import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { negotiate } from "../src/market/negotiation.js";

test("demo scenario: ask 20, min 15, max 18 → the buyer's $18 offer", () => {
  const r = negotiate({ askPrice: 20, sellerMin: 15, buyerMax: 18 });
  assert.deepEqual(r, { ok: true, price: 18, rule: "buyer_offer", savedVsAsk: 2 });
});

test("no overlap → no deal, no numbers leaked", () => {
  const r = negotiate({ askPrice: 20, sellerMin: 15, buyerMax: 12 });
  assert.deepEqual(r, { ok: false, reason: "no_overlap" });
});

test("a budget above the ask pays the ask", () => {
  assert.deepEqual(negotiate({ askPrice: 20, sellerMin: 16, buyerMax: 50 }), { ok: true, price: 20, rule: "asking_price", savedVsAsk: 0 });
});

test("cent amounts settle exactly", () => {
  assert.deepEqual(negotiate({ askPrice: 12, sellerMin: 10, buyerMax: 11.35 }), { ok: true, price: 11.35, rule: "buyer_offer", savedVsAsk: 0.65 });
});

test("the seller's minimum never moves the price, so a deal can't reveal it", () => {
  // With a midpoint rule a buyer who budgets the full ask could compute the minimum as 2 × price − ask.
  const prices = new Set([5, 9.5, 12, 15.25, 18, 20].map((min) => {
    const r = negotiate({ askPrice: 20, sellerMin: min, buyerMax: 20 });
    assert.ok(r.ok);
    return r.price;
  }));
  assert.deepEqual([...prices], [20]);
});

test("after walking away from a price, a lower budget gets no deal", () => {
  assert.deepEqual(negotiate({ askPrice: 20, sellerMin: 15, buyerMax: 16, floor: 20 }), { ok: false, reason: "no_overlap" });
  assert.deepEqual(negotiate({ askPrice: 20, sellerMin: 15, buyerMax: 20, floor: 20 }), { ok: true, price: 20, rule: "asking_price", savedVsAsk: 0 });
});

test("conforms to every pairing-core published vector", () => {
  const rows = readFileSync(new URL("../vendor/pairing-core/vectors.csv", import.meta.url), "utf8")
    .split("\n").slice(1).map((l) => l.split("#")[0].trim()).filter(Boolean);
  assert.ok(rows.length >= 15);
  for (const row of rows) {
    const [ask, min, max, floor, price] = row.split(",").map((f) => f.trim());
    const r = negotiate({ askPrice: +ask / 100, sellerMin: +min / 100, buyerMax: +max / 100, floor: +floor / 100 });
    if (price === "none") assert.equal(r.ok, false, row);
    else assert.ok(r.ok && Math.round(r.price * 100) === +price, `${row} → ${JSON.stringify(r)}`);
  }
});

test("price always stays inside both limits, and raising the budget never lowers it", () => {
  const cents = (max: number) => (1 + Math.floor(Math.random() * max)) / 100;
  for (let i = 0; i < 3000; i++) {
    const ask = cents(30000);
    const min = Math.min(ask, cents(30000));
    const max = cents(35000);
    const r = negotiate({ askPrice: ask, sellerMin: min, buyerMax: max });
    if (r.ok) {
      assert.ok(r.price >= min && r.price <= max && r.price <= ask, JSON.stringify({ ask, min, max, r }));
      const higher = negotiate({ askPrice: ask, sellerMin: min, buyerMax: max + 0.01 });
      assert.ok(higher.ok && higher.price >= r.price, JSON.stringify({ ask, min, max, r, higher }));
    } else {
      assert.ok(Math.min(ask, max) < min);
    }
  }
});
