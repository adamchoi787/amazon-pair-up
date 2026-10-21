import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";
import { type Deps } from "../src/market/service.js";
import { createMcpServer } from "../src/mcp/server.js";

// Things with no market price, no obvious buyer and no easy way to agree a
// deal: a one-of-a-kind item, a one-off job, a request that waits for the
// right person. The price comes from the two private limits alone.

const DIM = 256;
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
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return {
    call: async (name: string, args: Record<string, unknown>) => {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as { text: string }[])[0].text;
      return { ...JSON.parse(text), _raw: text, _isError: !!res.isError };
    },
    close: () => client.close(),
  };
}

test("a one-of-a-kind item with no reference price still settles from the two limits", async () => {
  const maker = await clientAs("maker_ana");
  const buyer = await clientAs("buyer_li");

  const posted = await maker.call("post_offer", {
    title: "Loft ladder", description: "Hand-built from cedar for a dorm bunk bed.",
    category: "furniture", ask_price: 60, min_price: 35, location: "UW campus",
  });
  assert.equal(posted._isError, false);
  assert.equal(posted.offer.typical_price, null, "nothing to compare against");

  const req = await buyer.call("post_request", { raw_request: "I need a loft ladder for my dorm bunk bed, max $45" });
  assert.equal(req.deal.offer_id, posted.offer.offer_id);
  assert.equal(req.deal.price, 45, "the buyer's budget clears the seller's private minimum");
  assert.ok(!req._raw.includes("min_price"), "the maker's minimum stays private");

  const done = await buyer.call("confirm_deal", { deal_id: req.deal.deal_id });
  assert.equal(done.deal.status, "confirmed");
  for (const c of [maker, buyer]) await c.close();
});

test("a one-off job waits for the right person, then pairs when they post", async () => {
  const mover = await clientAs("mover_sam");
  const asker = await clientAs("asker_jo");

  const req = await asker.call("post_request", {
    raw_request: "find someone to help carry a keyboard piano up three floors to my room, $30", kind: "service",
  });
  assert.equal(req.request.kind, "service");
  assert.equal(req.deal, null, "nobody can do it yet");
  assert.equal(req.request.status, "open", "the request stays open");

  const posted = await mover.call("post_offer", {
    kind: "service", title: "Help carrying heavy things up stairs", description: "Pianos, sofas, boxes. I bring a dolly.",
    category: "moving", ask_price: 25, min_price: 20, location: "UW campus",
  });
  assert.ok(posted.deal, "the waiting request is paired as soon as the mover posts");
  assert.equal(posted.deal.price, 25, "a $30 budget pays the mover's $25 asking price");
  for (const c of [mover, asker]) await c.close();
});
