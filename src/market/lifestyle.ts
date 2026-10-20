import { createHash } from "node:crypto";
import type { Db } from "../db/client.js";
import { num, type Kind, type PriceUnit } from "./types.js";

// Learning a person's routines from their own requests. No model call and no
// data from anyone else: requests that mean the same thing (embedding
// similarity, same kind and price unit) form a routine once they recur on
// regular days at a regular time. A routine knows when it usually happens, the
// usual budget, pickup and place, and when it is next due; get_suggestions
// offers it shortly before then. What the person does with a suggestion is
// remembered: "forget" stops it, and a routine dismissed twice in two weeks
// without being accepted goes quiet by itself.

export const DEFAULT_TIME_ZONE = "Asia/Hong_Kong";

/** How a routine is found and when it is offered. */
export const ROUTINE_POLICY = {
  windowDays: 90,
  /** Cosine similarity for two requests to count as the same need. */
  sameNeed: 0.8,
  minOccurrences: 3,
  /** A suggestion is due from this long before the usual time… */
  leadMinutes: 90,
  /** …until this long after it. */
  graceMinutes: 30,
  /** Dismissed this often in 14 days, never accepted: stop suggesting. */
  quietAfterDismissals: 2,
};

export interface PastRequest {
  id: string;
  need: string;
  kind: Kind;
  price_unit: PriceUnit;
  max_price: number;
  hours: number | null;
  pickup: string | null;
  location: string | null;
  schedule: string | null;
  created_at: Date;
  embedding: number[];
}

export type Cadence = "daily" | "weekdays" | "weekends" | "days";

export interface Routine {
  routine_id: string;
  need: string;
  kind: Kind;
  price_unit: PriceUnit;
  /** "weekdays around 12:15", "Tuesdays and Thursdays around 12:15" */
  when: string;
  cadence: Cadence;
  /** 0 = Sunday … 6 = Saturday, in the user's time zone. */
  weekdays: number[];
  /** Minutes after local midnight. */
  usual_minute: number;
  usual_budget: number;
  hours: number | null;
  pickup: string | null;
  location: string | null;
  times: number;
  last_at: string;
  next_at: string;
  /** 0-1: how many times, and how regular the days and times are. */
  confidence: number;
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ---------- time in the user's own zone ----------

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
    });
    partsFmt.set(tz, f);
  }
  return f;
}

export interface LocalTime { year: number; month: number; day: number; weekday: number; minute: number; date: string }

export function localTime(at: Date, tz: string): LocalTime {
  const p = Object.fromEntries(fmt(tz).formatToParts(at).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  const [year, month, day] = [Number(p.year), Number(p.month), Number(p.day)];
  return { year, month, day, weekday, minute: Number(p.hour) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}

/** The instant at `minute` past local midnight on a local calendar day. */
function atLocal(year: number, month: number, day: number, minute: number, tz: string): Date {
  const wall = Date.UTC(year, month - 1, day, 0, minute);
  // Two passes settle the offset, also across a daylight-saving change.
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const l = localTime(new Date(t), tz);
    const shown = Date.UTC(l.year, l.month - 1, l.day, 0, l.minute);
    t += wall - shown;
  }
  return new Date(t);
}

export const clock = (minute: number) => {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

// ---------- finding routines ----------

const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const mode = <T>(xs: (T | null)[]): T | null => {
  const counts = new Map<T, number>();
  for (const x of xs) if (x != null) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [x, c] of counts) if (c > n) [best, n] = [x, c];
  return best;
};

/** Group requests that mean the same thing. Greedy, oldest first, against each group's first request. */
export function groupSameNeeds(requests: PastRequest[], sameNeed = ROUTINE_POLICY.sameNeed): PastRequest[][] {
  const groups: PastRequest[][] = [];
  for (const r of [...requests].sort((a, b) => +a.created_at - +b.created_at)) {
    const home = groups.find((g) => g[0].kind === r.kind && g[0].price_unit === r.price_unit && cosine(g[0].embedding, r.embedding) >= sameNeed);
    if (home) home.push(r);
    else groups.push([r]);
  }
  return groups;
}

/** The routine in one group of same-need requests, or null when it doesn't recur regularly. */
export function routineOf(userId: string, group: PastRequest[], tz: string, now: Date, policy = ROUTINE_POLICY): Routine | null {
  if (group.length < policy.minOccurrences) return null;
  const local = group.map((r) => localTime(r.created_at, tz));
  if (new Set(local.map((l) => l.date)).size < policy.minOccurrences) return null;

  // Days: those that carry at least a fifth of the occurrences.
  const perDay = new Array<number>(7).fill(0);
  for (const l of local) perDay[l.weekday]++;
  const weekdays = perDay.map((n, d) => (n >= Math.max(1, group.length / 5) ? d : -1)).filter((d) => d >= 0);
  const onDays = local.filter((l) => weekdays.includes(l.weekday)).length / group.length;
  const cadence: Cadence =
    weekdays.length === 7 || weekdays.length >= 6 ? "daily"
    : weekdays.every((d) => d >= 1 && d <= 5) && weekdays.length >= 4 ? "weekdays"
    : weekdays.every((d) => d === 0 || d === 6) && weekdays.length === 2 ? "weekends"
    : "days";
  const days = cadence === "daily" ? [0, 1, 2, 3, 4, 5, 6] : cadence === "weekdays" ? [1, 2, 3, 4, 5] : weekdays;

  // Time: the median, and how tightly the times sit around it.
  const minutes = local.map((l) => l.minute);
  const usual = Math.round(median(minutes) / 5) * 5;
  const spread = median(minutes.map((m) => Math.abs(m - usual)));
  if (spread > 180) return null;
  const timeRegularity = spread <= 30 ? 1 : spread <= 90 ? 0.75 : 0.5;
  const confidence = Math.round(Math.min(1, group.length / 6) * timeRegularity * onDays * 100) / 100;
  if (confidence < 0.35) return null;

  const latest = group[group.length - 1];
  const dayWords =
    cadence === "daily" ? "every day"
    : cadence === "weekdays" ? "on weekdays"
    : cadence === "weekends" ? "on weekends"
    : `on ${days.map((d) => `${DAY[d]}s`).join(days.length === 2 ? " and " : ", ")}`;
  return {
    routine_id: `rtn_${createHash("sha1").update(`${userId}|${group[0].id}`).digest("hex").slice(0, 10)}`,
    need: latest.need,
    kind: latest.kind,
    price_unit: latest.price_unit,
    when: `${dayWords} around ${clock(usual)}`,
    cadence,
    weekdays: days,
    usual_minute: usual,
    usual_budget: Math.round(median(group.map((r) => r.max_price)) * 100) / 100,
    hours: mode(group.map((r) => r.hours)),
    pickup: mode(group.map((r) => r.pickup)),
    location: mode(group.map((r) => r.location)),
    times: group.length,
    last_at: latest.created_at.toISOString(),
    next_at: nextOccurrence(days, usual, tz, now, policy.graceMinutes).toISOString(),
    confidence,
  };
}

/** The next time on one of `days` at `minute`, counting one that started up to `grace` minutes ago. */
export function nextOccurrence(days: number[], minute: number, tz: string, now: Date, grace = 0): Date {
  const today = localTime(now, tz);
  for (let ahead = 0; ahead <= 7; ahead++) {
    const noon = atLocal(today.year, today.month, today.day + ahead, 12 * 60, tz);
    const l = localTime(noon, tz);
    if (!days.includes(l.weekday)) continue;
    const at = atLocal(l.year, l.month, l.day, minute, tz);
    if (+at >= +now - grace * 60_000) return at;
  }
  return atLocal(today.year, today.month, today.day + 7, minute, tz);
}

export function findRoutines(userId: string, requests: PastRequest[], tz: string, now = new Date(), policy = ROUTINE_POLICY): Routine[] {
  return groupSameNeeds(requests, policy.sameNeed)
    .map((g) => routineOf(userId, g, tz, now, policy))
    .filter((r): r is Routine => !!r)
    .sort((a, b) => b.confidence - a.confidence || +new Date(a.next_at) - +new Date(b.next_at));
}

/** Whether a routine should be offered now: inside its window before the usual time. */
export function isDue(r: Routine, now: Date, policy = ROUTINE_POLICY) {
  const at = +new Date(r.next_at);
  return +now >= at - policy.leadMinutes * 60_000 && +now <= at + policy.graceMinutes * 60_000;
}

// ---------- database ----------

const parseVector = (v: unknown): number[] => (Array.isArray(v) ? (v as number[]) : JSON.parse(String(v)));

export async function timeZoneOf(db: Db, userId: string) {
  const { rows } = await db.query<{ time_zone: string | null }>(`SELECT time_zone FROM users WHERE id = $1`, [userId]);
  return validZone(rows[0]?.time_zone) ?? DEFAULT_TIME_ZONE;
}

export function validZone(tz: string | null | undefined) {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

export async function pastRequests(db: Db, userId: string, windowDays = ROUTINE_POLICY.windowDays): Promise<PastRequest[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT id, need, kind, price_unit, max_price, hours, pickup, location, schedule, created_at, embedding::text AS embedding
     FROM buy_intents
     WHERE buyer_id = $1 AND embedding IS NOT NULL AND created_at > now() - make_interval(days => $2)
     ORDER BY created_at`,
    [userId, windowDays],
  );
  return rows.map((r) => ({
    id: String(r.id), need: String(r.need), kind: r.kind as Kind, price_unit: r.price_unit as PriceUnit,
    max_price: num(r.max_price as string)!, hours: num(r.hours as string | null), pickup: (r.pickup as string | null) ?? null,
    location: (r.location as string | null) ?? null, schedule: (r.schedule as string | null) ?? null,
    created_at: new Date(r.created_at as string), embedding: parseVector(r.embedding),
  }));
}

/** The user's routines, without the ones they asked to forget or keep dismissing. */
export async function routinesFor(db: Db, userId: string, now = new Date()) {
  const tz = await timeZoneOf(db, userId);
  const all = findRoutines(userId, await pastRequests(db, userId), tz, now);
  const { rows } = await db.query<{ routine_id: string; action: string; n: number }>(
    `SELECT routine_id, action, count(*)::int AS n FROM routine_feedback
     WHERE user_id = $1 AND (action = 'forget' OR created_at > now() - interval '14 days')
     GROUP BY routine_id, action`,
    [userId],
  );
  const fb = (id: string, action: string) => rows.find((r) => r.routine_id === id && r.action === action)?.n ?? 0;
  const live = all.filter((r) => !fb(r.routine_id, "forget"));
  const quiet = new Set(
    live.filter((r) => fb(r.routine_id, "dismissed") >= ROUTINE_POLICY.quietAfterDismissals && !fb(r.routine_id, "accepted")).map((r) => r.routine_id),
  );
  return { tz, routines: live, quiet };
}

export async function recordRoutineFeedback(db: Db, userId: string, routineId: string, action: "accepted" | "dismissed" | "forget", day: string) {
  await db.query(
    `INSERT INTO routine_feedback (user_id, routine_id, action, day) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [userId, routineId, action, day],
  );
}

export async function feedbackToday(db: Db, userId: string, routineId: string, day: string) {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM routine_feedback WHERE user_id = $1 AND routine_id = $2 AND day = $3`,
    [userId, routineId, day],
  );
  return rows[0].n > 0;
}
