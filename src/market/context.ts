import type { ExtractedIntent } from "../ai/index.js";
import type { Db } from "../db/client.js";
import { logEvent, shortId } from "./events.js";
import {
  clock, feedbackToday, isDue, localTime, pastRequests, recordRoutineFeedback, routinesFor, timeZoneOf, validZone, type Routine,
} from "./lifestyle.js";
import { ensureUser, MarketError, postRequest, rate, type Deps } from "./service.js";
import { type Kind, type PriceUnit, type RequestSource } from "./types.js";

// Knowing what someone needs before they ask. Two sources:
//   - context signals from devices: Bee (a to-do, a conversation summary, a
//     voice note), an Apple Watch or phone Shortcut ("arrived at Hall 5",
//     "I need a charger"), or an agent that holds the user's Bee data;
//   - routines learned from the user's own past requests (lifestyle.ts).
// Either becomes a suggestion: a ready-made request the user accepts with one
// yes (accept_suggestion), dismisses, or asks to forget. Nothing is posted
// without that yes. Only snippets that name a need are kept, for 30 days; a
// location keeps the place name only.

export const SIGNAL_SOURCES = ["bee", "watch", "phone"] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];
export const SIGNAL_KINDS = ["todo", "conversation", "journal", "fact", "location", "note"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

const KEEP_DAYS = 30;
export async function purgeContext(db: Db) {
  await db.query(`DELETE FROM context_signals WHERE created_at < now() - make_interval(days => $1)`, [KEEP_DAYS]);
}
/** A suggestion from a signal is offered for this long. */
const FRESH_HOURS = 48;
/** A place the user arrived at counts as where they are for this long. */
const HERE_HOURS = 3;
/** Past requests at least this similar set the usual budget for a new need. */
const SIMILAR = 0.75;

// Words that say someone needs something. Deliberately plain: a signal that
// misses here is simply not suggested, and every suggestion still waits for a yes.
const NEED_CUES = new RegExp(
  String.raw`\b(need|needs|needed|run(?:ning)? out of|ran out of|out of|broke|broken|lost|forgot|looking for|have to (?:buy|get|find)|` +
    String.raw`must (?:buy|get)|should (?:buy|get)|buy|get (?:a|an|some|new)|pick up|someone to|anyone (?:to|who)|help (?:me|with|moving|at)|` +
    String.raw`borrow|deliver|errand|replace|hire|book a)\b`,
  "i",
);
// Things already done or about someone else's plans: not a need now.
const NOT_NOW = /\b(already (?:bought|got|have)|bought|got one|done|finished|no longer need)\b/i;

export interface SignalInput {
  source: SignalSource;
  kind: SignalKind;
  text?: string;
  place?: string;
  /** ISO 8601; defaults to now. */
  observed_at?: string;
  /** The device's own id for the event (a Bee to-do id), so a resend is ignored. */
  external_id?: string;
  /** IANA zone of the device, e.g. "Asia/Hong_Kong"; remembered for the user's routines. */
  time_zone?: string;
}

export interface SuggestedRequest {
  need: string;
  kind: Kind;
  price_unit: PriceUnit;
  max_price: number | null;
  hours: number | null;
  pickup: string | null;
  location: string | null;
  schedule: string | null;
  needed_by: string | null;
}

export interface Suggestion {
  suggestion_id: string;
  from: "routine" | SignalSource;
  /** Why this is suggested, as the user would want it said. */
  reason: string;
  /** The user's own words or to-do that led here (signals only). */
  heard: string | null;
  request: SuggestedRequest;
  confidence: number | null;
  say: string;
}

export const looksLikeNeed = (text: string) => NEED_CUES.test(text) && !NOT_NOW.test(text);

/**
 * The part of a summary that names the need: "Realized my calculator broke;
 * need a graphing calculator before the exam." → "need a graphing calculator
 * before the exam". Extraction then reads the item, not the story around it.
 */
export function needClause(text: string) {
  const clauses = text.split(/(?<=[.;!?])\s+|;\s*/).map((c) => c.trim().replace(/[.;!?]+$/, "")).filter(Boolean);
  const needs = clauses.filter(looksLikeNeed);
  // Prefer the clause that says what is wanted over the one that says what broke.
  return needs.find((c) => /\b(need|buy|get|looking for|someone to|replace|borrow|hire|book)\b/i.test(c)) ?? needs[0] ?? text;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const parseDate = (s?: string) => {
  const d = s ? new Date(s) : new Date();
  return Number.isNaN(+d) ? new Date() : d;
};

// ---------- taking in context ----------

/** A device's time zone places the user's routines in their own day. */
export async function rememberTimeZone(db: Db, userId: string, tz?: string) {
  const zone = validZone(tz);
  if (zone) await db.query(`UPDATE users SET time_zone = $2 WHERE id = $1 AND time_zone IS DISTINCT FROM $2`, [userId, zone]);
}

/** Record one signal; when it names a need, return the suggestion it makes. */
export async function addContext(deps: Deps, userId: string, input: SignalInput) {
  const { db, ai } = deps;
  await ensureUser(db, userId);
  await rememberTimeZone(db, userId, input.time_zone);
  await purgeContext(db);

  const observedAt = parseDate(input.observed_at);
  const original = input.text?.trim().slice(0, 500) || null;
  const text = original && looksLikeNeed(original) ? needClause(original) : null;
  const place = input.place?.trim().slice(0, 120) || null;
  if (input.external_id) {
    const { rows } = await db.query<{ id: string; status: string; suggestion: Suggestion | null }>(
      `SELECT id, status, suggestion FROM context_signals WHERE user_id = $1 AND source = $2 AND external_id = $3`,
      [userId, input.source, input.external_id],
    );
    if (rows[0]) return { signal_id: rows[0].id, suggestion: rows[0].status === "suggested" ? rows[0].suggestion : null, duplicate: true };
  }

  const id = shortId("ctx");
  const need = input.kind !== "location" && text && looksLikeNeed(text);
  let suggestion: Suggestion | null = null;
  if (need) {
    const extracted = await ai.extractIntent(needClause(text), observedAt);
    suggestion = await fromSignal(deps, userId, id, input.source, text, extracted, observedAt);
  }
  await db.query(
    `INSERT INTO context_signals (id, user_id, source, kind, external_id, text, place, observed_at, status, suggestion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id, userId, input.source, input.kind, input.external_id ?? null,
      // Snippets that name no need are not kept.
      suggestion ? text : null, place, observedAt.toISOString(), suggestion ? "suggested" : "ignored",
      suggestion ? JSON.stringify(suggestion) : null,
    ],
  );
  await logEvent(db, "context_signal", userId, id, { source: input.source, kind: input.kind, suggested: !!suggestion });
  return { signal_id: id, suggestion, duplicate: false };
}

async function fromSignal(
  deps: Deps, userId: string, signalId: string, source: SignalSource, text: string, x: ExtractedIntent, at: Date,
): Promise<Suggestion> {
  const kind = x.kind ?? "item";
  const unit: PriceUnit = kind === "service" ? x.price_unit ?? "job" : "each";
  const budget = x.max_price ?? (await usualBudget(deps, userId, x.need, x.category, kind, unit));
  const location = x.location ?? (await whereNow(deps.db, userId, at)) ?? (await homeArea(deps.db, userId));
  const request: SuggestedRequest = {
    need: x.need, kind, price_unit: unit, max_price: budget, hours: x.hours ?? null, pickup: x.pickup ?? null,
    location, schedule: x.schedule ?? null, needed_by: x.needed_by && +new Date(x.needed_by) > Date.now() ? x.needed_by : null,
  };
  const device = source === "bee" ? "your Bee" : source === "watch" ? "your watch" : "your phone";
  const ask = budget != null ? ` for up to ${rate(budget, unit, "USD")}` : "";
  return {
    suggestion_id: `sug_${signalId}`,
    from: source,
    reason: `From ${device}: "${clip(text, 120)}"`,
    heard: clip(text, 200),
    request,
    confidence: null,
    say: `${device[0].toUpperCase()}${device.slice(1)} picked up: "${clip(text, 80)}". Want me to find ${articled(x.need)}${ask}?` +
      (budget == null ? " Tell me the most you'd pay." : ""),
  };
}

const articled = (need: string) => (/^(a|an|the|some|my|someone|somebody)\b/i.test(need) || /\bpaper\b/i.test(need) ? need : `${/^[aeiou]/i.test(need) ? "an" : "a"} ${need}`);

/** The median budget of the user's past requests for the same kind of thing. */
async function usualBudget(deps: Deps, userId: string, need: string, category: string | undefined, kind: Kind, unit: PriceUnit) {
  const v = await deps.ai.embed([need, category].filter(Boolean).join(". "));
  const past = (await pastRequests(deps.db, userId)).filter((r) => r.kind === kind && r.price_unit === unit);
  const near = past.filter((r) => cos(r.embedding, v) >= SIMILAR).map((r) => r.max_price).sort((a, b) => a - b);
  return near.length ? near[near.length >> 1] : null;
}

const cos = (a: number[], b: number[]) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  return x && y ? d / Math.sqrt(x * y) : 0;
};

async function whereNow(db: Db, userId: string, at: Date) {
  const { rows } = await db.query<{ place: string }>(
    `SELECT place FROM context_signals WHERE user_id = $1 AND kind = 'location' AND place IS NOT NULL
       AND observed_at BETWEEN $2::timestamptz - make_interval(hours => $3) AND $2::timestamptz
     ORDER BY observed_at DESC LIMIT 1`,
    [userId, at.toISOString(), HERE_HOURS],
  );
  return rows[0]?.place ?? null;
}

async function homeArea(db: Db, userId: string) {
  const { rows } = await db.query<{ home_area: string | null }>(`SELECT home_area FROM users WHERE id = $1`, [userId]);
  return rows[0]?.home_area ?? null;
}

// ---------- suggestions ----------

const routineSuggestionId = (r: Routine, day: string) => `sug_${r.routine_id}_${day.replace(/-/g, "")}`;

function fromRoutine(r: Routine, day: string, tz: string): Suggestion {
  const route = r.pickup && r.location ? ` from ${r.pickup} to ${r.location}` : r.pickup ? ` from ${r.pickup}` : r.location ? ` at ${r.location}` : "";
  const at = new Date(r.next_at);
  const time = localTime(at, tz).minute;
  return {
    suggestion_id: routineSuggestionId(r, day),
    from: "routine",
    reason: `You've asked for this ${r.times} times, usually ${r.when}.`,
    heard: null,
    request: {
      need: r.need, kind: r.kind, price_unit: r.price_unit, max_price: r.usual_budget, hours: r.hours, pickup: r.pickup,
      location: r.location, schedule: `today around ${clock(time)}`, needed_by: new Date(+at + 30 * 60_000).toISOString(),
    },
    confidence: r.confidence,
    say: `It's nearly time for your usual: ${r.need}${route}, about ${rate(r.usual_budget, r.price_unit, "USD")}. Want me to ask now?`,
  };
}

/** What the user may want now: fresh device suggestions, then routines that are due. */
export async function getSuggestions(deps: Deps, userId: string, now = new Date()) {
  const { db } = deps;
  await purgeContext(db);
  await ensureUser(db, userId);
  const { rows } = await db.query<{ suggestion: Suggestion }>(
    `SELECT suggestion FROM context_signals
     WHERE user_id = $1 AND status = 'suggested' AND observed_at > $2::timestamptz - make_interval(hours => $3)
     ORDER BY observed_at DESC LIMIT 5`,
    [userId, now.toISOString(), FRESH_HOURS],
  );
  const suggestions: Suggestion[] = rows.map((r) => r.suggestion);

  const { tz, routines, quiet } = await routinesFor(db, userId, now);
  const day = localTime(now, tz).date;
  for (const r of routines) {
    if (quiet.has(r.routine_id) || !isDue(r, now)) continue;
    // Already asked for today, or already answered today.
    if (+now - +new Date(r.last_at) < 12 * 3600_000 || (await feedbackToday(db, userId, r.routine_id, day))) continue;
    suggestions.push(fromRoutine(r, day, tz));
  }
  const first = suggestions[0];
  return {
    suggestions,
    say: !first
      ? "Nothing to suggest right now. I'll keep an eye out."
      : suggestions.length === 1
        ? first.say
        : `I have ${suggestions.length} ideas. First: ${first.say}`,
  };
}

/** Post the suggested request after the user's yes. `max_price` sets or changes the budget. */
export async function acceptSuggestion(deps: Deps, userId: string, suggestionId: string, maxPrice?: number, now = new Date()) {
  const found = await findSuggestion(deps, userId, suggestionId, now);
  const req = found.suggestion.request;
  const budget = maxPrice ?? req.max_price;
  if (budget == null) throw new MarketError("What's the most you'd pay? I keep that private.", "need_budget", { suggestion_id: suggestionId });
  const source: RequestSource = found.suggestion.from === "routine" ? "routine" : found.suggestion.from === "bee" ? "bee_context" : "device_context";
  const posted = await postRequest(deps, {
    user_id: userId, need: req.need, kind: req.kind, price_unit: req.price_unit === "each" ? undefined : req.price_unit,
    max_price: budget, hours: req.hours ?? undefined, pickup: req.pickup ?? undefined, location: req.location ?? undefined,
    schedule: req.schedule ?? undefined, source,
    // A deadline that passed while the suggestion waited no longer applies.
    needed_by: req.needed_by && +new Date(req.needed_by) > Date.now() ? req.needed_by : undefined,
    raw_request: found.suggestion.heard ?? undefined,
  });
  if (found.signalId) {
    await deps.db.query(`UPDATE context_signals SET status = 'accepted', request_id = $2 WHERE id = $1`, [found.signalId, posted.request.request_id]);
  } else {
    await recordRoutineFeedback(deps.db, userId, found.routineId!, "accepted", found.day!);
  }
  await logEvent(deps.db, "suggestion_accepted", userId, suggestionId, { from: found.suggestion.from });
  return { suggestion_id: suggestionId, ...posted };
}

/** The user said no. `forget` also stops a routine from being suggested again. */
export async function dismissSuggestion(deps: Deps, userId: string, suggestionId: string, forget = false, now = new Date()) {
  const found = await findSuggestion(deps, userId, suggestionId, now);
  if (found.signalId) {
    await deps.db.query(`UPDATE context_signals SET status = 'dismissed', text = NULL, suggestion = NULL WHERE id = $1`, [found.signalId]);
  } else {
    await recordRoutineFeedback(deps.db, userId, found.routineId!, forget ? "forget" : "dismissed", found.day!);
  }
  await logEvent(deps.db, "suggestion_dismissed", userId, suggestionId, { from: found.suggestion.from, forget });
  return {
    suggestion_id: suggestionId,
    forgotten: forget && !found.signalId,
    say: forget && !found.signalId ? "Okay, I won't suggest that again." : "Okay, skipped.",
  };
}

async function findSuggestion(deps: Deps, userId: string, suggestionId: string, now: Date) {
  const signal = suggestionId.match(/^sug_(ctx_[0-9a-f]{8})$/)?.[1];
  if (signal) {
    const { rows } = await deps.db.query<{ suggestion: Suggestion; status: string }>(
      `SELECT suggestion, status FROM context_signals WHERE id = $1 AND user_id = $2`,
      [signal, userId],
    );
    if (!rows[0]?.suggestion) throw new MarketError("I can't find that suggestion.");
    if (rows[0].status !== "suggested") throw new MarketError(rows[0].status === "accepted" ? "I already asked for that one." : "That suggestion was skipped.");
    return { suggestion: rows[0].suggestion, signalId: signal };
  }
  const m = suggestionId.match(/^sug_(rtn_[0-9a-f]{10})_(\d{4})(\d{2})(\d{2})$/);
  if (!m) throw new MarketError("I can't find that suggestion.");
  const day = `${m[2]}-${m[3]}-${m[4]}`;
  const tz = await timeZoneOf(deps.db, userId);
  const { routines } = await routinesFor(deps.db, userId, now);
  const r = routines.find((x) => x.routine_id === m[1]);
  if (!r) throw new MarketError("I can't find that suggestion.");
  return { suggestion: fromRoutine(r, day, tz), routineId: r.routine_id, day };
}

// ---------- what the market has learned about the user ----------

export async function getMyRoutines(deps: Deps, userId: string, now = new Date()) {
  const { db } = deps;
  await purgeContext(db);
  await ensureUser(db, userId);
  const { tz, routines, quiet } = await routinesFor(db, userId, now);
  const { rows: sources } = await db.query<{ source: string; last_seen: string | Date; signals: number }>(
    `SELECT source, max(observed_at) AS last_seen, count(*)::int AS signals FROM context_signals
     WHERE user_id = $1 GROUP BY source ORDER BY source`,
    [userId],
  );
  const list = routines.map((r) => ({
    routine_id: r.routine_id, need: r.need, kind: r.kind, when: r.when, usual_budget: r.usual_budget, price_unit: r.price_unit,
    pickup: r.pickup, location: r.location, times: r.times, next_at: r.next_at, confidence: r.confidence, paused: quiet.has(r.routine_id),
  }));
  return {
    time_zone: tz,
    routines: list,
    devices: sources.map((s) => ({ source: s.source, last_seen: new Date(s.last_seen).toISOString(), signals: Number(s.signals) })),
    say: list.length
      ? `I've noticed ${list.length === 1 ? "one routine" : `${list.length} routines`}: ` +
        list.slice(0, 3).map((r) => `${r.need}, ${r.when}, about ${rate(r.usual_budget, r.price_unit, "USD")}`).join("; ") +
        ". Say \"forget\" when I suggest one you don't want."
      : "I haven't noticed any routines yet. After you ask for the same thing a few times, I'll offer it when it's due.",
  };
}
