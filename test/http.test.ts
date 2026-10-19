import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { createMockAi } from "../src/ai/mock.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, type Db } from "../src/db/client.js";

// HTTP transport behaviour Alexa+ depends on: Streamable HTTP, protocol 2025-11-25,
// Origin validation, and stateless method handling.

const DIM = 64;
let db: Db;
let server: Server;
let base: string;

before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
  const cfg = { ...config, host: "127.0.0.1", allowedOrigins: ["https://simulator.example"], mcpApiKey: "" };
  const app = createApp({ db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.35 } }, cfg);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
after(async () => {
  server.close();
  await db.close();
});

const initialize = (headers: Record<string, string> = {}) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    }),
  });

test("initialize negotiates protocol 2025-11-25 over Streamable HTTP", async () => {
  const res = await initialize();
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /"protocolVersion":"2025-11-25"/);
});

test("requests from a disallowed Origin are rejected with 403", async () => {
  assert.equal((await initialize({ Origin: "https://evil.example" })).status, 403);
});

test("requests from an allowed Origin are accepted", async () => {
  assert.equal((await initialize({ Origin: "https://simulator.example" })).status, 200);
});

test("GET and DELETE on /mcp return 405 (stateless server)", async () => {
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: "DELETE" })).status, 405);
});
