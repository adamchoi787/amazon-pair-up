import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("cent amounts settle exactly", () => {
  const r = negotiate({ askPrice: 12, sellerMin: 10, buyerMax: 16.25 });
  assert.deepEqual(r, { ok: true, price: 11, rule: "split_the_difference", savedVsAsk: 1 });
});

test("conforms to every pairing-core published vector", () => {
  const rows = readFileSync(new URL("../vendor/pairing-core/vectors.csv", import.meta.url), "utf8")
    .split("\n").slice(1).map((l) => l.split("#")[0].trim()).filter(Boolean);
  assert.ok(rows.length >= 20);
  for (const row of rows) {
    const [ask, min, max, price] = row.split(",").map((f) => f.trim());
    const r = negotiate({ askPrice: +ask / 100, sellerMin: +min / 100, buyerMax: +max / 100 });
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
