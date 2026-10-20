import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createMockAi } from "../src/ai/mock.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, type Db } from "../src/db/client.js";
import { checkInAtPoint, chooseMeetupPoint, isPresence, listMeetupPoints, recordRingNotification } from "../src/market/points.js";
import { confirmDeal, getDealStatus, postOffer, postRequest, type Deps } from "../src/market/service.js";
import { RingClient, RingApiError } from "../src/ring/client.js";
import { parseRingNotification, ringSignature, verifyRingSignature } from "../src/ring/webhook.js";

// PairUp Points: a deal's two people meet at a point watched by a Ring device,
// and Ring confirms each arrival. Ring is reached through a stubbed fetch that
// returns the Partner API's documented JSON:API shapes.

const DIM = 64;
const KEY = "test-hmac-key";
const DEVICE = "ring_dev_hub";
let db: Db;
let deps: Deps;
let history: { id: string; type: string; start: number }[] = [];
const calls: string[] = [];

const ringFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  calls.push(url);
  assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer playground-token");
  const body = url.includes("/v1/history/devices/")
    ? { data: history.map((e) => ({ type: "history-events", id: e.id, attributes: { event_type: e.type, start: e.start, end: e.start + 5000 }, relationships: { source: { data: { type: "devices", id: DEVICE } } } })), links: {} }
    : { data: [{ type: "devices", id: DEVICE, attributes: { name: "HUB north doorbell" } }] };
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/vnd.api+json" } });
};

before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
  deps = {
    db, ai: createMockAi(DIM),
    cfg: { matchThreshold: 0.35, ring: { accessToken: "playground-token", hmacKey: KEY, pointDevices: `pt_uw_hub=${DEVICE}`, fetch: ringFetch } },
  };
});
after(async () => db.close());

async function confirmedDeal(seller: string, buyer: string, title: string) {
  await postOffer(deps, { user_id: seller, title, category: "calculator", ask_price: 20, min_price: 15, location: "UW campus" });
  const req = await postRequest(deps, { user_id: buyer, raw_request: `I need a ${title}, maximum $18`, location: "UW campus" });
  assert.ok(req.deal, "paired");
  await confirmDeal(deps, buyer, req.deal!.deal_id);
  return req.deal!.deal_id;
}

test("Ring client reads devices and Event History from the Partner API", async () => {
  history = [{ id: "h1", type: "ding", start: Date.now() - 60_000 }, { id: "h0", type: "motion", start: Date.now() - 3_600_000 }];
  const ring = new RingClient("playground-token", { fetch: ringFetch });
  assert.deepEqual(await ring.devices(), [{ id: DEVICE, name: "HUB north doorbell" }]);
  const recent = await ring.history(DEVICE, { since: Date.now() - 600_000 });
  assert.deepEqual(recent.map((e) => e.id), ["h1"], "stops at events older than since");
  assert.ok(calls.some((u) => u.startsWith("https://api.amazonvision.com/v1/history/devices/ring_dev_hub/events")));
});

test("presence: doorbell presses and people count; vehicles and packages don't", () => {
  assert.equal(isPresence("button_press", null), true);
  assert.equal(isPresence("motion_detected", "human"), true);
  assert.equal(isPresence("motion_detected", "vehicle"), false);
  assert.equal(isPresence("motion_detected", "package_delivery"), false);
  assert.equal(isPresence("on_demand", null), false);
  assert.equal(isPresence("on_demand", null, true), true, "the sandbox's live-view simulation counts in sandbox mode");
});

test("webhook signature: HMAC-SHA256 over the raw body, sha256= prefix", () => {
  const raw = Buffer.from(JSON.stringify({ meta: { request_id: "r1" }, data: { id: "e1", type: "button_press", attributes: { source: DEVICE, source_type: "devices", timestamp: 1 } } }));
  assert.equal(verifyRingSignature(raw, ringSignature(raw, KEY), KEY), true);
  assert.equal(verifyRingSignature(raw, ringSignature(raw, "other"), KEY), false);
  assert.equal(verifyRingSignature(Buffer.from(raw.toString() + " "), ringSignature(raw, KEY), KEY), false);
  assert.equal(parseRingNotification(JSON.parse(raw.toString()))?.device_id, DEVICE);
});

test("both people check in at the HUB point and Ring confirms the hand-off", async () => {
  const dealId = await confirmedDeal("u_pt_seller", "u_pt_buyer", "TI-84 Plus graphing calculator");
  const listed = await listMeetupPoints(deps, "UW campus");
  assert.equal(listed.points[0].point_id, "pt_uw_hub");
  assert.equal(listed.points[0].ring_device, true);

  const chosen = await chooseMeetupPoint(deps, "u_pt_buyer", { deal_id: dealId });
  assert.equal(chosen.point.point_id, "pt_uw_hub", "nearest point to both");
  assert.match(chosen.say, /press the Ring doorbell/);

  // The seller arrives: Ring Event History shows a doorbell press a minute ago.
  history = [{ id: "evt_seller", type: "ding", start: Date.now() - 60_000 }];
  const seller = await checkInAtPoint(deps, "u_pt_seller", {});
  assert.equal(seller.ring.checked, true);
  assert.equal(seller.arrival.you, "confirmed");
  assert.equal(seller.arrival.them, "not_here");
  assert.equal(seller.arrival.status, "one_here");

  // The buyer says "I'm here" before pressing the bell: checked in, not yet confirmed.
  history = [];
  await db.query(`DELETE FROM ring_events`);
  const buyer = await checkInAtPoint(deps, "u_pt_buyer", { deal_id: dealId });
  assert.equal(buyer.arrival.you, "checked_in");
  assert.match(buyer.say, /Press the Ring doorbell/);

  // Then the doorbell press arrives through the signed webhook.
  const app = createApp(deps, { ...config, host: "127.0.0.1", mcpApiKey: "", aiMode: "mock" });
  const server = app.listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    const payload = JSON.stringify({
      meta: { version: "1.1", time: new Date().toISOString(), request_id: "req_1", account_id: "acct" },
      data: { id: `${DEVICE}_button_press_${Date.now()}`, type: "button_press", attributes: { source: DEVICE, source_type: "devices", timestamp: Date.now() } },
    });
    const post = (sig: string) => fetch(`http://127.0.0.1:${port}/api/ring/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Signature": sig }, body: payload });
    assert.equal((await post("sha256=00")).status, 401, "unsigned deliveries are refused");
    const ok = await post(ringSignature(payload, KEY));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, stored: true, confirmed: 1 });
  } finally {
    server.close();
  }

  const status = await getDealStatus(deps, "u_pt_buyer", dealId);
  const point = status.deals[0].meetup.point!;
  assert.equal(point.status, "both_here");
  assert.equal(point.you, "confirmed");
  assert.equal(point.them, "confirmed");
  assert.match(status.deals[0].meetup.place!, /PairUp Point, HUB north entrance/);

  const stored = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ring_events WHERE point_id = 'pt_uw_hub'`);
  assert.equal(stored.rows[0].n, 1, "only the type and time of presence events are kept");
});

test("check-in needs a confirmed deal at a point", async () => {
  await assert.rejects(checkInAtPoint(deps, "u_nobody", {}), /PairUp Point/);
});

test("Ring client follows same-origin pagination and keeps missing event ends null", async () => {
  let calls = 0;
  const ring = new RingClient("token", { fetch: async (input) => {
    calls++;
    return Response.json({ data: [{ id: String(calls), type: "devices", attributes: { name: `Door ${calls}` } }], links: { next: calls === 1 ? "?page=2" : null } });
  } });
  assert.equal((await ring.devices()).length, 2); assert.equal(calls, 2);
  const history = new RingClient("token", { fetch: async () => Response.json({ data: [{ id: "e", type: "events", attributes: { event_type: "ding", start: 123, end: null } }] }) });
  assert.equal((await history.history("d"))[0].end, null);
  const foreign = new RingClient("token", { fetch: async () => Response.json({ data: [], links: { next: "https://foreign.example/devices" } }) });
  await assert.rejects(foreign.devices(), /another host/);
});
test("Ring throttling honors short Retry-After, reports long waits and explains expired tokens", async () => {
  let calls = 0;
  const ring = new RingClient("token", { fetch: async () => ++calls === 1 ? new Response("", { status: 429, headers: { "Retry-After": "1" } }) : Response.json({ data: [] }) });
  const start = Date.now(); await ring.devices();
  assert.equal(calls, 2); assert.ok(Date.now() - start >= 950);
  const limited = new RingClient("token", { fetch: async () => new Response("", { status: 429, headers: { "Retry-After": "60" } }) });
  await assert.rejects(limited.devices(), (e: RingApiError) => e.status === 429 && e.retryAfterSeconds === 60);
  const expired = new RingClient("token", { fetch: async () => new Response("", { status: 401 }) });
  await assert.rejects(expired.devices(), /renew the Playground token/);
});
test("Ring delivery dedupes request_id across event ids and ignores stale or future arrival evidence", async () => {
  const base = { request_id: "request-dedupe", event_id: "dedupe-1", event_type: "button_press", sub_type: null, device_id: DEVICE, at: Date.now() };
  assert.equal((await recordRingNotification(deps, base)).stored, true);
  assert.deepEqual(await recordRingNotification(deps, { ...base, event_id: "dedupe-2" }), { stored: false, confirmed: 0 });
  assert.equal((await db.query("SELECT id FROM ring_events WHERE request_id = $1", [base.request_id])).rows.length, 1);
  for (const at of [Date.now() - 86_400_000, Date.now() + 3_600_000]) {
    assert.equal((await recordRingNotification(deps, { ...base, request_id: `old-${at}`, event_id: `old-${at}`, at })).stored, false);
  }
});
