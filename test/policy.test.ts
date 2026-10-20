import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { sanitizeIntent } from "../src/ai/bedrock.js";
import { createMockAi, mockEmbed } from "../src/ai/mock.js";
import { createApp } from "../src/app.js";
import { config, type Config } from "../src/config.js";
import { openDb, type Db } from "../src/db/client.js";
import { postRequest, postOffer, MarketError, type Deps } from "../src/market/service.js";

// Production policy: HTTP rate limits, dashboard access, posting limits, and
// untrusted model output.

const DIM = 64;
let db: Db;
const servers: Server[] = [];

before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
});
after(async () => {
  for (const s of servers) s.close();
  await db.close();
});

async function serve(overrides: Partial<Config>) {
  const cfg = { ...config, host: "127.0.0.1", mcpApiKey: "", allowedOrigins: [], ...overrides };
  const app = createApp({ db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.35 } }, cfg);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push(server);
  const addr = server.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

const ping = (base: string, userId: string) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-User-Id": userId },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });

test("each caller gets a fixed number of MCP calls per minute", async () => {
  const base = await serve({ mcpCallsPerMinute: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await ping(base, "busy")).status, 200);
  const limited = await ping(base, "busy");
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await ping(base, "someone_else")).status, 200, "limits are per caller");
});

test("the dashboard is open locally and needs a token once one is set", async () => {
  const local = await serve({ authMode: "none", dashboardToken: "" });
  assert.equal((await fetch(`${local}/api/dashboard`)).status, 200);

  const guarded = await serve({ authMode: "none", dashboardToken: "s3cret-token" });
  assert.equal((await fetch(`${guarded}/api/dashboard`)).status, 401);
  assert.equal((await fetch(`${guarded}/api/dashboard`, { headers: { Authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await fetch(`${guarded}/api/dashboard`, { headers: { Authorization: "Bearer s3cret-token" } })).status, 200);
});

test("behind a CDN, only requests with the origin secret reach the app", async () => {
  const base = await serve({ originSecret: "edge-secret-123" });
  assert.equal((await fetch(`${base}/app/`)).status, 403);
  assert.equal((await fetch(`${base}/app/`, { headers: { "X-Origin-Verify": "nope" } })).status, 403);
  assert.equal((await fetch(`${base}/app/`, { headers: { "X-Origin-Verify": "edge-secret-123" } })).status, 200);
  assert.equal((await fetch(`${base}/health`)).status, 200, "health checks need no secret");
});

test("posting limits stop floods", async () => {
  const deps: Deps = { db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.35, postsPerHour: 3, maxOpenRequests: 2 } };
  await postRequest(deps, { user_id: "prober", need: "rice cooker", max_price: 10 });
  await postRequest(deps, { user_id: "prober", need: "rice cooker", max_price: 11 });
  await assert.rejects(postRequest(deps, { user_id: "prober", need: "rice cooker", max_price: 12 }), (e: Error) =>
    e instanceof MarketError && /open requests/.test(e.message));

  await postOffer(deps, { user_id: "flooder", title: "Thing one", ask_price: 5 });
  await postOffer(deps, { user_id: "flooder", title: "Thing two", ask_price: 5 });
  await postOffer(deps, { user_id: "flooder", title: "Thing three", ask_price: 5 });
  await assert.rejects(postOffer(deps, { user_id: "flooder", title: "Thing four", ask_price: 5 }), (e: Error) =>
    e instanceof MarketError && /posted a lot/.test(e.message));
});

test("model output is validated field by field", () => {
  const out = sanitizeIntent(
    { need: "  graphing calculator ", category: "Calculator", max_price: "18", min_condition: "pristine",
      quantity: -2, needed_by: "not a date", location: "UW campus", extra: "ignored" },
    "fallback text",
  );
  assert.deepEqual(out, { need: "graphing calculator", category: "calculator", max_price: 18, location: "UW campus" });
  assert.deepEqual(sanitizeIntent("garbage", "I need a lamp"), { need: "I need a lamp" });
});

test("negated words carry no meaning in offline embeddings", () => {
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  const q = mockEmbed("graphing calculator", 256);
  const graphing = mockEmbed("TI-84 Plus graphing calculator", 256);
  const notGraphing = mockEmbed("Casio scientific calculator. Not graphing.", 256);
  assert.ok(cos(q, graphing) > cos(q, notGraphing) + 0.2);
});
