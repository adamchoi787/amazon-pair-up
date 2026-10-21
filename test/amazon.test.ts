import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";
import { amazonSearchUrl, hubPointFor, tradeInCategory } from "../src/market/amazon.js";
import { ensureUser, type Deps } from "../src/market/service.js";
import { outputs } from "../src/mcp/schemas.js";
import { createMcpServer } from "../src/mcp/server.js";

// Where the local market hands off to Amazon: a search link and the new price
// when nobody has the item, a Trade-In link for an item nobody is asking
// for, and an Amazon Hub point as the meet-up when both sides share an area.

// ---------- the rules on their own ----------

test("an Amazon search link for the request", () => {
  assert.equal(amazonSearchUrl(" TI-84 graphing calculator "), "https://www.amazon.com/s?k=TI-84%20graphing%20calculator");
  assert.equal(amazonSearchUrl("pens & paper"), "https://www.amazon.com/s?k=pens%20%26%20paper");
});

test("Trade-In categories match by category or title words", () => {
  assert.equal(tradeInCategory({ title: "Kindle Paperwhite", category: "e-reader" })?.id, "electronics");
  assert.equal(tradeInCategory({ title: "Sony PlayStation 5 with two controllers" })?.id, "game_consoles");
  assert.equal(tradeInCategory({ title: "iPhone 13, 128GB", category: "phone" })?.id, "electronics");
  assert.equal(tradeInCategory({ title: "TI-84 Plus graphing calculator", category: "calculator" }), null);
  assert.equal(tradeInCategory({ title: "Bookshelf speaker stand", category: "furniture" })?.id, "electronics", "whole words: 'bookshelf' is no book");
  assert.equal(tradeInCategory({ title: "Bookshelf", category: "furniture" }), null);
});

test("a Hub point is suggested only when both sides are in the same area", () => {
  const hub = hubPointFor("UW campus", " uw  Campus ");
  assert.deepEqual(hub, { name: "Amazon Hub Counter, HUB ground floor", type: "counter", area: "UW campus" });
  assert.equal(hubPointFor("UW campus", "Ballard"), null);
  assert.equal(hubPointFor("UW campus", null), null);
  assert.equal(hubPointFor("Wallingford", "Wallingford"), null, "an area without Hub points");
});

// ---------- through the MCP tools ----------

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
  await client.listTools(); // the SDK validates every structuredContent against its outputSchema
  return {
    call: async <K extends keyof typeof outputs>(name: K, args: Record<string, unknown>) => {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as { text: string }[])[0].text;
      assert.ok(!res.isError, `${name} failed: ${text}`);
      return z.object(outputs[name]).strict().parse(res.structuredContent) as any;
    },
    close: () => client.close(),
  };
}

test("no seller: the request waits, with the item new on Amazon as an option", async () => {
  const buyer = await clientAs("amz_buyer");
  const req = await buyer.call("post_request", { need: "TI-84 graphing calculator", max_price: 18 });
  assert.equal(req.deal, null);
  assert.equal(req.request.status, "open", "the request still waits for a seller");
  assert.equal(req.fallback.reason, "no_seller");
  assert.equal(req.fallback.still_waiting, true);
  assert.equal(req.fallback.amazon_url, "https://www.amazon.com/s?k=TI-84%20graphing%20calculator");
  assert.equal(typeof req.fallback.new_price, "number", "the new price comes from the reference prices");
  assert.equal(req.fallback.say, `Nobody has one yet. New on Amazon it's about $${req.fallback.new_price} (demo estimate).`);
  assert.match(req.say, /keep looking.*If you can't wait, it's about \$\d+ new on Amazon \(demo estimate\)\.$/);
  await buyer.close();
});

test("nothing within budget: the closest offer is named and the Amazon option is still there", async () => {
  const seller = await clientAs("amz_seller_tent");
  const buyer = await clientAs("amz_buyer_tent");
  await seller.call("post_offer", { title: "Two-person camping tent", category: "camping", ask_price: 40, min_price: 35 });
  const req = await buyer.call("post_request", { need: "two-person camping tent", max_price: 20 });
  assert.equal(req.deal, null);
  assert.equal(req.fallback.reason, "over_budget");
  assert.equal(req.fallback.new_price, null, "no reference price for a tent");
  assert.equal(req.fallback.say, "Nobody has one in your budget yet. You can also look for a new one on Amazon.");
  assert.match(req.say, /Want it at that price\? Otherwise I'll keep looking\.$/);
  for (const c of [seller, buyer]) await c.close();
});

test("no Amazon fallback for a deal or for a service", async () => {
  const seller = await clientAs("amz_seller_lamp");
  const buyer = await clientAs("amz_buyer_lamp");
  await seller.call("post_offer", { title: "Desk lamp, LED", category: "lamp", ask_price: 10 });
  const found = await buyer.call("post_request", { need: "desk lamp", max_price: 12 });
  assert.ok(found.deal);
  assert.equal(found.fallback, null);
  const errand = await buyer.call("post_request", { kind: "service", need: "pick up my parcel from the mailroom", max_price: 4 });
  assert.equal(errand.deal, null);
  assert.equal(errand.fallback, null, "Amazon doesn't run errands");
  for (const c of [seller, buyer]) await c.close();
});

test("an item nobody is asking for, in a Trade-In category, gets the Trade-In link", async () => {
  const seller = await clientAs("amz_books");
  const posted = await seller.call("post_offer", { title: "Kindle Paperwhite", category: "e-reader", ask_price: 30 });
  assert.equal(posted.deal, null);
  assert.deepEqual(posted.trade_in, {
    category: "electronics",
    url: "https://www.amazon.com/tradein",
    say: "You can check whether Amazon Trade-In accepts your electronics for Amazon credit.",
  });
  assert.match(posted.say, /as soon as one asks\. You can check whether Amazon Trade-In/);

  const calc = await seller.call("post_offer", { title: "Casio graphing calculator", category: "calculator", ask_price: 25 });
  assert.equal(calc.trade_in, null, "Amazon Trade-In doesn't take calculators");
  const help = await seller.call("post_offer", { kind: "service", title: "Phone screen repair", category: "repair", ask_price: 20 });
  assert.equal(help.trade_in, null, "services are never traded in");
  await seller.close();
});

test("no Trade-In hint when a buyer is already waiting", async () => {
  const buyer = await clientAs("amz_wants_ps5");
  const seller = await clientAs("amz_has_ps5");
  await buyer.call("post_request", { need: "PlayStation 5 game console", max_price: 350 });
  const posted = await seller.call("post_offer", { title: "Sony PlayStation 5 game console", category: "console", ask_price: 340 });
  assert.ok(posted.deal);
  assert.equal(posted.trade_in, null);
  for (const c of [seller, buyer]) await c.close();
});

test("both sides on campus: the deal suggests the campus Amazon Hub point", async () => {
  const seller = await clientAs("amz_hub_seller");
  const buyer = await clientAs("amz_hub_buyer");
  await seller.call("post_offer", { title: "Rice cooker, 1L", category: "kitchen", ask_price: 15, location: "UW campus", availability: "evenings" });
  const req = await buyer.call("post_request", { need: "rice cooker", max_price: 15, location: "UW campus" });
  assert.deepEqual(req.deal.meetup, {
    place: "Amazon Hub Counter, HUB ground floor, UW campus (demo location)",
    availability: "evenings",
    hub_point: { name: "Amazon Hub Counter, HUB ground floor", type: "counter", area: "UW campus", demo: true },
    point: null,
  });
  assert.match(req.say, /Meet-up: Amazon Hub Counter, HUB ground floor, UW campus \(demo location\)\./);
  const done = await buyer.call("confirm_deal", { deal_id: req.deal.deal_id });
  assert.match(done.say, /Meet-up: Amazon Hub Counter, HUB ground floor, UW campus \(demo location\), evenings\./);
  for (const c of [seller, buyer]) await c.close();
});

test("a buyer's home area counts when the request names none; different areas keep the seller's area", async () => {
  await ensureUser(db, "amz_home_buyer", "Hana");
  await db.query(`UPDATE users SET home_area = 'Ballard' WHERE id = 'amz_home_buyer'`);
  const seller = await clientAs("amz_home_seller");
  const buyer = await clientAs("amz_home_buyer");
  await seller.call("post_offer", { title: "Yoga mat, purple", category: "sports", ask_price: 8, location: "Ballard" });
  const near = await buyer.call("post_request", { need: "yoga mat", max_price: 8 });
  assert.equal(near.deal.meetup.hub_point.area, "Ballard");

  const far = await clientAs("amz_far_seller");
  await far.call("post_offer", { title: "Basketball, size 7", category: "sports", ask_price: 10, location: "Northgate" });
  const away = await buyer.call("post_request", { need: "basketball", max_price: 10 });
  assert.deepEqual(away.deal.meetup, { place: "Northgate", availability: null, hub_point: null, point: null });
  for (const c of [seller, buyer, far]) await c.close();
});
