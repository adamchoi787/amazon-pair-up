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

test("every response carries a request id, and a caller's own id is echoed", async () => {
  const fresh = await initialize();
  assert.match(fresh.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
  const given = await initialize({ "X-Request-Id": "alexa-req-12345678" });
  assert.equal(given.headers.get("x-request-id"), "alexa-req-12345678");
  const junk = await initialize({ "X-Request-Id": "bad id with spaces" });
  assert.notEqual(junk.headers.get("x-request-id"), "bad id with spaces");
});

test("/ready checks the database", async () => {
  const res = await fetch(`${base}/ready`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("the server card describes the live tool surface", async () => {
  const res = await fetch(`${base}/.well-known/mcp/server-card.json`);
  assert.equal(res.status, 200);
  const card = await res.json();
  assert.equal(card.protocolVersion, "2025-11-25");
  assert.equal(card.serverInfo.name, "pairup");
  assert.match(card.transport.endpoint, /\/mcp$/);
  const names = card.tools.map((t: { name: string }) => t.name);
  for (const t of ["post_offer", "post_request", "confirm_deal", "decline_deal", "withdraw_post"]) assert.ok(names.includes(t), t);
  assert.ok(card.tools.every((t: { outputSchema?: unknown }) => t.outputSchema), "every tool has an output schema");
  assert.ok(card.prompts.some((p: { name: string }) => p.name === "find_something"));
  assert.match(card.instructions, /confirm_deal only after an explicit yes/);
});

test("llms.txt and the Agent Skill are served for agents", async () => {
  const llms = await fetch(`${base}/llms.txt`);
  assert.equal(llms.status, 200);
  const text = await llms.text();
  assert.match(text, /^# PairUp/);
  assert.match(text, /`post_request`/);
  const skill = await fetch(`${base}/skills/pairup/SKILL.md`);
  assert.equal(skill.status, 200);
  assert.match(await skill.text(), /^---\r?\nname: pairup\r?\n/);
});

test("GET and DELETE on /mcp return 405 (stateless server)", async () => {
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: "DELETE" })).status, 405);
});
