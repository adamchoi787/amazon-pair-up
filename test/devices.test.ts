import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { createMockAi } from "../src/ai/mock.js";
import { userForAccessToken } from "../src/auth/oauth.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, type Db } from "../src/db/client.js";
import { postOffer, type Deps } from "../src/market/service.js";

// An Apple Watch Shortcut and the Bee bridge over HTTP: a device token, context
// in, a suggestion out, and a whole spoken exchange through /api/voice.

const DIM = 64;
let db: Db;
let deps: Deps;
let server: Server;
let base: string;

before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
  deps = { db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.35 } };
  const app = createApp(deps, { ...config, host: "127.0.0.1", mcpApiKey: "", aiMode: "mock" });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  await postOffer(deps, { user_id: "u_seller", title: "TI-84 Plus graphing calculator", category: "calculator", ask_price: 20, min_price: 15 });
});
after(async () => {
  server.close();
  await db.close();
});

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

async function newDevice(kind: string, user = "u_tony") {
  const res = await post("/api/devices", { kind }, { "X-User-Id": user });
  assert.equal(res.status, 201);
  return (await res.json()) as { device_id: string; token: string; endpoints: { voice: string } };
}

test("a watch token talks to /api/voice: suggestion, budget, deal, yes", async () => {
  const watch = await newDevice("watch");
  assert.match(watch.token, /^apd_/);
  assert.match(watch.endpoints.voice, /\/api\/voice$/);
  const auth = { Authorization: `Bearer ${watch.token}` };

  // Bee (through the bridge, with its own token) heard a need.
  const bee = await newDevice("bee");
  const ctx = await post("/api/context", { kind: "todo", text: "Need a graphing calculator before the exam", external_id: "t1" }, { Authorization: `Bearer ${bee.token}` });
  assert.equal(ctx.status, 200);
  const ctxBody = (await ctx.json()) as { suggestions: { from: string }[]; say: string };
  assert.equal(ctxBody.suggestions[0].from, "bee", "the device kind is the source");
  assert.match(ctxBody.say, /Your Bee picked up/);

  const say = async (text: string) => {
    const res = await post("/api/voice", { text, time_zone: "Asia/Hong_Kong" }, auth);
    assert.equal(res.status, 200);
    return (await res.json()) as { say: string; tool: string | null; result: Record<string, unknown> | null };
  };
  const news = await say("any news?");
  assert.match(news.say, /Your Bee picked up: "Need a graphing calculator before the exam"\. Want me to find a graphing calculator\? Tell me the most you'd pay\./);
  const deal = await say("18 dollars");
  assert.equal(deal.tool, "accept_suggestion");
  assert.match(deal.say, /TI-84 Plus graphing calculator/);
  const yes = await say("yes");
  assert.equal(yes.tool, "confirm_deal");
  assert.match(yes.say, /confirm|seller|deal/i);

  const tz = await db.query<{ time_zone: string }>(`SELECT time_zone FROM users WHERE id = 'u_tony'`);
  assert.equal(tz.rows[0].time_zone, "Asia/Hong_Kong", "the watch's zone places routines in the user's day");
});

test("device tokens reach only /api/voice and /api/context, and can be revoked", async () => {
  const watch = await newDevice("watch", "u_ken");
  const auth = { Authorization: `Bearer ${watch.token}` };
  assert.equal(await userForAccessToken(db, `Bearer ${watch.token}`), null, "a device token is not an MCP (OAuth) credential");
  const manage = await post("/api/devices", { kind: "watch" }, auth);
  assert.equal(manage.status, 401, "devices can't mint more devices");

  const list = await fetch(`${base}/api/devices`, { headers: { "X-User-Id": "u_ken" } });
  assert.deepEqual(((await list.json()) as { devices: { device_id: string }[] }).devices.map((d) => d.device_id), [watch.device_id]);
  const del = await fetch(`${base}/api/devices/${watch.device_id}`, { method: "DELETE", headers: { "X-User-Id": "u_ken" } });
  assert.equal(del.status, 200);
  assert.equal((await post("/api/voice", { text: "any news?" }, auth)).status, 401);
});

test("context validates its input and ignores resends", async () => {
  const phone = await newDevice("phone", "u_mei");
  const auth = { Authorization: `Bearer ${phone.token}` };
  assert.equal((await post("/api/context", { kind: "weather" }, auth)).status, 400);
  const batch = { signals: [{ kind: "location", place: "Hall 5" }, { kind: "note", text: "ran out of tissues", external_id: "n1" }] };
  const first = (await (await post("/api/context", batch, auth)).json()) as { suggestions: { request: { location: string } }[] };
  assert.equal(first.suggestions[0].request.location, "Hall 5", "the place the phone reported");
  const again = (await (await post("/api/context", batch, auth)).json()) as { results: { duplicate: boolean }[] };
  assert.equal(again.results[1].duplicate, true);
});
