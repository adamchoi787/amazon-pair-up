import assert from "node:assert/strict";
import { test } from "node:test";
import { negotiate } from "../src/market/negotiation.js";

test("demo scenario: ask 20, min 15, max 18 → 17", () => {
  const r = negotiate({ askPrice: 20, sellerMin: 15, buyerMax: 18 });
  assert.deepEqual(r, { ok: true, price: 17, rule: "split_the_difference", savedVsAsk: 3 });
});

test("no overlap → no deal, no numbers leaked", () => {
  const r = negotiate({ askPrice: 20, sellerMin: 15, buyerMax: 12 });
  assert.deepEqual(r, { ok: false, reason: "no_overlap" });
});

test("buyer budget above ask still negotiates below ask", () => {
  const r = negotiate({ askPrice: 20, sellerMin: 16, buyerMax: 50 });
  assert.ok(r.ok && r.price === 18);
});

test("micro item uses half-unit ticks: tissues ask 2, min 1, max 3 → 1.5", () => {
  const r = negotiate({ askPrice: 2, sellerMin: 1, buyerMax: 3 });
  assert.ok(r.ok && r.price === 1.5);
});

test("price always stays inside both limits", () => {
  for (let i = 0; i < 2000; i++) {
    const ask = Math.round(Math.random() * 200 * 2) / 2 + 0.5;
    const min = Math.round(Math.random() * ask * 2) / 2;
    const max = Math.round(Math.random() * 250 * 2) / 2;
    const r = negotiate({ askPrice: ask, sellerMin: min, buyerMax: max });
    if (r.ok) {
      assert.ok(r.price >= min && r.price <= max && r.price <= ask, JSON.stringify({ ask, min, max, r }));
    } else {
      assert.ok(Math.min(ask, max) < min);
    }
  }
});
