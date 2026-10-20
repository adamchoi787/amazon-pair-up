import type { Db } from "../db/client.js";

// Deterministic scheduling for the campus market. Natural language outside this
// small, documented grammar stays unverified; an LLM never proves availability.
export const DEFAULT_TIME_ZONE = "America/Los_Angeles";
const DAY = 86_400_000;
const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dayPattern = /\b(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)s?\b/g;
const clock = "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?";
const rangePattern = new RegExp(`\\b${clock}\\s*(?:-|to|until|till)\\s*${clock}\\b`, "i");
const atPattern = new RegExp(`\\b(by|before|at|around)\\s+${clock}\\b`, "i");
const formatters = new Map<string, Intl.DateTimeFormat>();

export function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}

function localParts(date: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) formatters.set(timeZone, formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }));
  const p = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute };
}

// Try the offsets on both sides of a DST transition. Ambiguous/nonexistent
// local times require an ISO timestamp with an offset instead of a guess.
function instant(local: number, timeZone: string): Date {
  const candidates = new Set<number>();
  for (const shift of [-DAY, 0, DAY]) {
    const probe = local + shift;
    const p = localParts(new Date(probe), timeZone);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - probe;
    const candidate = local - offset;
    const c = localParts(new Date(candidate), timeZone);
    if (Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute) === local) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new Error("That local time is ambiguous or does not exist. Give an ISO time with its UTC offset.");
  return new Date([...candidates][0]);
}

/** The instant of a local wall-clock time, `daysAgo` local days before `now`'s local date. */
export function localInstant(now: Date, daysAgo: number, minutes: number, timeZone = DEFAULT_TIME_ZONE): Date {
  const p = localParts(now, timeZone);
  return instant(Date.UTC(p.year, p.month - 1, p.day) - daysAgo * DAY + minutes * 60_000, timeZone);
}

const clean = (s: string) => s.toLowerCase().replace(/[–—]/g, "-").replace(/\b([ap])\.?m\.?/g, "$1m").trim();
function minute(h: string, m: string | undefined, meridiem: string | undefined): number | null {
  const hour = +h, mins = +(m ?? 0);
  if (mins > 59 || hour > (meridiem ? 12 : 23) || (meridiem && hour < 1)) return null;
  return (meridiem ? hour % 12 + (meridiem === "pm" ? 12 : 0) : hour) * 60 + mins;
}

function timeRange(text: string): { start: number; end: number; text: string } | null {
  const r = text.replace(/\b\d{4}-\d\d-\d\d\b/g, "").match(rangePattern);
  if (!r) return null;
  if (!r[3] && !r[6] && +r[1] <= 12 && +r[4] <= 12 && !r[2] && !r[5]) return null;
  let first = r[3];
  // "9-5pm" means 9am-5pm; "2-6pm" means 2pm-6pm.
  if (!first && r[6]) first = +r[1] > +r[4] && +r[1] !== 12 ? (r[6] === "pm" ? "am" : "pm") : r[6];
  const start = minute(r[1], r[2], first), end = minute(r[4], r[5], r[6]);
  if (start == null || end == null || start === end) return null;
  return { start, end: end <= start ? end + 1440 : end, text: r[0] };
}

function daysOf(text: string): Set<number> | null {
  if (/\b(weekdays?|weeknights?)\b/.test(text)) return new Set([1, 2, 3, 4, 5]);
  if (/\bweekends?\b/.test(text)) return new Set([0, 6]);
  if (/\b(daily|every day|any day|everyday|anytime)\b/.test(text)) return new Set([0, 1, 2, 3, 4, 5, 6]);
  const found = [...text.matchAll(dayPattern)];
  if (!found.length) return null;
  const days = new Set(found.map(m => names.indexOf(m[1].slice(0, 3))));
  if (found.length === 2 && /^\s*(?:-|to|through)\s*$/.test(text.slice(found[0].index! + found[0][0].length, found[1].index))) {
    const start = names.indexOf(found[0][1].slice(0, 3)), end = names.indexOf(found[1][1].slice(0, 3));
    for (let d = start; d !== end; d = (d + 1) % 7) days.add(d);
  }
  return days;
}

export interface TimeInput {
  schedule?: string | null; needed_by?: string | Date | null; hours?: number | string | null;
  starts_at?: string | null; ends_at?: string | null; time_zone?: string; now?: Date;
}
export interface ServiceTime { start: string | null; end: string | null; deadline: string | null; hours: number | null }

/** Resolve against the post's creation time, never the time a later buyer browses it. */
export function resolveServiceTime(input: TimeInput): ServiceTime {
  const zone = input.time_zone ?? DEFAULT_TIME_ZONE;
  if (!validTimeZone(zone)) throw new Error("Use a valid IANA time zone, such as America/Los_Angeles.");
  const hours = input.hours == null ? null : Number(input.hours);
  if (hours != null && (!Number.isFinite(hours) || hours <= 0 || hours > 336)) throw new Error("Hours must be greater than zero and at most 336.");
  const iso = (s: string) => {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)$/i.test(s) || !Number.isFinite(Date.parse(s))) {
      throw new Error("Use an ISO date and time with a UTC offset for starts_at and ends_at.");
    }
    const [year, month, day] = s.slice(0, 10).split("-").map(Number);
    if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== s.slice(0, 10)) throw new Error("That calendar date does not exist.");
    return new Date(s).toISOString();
  };
  if (input.ends_at && !input.starts_at) throw new Error("Give starts_at as well as ends_at.");
  if (input.starts_at) {
    const start = iso(input.starts_at);
    const end = input.ends_at ? iso(input.ends_at) : hours ? new Date(Date.parse(start) + hours * 3_600_000).toISOString() : null;
    if (end && end <= start) throw new Error("The job must end after it starts.");
    if (end && Date.parse(end) - Date.parse(start) > 14 * DAY) throw new Error("A job can last at most 14 days.");
    if (end && hours && Math.abs((Date.parse(end) - Date.parse(start)) / 3_600_000 - hours) > 0.011) throw new Error("The hours and the requested time window disagree.");
    if (input.schedule) {
      const spoken = resolveServiceTime({ ...input, starts_at: undefined, ends_at: undefined, needed_by: start });
      if ((spoken.start && spoken.start !== start) || (spoken.end && spoken.end !== end)) throw new Error("The spoken schedule and exact timestamps disagree.");
    }
    return { start, end, deadline: start, hours: end ? +((Date.parse(end) - Date.parse(start)) / 3_600_000).toFixed(2) : hours };
  }
  const text = clean(input.schedule ?? "");
  const now = input.now ?? new Date();
  const anchor = input.needed_by ? new Date(input.needed_by) : now;
  const parts = localParts(anchor, zone);
  let date = Date.UTC(parts.year, parts.month - 1, parts.day);
  const explicitDate = text.match(/\b(\d{4})-(\d\d)-(\d\d)\b/);
  const day = text.match(/\b(today|tomorrow|tonight|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)?.[1];
  if (explicitDate) {
    date = Date.UTC(+explicitDate[1], +explicitDate[2] - 1, +explicitDate[3]);
    if (new Date(date).toISOString().slice(0, 10) !== explicitDate[0]) throw new Error("That calendar date does not exist.");
  } else if (!input.needed_by) {
    if (day === "tomorrow") date += DAY;
    else if (day && names.includes(day.slice(0, 3))) {
      date += ((names.indexOf(day.slice(0, 3)) - new Date(date).getUTCDay() + 7) % 7 || 7) * DAY;
    }
  }
  if (input.needed_by && day && names.includes(day.slice(0, 3)) && names.indexOf(day.slice(0, 3)) !== new Date(date).getUTCDay()) {
    throw new Error("The requested weekday and needed_by date disagree. Give the exact date and time you want.");
  }
  const range = timeRange(text);
  const point = range ? null : text.match(atPattern);
  const value = point ? minute(point[2], point[3], point[4]) : null;
  if (!range && value == null) {
    const deadline = input.needed_by ? new Date(input.needed_by).toISOString()
      : day || explicitDate ? instant(date + 1439 * 60_000, zone).toISOString() : null;
    return { start: null, end: null, deadline, hours };
  }
  if (/\b(around|about|roughly|maybe|except|unless|not)\b/.test(text)) {
    return { start: null, end: null, deadline: input.needed_by ? new Date(input.needed_by).toISOString() : instant(date + 1439 * 60_000, zone).toISOString(), hours };
  }
  let start = instant(date + (range?.start ?? value!) * 60_000, zone);
  if (!day && !explicitDate && !input.needed_by && start <= now) {
    date += DAY;
    start = instant(date + (range?.start ?? value!) * 60_000, zone);
  }
  if (point && /^(by|before)$/.test(point[1])) return { start: null, end: null, deadline: start.toISOString(), hours };
  const end = range ? instant(date + range.end * 60_000, zone)
    : hours ? new Date(start.getTime() + hours * 3_600_000) : null;
  const duration = end ? +((end.getTime() - start.getTime()) / 3_600_000).toFixed(2) : hours;
  if (range && hours && Math.abs(duration! - hours) > 0.011) throw new Error("The hours and the requested time window disagree.");
  return { start: start.toISOString(), end: end?.toISOString() ?? null, deadline: start.toISOString(), hours: duration };
}

/**
 * An item's deadline from free speech. Only a day word, an ISO date or "by/before"
 * with a clear clock time count; prices such as "15-20 bucks" or "around 20" and
 * place names such as "7-Eleven" never set a deadline. Unclear text gives null.
 */
export function itemDeadline(raw: string, timeZone = DEFAULT_TIME_ZONE, now = new Date()): string | null {
  const text = clean(raw);
  const explicitDate = text.match(/\b(\d{4})-(\d\d)-(\d\d)\b/);
  const day = text.match(/\b(today|tomorrow|tonight|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)?.[1];
  const by = text.match(/\b(?:by|before)\s+(?:(noon)|(\d{1,2})(?::(\d{2}))?\s*(am|pm)|(\d{1,2}):(\d{2}))\b/);
  if (!explicitDate && !day && !by) return null;
  try {
    const parts = localParts(now, timeZone);
    let date = Date.UTC(parts.year, parts.month - 1, parts.day);
    if (explicitDate) {
      date = Date.UTC(+explicitDate[1], +explicitDate[2] - 1, +explicitDate[3]);
      if (new Date(date).toISOString().slice(0, 10) !== explicitDate[0]) return null;
    } else if (day === "tomorrow") date += DAY;
    else if (day && names.includes(day.slice(0, 3))) {
      date += ((names.indexOf(day.slice(0, 3)) - new Date(date).getUTCDay() + 7) % 7 || 7) * DAY;
    }
    const value = !by ? null : by[1] ? 720 : by[2] ? minute(by[2], by[3], by[4]) : minute(by[5], by[6], undefined);
    if (by && value == null) return null;
    if (value == null) return instant(date + 1439 * 60_000, timeZone).toISOString();
    let deadline = instant(date + value * 60_000, timeZone);
    if (!day && !explicitDate && deadline <= now) deadline = instant(date + DAY + value * 60_000, timeZone);
    return deadline.toISOString();
  } catch { return null; }
}

interface WeeklyWindow { day: number; start: number; end: number }
function availability(text: string): { windows: WeeklyWindow[]; days: Set<number> | null; complete: boolean } {
  const s = clean(text);
  const days = daysOf(s);
  const windows: WeeklyWindow[] = [];
  let complete = !!s;
  for (const clause of s.split(/;|\n|,(?=\s*(?:mon|tue|wed|thu|fri|sat|sun|week))/)) {
    const clauseDays = daysOf(clause);
    const range = timeRange(clause);
    let rest = clause.replace(range?.text ?? "\0", "").replace(dayPattern, "")
      .replace(/\b(weekdays?|weekends?|daily|everyday|every day|any day|anytime|only|every|on|from|and|to|through)\b/g, "").replace(/[\s,\-/]/g, "");
    // Partial constraints still reject an impossible day, but are never called verified.
    if (rest || !clause.trim()) complete = false;
    for (const day of clauseDays ?? [0, 1, 2, 3, 4, 5, 6]) {
      const start = range?.start ?? 0, end = range?.end ?? 1440;
      windows.push({ day, start, end: Math.min(end, 1440) });
      if (end > 1440) windows.push({ day: (day + 1) % 7, start: 0, end: end - 1440 });
    }
  }
  return { windows, days, complete };
}

export interface ScheduledOffer { kind: string; availability: string | null; time_zone?: string }
export interface ScheduledRequest {
  kind: string; schedule: string | null; needed_by: string | Date | null; hours: number | string | null;
  service_start?: string | Date | null; service_end?: string | Date | null; time_zone?: string; created_at?: string | Date;
}
export type ScheduleStatus = "verified" | "needs_confirmation" | "conflict" | "not_applicable";
export interface ScheduleCheck { status: ScheduleStatus; starts_at: string | null; ends_at: string | null; time_zone: string; provider_availability: string | null }

export function requestWindow(request: ScheduledRequest): ServiceTime {
  if (request.service_start) return {
    start: new Date(request.service_start).toISOString(), end: request.service_end ? new Date(request.service_end).toISOString() : null,
    deadline: request.needed_by ? new Date(request.needed_by).toISOString() : null, hours: request.hours == null ? null : Number(request.hours),
  };
  try { return resolveServiceTime({ ...request, now: request.created_at ? new Date(request.created_at) : new Date() }); }
  catch { return { start: null, end: null, deadline: null, hours: null }; }
}

/** Half-open work windows allow one job to start exactly when another ends. */
export function windowsOverlap(a: ServiceTime, b: ServiceTime): boolean {
  return !!(a.start && a.end && b.start && b.end && a.start < b.end && b.start < a.end);
}

export async function providerBookings(db: Db, sellerIds: string[]) {
  if (!sellerIds.length) return [];
  const { rows } = await db.query<ScheduledRequest & { seller_id: string; request_id: string }>(
    `SELECT i.*, l.seller_id, i.id AS request_id FROM deals d
     JOIN listings l ON l.id = d.listing_id JOIN buy_intents i ON i.id = d.buy_intent_id
     WHERE l.seller_id = ANY($1::text[]) AND l.kind = 'service'
       AND (i.service_end IS NULL OR i.service_end > now())
       AND (d.status = 'confirmed' OR (d.status = 'proposed' AND d.expires_at > now()))`,
    [sellerIds],
  );
  return rows;
}

export function hasBookingConflict(request: ScheduledRequest & { id: string }, bookings: Awaited<ReturnType<typeof providerBookings>>) {
  const window = requestWindow(request);
  return bookings.some(b => b.request_id !== request.id && windowsOverlap(window, requestWindow(b)));
}

export function checkSchedule(offer: ScheduledOffer, request: ScheduledRequest): ScheduleCheck {
  const zone = offer.time_zone ?? DEFAULT_TIME_ZONE;
  const work = requestWindow(request);
  const result: ScheduleCheck = { status: "needs_confirmation", starts_at: work.start, ends_at: work.end, time_zone: zone, provider_availability: offer.availability };
  if (offer.kind !== "service") return { ...result, status: "not_applicable" };
  if (!offer.availability || !validTimeZone(zone)) return result;
  const available = availability(offer.availability);
  // Unknown qualifiers such as "except Monday" cannot safely prove a conflict
  // using a partial parse either; preserve a manual confirmation in that case.
  if (/\b(except|not|unless|excluding)\b/.test(clean(offer.availability))) return result;
  const start = work.start ?? work.deadline;
  if (!start) return result;
  const dayOnly = !work.start && !!request.schedule && !timeRange(clean(request.schedule)) && !atPattern.test(clean(request.schedule));
  const end = work.end ? Date.parse(work.end) : Date.parse(start) + 1;
  for (let t = Date.parse(start); t < end;) {
    const p = localParts(new Date(t), zone);
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    if (available.days && !available.days.has(weekday) && !available.windows.some(w => w.day === weekday && w.start === 0)) return { ...result, status: "conflict" };
    // Walk UTC minute boundaries. A local hour can repeat or disappear at DST,
    // so adding a nominal number of hours to local midnight is unsafe here.
    const fraction = ((t % 60_000) + 60_000) % 60_000;
    const m = p.hour * 60 + p.minute + fraction / 60_000;
    const step = Math.min(end - t, 60_000 - fraction);
    if (available.complete && !dayOnly) {
      const ranges = available.windows.filter(w => w.day === weekday).sort((a, b) => a.start - b.start);
      let until = m;
      for (const r of ranges) if (r.start <= until && r.end > until) until = r.end;
      if (until < m + step / 60_000) return { ...result, status: "conflict" };
    }
    t += step;
  }
  return { ...result, status: available.complete && !!work.start && !!work.end ? "verified" : "needs_confirmation" };
}
