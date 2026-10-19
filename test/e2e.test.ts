import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";
import { createListing, type Deps } from "../src/market/service.js";
import { createMcpServer } from "../src/mcp/server.js";

// The full tool surface against an in-memory Postgres + pgvector, over a real
// MCP client. No network, no AWS. One test per pairing-engine guarantee.

const DIM = 256;
let db: Db;
let deps: Deps;

before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
  deps = { db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.35 } };
  // Distractors near the demo item
  await createListing(deps, { user_id: "u_other", title: "Casio fx-991EX scientific calculator", description: "Not graphing.", category: "calculator", ask_price: 12, min_price: 9 });
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
      return { ...JSON.parse(text), _raw: text, _isError: !!res.isError, _structured: res.structuredContent };
    },
    close: () => client.close(),
  };
}

const proposedDeals = async (listingId: string) =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM deals WHERE listing_id = $1 AND status = 'proposed'`, [listingId])).rows[0].n;

test("TI-84 demo: a buyer's request is paired and negotiated in one turn", async () => {
  const seller = await clientAs("seller");
  const buyer = await clientAs("buyer");

  const posted = await seller.call("create_listing", {
    title: "TI-84 Plus graphing calculator", category: "calculator", ask_price: 20, min_price: 15, location: "HKUST campus",
  });
  assert.equal(posted.listing.your_min_price, 15, "seller sees own reserve");
  assert.equal(posted.deal, null, "no buyer waiting yet");
  assert.match(posted.say, /pair you with a buyer/);

  const req = await buyer.call("create_buy_intent", { raw_request: "I need a graphing calculator today, maximum $18" });
  assert.equal(req.intent.your_max_price, 18, "budget extracted from speech");
  assert.ok(req.intent.needed_by, "deadline extracted");
  assert.equal(req.intent.status, "matched");
  assert.equal(req.deal.listing_id, posted.listing.listing_id, "TI-84 beats the non-graphing Casio");
  assert.equal(req.deal.price, 17);
  assert.equal(req.deal.saved_vs_ask, 3);
  assert.equal(req.deal.counterpart, "seller");
  assert.deepEqual(req.deal.meetup, { place: "HKUST campus", availability: null });
  assert.equal(req.deal.seller_confirmed, true, "seller pre-authorised via auto_accept");
  assert.equal(req.deal.waiting_for_you, true, "buyer must still say yes");
  assert.match(req.say, /\$17, \$3 below asking.*Should I confirm it\?/);
  assert.ok(req.alternatives.length <= 4);
  assert.ok(!req.alternatives.some((m: { title: string }) => /Nspire/.test(m.title)), "over-budget reserve filtered out");
  assert.ok(!req.alternatives.some((m: { listing_id: string }) => m.listing_id === posted.listing.listing_id), "held item isn't repeated");
  assert.ok(!req._raw.includes("min_price"), "buyer never sees seller reserve");
  assert.deepEqual(req._structured, JSON.parse(req._raw), "structuredContent mirrors the text result");

  const done = await buyer.call("confirm_deal", { deal_id: req.deal.deal_id });
  assert.equal(done.deal.status, "confirmed");
  assert.match(done.say, /Done! .* with seller\. Meet-up: HKUST campus\./);

  const status = await seller.call("get_deal_status", {});
  assert.equal(status.deals[0].your_role, "seller");
  assert.equal(status.deals[0].counterpart, "buyer");
  assert.ok(!status._raw.includes("max_price"), "seller never sees buyer budget");

  for (const c of [seller, buyer]) await c.close();
});

test("a new listing is paired with the best waiting buyer; budgets stay private", async () => {
  const early = await clientAs("buyer_early");
  const late = await clientAs("buyer_late");
  const cheap = await clientAs("buyer_cheap");
  const seller = await clientAs("seller_umbrella");

  const a = await early.call("create_buy_intent", { need: "umbrella", max_price: 16.25, location: "HKUST campus" });
  const b = await late.call("create_buy_intent", { need: "rain umbrella", max_price: 13.75 });
  await cheap.call("create_buy_intent", { need: "umbrella", max_price: 6.5 }); // below the seller's reserve
  assert.equal(a.deal, null);
  assert.match(a.say, /keep looking and pair you/);

  const res = await seller.call("create_listing", {
    title: "Compact travel umbrella", category: "umbrella", ask_price: 12, min_price: 10, location: "HKUST campus",
  });
  assert.equal(res.waiting_buyers, 2, "both buyers within reach of the reserve are waiting");
  assert.equal(res.deal.counterpart, "buyer_early", "same-area buyer is paired first");
  assert.equal(res.deal.price, 11);
  assert.match(res.say, /A buyer was already looking for one: I agreed \$11, inside your limit, and asked them to confirm\. One more person is looking too\./);
  for (const budget of ["16.25", "13.75", "6.5", "max_price"]) assert.ok(!res._raw.includes(budget), `${budget} hidden from the seller`);

  const inbox = await early.call("get_deal_status", {});
  assert.equal(inbox.waiting_for_you, 1);
  assert.equal(inbox.deals[0].deal_id, res.deal.deal_id);
  assert.match(inbox.say, /^One deal is waiting for your yes\./);
  assert.ok(!inbox._raw.includes("min_price"));

  // Declining re-pairs the listing with the next buyer and never repeats the declined pair.
  const no = await early.call("decline_deal", { deal_id: res.deal.deal_id });
  assert.equal(no.status, "declined");
  assert.equal(no.next_deal, null, "no other umbrella for the early buyer");
  const lateInbox = await late.call("get_deal_status", {});
  assert.equal(lateInbox.deals[0].listing_id, res.listing.listing_id, "listing re-paired with the next buyer");
  assert.equal(lateInbox.deals[0].waiting_for_you, true);

  await late.call("decline_deal", { deal_id: lateInbox.deals[0].deal_id });
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM listings WHERE id = $1`, [res.listing.listing_id]);
  assert.equal(rows[0].status, "active", "no buyer left who hasn't declined it");
  const again = await early.call("find_matches", { intent_id: a.intent.intent_id });
  assert.ok(!again.matches.some((m: { listing_id: string }) => m.listing_id === res.listing.listing_id), "declined pair stays apart");

  for (const c of [early, late, cheap, seller]) await c.close();
});

test("a listing is held by one deal at a time, even when buyers arrive together", async () => {
  const seller = await clientAs("seller_lamp");
  const { listing } = await seller.call("create_listing", { title: "Desk lamp", category: "lamp", ask_price: 8, min_price: 6 });
  const buyers = await Promise.all(["lamp_b1", "lamp_b2", "lamp_b3"].map(clientAs));
  const results = await Promise.all(buyers.map((b) => b.call("create_buy_intent", { need: "desk lamp", max_price: 8 })));

  assert.equal(results.filter((r) => r.deal?.listing_id === listing.listing_id).length, 1, "exactly one buyer gets it");
  assert.equal(await proposedDeals(listing.listing_id), 1);
  for (const c of [seller, ...buyers]) await c.close();
});

test("choosing another option moves the request's single deal to it", async () => {
  const s1 = await clientAs("tissue_s1");
  const s2 = await clientAs("tissue_s2");
  const buyer = await clientAs("tissue_buyer");
  const first = await s1.call("create_listing", { title: "Pocket tissues, 10 packs", category: "tissue", condition: "new", ask_price: 2, min_price: 1 });
  const second = await s2.call("create_listing", { title: "Pocket tissues, 6 packs", category: "tissue", condition: "new", ask_price: 1.5, min_price: 1 });

  const req = await buyer.call("create_buy_intent", { need: "pocket tissues", max_price: 3 });
  const other = req.deal.listing_id === first.listing.listing_id ? second : first;
  const held = req.deal.listing_id;

  const switched = await buyer.call("negotiate", { intent_id: req.intent.intent_id, listing_id: other.listing.listing_id });
  assert.equal(switched.deal.listing_id, other.listing.listing_id);
  assert.equal(await proposedDeals(held), 0, "the previous hold is released");
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM deals WHERE buy_intent_id = $1 AND status = 'proposed'`, [req.intent.intent_id]);
  assert.equal(rows[0].n, 1, "one proposed deal per request");

  const repeat = await buyer.call("negotiate", { intent_id: req.intent.intent_id, listing_id: other.listing.listing_id });
  assert.equal(repeat.deal.deal_id, switched.deal.deal_id, "asking again returns the same deal");
  for (const c of [s1, s2, buyer]) await c.close();
});

test("no overlap returns a speakable refusal without numbers", async () => {
  const seller = await clientAs("seller2");
  const buyer = await clientAs("buyer2");
  const { listing } = await seller.call("create_listing", { title: "Rice cooker", category: "kitchen", ask_price: 30, min_price: 25 });
  const req = await buyer.call("create_buy_intent", { need: "rice cooker", max_price: 20 });
  assert.equal(req.deal, null, "below the reserve: not paired");
  const neg = await buyer.call("negotiate", { intent_id: req.intent.intent_id, listing_id: listing.listing_id });
  assert.equal(neg.deal, null);
  assert.ok(!/\d/.test(neg.say), "no numbers in refusal");
  for (const c of [seller, buyer]) await c.close();
});

test("a seller without auto-accept gives the final yes", async () => {
  const seller = await clientAs("seller_bike");
  const buyer = await clientAs("buyer_bike");
  await seller.call("create_listing", { title: "Bike lock", category: "bike", ask_price: 10, min_price: 8, auto_accept: false });
  const req = await buyer.call("create_buy_intent", { need: "bike lock", max_price: 10 });
  assert.equal(req.deal.seller_confirmed, false);
  assert.match(req.say, /The seller gives the final yes\./);

  const half = await buyer.call("confirm_deal", { deal_id: req.deal.deal_id });
  assert.equal(half.deal.status, "proposed");
  assert.deepEqual(half.deal.waiting_for, ["seller"]);

  const inbox = await seller.call("get_deal_status", {});
  assert.equal(inbox.deals[0].waiting_for_you, true);
  const done = await seller.call("confirm_deal", { deal_id: req.deal.deal_id });
  assert.equal(done.deal.status, "confirmed");
  for (const c of [seller, buyer]) await c.close();
});

test("expired requests are not paired, and past deadlines are refused", async () => {
  const buyer = await clientAs("buyer_late_night");
  const seller = await clientAs("seller_kettle");
  const req = await buyer.call("create_buy_intent", { need: "electric kettle", max_price: 15 });
  await db.query(`UPDATE buy_intents SET needed_by = now() - interval '1 hour' WHERE id = $1`, [req.intent.intent_id]);

  const posted = await seller.call("create_listing", { title: "Electric kettle", category: "kitchen", ask_price: 12, min_price: 10 });
  assert.equal(posted.deal, null);
  assert.equal(posted.waiting_buyers, 0);

  const past = await buyer.call("create_buy_intent", { need: "kettle", max_price: 15, needed_by: "2020-01-01T00:00:00Z" });
  assert.equal(past._isError, true);
  assert.match(past.say, /already passed/);
  for (const c of [buyer, seller]) await c.close();
});

test("missing budget asks for it instead of guessing", async () => {
  const buyer = await clientAs("buyer3");
  const res = await buyer.call("create_buy_intent", { raw_request: "I need an umbrella" });
  assert.equal(res._isError, true);
  assert.match(res.say, /most you'd pay/);
  await buyer.close();
});

test("only the two parties can see or act on a deal", async () => {
  const seller = await clientAs("seller_mug");
  const buyer = await clientAs("buyer_mug");
  const stranger = await clientAs("stranger");
  await seller.call("create_listing", { title: "Travel mug", category: "mug", ask_price: 6, min_price: 4 });
  const req = await buyer.call("create_buy_intent", { need: "travel mug", max_price: 6 });
  for (const tool of ["confirm_deal", "decline_deal"]) {
    const res = await stranger.call(tool, { deal_id: req.deal.deal_id });
    assert.equal(res._isError, true);
    assert.match(res.say, /not part of this deal/);
  }
  const peek = await stranger.call("get_deal_status", { deal_id: req.deal.deal_id });
  assert.equal(peek._isError, true);
  for (const c of [seller, buyer, stranger]) await c.close();
});
