import assert from "node:assert/strict";
import { test } from "node:test";
import { createMockAi } from "../src/ai/mock.js";
import { openDb } from "../src/db/client.js";
import { postRequest } from "../src/market/service.js";

// Ported from the unruffled-chaum worktree; main's stronger retry contract is
// covered separately in idempotency.test.ts.
test("an agent's parsed request skips model extraction and preserves local deadlines", async () => {
  const db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: 64 }, { inMemory: true });
  const mock = createMockAi(64); let extracted = 0;
  const deps = { db, ai: { ...mock, extractIntent: (text: string) => { extracted++; return mock.extractIntent(text); } }, cfg: { matchThreshold: 0.35 } };
  try {
    const r = await postRequest(deps, { user_id: "parsed", need: "graphing calculator", max_price: 18, kind: "item", raw_request: "I need a graphing calculator tomorrow, maximum $18" });
    assert.equal(extracted, 0);
    assert.equal(r.request.category, "calculator"); assert.ok(r.request.needed_by);
    await postRequest(deps, { user_id: "parsed", raw_request: "I need printer paper, max $5" });
    assert.equal(extracted, 1);
  } finally { await db.close(); }
});
