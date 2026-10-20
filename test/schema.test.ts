import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";
import type { Deps } from "../src/market/service.js";
import { outputs } from "../src/mcp/schemas.js";
import { createMcpServer } from "../src/mcp/server.js";

// Every tool declares an output schema, and every real result matches it.
// The client below has listed the tools, so the SDK also validates each
// structuredContent against the declared schema on every call.

const DIM = 64;
let db: Db;
let deps: Deps;

before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
  deps = { db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.35 } };
});
after(async () => db.close());

async function clientAs(userId: string) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(deps, { userId }).connect(a);
  const client = new Client({ name: "schema-test", version: "0" });
  await client.connect(b);
  const { tools } = await client.listTools();
  return {
    tools,
    call: async <K extends keyof typeof outputs>(name: K, args: Record<string, unknown>) => {
      const res = await client.callTool({ name, arguments: args });
      assert.ok(!res.isError, `${name} failed: ${JSON.stringify(res.content)}`);
      const schema = z.object(outputs[name]).strict() as unknown as z.ZodType<z.infer<z.ZodObject<(typeof outputs)[K]>>>;
      return schema.parse(res.structuredContent);
    },
    close: () => client.close(),
  };
}

test("every tool declares an output schema and behaviour annotations", async () => {
  const c = await clientAs("inspector");
  assert.deepEqual(c.tools.map((t) => t.name).sort(), Object.keys(outputs).sort());
  for (const t of c.tools) {
    assert.equal(t.outputSchema?.type, "object", `${t.name} has an outputSchema`);
    assert.ok(t.outputSchema?.properties && "say" in t.outputSchema.properties, `${t.name} returns 'say'`);
    assert.equal(typeof t.annotations?.readOnlyHint, "boolean", `${t.name} says whether it writes`);
    assert.equal(t.annotations?.openWorldHint, false, `${t.name} acts only on the marketplace`);
    assert.ok(t.title && t.description, `${t.name} has a title and description`);
  }
  await c.close();
});

test("all tool results conform to their declared schemas", async () => {
  const seller = await clientAs("s");
  const buyer = await clientAs("b");

  await seller.call("post_offer", { title: "Scientific calculator", category: "calculator", ask_price: 12, min_price: 9 });
  const posted = await seller.call("post_offer", {
    title: "TI-84 Plus graphing calculator", category: "calculator", condition: "good",
    ask_price: 20, min_price: 15, location: "HKUST campus", availability: "weekdays after 5pm",
  });
  const req = await buyer.call("post_request", { raw_request: "I need a graphing calculator tomorrow, maximum $18" });
  assert.ok(req.deal, "paired");
  assert.equal(req.deal.offer_id, posted.offer.offer_id);
  assert.equal(req.deal.meetup.availability, "weekdays after 5pm");

  const more = await buyer.call("find_matches", { request_id: req.request.request_id });
  const pick = more.matches[0];
  assert.ok(pick, "an alternative exists");
  const switched = await buyer.call("negotiate", { request_id: req.request.request_id, offer_id: pick.offer_id });
  assert.ok(switched.deal);
  const no = await buyer.call("decline_deal", { deal_id: switched.deal.deal_id });
  assert.ok(no.next_deal, "the TI-84 comes back as the next offer");
  const yes = await buyer.call("confirm_deal", { deal_id: no.next_deal.deal_id });
  assert.equal(yes.deal.status, "confirmed");
  const status = await seller.call("get_deal_status", {});
  assert.ok(status.deals.length >= 1);

  for (const c of [seller, buyer]) await c.close();
});

test("service results conform too: errands, hourly work, posts", async () => {
  const runner = await clientAs("schema_runner");
  const helper = await clientAs("schema_helper");
  const client = await clientAs("schema_client");

  await runner.call("post_offer", {
    kind: "service", title: "Lunch runs around campus", category: "delivery", ask_price: 4, min_price: 3, location: "HKUST campus",
  });
  await helper.call("post_offer", {
    kind: "service", price_unit: "hour", title: "Event helper: setup and registration", category: "event", ask_price: 11, min_price: 9,
  });
  const lunch = await client.call("post_request", { raw_request: "find someone to pick up my lunch from LG7 canteen to Hall 5 by 12:30, $5" });
  assert.equal(lunch.deal?.kind, "service");
  const event = await client.call("post_request", { raw_request: "get me a guy to help with the event on Saturday 2-6pm, budget $10/hr" });
  assert.equal(event.deal?.price_unit, "hour");
  await client.call("confirm_deal", { deal_id: lunch.deal.deal_id });
  await runner.call("get_deal_status", {});
  await runner.call("confirm_deal", { deal_id: lunch.deal.deal_id });
  await helper.call("decline_deal", { deal_id: event.deal.deal_id });
  await runner.call("list_my_posts", {});
  const mine = await client.call("list_my_posts", {});
  await client.call("withdraw_post", { post_id: mine.requests[0].request_id });

  for (const c of [runner, helper, client]) await c.close();
});
