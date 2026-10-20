import assert from "node:assert/strict";
import { test } from "node:test";
import { createMockAi } from "../src/ai/mock.js";
import { openDb } from "../src/db/client.js";
import { seedMarketplace } from "../src/db/seed.js";
import { postOffer } from "../src/market/service.js";

test("fresh demo seed accepts its reviewed prices; user posts still need price confirmation", async () => {
  const db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: 64 }, { inMemory: true });
  const deps = { db, ai: createMockAi(64), cfg: { matchThreshold: 0.35 } };
  try {
    assert.equal(await seedMarketplace(deps), 162);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM listings")).rows[0].n, 162);
    await assert.rejects(postOffer(deps, { user_id: "price-test", title: "TI-84 graphing calculator", category: "calculator", ask_price: 1 }), (e: { code?: string }) => e.code === "confirm_price");
  } finally { await db.close(); }
});
