import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";
import { purgeIdempotentCalls } from "../src/market/idempotency.js";
import type { Deps } from "../src/market/service.js";
import { createMcpServer } from "../src/mcp/server.js";

// Retries from voice hosts and agents: the same idempotency_key returns the
// first result and changes nothing; a reused key for another action is refused.

const DIM = 64;
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
  return async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    return { ...JSON.parse((res.content as { text: string }[])[0].text), _isError: !!res.isError };
  };
}

const count = async (sql: string, params: unknown[]) => (await db.query<{ n: number }>(sql, params)).rows[0].n;

test("a retried post_offer with the same key posts once and returns the first result", async () => {
  const call = await clientAs("idem_seller");
  const args = { title: "Desk lamp", category: "lamp", ask_price: 8, min_price: 6, idempotency_key: "retry-key-0001" };
  const first = await call("post_offer", args);
  const again = await call("post_offer", args);
  assert.equal(first._isError, false);
  assert.equal(again.offer.offer_id, first.offer.offer_id, "same offer comes back");
  assert.equal(await count(`SELECT count(*)::int AS n FROM listings WHERE seller_id = $1`, ["idem_seller"]), 1);
});

test("without a key, two identical calls are two posts", async () => {
  const call = await clientAs("idem_plain");
  await call("post_offer", { title: "Bike lock", ask_price: 5 });
  await call("post_offer", { title: "Bike lock", ask_price: 5 });
  assert.equal(await count(`SELECT count(*)::int AS n FROM listings WHERE seller_id = $1`, ["idem_plain"]), 2);
});

test("a key reused for a different action is refused with idempotency_conflict", async () => {
  const call = await clientAs("idem_conflict");
  await call("post_offer", { title: "Kettle", ask_price: 9, idempotency_key: "reused-key-0001" });
  const other = await call("post_offer", { title: "Toaster", ask_price: 9, idempotency_key: "reused-key-0001" });
  assert.equal(other._isError, true);
  assert.equal(other.code, "idempotency_conflict");
  assert.ok(other.say);
});

test("keys belong to one user: another user's identical key posts their own offer", async () => {
  const a = await clientAs("idem_a");
  const b = await clientAs("idem_b");
  const args = { title: "Phone stand", ask_price: 4, idempotency_key: "shared-key-0001" };
  const fromA = await a("post_offer", args);
  const fromB = await b("post_offer", args);
  assert.notEqual(fromA.offer.offer_id, fromB.offer.offer_id);
});

test("a failed call is not stored, so the same key works once the problem is fixed", async () => {
  const call = await clientAs("idem_retry");
  // A $1 phone trips the price check; the user confirms and the agent retries with the same key.
  await call("post_offer", { title: "iPhone 13 128GB", category: "phone", ask_price: 300, idempotency_key: "warmup-0000001" });
  const checked = await call("post_offer", { title: "iPhone 13 128GB", category: "phone", ask_price: 1, idempotency_key: "price-key-0001" });
  if (checked._isError) {
    assert.equal(checked.code, "confirm_price");
    const ok = await call("post_offer", { title: "iPhone 13 128GB", category: "phone", ask_price: 1, confirm_price: true, idempotency_key: "price-key-0001" });
    assert.equal(ok._isError, false, "the key was released by the failed call");
  }
});

test("confirm_deal retried with the same key confirms once", async () => {
  const seller = await clientAs("idem_s2");
  const buyer = await clientAs("idem_b2");
  await seller("post_offer", { title: "Scientific calculator Casio", category: "calculator", ask_price: 10, min_price: 8 });
  const req = await buyer("post_request", { need: "scientific calculator", category: "calculator", max_price: 10 });
  assert.ok(req.deal, "paired");
  const args = { deal_id: req.deal.deal_id, idempotency_key: "confirm-key-0001" };
  const first = await buyer("confirm_deal", args);
  const again = await buyer("confirm_deal", args);
  assert.equal(first._isError, false);
  assert.deepEqual(again.deal, first.deal);
  assert.equal(await count(`SELECT count(*)::int AS n FROM events WHERE ref_id = $1 AND kind LIKE 'deal_%confirmed'`, [req.deal.deal_id]), 1);
});

test("stored results are purged after the retry window", async () => {
  await db.query(`UPDATE idempotent_calls SET created_at = now() - interval '2 days'`);
  assert.ok((await purgeIdempotentCalls(db)) > 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM idempotent_calls`, []), 0);
});
