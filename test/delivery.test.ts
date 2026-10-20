import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";
import { deliveryQuote } from "../src/market/amazon.js";
import type { Deps } from "../src/market/service.js";
import { outputs } from "../src/mcp/schemas.js";
import { createMcpServer } from "../src/mcp/server.js";

// Amazon Hub delivery: an item deal can go by Amazon instead of a meet-up.
// The seller drops it at a Hub Counter, the buyer collects it from a Hub
// Locker, and the buyer pays the fee on top of the settled price.

test("a delivery quote names a drop-off counter and a pickup locker", () => {
  const same = deliveryQuote("UW campus", "uw campus")!;
  assert.equal(same.drop_off.name, "Amazon Hub Counter, HUB ground floor");
  assert.equal(same.pick_up.name, "Amazon Hub Locker, Suzzallo Library entrance");
  assert.equal(same.fee, 3.99);
  const cross = deliveryQuote("Northgate", "Ballard")!;
  assert.equal(cross.drop_off.area, "Northgate");
  assert.equal(cross.pick_up.area, "Ballard");
  assert.equal(cross.fee, 5.99);
  assert.equal(deliveryQuote("Wallingford", "Ballard"), null, "an area without Hub points");
  assert.equal(deliveryQuote(null, "Ballard"), null);
});

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

test("a buyer switches a deal to Amazon Hub delivery; the seller confirms again", async () => {
  const seller = await clientAs("dlv_seller");
  const buyer = await clientAs("dlv_buyer");
  await seller.call("post_offer", { title: "Electric kettle, 1.7L", category: "kitchen", ask_price: 12, location: "Northgate", auto_accept: true });
  const req = await buyer.call("post_request", { need: "electric kettle", max_price: 12, location: "Ballard" });
  const id = req.deal.deal_id;
  assert.equal(req.deal.handoff, "meetup");
  assert.equal(req.deal.delivery.selected, false, "delivery is offered on the card");
  assert.equal(req.deal.seller_confirmed, true);

  const ship = await buyer.call("choose_handoff", { deal_id: id, method: "delivery" });
  assert.equal(ship.deal.handoff, "delivery");
  assert.equal(ship.deal.delivery.selected, true);
  assert.equal(ship.deal.price, 12, "the settled price stays");
  assert.equal(ship.deal.total, 17.99, "price plus the delivery fee");
  assert.deepEqual(ship.deal.meetup, { place: null, availability: null, hub_point: null });
  assert.equal(ship.deal.seller_confirmed, false, "a drop-off needs the seller's yes again");
  assert.equal(ship.say,
    "Switched to Amazon Hub delivery. Amazon Hub delivery: drop-off at Amazon Hub Counter, Northgate Station level 2, " +
    "pickup at Amazon Hub Locker, Ballard Ave grocery store, Ballard, next day, $5.99 delivery (demo estimate). " +
    "Total $17.99. Should I confirm? The seller gives the final yes.");

  await assert.rejects(() => seller.call("choose_handoff", { deal_id: id, method: "meetup" }), /The buyer chooses/);
  await buyer.call("confirm_deal", { deal_id: id });
  const done = await seller.call("confirm_deal", { deal_id: id });
  assert.equal(done.deal.status, "confirmed");
  assert.match(done.deal.delivery.reference, /^DEMO-/);
  assert.match(done.say, /Shipment DEMO-\w+: the seller gets the drop-off label and you get a pickup code\.$/);
  const mine = await buyer.call("get_deal_status", { deal_id: id });
  assert.match(mine.say, /confirmed with .+, by Amazon Hub delivery to Amazon Hub Locker, Ballard Ave grocery store\./);
  for (const c of [seller, buyer]) await c.close();
});

test("asking for it shipped sets delivery on the request; services have no handoff", async () => {
  const seller = await clientAs("dlv_seller_mat");
  const buyer = await clientAs("dlv_buyer_mat");
  await seller.call("post_offer", { title: "Yoga mat, 6mm", category: "sports", ask_price: 7, location: "UW campus" });
  const req = await buyer.call("post_request", { need: "yoga mat", raw_request: "a yoga mat shipped to my locker, up to $7", max_price: 7, location: "Capitol Hill" });
  assert.equal(req.deal.handoff, "delivery");
  assert.equal(req.deal.delivery.pick_up.area, "Capitol Hill");
  assert.equal(req.deal.total, 12.99);
  assert.match(req.say, /Amazon Hub delivery: drop-off at Amazon Hub Counter, HUB ground floor/);

  const helper = await clientAs("dlv_helper");
  await helper.call("post_offer", { kind: "service", title: "Lunch runs on campus", category: "delivery", ask_price: 4 });
  const run = await buyer.call("post_request", { kind: "service", need: "pick up my lunch", max_price: 5, pickup: "the HUB", location: "McCarty Hall" });
  assert.ok(run.deal);
  assert.equal(run.deal.handoff, null);
  assert.equal(run.deal.delivery, null);
  await assert.rejects(() => buyer.call("choose_handoff", { deal_id: run.deal.deal_id, method: "delivery" }), /Delivery is for items/);
  for (const c of [seller, buyer, helper]) await c.close();
});
