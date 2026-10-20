import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";
import { postOffer, type Deps } from "../src/market/service.js";
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
  await postOffer(deps, { user_id: "u_other", title: "Casio fx-991EX scientific calculator", description: "Not graphing.", category: "calculator", ask_price: 12, min_price: 9 });
  await postOffer(deps, { user_id: "u_other", title: "Yoga mat", category: "sports", ask_price: 7, min_price: 5 });
  await postOffer(deps, { user_id: "u_other", title: "TI-Nspire graphing calculator", category: "calculator", ask_price: 45, min_price: 38 });
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

/** A price in tool output, ignoring timestamps and ids that happen to contain the digits. */
const mentionsAmount = (raw: string, amount: number) =>
  new RegExp(String.raw`(?<![\w.-])\$?${amount}(?:\.0+)?(?![\w:-]|\.\d)`).test(raw.replace(/"\d{4}-\d\d-\d\dT[^"]*"/g, '""'));

const proposedDeals = async (listingId: string) =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM deals WHERE listing_id = $1 AND status = 'proposed'`, [listingId])).rows[0].n;

test("TI-84 demo: a buyer's request is paired and negotiated in one turn", async () => {
  const seller = await clientAs("seller");
  const buyer = await clientAs("buyer");

  const posted = await seller.call("post_offer", {
    title: "TI-84 Plus graphing calculator", category: "calculator", ask_price: 20, min_price: 15, location: "UW campus",
  });
  assert.equal(posted.offer.your_min_price, 15, "seller sees own reserve");
  assert.equal(posted.deal, null, "no buyer waiting yet");
  assert.match(posted.say, /pair you with a buyer/);

  const req = await buyer.call("post_request", { raw_request: "I need a graphing calculator today, maximum $18" });
  assert.equal(req.request.your_max_price, 18, "budget extracted from speech");
  assert.ok(req.request.needed_by, "deadline extracted");
  assert.equal(req.request.status, "matched");
  assert.equal(req.deal.offer_id, posted.offer.offer_id, "TI-84 beats the non-graphing Casio");
  assert.equal(req.deal.price, 18, "a budget below the ask is the buyer's offer");
  assert.equal(req.deal.saved_vs_ask, 2);
  assert.equal(req.deal.counterpart, "seller");
  assert.deepEqual(req.deal.meetup, { place: "UW campus", availability: null, hub_point: null, point: null }, "the buyer gave no area, so no Hub point");
  assert.equal(req.deal.seller_confirmed, true, "seller pre-authorised via auto_accept");
  assert.equal(req.deal.waiting_for_you, true, "buyer must still say yes");
  assert.match(req.say, /\$18, \$2 below asking.*Should I confirm it\?/);
  assert.ok(req.alternatives.length <= 4);
  assert.ok(!req.alternatives.some((m: { title: string }) => /Casio/.test(m.title)), "an explicit not-graphing disclaimer excludes the scientific calculator");
  assert.ok(!req.alternatives.some((m: { title: string }) => /Nspire/.test(m.title)), "over-budget reserve filtered out");
  assert.ok(!req.alternatives.some((m: { offer_id: string }) => m.offer_id === posted.offer.offer_id), "held item isn't repeated");
  assert.ok(!req._raw.includes("min_price"), "buyer never sees seller reserve");
  assert.deepEqual(req._structured, JSON.parse(req._raw), "structuredContent mirrors the text result");

  const done = await buyer.call("confirm_deal", { deal_id: req.deal.deal_id });
  assert.equal(done.deal.status, "confirmed");
  assert.match(done.say, /Done! .* with seller\. Meet-up: UW campus\./);

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

  const a = await early.call("post_request", { need: "umbrella", max_price: 16.25, location: "UW campus" });
  const b = await late.call("post_request", { need: "rain umbrella", max_price: 13.75 });
  await cheap.call("post_request", { need: "umbrella", max_price: 6.5 }); // below the seller's reserve
  assert.equal(a.deal, null);
  assert.match(a.say, /keep looking and pair you/);

  const res = await seller.call("post_offer", {
    title: "Compact travel umbrella", category: "umbrella", ask_price: 12, min_price: 10, location: "UW campus",
  });
  assert.equal(res.waiting_requests, 2, "both buyers within reach of the reserve are waiting");
  assert.equal(res.deal.counterpart, "buyer_early", "same-area buyer is paired first");
  assert.equal(res.deal.price, 12, "a budget above the ask pays the ask");
  assert.match(res.say, /A buyer was already looking for one: they'll pay your asking price of \$12\. I've asked them to confirm\. One more person is looking too\./);
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
  assert.equal(lateInbox.deals[0].offer_id, res.offer.offer_id, "listing re-paired with the next buyer");
  assert.equal(lateInbox.deals[0].waiting_for_you, true);

  await late.call("decline_deal", { deal_id: lateInbox.deals[0].deal_id });
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM listings WHERE id = $1`, [res.offer.offer_id]);
  assert.equal(rows[0].status, "active", "no buyer left who hasn't declined it");
  const again = await early.call("find_matches", { request_id: a.request.request_id });
  assert.ok(!again.matches.some((m: { offer_id: string }) => m.offer_id === res.offer.offer_id), "declined pair stays apart");

  for (const c of [early, late, cheap, seller]) await c.close();
});

test("a buyer who walks away from a price can't come back lower; the seller's minimum stays hidden", async () => {
  const seller = await clientAs("seller_fan");
  const buyer = await clientAs("buyer_fan");
  const { offer } = await seller.call("post_offer", { title: "Quiet desk fan", category: "fan", ask_price: 20, min_price: 12 });

  const first = await buyer.call("post_request", { need: "desk fan", max_price: 25 });
  assert.equal(first.deal.offer_id, offer.offer_id);
  assert.equal(first.deal.price, 20, "a budget above the ask pays the ask, whatever the minimum");
  await buyer.call("decline_deal", { deal_id: first.deal.deal_id });

  // $15 clears the seller's $12 minimum, but this buyer already turned down $20 for this fan.
  const lower = await buyer.call("post_request", { need: "desk fan", max_price: 15 });
  assert.equal(lower.deal, null, "no stepping down toward the minimum");

  // Another buyer can make that offer, and the first buyer can come back at the price they left.
  const other = await clientAs("buyer_fan_2");
  const fair = await other.call("post_request", { need: "desk fan", max_price: 15 });
  assert.equal(fair.deal?.price, 15, "another buyer's $15 offer clears the minimum");
  await other.call("decline_deal", { deal_id: fair.deal.deal_id });
  const back = await buyer.call("post_request", { need: "desk fan", max_price: 20 });
  assert.equal(back.deal?.offer_id, offer.offer_id);
  assert.equal(back.deal.price, 20);
  await buyer.call("withdraw_post", { post_id: lower.request.request_id });
  for (const c of [seller, buyer, other]) await c.close();
});

test("a listing is held by one deal at a time, even when buyers arrive together", async () => {
  const seller = await clientAs("seller_lamp");
  const { offer: listing } = await seller.call("post_offer", { title: "Desk lamp", category: "lamp", ask_price: 8, min_price: 6 });
  const buyers = await Promise.all(["lamp_b1", "lamp_b2", "lamp_b3"].map(clientAs));
  const results = await Promise.all(buyers.map((b) => b.call("post_request", { need: "desk lamp", max_price: 8 })));

  assert.equal(results.filter((r) => r.deal?.offer_id === listing.offer_id).length, 1, "exactly one buyer gets it");
  assert.equal(await proposedDeals(listing.offer_id), 1);
  for (const c of [seller, ...buyers]) await c.close();
});

test("choosing another option moves the request's single deal to it", async () => {
  const s1 = await clientAs("tissue_s1");
  const s2 = await clientAs("tissue_s2");
  const buyer = await clientAs("tissue_buyer");
  const first = await s1.call("post_offer", { title: "Pocket tissues, 10 packs", category: "tissue", condition: "new", ask_price: 2, min_price: 1 });
  const second = await s2.call("post_offer", { title: "Pocket tissues, 6 packs", category: "tissue", condition: "new", ask_price: 1.5, min_price: 1 });

  const req = await buyer.call("post_request", { need: "pocket tissues", max_price: 3 });
  const other = req.deal.offer_id === first.offer.offer_id ? second : first;
  const held = req.deal.offer_id;

  const switched = await buyer.call("negotiate", { request_id: req.request.request_id, offer_id: other.offer.offer_id });
  assert.equal(switched.deal.offer_id, other.offer.offer_id);
  assert.equal(await proposedDeals(held), 0, "the previous hold is released");
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM deals WHERE buy_intent_id = $1 AND status = 'proposed'`, [req.request.request_id]);
  assert.equal(rows[0].n, 1, "one proposed deal per request");

  const repeat = await buyer.call("negotiate", { request_id: req.request.request_id, offer_id: other.offer.offer_id });
  assert.equal(repeat.deal.deal_id, switched.deal.deal_id, "asking again returns the same deal");
  for (const c of [s1, s2, buyer]) await c.close();
});

test("no overlap names only the public asking price, and a yes buys at it", async () => {
  const seller = await clientAs("seller2");
  const buyer = await clientAs("buyer2");
  const { offer: listing } = await seller.call("post_offer", { title: "Rice cooker", category: "kitchen", ask_price: 30, min_price: 25 });
  const req = await buyer.call("post_request", { need: "rice cooker", max_price: 20 });
  assert.equal(req.deal, null, "below the reserve: not paired");
  assert.match(req.say, /Rice cooker is asking \$30, .*Want it at that price\?/);
  assert.equal(req.alternatives[0].offer_id, listing.offer_id, "the closest offer is listed at its asking price");
  assert.equal(req.alternatives[0].within_budget_at_ask, false);
  const neg = await buyer.call("negotiate", { request_id: req.request.request_id, offer_id: listing.offer_id });
  assert.equal(neg.deal, null);
  assert.equal(neg.say, "The seller can't go that low. It's $30. Want it at that price?");
  assert.ok(!mentionsAmount(req._raw + neg._raw, 25), "the seller's minimum never shows");

  const lower = await buyer.call("negotiate", { request_id: req.request.request_id, offer_id: listing.offer_id, max_price: 15 });
  assert.ok(lower._isError, "a request's budget only goes up");
  const yes = await buyer.call("negotiate", { request_id: req.request.request_id, offer_id: listing.offer_id, max_price: 30 });
  assert.equal(yes.deal.price, 30);
  await buyer.call("decline_deal", { deal_id: yes.deal.deal_id });
  for (const c of [seller, buyer]) await c.close();
});

test("one offer below the asking price: rising budgets can't climb to the seller's minimum", async () => {
  const seller = await clientAs("seller_speaker");
  const prober = await clientAs("prober_speaker");
  const { offer } = await seller.call("post_offer", { title: "Bluetooth speaker", category: "audio", ask_price: 40, min_price: 30 });

  // Step up from below: the first no fixes the price at the ask for this buyer.
  const first = await prober.call("post_request", { need: "bluetooth speaker", max_price: 20 });
  assert.equal(first.deal, null);
  for (const budget of [28, 31, 35, 39.99]) {
    const again = await prober.call("post_request", { need: "bluetooth speaker", max_price: budget });
    assert.equal(again.deal, null, `$${budget} clears the $30 minimum, but this buyer's offer already failed`);
    assert.match(again.say, /asking \$40/);
    const neg = await prober.call("negotiate", { request_id: again.request.request_id, offer_id: offer.offer_id });
    assert.equal(neg.deal, null);
    await prober.call("withdraw_post", { post_id: again.request.request_id });
  }

  // The rule is per listing: a new listing gets this buyer's first offer, made by a request already waiting.
  const waiting = await prober.call("post_request", { need: "bluetooth speaker", max_price: 33 });
  assert.equal(waiting.deal, null);
  const second = await seller.call("post_offer", { title: "Bluetooth speaker, second one", category: "audio", ask_price: 40, min_price: 30 });
  assert.equal(second.deal?.price, 33);
  await prober.call("withdraw_post", { post_id: waiting.request.request_id });

  // Another buyer's first offer still clears the minimum.
  const other = await clientAs("other_speaker");
  const fair = await other.call("post_request", { need: "bluetooth speaker", max_price: 32 });
  assert.equal(fair.deal?.price, 32);
  for (const c of [seller, prober, other]) await c.close();
});

test("a seller without auto-accept gives the final yes", async () => {
  const seller = await clientAs("seller_bike");
  const buyer = await clientAs("buyer_bike");
  await seller.call("post_offer", { title: "Bike lock", category: "bike", ask_price: 10, min_price: 8, auto_accept: false });
  const req = await buyer.call("post_request", { need: "bike lock", max_price: 10 });
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
  const req = await buyer.call("post_request", { need: "electric kettle", max_price: 15 });
  await db.query(`UPDATE buy_intents SET needed_by = now() - interval '1 hour' WHERE id = $1`, [req.request.request_id]);

  const posted = await seller.call("post_offer", { title: "Electric kettle", category: "kitchen", ask_price: 12, min_price: 10 });
  assert.equal(posted.deal, null);
  assert.equal(posted.waiting_requests, 0);

  const past = await buyer.call("post_request", { need: "kettle", max_price: 15, needed_by: "2020-01-01T00:00:00Z" });
  assert.equal(past._isError, true);
  assert.match(past.say, /already passed/);
  for (const c of [buyer, seller]) await c.close();
});

test("missing budget asks for it instead of guessing", async () => {
  const buyer = await clientAs("buyer3");
  const res = await buyer.call("post_request", { raw_request: "I need an umbrella" });
  assert.equal(res._isError, true);
  assert.match(res.say, /most you'd pay/);
  await buyer.close();
});

test("only the two parties can see or act on a deal", async () => {
  const seller = await clientAs("seller_mug");
  const buyer = await clientAs("buyer_mug");
  const stranger = await clientAs("stranger");
  await seller.call("post_offer", { title: "Travel mug", category: "mug", ask_price: 6, min_price: 4 });
  const req = await buyer.call("post_request", { need: "travel mug", max_price: 6 });
  for (const tool of ["confirm_deal", "decline_deal"]) {
    const res = await stranger.call(tool, { deal_id: req.deal.deal_id });
    assert.equal(res._isError, true);
    assert.match(res.say, /not part of this deal/);
  }
  const peek = await stranger.call("get_deal_status", { deal_id: req.deal.deal_id });
  assert.equal(peek._isError, true);
  for (const c of [seller, buyer, stranger]) await c.close();
});

test("an unanswered offer expires, frees the item and pairs the next buyer", async () => {
  const seller = await clientAs("seller_stand");
  const slow = await clientAs("buyer_slow");
  const quick = await clientAs("buyer_quick");
  await slow.call("post_request", { need: "monitor stand", max_price: 20 });
  const posted = await seller.call("post_offer", { title: "Monitor stand", category: "stand", ask_price: 15, min_price: 12 });
  assert.equal(posted.deal.counterpart, "buyer_slow");
  assert.ok(posted.deal.on_hold_until, "offers say when they expire");
  const quickReq = await quick.call("post_request", { need: "monitor stand", max_price: 20 });
  assert.equal(quickReq.deal, null, "the stand is on hold for the first buyer");

  await db.query(`UPDATE deals SET expires_at = now() - interval '1 minute' WHERE id = $1`, [posted.deal.deal_id]);
  const inbox = await quick.call("get_deal_status", {});
  assert.equal(inbox.deals[0].offer_id, posted.offer.offer_id, "freed item goes to the next buyer");
  assert.equal(inbox.deals[0].waiting_for_you, true);

  const late = await slow.call("confirm_deal", { deal_id: posted.deal.deal_id });
  assert.equal(late._isError, true);
  assert.match(late.say, /expired/);
  const slowStatus = await slow.call("get_deal_status", { deal_id: posted.deal.deal_id });
  assert.equal(slowStatus.deals[0].status, "expired");
  for (const c of [seller, slow, quick]) await c.close();
});

test("users can list and withdraw their own posts; held deals are released", async () => {
  const seller = await clientAs("seller_chair");
  const buyer = await clientAs("buyer_chair");
  const other = await clientAs("seller_chair_2");
  const { offer: listing } = await seller.call("post_offer", { title: "Folding chair", category: "chair", ask_price: 9, min_price: 7 });
  const backup = await other.call("post_offer", { title: "Folding chair, blue", category: "chair", ask_price: 10, min_price: 8 });
  const req = await buyer.call("post_request", { need: "folding chair", max_price: 10 });
  assert.equal(req.deal.offer_id, listing.offer_id);

  const mine = await seller.call("list_my_posts", {});
  assert.deepEqual(mine.offers.map((l: { offer_id: string }) => l.offer_id), [listing.offer_id]);
  assert.match(mine.say, /one item for sale: Folding chair/);

  const stolen = await buyer.call("withdraw_post", { post_id: listing.offer_id });
  assert.equal(stolen._isError, true, "only the owner can withdraw");

  const down = await seller.call("withdraw_post", { post_id: listing.offer_id });
  assert.equal(down.status, "withdrawn");
  assert.equal(down.released_deal_id, req.deal.deal_id);
  const inbox = await buyer.call("get_deal_status", {});
  assert.equal(inbox.deals[0].offer_id, backup.offer.offer_id, "buyer is paired with the other chair");
  assert.equal(inbox.deals.find((d: { deal_id: string }) => d.deal_id === req.deal.deal_id).status, "withdrawn");

  const cancel = await buyer.call("withdraw_post", { post_id: req.request.request_id });
  assert.equal(cancel.status, "cancelled");
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM listings WHERE id = $1`, [backup.offer.offer_id]);
  assert.equal(rows[0].status, "active", "the blue chair is back on the market");
  for (const c of [seller, buyer, other]) await c.close();
});

// ---------- Services: the same engine pairs people who need a task done ----------

test("lunch run: a request is paired with a runner in one turn, and the runner takes the job", async () => {
  const runner = await clientAs("runner_ken");
  const other = await clientAs("lunchbox_seller");
  const hungry = await clientAs("hungry_mei");

  // An item that shares words with the request must never stand in for a service.
  await other.call("post_offer", { title: "Lunch box with chopsticks", category: "kitchen", ask_price: 4, min_price: 3 });
  const runs = await runner.call("post_offer", {
    kind: "service", title: "Lunch runs around campus", description: "I pick up food from any canteen and bring it to your hall.",
    category: "delivery", ask_price: 4, min_price: 3, location: "UW campus", availability: "weekdays 11am-2pm",
  });
  assert.equal(runs.offer.kind, "service");
  assert.equal(runs.offer.price_unit, "job");
  assert.equal(runs.offer.condition, null, "services have no condition");
  assert.equal(runs.offer.auto_accept, false, "a provider says yes to each job by default");
  assert.match(runs.say, /You're on the market: Lunch runs around campus, \$4 a job\..*I'll bring you jobs as people ask\./);

  const req = await hungry.call("post_request", { raw_request: "find someone to pick up my lunch from the HUB to McCarty Hall by 12:30, $5", needed_by: "2099-01-05T12:30:00-08:00" });
  assert.equal(req.request.kind, "service");
  assert.equal(req.request.need, "pick up my lunch");
  assert.equal(req.request.pickup, "the HUB");
  assert.equal(req.request.location, "McCarty Hall");
  assert.equal(req.request.your_max_price, 5);
  assert.equal(req.deal.offer_id, runs.offer.offer_id, "paired with the runner, not the lunch box");
  assert.equal(req.deal.kind, "service");
  assert.equal(req.deal.price, 4, "a $5 budget pays the runner's $4 rate");
  assert.equal(req.deal.total, 4);
  assert.equal(req.deal.pickup, "the HUB");
  assert.deepEqual(req.deal.meetup, { place: "McCarty Hall", availability: "by 12:30", hub_point: null, point: null }, "the job happens where and when the requester needs it");
  assert.ok(new Date(req.deal.on_hold_until) <= new Date(req.request.needed_by), "a lunch offer never outlives lunch");
  assert.ok(!req.alternatives.some((m: { kind: string }) => m.kind !== "service"), "only services as alternatives");
  assert.match(req.say, /^Found someone: runner_ken can do it for \$4\. From the HUB to McCarty Hall, by 12:30\. The helper still needs to check the time\. Should I confirm\? runner_ken gives the final yes\.$/);
  assert.ok(!req._raw.includes("min_price"), "the runner's minimum stays private");

  const half = await hungry.call("confirm_deal", { deal_id: req.deal.deal_id });
  assert.deepEqual(half.deal.waiting_for, ["seller"]);
  assert.match(half.say, /I'll let you know when runner_ken says yes\./);

  const jobs = await runner.call("get_deal_status", {});
  assert.equal(jobs.deals[0].task, "pick up my lunch", "the runner hears the task");
  assert.equal(jobs.deals[0].waiting_for_you, true);
  assert.match(jobs.say, /^One deal is waiting for your yes\. Pick up my lunch for hungry_mei, \$4: waiting for your yes\./);
  assert.ok(!jobs._raw.includes("max_price") && !jobs._raw.includes('"5"'), "the requester's budget stays private");

  const booked = await runner.call("confirm_deal", { deal_id: req.deal.deal_id });
  assert.equal(booked.deal.status, "confirmed");
  assert.match(booked.say, /^Booked! Lunch runs around campus with hungry_mei, \$4\. From the HUB to McCarty Hall, by 12:30\.$/);

  // A service offer stands: the runner gets the next job.
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM listings WHERE id = $1`, [runs.offer.offer_id]);
  assert.equal(rows[0].status, "active");
  const second = await clientAs("hungry_tom");
  const next = await second.call("post_request", { raw_request: "can someone bring me lunch from the Chinese restaurant to the library by 1pm, up to $4", needed_by: "2099-01-05T13:00:00-08:00" });
  assert.equal(next.deal.offer_id, runs.offer.offer_id);
  for (const c of [runner, other, hungry, second]) await c.close();
});

test("event help: an hourly rate is settled and the total is shown for the hours", async () => {
  const helper = await clientAs("helper_priya");
  const flat = await clientAs("helper_flat");
  const organiser = await clientAs("organiser_ana");
  await flat.call("post_offer", { kind: "service", price_unit: "job", title: "Event setup crew, one flat fee", category: "event", ask_price: 30, min_price: 25 });
  const offer = await helper.call("post_offer", {
    kind: "service", price_unit: "hour", title: "Event helper: setup, registration, ushering", category: "event",
    ask_price: 11, min_price: 9, location: "UW campus", availability: "weekends", auto_accept: true,
  });
  assert.match(offer.say, /\$11 an hour\. I'll accept down to \$9 an hour without asking you/);

  const req = await organiser.call("post_request", { raw_request: "get me a guy to help with the event on Saturday 2-6pm, budget $10/hr" });
  assert.equal(req.request.price_unit, "hour");
  assert.equal(req.request.hours, 4);
  assert.equal(req.request.schedule, "Saturday 2-6pm");
  assert.equal(req.deal.offer_id, offer.offer.offer_id, "an hourly request pairs with hourly work only");
  assert.equal(req.deal.price, 10, "the $10 budget is the offer; it clears the $9 minimum");
  assert.equal(req.deal.hours, 4);
  assert.equal(req.deal.total, 40);
  assert.equal(req.deal.meetup.availability, "Saturday 2-6pm");
  assert.equal(req.deal.seller_confirmed, true, "the helper pre-approved rates at or above their minimum");
  assert.match(req.say, /^Found someone: helper_priya can do it for \$10 an hour, \$40 for 4 hours, \$1 below their rate\. .*Saturday 2-6pm\. Should I confirm it\?$/);
  assert.ok(!req.alternatives.some((m: { price_unit: string }) => m.price_unit !== "hour"));

  const done = await organiser.call("confirm_deal", { deal_id: req.deal.deal_id });
  assert.match(done.say, /^Booked! Event helper: setup, registration, ushering with helper_priya, \$10 an hour, \$40 for 4 hours\./);
  for (const c of [helper, flat, organiser]) await c.close();
});

test("an offer for a service is paired with a request that was already waiting", async () => {
  const mover = await clientAs("mover_tom");
  const student = await clientAs("student_moving");
  const waiting = await student.call("post_request", { need: "help moving boxes to Hall 9", kind: "service", price_unit: "hour", hours: 2, max_price: 12 });
  assert.equal(waiting.deal, null);
  assert.match(waiting.say, /Nobody's free for it yet.*Helpers won't see your budget\./);

  const posted = await mover.call("post_offer", { kind: "service", price_unit: "hour", title: "Moving help with a trolley", category: "moving", ask_price: 12, min_price: 10 });
  assert.equal(posted.waiting_requests, 1);
  assert.equal(posted.deal.task, "help moving boxes to Hall 9");
  assert.equal(posted.deal.total, 24);
  assert.match(posted.say, /New job from student_moving: help moving boxes to Hall 9, for \$12 an hour, \$24 for 2 hours\. .*Want it\?$/);
  for (const c of [mover, student]) await c.close();
});
