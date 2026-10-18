import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";
import { createListing, type Deps } from "../src/market/service.js";
import { createMcpServer } from "../src/mcp/server.js";

// Full tool flow against an in-memory Postgres+pgvector — no network, no AWS.

const DIM = 256;
let db: Db;
let deps: Deps;

before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
  deps = { db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.2 } };
  // Distractors
  await createListing(deps, { user_id: "u_other", title: "Casio scientific calculator", category: "calculator", ask_price: 12, min_price: 9 });
  await createListing(deps, { user_id: "u_other", title: "Yoga mat", category: "sports", ask_price: 7, min_price: 5 });
  await createListing(deps, { user_id: "u_other", title: "TI-Nspire graphing calculator", category: "calculator", ask_price: 45, min_price: 38 });
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

test("TI-84 demo: list → intent → match → negotiate → confirm", async () => {
  const seller = await clientAs("seller");
  const buyer = await clientAs("buyer");

  const { listing } = await seller.call("create_listing", {
    title: "TI-84 Plus graphing calculator", category: "calculator", ask_price: 20, min_price: 15, location: "HKUST campus",
  });
  assert.equal(listing.your_min_price, 15, "seller sees own reserve");

  const { intent } = await buyer.call("create_buy_intent", { raw_request: "I need a graphing calculator today, maximum $18" });
  assert.equal(intent.your_max_price, 18, "budget extracted from speech");
  assert.ok(intent.needed_by, "deadline extracted");

  const found = await buyer.call("find_matches", { intent_id: intent.intent_id });
  assert.equal(found.matches[0].listing_id, listing.listing_id, "TI-84 ranks first");
  assert.ok(!found.matches.some((m: { title: string }) => m.title.includes("Nspire")), "over-budget reserve filtered out");
  assert.ok(!found._raw.includes("min_price"), "buyer never sees seller reserve");

  const neg = await buyer.call("negotiate", { intent_id: intent.intent_id, listing_id: listing.listing_id });
  assert.equal(neg.deal.price, 17);
  assert.equal(neg.deal.seller_confirmed, true, "seller pre-authorised via auto_accept");
  assert.equal(neg.deal.status, "proposed", "buyer must still confirm");

  const done = await buyer.call("confirm_deal", { deal_id: neg.deal.deal_id });
  assert.equal(done.deal.status, "confirmed");

  const status = await seller.call("get_deal_status", {});
  assert.equal(status.deals[0].your_role, "seller");
  assert.ok(!status._raw.includes("max_price"), "seller never sees buyer budget");

  await seller.close();
  await buyer.close();
});

test("no overlap returns a speakable refusal without numbers", async () => {
  const seller = await clientAs("seller2");
  const buyer = await clientAs("buyer2");
  const { listing } = await seller.call("create_listing", { title: "Rice cooker", category: "kitchen", ask_price: 30, min_price: 25 });
  const { intent } = await buyer.call("create_buy_intent", { need: "rice cooker", max_price: 40 });
  // Force a below-reserve budget directly to test the negotiation guard.
  await db.query(`UPDATE buy_intents SET max_price = 10 WHERE id = $1`, [intent.intent_id]);
  const neg = await buyer.call("negotiate", { intent_id: intent.intent_id, listing_id: listing.listing_id });
  assert.equal(neg.deal, null);
  assert.ok(!/\d/.test(neg.say), "no numbers in refusal");
  await seller.close();
  await buyer.close();
});

test("missing budget asks for it instead of guessing", async () => {
  const buyer = await clientAs("buyer3");
  const res = await buyer.call("create_buy_intent", { raw_request: "I need an umbrella" });
  assert.equal(res._isError, true);
  assert.match(res.say, /most you'd pay/);
  await buyer.close();
});
