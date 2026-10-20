import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb } from "../src/db/client.js";
import { createMockAi } from "../src/ai/mock.js";
import { Mcp, resultData } from "../src/web/mcp.js";
import type { Auth } from "../src/web/auth.js";

test("browser MCP reinitializes after session loss and retries one write once", async () => {
  const db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: 64 }, { inMemory: true });
  const app = createApp({ db, ai: createMockAi(64), cfg: { matchThreshold: 0.35 } }, { ...config, host: "127.0.0.1", allowedHosts: [], authMode: "none", mcpApiKey: "", originSecret: "", mcpSessions: true });
  const http = app.listen(0, "127.0.0.1"); await new Promise<void>((r) => http.once("listening", r));
  const a = http.address(); assert.ok(a && typeof a === "object");
  const prior = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { value: { origin: `http://127.0.0.1:${a.port}` }, configurable: true });
  const auth = { fetch: (input: RequestInfo | URL, init: RequestInit = {}) => { const headers = new Headers(init.headers); headers.set("X-User-Id", "session-user"); return fetch(input, { ...init, headers }); } } as Auth;
  const mcp = new Mcp(auth);
  try {
    await mcp.connect();
    await app.locals.mcpSessions.closeAll();
    const r = await mcp.call("post_offer", { title: "Desk lamp", ask_price: 10 });
    assert.equal(r.isError, undefined); assert.ok(resultData(r).offer);
    assert.equal((await db.query("SELECT id FROM listings WHERE seller_id='session-user'")).rows.length, 1);
    await app.locals.mcpSessions.closeAll();
    assert.ok(await mcp.view(mcp.viewFor("post_offer")!));
  } finally {
    await mcp.close(); await app.locals.mcpSessions.closeAll(); http.closeAllConnections(); await new Promise<void>((r) => http.close(() => r())); await db.close();
    if (prior) Object.defineProperty(globalThis, "location", prior); else Reflect.deleteProperty(globalThis, "location");
  }
});
