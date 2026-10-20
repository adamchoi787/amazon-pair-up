import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";
import { tradeBand, verdict, type Trade } from "../src/market/pricing.js";
import type { Deps } from "../src/market/service.js";
import { createMcpServer } from "../src/mcp/server.js";

// The price check: deterministic, never sets a price, asks "did you mean…?"
// when a price is far from what similar things go for.

// ---------- the robust band on its own ----------

const trades = (rows: [number, string, string][]): Trade[] => rows.map(([price, seller, buyer]) => ({ price, seller, buyer }));

test("a trade band needs three independent sellers and three buyers", () => {
  assert.equal(tradeBand(trades([[50, "s1", "b1"], [55, "s2", "b2"]])), null);
  assert.equal(tradeBand(trades([[50, "s1", "b1"], [55, "s2", "b1"], [52, "s3", "b1"]])), null, "one buyer buying from everyone");
  const band = tradeBand(trades([[50, "s1", "b1"], [55, "s2", "b2"], [52, "s3", "b3"]]));
  assert.ok(band && band.low < 52 && band.high > 52);
});

test("one seller's staged trades count once, so they can't move the band", () => {
  const honest = trades([[50, "s1", "b1"], [55, "s2", "b2"], [52, "s3", "b3"], [48, "s4", "b4"]]);
  // A seller and two sock puppets record twenty sales at $500…
  const staged = Array.from({ length: 20 }, (_, n) => ({ price: 500, seller: "scammer", buyer: `puppet${n % 2}` }));
  const band = tradeBand([...honest, ...staged])!;
  // …which weigh exactly as much as one sale would.
  assert.deepEqual(band, tradeBand([...honest, staged[0], staged[1]]));
  assert.equal(verdict(500, band), "far_above", "$500 still looks wrong");
  assert.equal(verdict(52, band), "typical");
});

test("moving the centre takes more than half of the independent sellers", () => {
  const market = trades([[50, "s1", "b1"], [55, "s2", "b2"], [52, "s3", "b3"], [48, "s4", "b4"], [51, "s5", "b5"]]);
  const fakes = trades([[1, "f1", "x1"], [1, "f2", "x2"]]);
  const band = tradeBand([...market, ...fakes])!;
  assert.equal(verdict(1, band), "far_below", "two fake $1 sellers can't make $1 look normal");
  assert.equal(verdict(50, band), "typical");
});

test("verdicts", () => {
  const band = { low: 100, high: 200 };
  assert.equal(verdict(150, band), "typical");
  assert.equal(verdict(80, band), "below_typical");
  assert.equal(verdict(49, band), "far_below");
  assert.equal(verdict(250, band), "above_typical");
  assert.equal(verdict(401, band), "far_above");
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
  return {
    call: async (name: string, args: Record<string, unknown>) => {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as { text: string }[])[0].text;
      return { ...JSON.parse(text), _isError: !!res.isError };
    },
    close: () => client.close(),
  };
}

test("a $1 iPhone is questioned, posted only once confirmed, and the buyer is warned", async () => {
  const seller = await clientAs("seller_phone");
  const buyer = await clientAs("buyer_phone");
  const offer = { title: "iPhone 13, 128GB", category: "phone", ask_price: 1 };

  const asked = await seller.call("post_offer", offer);
  assert.equal(asked._isError, true);
  assert.equal(asked.code, "confirm_price");
  assert.equal(asked.field, "ask_price");
  assert.equal(asked.verdict, "far_below");
  assert.match(asked.say, /^Items like this usually sell for \$\d+ to \$\d+, and you're asking \$1\. Is \$1 right\?/);
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM listings WHERE seller_id = 'seller_phone'`);
  assert.equal(rows[0].n, 0, "nothing is posted until the seller confirms");

  const posted = await seller.call("post_offer", { ...offer, confirm_price: true });
  assert.equal(posted._isError, false);
  assert.equal(posted.offer.typical_price.source, "reference");
  assert.ok(posted.offer.typical_price.low >= 100, "a smartphone's range, not a cable's");

  const req = await buyer.call("post_request", { need: "iPhone 13", max_price: 300 });
  assert.equal(req.deal.price, 1);
  assert.equal(req.deal.price_check.verdict, "far_below");
  assert.match(req.say, /Heads up: that's far below the usual \$\d+ to \$\d+\. Meet somewhere public, check it works, and only pay once you have it\./);
  for (const c of [seller, buyer]) await c.close();
});

test("a minimum heard as $1 is questioned; a fair asking price is not", async () => {
  const seller = await clientAs("seller_switch");
  const asked = await seller.call("post_offer", { title: "Nintendo Switch OLED", category: "console", ask_price: 250, min_price: 1 });
  assert.equal(asked.code, "confirm_price");
  assert.equal(asked.field, "min_price");
  assert.match(asked.say, /your lowest price is \$1\./);
  const fixed = await seller.call("post_offer", { title: "Nintendo Switch OLED", category: "console", ask_price: 250, min_price: 200 });
  assert.equal(fixed._isError, false);
  assert.equal(fixed.offer.your_min_price, 200);
  await seller.close();
});

test("a budget heard as $180 for a calculator is questioned; the user's correction goes through", async () => {
  const buyer = await clientAs("buyer_calc");
  const asked = await buyer.call("post_request", { need: "TI-84 graphing calculator", max_price: 180 });
  assert.equal(asked.code, "confirm_price");
  assert.equal(asked.field, "max_price");
  assert.match(asked.say, /your budget is \$180\. Is \$180 right\?/);
  const fixed = await buyer.call("post_request", { need: "TI-84 graphing calculator", max_price: 18 });
  assert.equal(fixed._isError, false);
  assert.equal(fixed.request.your_max_price, 18);
  await buyer.close();
});

test("without a reference, confirmed trades from established accounts set the range", async () => {
  // Five sellers sold film cameras around $80 to five buyers; all accounts are a month old.
  for (let n = 0; n < 5; n++) {
    const s = await clientAs(`cam_s${n}`);
    const b = await clientAs(`cam_b${n}`);
    const { offer } = await s.call("post_offer", { title: "Vintage 35mm film camera", category: "camera", ask_price: 76 + 2 * n });
    const req = await b.call("post_request", { need: "vintage 35mm film camera", max_price: 100 });
    assert.equal(req.deal.offer_id, offer.offer_id);
    await b.call("confirm_deal", { deal_id: req.deal.deal_id });
    for (const c of [s, b]) await c.close();
  }
  await db.query(`UPDATE users SET created_at = now() - interval '30 days' WHERE id LIKE 'cam_%'`);

  const lure = await clientAs("cam_lure");
  const asked = await lure.call("post_offer", { title: "Vintage 35mm film camera", category: "camera", ask_price: 5 });
  assert.equal(asked.code, "confirm_price");
  assert.equal(asked.source, "trades");
  assert.ok(asked.typical_low > 10 && asked.typical_high < 200);
  await lure.close();
});
