import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createMockAi } from "../src/ai/mock.js";
import { openDb } from "../src/db/client.js";
import { createMcpServer } from "../src/mcp/server.js";
import { checkSchedule, itemDeadline, resolveServiceTime, windowsOverlap } from "../src/market/scheduling.js";

const MONDAY = "2099-01-05T14:00:00-08:00";
const END = "2099-01-05T18:00:00-08:00";
const request = (starts_at = MONDAY, ends_at = END) => {
  const w = resolveServiceTime({ starts_at, ends_at });
  return { id: "request", kind: "service", schedule: null, needed_by: w.deadline, hours: w.hours, service_start: w.start, service_end: w.end };
};
const offer = (availability: string | null, time_zone = "America/Los_Angeles") => ({ kind: "service", availability, time_zone });

test("availability checks days, full duration, boundaries, day ranges and split shifts", () => {
  assert.equal(checkSchedule(offer("Sundays only, 09:00-10:00"), request()).status, "conflict");
  assert.equal(checkSchedule(offer("Mon-Fri 9am-5pm"), request()).status, "conflict", "a start inside the window is insufficient");
  assert.equal(checkSchedule(offer("weekdays 2-6pm"), request()).status, "verified");
  assert.equal(checkSchedule(offer("Monday 9am-12pm; Monday 2-6pm"), request()).status, "verified");
  assert.equal(checkSchedule(offer("Monday 9am-3pm; Monday 4-6pm"), request()).status, "conflict", "a gap in availability is not a four-hour slot");
  assert.equal(checkSchedule(offer("weekends"), request()).status, "conflict");
  assert.equal(checkSchedule(offer("weekdays 2-6"), request()).status, "needs_confirmation", "ambiguous clocks cannot auto-approve a job");
  assert.equal(checkSchedule(offer("Monday 2-6pm"), request("2099-01-05T17:59:59-08:00", "2099-01-05T18:00:29-08:00")).status, "conflict");
});

test("overnight windows cover the following day, including the week boundary", () => {
  const night = request("2099-01-04T23:00:00-08:00", "2099-01-05T01:00:00-08:00");
  assert.equal(checkSchedule(offer("Sunday 10pm-2am"), night).status, "verified");
  assert.equal(checkSchedule(offer("Sunday 10pm-12am"), night).status, "conflict");
});

test("unparsed schedules and deadline-only errands need a provider's yes", () => {
  assert.equal(checkSchedule(offer(null), request()).status, "needs_confirmation");
  assert.equal(checkSchedule(offer("weekday evenings"), request()).status, "needs_confirmation");
  assert.equal(checkSchedule(offer("daily except Monday"), request()).status, "needs_confirmation");
  assert.equal(checkSchedule(offer("weekdays 11am-2pm"), { kind: "service", schedule: "by 12:30", needed_by: "2099-01-05T12:30:00-08:00", hours: null }).status, "needs_confirmation");
  assert.equal(checkSchedule(offer("Monday 9am-5pm"), { kind: "service", schedule: "Monday", needed_by: "2099-01-05T23:59:00-08:00", hours: 2 }).status, "needs_confirmation", "a day without a time is not a 23:59 appointment");
});

test("natural dates use the market time zone rather than the machine's time zone", () => {
  const now = new Date("2026-10-21T05:00:00Z"); // Tuesday 22:00 in Seattle, already Wednesday in UTC.
  const w = resolveServiceTime({ schedule: "today 9am-11am", now });
  assert.equal(w.start, "2026-10-20T16:00:00.000Z");
  assert.equal(w.end, "2026-10-20T18:00:00.000Z");
  const weekend = resolveServiceTime({ schedule: "Saturday 2-6pm", now });
  assert.equal(weekend.start, "2026-10-24T21:00:00.000Z");
  assert.equal(weekend.hours, 4);
  assert.equal(checkSchedule(offer("Tuesday 6-10am", "Asia/Singapore"), request()).status, "verified", "the same instant is Tuesday 06:00-10:00 in Singapore");
});

test("ambiguous DST times, invalid windows and inconsistent hours are rejected", () => {
  assert.throws(() => resolveServiceTime({ schedule: "2026-11-01 1am-2am", time_zone: "America/New_York" }), /ambiguous/);
  assert.throws(() => resolveServiceTime({ starts_at: MONDAY, ends_at: END, hours: 2 }), /disagree/);
  assert.throws(() => resolveServiceTime({ starts_at: MONDAY, ends_at: "2099-01-05T12:00:00-08:00" }), /end after/);
  assert.throws(() => resolveServiceTime({ starts_at: "2099-01-05T14:00:00" }), /UTC offset/);
  assert.throws(() => resolveServiceTime({ schedule: "2026-02-30 2-6pm" }), /does not exist/);
  assert.throws(() => resolveServiceTime({ starts_at: "2099-02-30T14:00:00-08:00" }), /does not exist/);
  assert.throws(() => resolveServiceTime({ starts_at: MONDAY, ends_at: END, schedule: "Monday 3-6pm" }), /disagree/);
  assert.equal(windowsOverlap(resolveServiceTime({ starts_at: MONDAY, ends_at: END }), resolveServiceTime({ starts_at: END, ends_at: "2099-01-05T19:00:00-08:00" })), false);
});

test("explicit work windows are checked through both sides of a daylight-saving change", () => {
  // Use the actual 2026 fallback Sunday; explicit offsets disambiguate the first 01:00.
  const fallback = request("2026-11-01T01:00:00-04:00", "2026-11-01T04:00:00-05:00");
  assert.equal(checkSchedule(offer("Sunday 1am-4am", "America/New_York"), fallback).status, "verified");
  assert.equal(checkSchedule(offer("Sunday 1am-3am", "America/New_York"), fallback).status, "conflict");
});

async function market() {
  const db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: 64 }, { inMemory: true });
  const deps = { db, ai: createMockAi(64), cfg: { matchThreshold: 0.35, postsPerHour: 100 } };
  const clients: Client[] = [];
  const as = async (userId: string) => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(deps, { userId }).connect(a);
    const client = new Client({ name: "schedule-regression", version: "1" });
    await client.connect(b);
    await client.listTools();
    clients.push(client);
    return async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args }) as CallToolResult;
      return { ...JSON.parse((r.content.find(c => c.type === "text") as { text: string }).text), _error: !!r.isError };
    };
  };
  return { db, as, close: async () => { for (const c of clients) await c.close(); await db.close(); } };
}
const service = { kind: "service", price_unit: "hour", title: "Spectrometer calibration assistance", ask_price: 20, availability: "weekdays 2-6pm", auto_accept: true };
const job = { kind: "service", price_unit: "hour", need: service.title, max_price: 20, starts_at: MONDAY, ends_at: END };

test("MCP regression: Sunday-only provider is never proposed for a Monday job, in either direction or by negotiate", async t => {
  const m = await market(); t.after(m.close);
  const seller = await m.as("seller"), buyer = await m.as("buyer");
  const posted = await seller("post_offer", { ...service, availability: "Sundays only, 09:00-10:00" });
  const requested = await buyer("post_request", job);
  assert.equal(requested.deal, null);
  assert.deepEqual(requested.alternatives, []);
  const direct = await buyer("negotiate", { request_id: requested.request.request_id, offer_id: posted.offer.offer_id });
  assert.equal(direct.code, "schedule_conflict");
  const later = await seller("post_offer", { ...service, availability: "Sundays only, 09:00-10:00" });
  assert.equal(later.deal, null);
  const compatible = await seller("post_offer", service);
  assert.equal(compatible.deal.request_id, requested.request.request_id);
  assert.equal(compatible.deal.scheduling.status, "verified");
});

test("availability filtering happens before candidate limits", async t => {
  const m = await market(); t.after(m.close);
  for (let i = 0; i < 35; i++) await (await m.as(`busy-${i}`))("post_offer", { ...service, availability: "Sunday 2-6pm" });
  const good = await (await m.as("available"))("post_offer", service);
  const result = await (await m.as("buyer"))("post_request", job);
  assert.equal(result.deal.offer_id, good.offer.offer_id, "scan past unavailable higher-ranked candidates");
});

test("timed bookings exclude overlapping work across a provider's different offers and allow back-to-back jobs", async t => {
  const m = await market(); t.after(m.close);
  const seller = await m.as("seller"), buyer = await m.as("buyer"), other = await m.as("other");
  await seller("post_offer", { ...service, availability: "weekdays" });
  const first = await buyer("post_request", job);
  assert.equal(first.deal.seller_confirmed, true);
  await buyer("confirm_deal", { deal_id: first.deal.deal_id });
  await seller("post_offer", { ...service, availability: "weekdays" });
  const overlap = await other("post_request", { ...job, starts_at: "2099-01-05T15:00:00-08:00", ends_at: "2099-01-05T16:00:00-08:00" });
  assert.equal(overlap.deal, null);
  const next = await other("post_request", { ...job, starts_at: END, ends_at: "2099-01-05T19:00:00-08:00" });
  assert.ok(next.deal);
});

test("unknown availability never auto-accepts a service, and simultaneous confirmations preserve both yeses", async t => {
  const m = await market(); t.after(m.close);
  const seller = await m.as("seller"), buyer = await m.as("buyer");
  await seller("post_offer", { ...service, availability: "ask me first" });
  const requested = await buyer("post_request", job);
  assert.equal(requested.deal.seller_confirmed, false);
  assert.equal(requested.deal.scheduling.status, "needs_confirmation");
  assert.match(requested.say, /check the time/);
  await Promise.all([buyer("confirm_deal", { deal_id: requested.deal.deal_id }), seller("confirm_deal", { deal_id: requested.deal.deal_id })]);
  const status = await buyer("get_deal_status", { deal_id: requested.deal.deal_id });
  assert.equal(status.deals[0].status, "confirmed");
  assert.equal(status.deals[0].buyer_confirmed, true);
  assert.equal(status.deals[0].seller_confirmed, true);
});

test("concurrent requests cannot reserve overlapping jobs across two offers from one provider", async t => {
  const m = await market(); t.after(m.close);
  const seller = await m.as("seller"), a = await m.as("a"), b = await m.as("b");
  await seller("post_offer", service);
  await seller("post_offer", service);
  const results = await Promise.all([a("post_request", job), b("post_request", job)]);
  assert.equal(results.filter(r => !!r.deal).length, 1);
  assert.equal((await m.db.query(`SELECT id FROM deals WHERE status = 'proposed'`)).rows.length, 1);
});

test("legacy automatic service approval cannot bypass a tentative time check", async t => {
  const m = await market(); t.after(m.close);
  const seller = await m.as("seller"), buyer = await m.as("buyer");
  await seller("post_offer", { ...service, availability: "ask me first" });
  const result = await buyer("post_request", job);
  // An old release pre-approved the price without verifying availability.
  await m.db.query(`UPDATE deals SET seller_confirmed = true WHERE id = $1`, [result.deal.deal_id]);
  const inbox = await seller("get_deal_status", {});
  assert.equal(inbox.deals[0].waiting_for_you, true);
  const half = await buyer("confirm_deal", { deal_id: result.deal.deal_id });
  assert.equal(half.deal.status, "proposed");
  assert.equal(half.deal.seller_confirmed, false);
  const confirmed = await seller("confirm_deal", { deal_id: result.deal.deal_id });
  assert.equal(confirmed.deal.status, "confirmed");
});

test("item deadlines come only from a day, a date or 'by' a clear time, never from prices or place names", () => {
  const zone = "America/Los_Angeles";
  const now = new Date("2026-10-20T18:00:00Z"); // Tuesday 11:00 in Seattle.
  for (const text of ["a desk lamp for around 20 bucks", "used bike, 15-20 bucks", "I can pick it up at 7-Eleven", "TI-84 under $40"]) {
    assert.equal(itemDeadline(text, zone, now), null, text);
  }
  assert.equal(itemDeadline("a calculator under 40 by 5pm", zone, now), "2026-10-21T00:00:00.000Z");
  assert.equal(itemDeadline("a calculator by 9am", zone, now), "2026-10-21T16:00:00.000Z", "a passed time means tomorrow");
  assert.equal(itemDeadline("I need a graphing calculator today, max $18", zone, now), "2026-10-21T06:59:00.000Z");
  assert.equal(itemDeadline("TI-84 by Friday", zone, now), "2026-10-24T06:59:00.000Z");
});
