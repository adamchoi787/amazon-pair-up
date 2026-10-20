import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";

// https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
let db: Db, http: Server, url: string, app: ReturnType<typeof createApp>;
const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-User-Id": "owner", "MCP-Protocol-Version": "2025-11-25" };
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "conformance", version: "1" } } };
const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };
const post = (body: unknown, extra = {}) => fetch(url, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: 64 }, { inMemory: true });
  app = createApp({ db, ai: createMockAi(64), cfg: { matchThreshold: 0.35 } }, { ...config, host: "127.0.0.1", authMode: "none", originSecret: "", mcpApiKey: "", allowedHosts: [], allowedOrigins: [], mcpCallsPerMinute: 1000, mcpSessions: true });
  http = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => http.once("listening", r));
  const a = http.address(); assert.ok(a && typeof a === "object");
  url = `http://127.0.0.1:${a.port}/mcp`;
});
after(async () => { await app.locals.mcpSessions.closeAll(); http.closeAllConnections(); await new Promise<void>((r) => http.close(() => r())); await db.close(); });

test("foreign Origin is forbidden on POST, GET and DELETE", async () => {
  for (const method of ["POST", "GET", "DELETE"]) {
    const res = await fetch(url, { method, headers: { ...headers, Origin: "https://foreign.example" }, ...(method === "POST" ? { body: JSON.stringify(list) } : {}) });
    assert.equal(res.status, 403); await res.text();
  }
});
test("unsupported protocol and incomplete Accept headers fail", async () => {
  for (const extra of [{ "MCP-Protocol-Version": "1900-01-01" }, { Accept: "application/json" }, { Accept: "text/event-stream" }]) {
    const res = await post(list, extra); assert.equal(res.status, "Accept" in extra ? 406 : 400); await res.text();
  }
  for (const method of ["GET", "DELETE"]) {
    const res = await fetch(url, { method, headers: { ...headers, "MCP-Protocol-Version": "invalid" } });
    assert.equal(res.status, 400); await res.text();
  }
});
test("POST accepts one message; batches including empty and single-element arrays are rejected", async () => {
  for (const body of [[], [list], [list, { ...list, id: 3 }]]) {
    const res = await post(body); assert.equal(res.status, 400); assert.equal((await res.json()).error.code, -32600);
  }
  const res = await post(list); assert.equal(res.status, 200); assert.match(await res.text(), /tools/);
});
test("stateless GET is 405 and an unknown session is 404", async () => {
  const bare = await fetch(url, { headers }); assert.equal(bare.status, 405); await bare.text();
  for (const method of ["POST", "GET", "DELETE"]) {
    const res = await fetch(url, { method, headers: { ...headers, "Mcp-Session-Id": "unknown" }, ...(method === "POST" ? { body: JSON.stringify(list) } : {}) });
    assert.equal(res.status, 404); await res.text();
  }
});
test("session initialize, initialized notification, GET SSE and DELETE lifecycle", async () => {
  const opened = await post(init); assert.equal(opened.status, 200);
  const id = opened.headers.get("mcp-session-id"); assert.ok(id); await opened.text();
  const session = { "Mcp-Session-Id": id };
  const notice = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
  assert.equal(notice.status, 202); assert.equal(await notice.text(), "");
  const controller = new AbortController();
  const stream = await fetch(url, { headers: { ...headers, ...session, Accept: "text/event-stream" }, signal: controller.signal });
  assert.equal(stream.status, 200); assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
  controller.abort();
  const bad = await fetch(url, { headers: { ...headers, ...session, "MCP-Protocol-Version": "bad" } });
  assert.equal(bad.status, 400); await bad.text();
  const ended = await fetch(url, { method: "DELETE", headers: { ...headers, ...session } });
  assert.equal(ended.status, 200); await ended.text();
  const again = await post(list, session); assert.equal(again.status, 404); await again.text();
});
