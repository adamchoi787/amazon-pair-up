import { readFileSync } from "node:fs";
import type { Db } from "../db/client.js";
import { RingApiError, RingClient } from "../ring/client.js";
import type { RingNotification } from "../ring/webhook.js";
import { logEvent } from "./events.js";
import { MarketError, type Deps } from "./service.js";

// PairUp Points: small unstaffed hand-off spots, each watched by one Ring
// camera or doorbell. Two people who'd rather not meet a stranger anywhere
// else pick a point for their deal. When each arrives, they press the Ring
// doorbell (or walk past the camera) and tell PairUp they're here. A check-in
// counts as confirmed when the point's Ring device recorded a doorbell press or
// a person within ten minutes of it. Once both are confirmed, the deal shows
// "both here", the hand-off can happen, and both sides hear it.
//
// Deterministic and privacy-first: PairUp reads only the event type and time
// from Ring (webhooks, or Event History when someone checks in). It never
// requests video, snapshots or audio, never identifies faces, keeps Ring events
// for 24 hours and check-ins for 30 days.

export interface RingSettings {
  /** Ring Partner API token: a Playground token (30 minutes) or an account-linked app token. */
  accessToken?: string;
  apiBase?: string;
  /** The Ring app's HMAC signing key; turns on POST /api/ring/webhook. */
  hmacKey?: string;
  /** "pt_uw_hub=<device id>,…": which Ring device watches which point. */
  pointDevices?: string;
  /** Ring's sandbox can only simulate live views: count on_demand events as presence too. */
  sandbox?: boolean;
  fetch?: typeof fetch;
}

export interface Point { id: string; name: string; area: string; hours: string | null; ring_device_id: string | null }

const WINDOW_MINUTES = 10;
/** How far back a check-in reads Ring Event History. */
const HISTORY_MINUTES = 30;

let cache: { file: string; points: Point[] } | null = null;

export function loadPoints(file = "data/pairup-points.json"): Point[] {
  if (cache?.file !== file) {
    const raw = (JSON.parse(readFileSync(file, "utf8")) as { points: Partial<Point>[] }).points;
    cache = { file, points: raw.map((p) => ({ id: p.id!, name: p.name!, area: p.area!, hours: p.hours ?? null, ring_device_id: p.ring_device_id ?? null })) };
  }
  return cache.points;
}

export const pointById = (id: string | null | undefined) => (id ? loadPoints().find((p) => p.id === id) ?? null : null);

/** The Ring device watching each point: the data file, overridden by RING_POINT_DEVICES. */
export function pointDevices(ring: RingSettings | undefined) {
  const map = new Map<string, string>();
  for (const p of loadPoints()) if (p.ring_device_id) map.set(p.id, p.ring_device_id);
  for (const pair of (ring?.pointDevices ?? "").split(",")) {
    const [point, device] = pair.split("=").map((s) => s.trim());
    if (point && device) map.set(point, device);
  }
  return map;
}

/** A Ring event that shows a person at the point. */
export function isPresence(type: string, subType: string | null, sandbox = false) {
  if (type === "button_press" || type === "ding") return true;
  if (type === "motion_detected" || type === "motion") return subType == null || subType === "human" || subType === "motion";
  return type === "on_demand" && sandbox;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function pointView(p: Point, ring: RingSettings | undefined) {
  return { point_id: p.id, name: p.name, area: p.area, hours: p.hours, ring_device: pointDevices(ring).has(p.id), demo: true as const };
}

// ---------- tools ----------

export async function listMeetupPoints(deps: Deps, area?: string) {
  const all = loadPoints();
  const near = area ? all.filter((p) => norm(p.area) === norm(area)) : all;
  const points = (near.length ? near : all).map((p) => pointView(p, deps.cfg.ring));
  return {
    points,
    say: `${points.length === 1 ? "There's one PairUp Point" : `There are ${points.length} PairUp Points`}${area && near.length ? ` near ${area}` : ""}: ` +
      `${points.map((p) => p.name.replace(/^PairUp Point, /, "")).join("; ")}. Each has a Ring doorbell that confirms when you've both arrived.`,
  };
}

interface DealParties { id: string; status: string; buyer_id: string; seller_id: string; offer_location: string | null; request_location: string | null; seller_home: string | null; buyer_home: string | null }

const PARTIES = `
  SELECT d.id, d.status, l.seller_id, i.buyer_id, l.location AS offer_location, i.location AS request_location,
         su.home_area AS seller_home, bu.home_area AS buyer_home
  FROM deals d JOIN listings l ON l.id = d.listing_id JOIN buy_intents i ON i.id = d.buy_intent_id
  JOIN users su ON su.id = l.seller_id JOIN users bu ON bu.id = i.buyer_id`;

async function ownDeal(db: Db, userId: string, dealId: string | undefined, statuses: string[], withPoint = false) {
  const { rows } = await db.query<DealParties>(
    `${PARTIES} ${withPoint ? "JOIN meetups m ON m.deal_id = d.id" : ""}
     WHERE (l.seller_id = $1 OR i.buyer_id = $1) AND ($2::text IS NULL OR d.id = $2) AND d.status = ANY($3)
     ORDER BY d.updated_at DESC LIMIT 1`,
    [userId, dealId ?? null, statuses],
  );
  return rows[0] ?? null;
}

/** Meet at a PairUp Point for this deal: the one named, else the first in either person's area. */
export async function chooseMeetupPoint(deps: Deps, userId: string, input: { deal_id?: string; point_id?: string }) {
  const { db } = deps;
  const deal = await ownDeal(db, userId, input.deal_id, ["proposed", "confirmed"]);
  if (!deal) {
    throw new MarketError(input.deal_id ? "That deal isn't open, or it isn't yours." : "You don't have an open deal to pick a meet-up point for.", "no_open_deal");
  }
  let point: Point | null;
  if (input.point_id) {
    point = pointById(input.point_id);
    if (!point) throw new MarketError("I don't know that PairUp Point. Ask me for the points nearby.", "unknown_point");
  } else {
    const areas = [deal.offer_location ?? deal.seller_home, deal.request_location ?? deal.buyer_home].map(norm);
    const all = loadPoints();
    point = all.find((p) => areas.every((a) => a === norm(p.area))) ?? all.find((p) => areas.includes(norm(p.area))) ?? null;
    if (!point) {
      throw new MarketError(
        "There's no PairUp Point near either of you yet. Pick one by name, for example the HUB north entrance.",
        "no_point_nearby",
        { points: all.map((p) => p.id) },
      );
    }
  }
  await db.query(
    `INSERT INTO meetups (deal_id, point_id, chosen_by) VALUES ($1, $2, $3)
     ON CONFLICT (deal_id) DO UPDATE SET point_id = EXCLUDED.point_id, chosen_by = EXCLUDED.chosen_by, status = 'chosen', both_here_at = NULL, updated_at = now()`,
    [deal.id, point.id, userId],
  );
  // A new point starts the arrivals over.
  await db.query(`DELETE FROM meetup_arrivals WHERE deal_id = $1`, [deal.id]);
  await db.query(`UPDATE deals SET meetup = $2, updated_at = now() WHERE id = $1`, [deal.id, point.name]);
  await logEvent(db, "meetup_point_chosen", userId, deal.id, { point_id: point.id });
  const ringLine = pointDevices(deps.cfg.ring).has(point.id)
    ? " When you get there, press the Ring doorbell and tell me you're here. Ring confirms when you've both arrived. No video is kept."
    : " When you get there, tell me you're here.";
  return { deal_id: deal.id, point: pointView(point, deps.cfg.ring), say: `You'll meet at ${point.name} (demo location).${ringLine}` };
}

/** "I'm here": record the arrival, read the point's Ring Event History, and confirm it when Ring saw someone. */
export async function checkInAtPoint(deps: Deps, userId: string, input: { deal_id?: string }) {
  const { db, cfg } = deps;
  const deal = await ownDeal(db, userId, input.deal_id, ["confirmed"], true);
  if (!deal) {
    const open = input.deal_id ? null : await ownDeal(db, userId, undefined, ["proposed"], true);
    throw new MarketError(
      open ? "Both of you need to confirm the deal before the hand-off." : "You don't have a confirmed deal at a PairUp Point. Pick a point for your deal first.",
      open ? "deal_not_confirmed" : "no_meetup",
    );
  }
  const { rows: [m] } = await db.query<{ point_id: string; status: string }>(`SELECT point_id, status FROM meetups WHERE deal_id = $1`, [deal.id]);
  const point = pointById(m.point_id)!;
  await db.query(
    `INSERT INTO meetup_arrivals (deal_id, user_id, checked_in_at) VALUES ($1, $2, now())
     ON CONFLICT (deal_id, user_id) DO UPDATE SET checked_in_at = CASE WHEN meetup_arrivals.verified_at IS NULL THEN now() ELSE meetup_arrivals.checked_in_at END`,
    [deal.id, userId],
  );
  await logEvent(db, "meetup_checked_in", userId, deal.id, { point_id: point.id });

  const device = pointDevices(cfg.ring).get(point.id);
  let ring: { device: boolean; checked: boolean; error: string | null } = { device: !!device, checked: false, error: null };
  if (device && cfg.ring?.accessToken) {
    try {
      const events = await new RingClient(cfg.ring.accessToken, { apiBase: cfg.ring.apiBase, fetch: cfg.ring.fetch })
        .history(device, { since: Date.now() - HISTORY_MINUTES * 60_000, maxPages: 2 });
      for (const e of events) {
        if (isPresence(e.event_type, null, cfg.ring.sandbox)) await storeRingEvent(db, { id: e.id, device_id: device, point_id: point.id, event_type: e.event_type, sub_type: null, at: e.start, source: "history" });
      }
      ring = { ...ring, checked: true };
    } catch (err) {
      if (!(err instanceof RingApiError) && !(err instanceof Error && err.name === "TimeoutError")) throw err;
      ring = { ...ring, error: err instanceof RingApiError ? err.message : "Ring didn't answer in time" };
    }
  }
  await matchArrivals(db, point.id);
  const status = await meetupStatus(db, deal.id, userId);
  const say = status.status === "both_here"
    ? `You're both here. Ring confirmed both arrivals at ${point.name}. Go ahead with the hand-off.`
    : status.you === "confirmed"
      ? `Ring confirmed you're at ${point.name}. I'll tell you when the other person arrives.`
      : device
        ? `Checked in. Press the Ring doorbell at ${point.name} so I can confirm you're there.`
        : `Checked in at ${point.name}. This point has no Ring device connected yet, so I've noted it as your word.`;
  return { deal_id: deal.id, point: pointView(point, cfg.ring), arrival: status, ring, say };
}

// ---------- Ring events ----------

interface StoredEvent { id: string; device_id: string; point_id: string; event_type: string; sub_type: string | null; at: number; source: "webhook" | "history"; request_id?: string | null }

async function storeRingEvent(db: Db, e: StoredEvent) {
  await db.query(
    `INSERT INTO ring_events (id, device_id, point_id, event_type, sub_type, occurred_at, source, request_id)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), $7, $8) ON CONFLICT (id) DO NOTHING`,
    [e.id, e.device_id, e.point_id, e.event_type, e.sub_type, e.at, e.source, e.request_id ?? null],
  );
}

/**
 * A verified Ring webhook. Only presence events from a device that watches a
 * point are kept; everything else is acknowledged and dropped.
 */
export async function recordRingNotification(deps: Deps, n: RingNotification) {
  const point = [...pointDevices(deps.cfg.ring)].find(([, device]) => device === n.device_id)?.[0];
  if (!point || !isPresence(n.event_type, n.sub_type, deps.cfg.ring?.sandbox)) return { stored: false, confirmed: 0 };
  await storeRingEvent(deps.db, { id: n.event_id, device_id: n.device_id, point_id: point, event_type: n.event_type, sub_type: n.sub_type, at: n.at, source: "webhook", request_id: n.request_id });
  return { stored: true, confirmed: await matchArrivals(deps.db, point) };
}

/** Confirm open check-ins at a point that have a Ring presence event within the window; returns how many. */
async function matchArrivals(db: Db, pointId: string) {
  const { rows } = await db.query<{ deal_id: string; user_id: string }>(
    `WITH hit AS (
       SELECT DISTINCT ON (a.deal_id, a.user_id) a.deal_id, a.user_id, r.id, r.occurred_at, r.event_type
         FROM meetup_arrivals a
         JOIN meetups m ON m.deal_id = a.deal_id AND m.point_id = $1
         JOIN ring_events r ON r.point_id = m.point_id
          AND r.occurred_at BETWEEN a.checked_in_at - interval '${WINDOW_MINUTES} minutes' AND a.checked_in_at + interval '${WINDOW_MINUTES} minutes'
        WHERE a.verified_at IS NULL
        ORDER BY a.deal_id, a.user_id, abs(extract(epoch FROM r.occurred_at - a.checked_in_at)))
     UPDATE meetup_arrivals a
        SET ring_event_id = hit.id, ring_event_at = hit.occurred_at, ring_event_type = hit.event_type, verified_at = now()
       FROM hit WHERE a.deal_id = hit.deal_id AND a.user_id = hit.user_id
      RETURNING a.deal_id, a.user_id`,
    [pointId],
  );
  for (const r of rows) {
    await logEvent(db, "meetup_arrival_confirmed", r.user_id, r.deal_id, { point_id: pointId });
    const { rows: [both] } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM meetup_arrivals WHERE deal_id = $1 AND verified_at IS NOT NULL`, [r.deal_id],
    );
    const next = both.n >= 2 ? "both_here" : "one_here";
    const { rows: changed } = await db.query(
      `UPDATE meetups SET status = $2, both_here_at = CASE WHEN $2 = 'both_here' THEN now() ELSE NULL END, updated_at = now()
        WHERE deal_id = $1 AND status <> 'both_here' AND status <> $2 RETURNING deal_id`,
      [r.deal_id, next],
    );
    if (changed.length && next === "both_here") await logEvent(db, "meetup_both_here", null, r.deal_id, { point_id: pointId });
  }
  return rows.length;
}

export type ArrivalState = "not_here" | "checked_in" | "confirmed";

export interface ArrivalRow { user_id: string; checked_in_at: string; verified_at: string | null; ring_event_type: string | null }

/** Each side's arrival as the viewer sees it: theirs and the other person's. */
export function arrivalView(status: string, bothHereAt: string | Date | null, arrivals: ArrivalRow[], viewerId: string) {
  const state = (a?: ArrivalRow): ArrivalState => (!a ? "not_here" : a.verified_at ? "confirmed" : "checked_in");
  const mine = arrivals.find((a) => a.user_id === viewerId);
  const theirs = arrivals.find((a) => a.user_id !== viewerId);
  return {
    status: status as "chosen" | "one_here" | "both_here",
    you: state(mine),
    them: state(theirs),
    both_here_at: bothHereAt ? new Date(bothHereAt).toISOString() : null,
  };
}

async function meetupStatus(db: Db, dealId: string, viewerId: string) {
  const { rows: [m] } = await db.query<{ status: string; both_here_at: string | null }>(`SELECT status, both_here_at FROM meetups WHERE deal_id = $1`, [dealId]);
  const { rows } = await db.query<ArrivalRow>(`SELECT user_id, checked_in_at, verified_at, ring_event_type FROM meetup_arrivals WHERE deal_id = $1`, [dealId]);
  return arrivalView(m.status, m.both_here_at, rows, viewerId);
}

/** Ring events last a day; check-ins 30 days. */
export async function purgeRing(db: Db) {
  await db.query(`DELETE FROM ring_events WHERE received_at < now() - interval '24 hours'`);
  await db.query(`DELETE FROM meetup_arrivals WHERE checked_in_at < now() - interval '30 days'`);
}
