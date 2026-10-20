import { createHash } from "node:crypto";
import type { Ai, Condition, ExtractedIntent } from "./types.js";

// Offline stand-in for Bedrock. Good enough to develop and demo the flow;
// swap AI_MODE=bedrock for real semantic quality.

// Tiny concept map so the mock "understands" the demo scenarios. A word can
// carry several concepts; the first concept that is a category comes first.
// Extend freely.
const SYNONYMS: Record<string, string[]> = {
  calculator: ["ti-84", "ti84", "ti-83", "ti83", "nspire", "graphing", "casio", "scientific", "calc"],
  graphing: ["ti-84", "ti84", "ti-83", "ti83", "nspire", "graphing", "graph"],
  scientific: ["casio", "scientific", "fx-991ex"],
  tissue: ["tissues", "napkin", "napkins", "kleenex", "paper"],
  textbook: ["book", "textbook", "textbooks", "edition"],
  charger: ["cable", "usb-c", "adapter", "charging"],
  umbrella: ["umbrellas", "rain"],
  headphones: ["earbuds", "headset", "airpods"],
  // Services
  delivery: ["deliver", "delivered", "delivery", "pick", "picked", "pickup", "lunch", "dinner", "breakfast", "food", "meal",
    "takeaway", "takeout", "errand", "errands", "runner", "run", "runs", "courier", "parcel", "groceries", "grocery", "bring", "grab"],
  event: ["events", "usher", "ushers", "ushering", "booth", "registration", "setup", "staff", "crew", "conference", "party"],
  tutoring: ["tutor", "tutors", "lesson", "lessons", "homework", "teach", "coaching"],
  moving: ["move", "moving", "movers", "carry", "boxes", "furniture"],
};
/** Categories that name a service rather than an item. */
export const SERVICE_CATEGORIES = new Set(["delivery", "event", "tutoring", "moving"]);
const SUBCONCEPTS = new Set(["graphing", "scientific"]);
const CANON = new Map<string, string[]>();
for (const [canon, words] of Object.entries(SYNONYMS)) {
  for (const w of [canon, ...words]) CANON.set(w, [...(CANON.get(w) ?? []), canon]);
}
const categoryOf = (tok: string) => CANON.get(tok)?.find((c) => !SUBCONCEPTS.has(c));

// A word right after a negation ("not graphing", "no charger") describes what
// the item is not, so it carries no meaning for matching.
const NEGATIONS = new Set(["not", "no", "non", "without"]);

const tokenize = (text: string) =>
  text.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? [];

function bucket(feature: string, dim: number): [number, number] {
  const h = createHash("sha1").update(feature).digest();
  return [h.readUInt32BE(0) % dim, h[4] & 1 ? 1 : -1];
}

export function mockEmbed(text: string, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  for (const [n, tok] of tokens.entries()) {
    if (NEGATIONS.has(tok) || NEGATIONS.has(tokens[n - 1] ?? "")) continue;
    const features = [`w:${tok}`];
    for (const canon of CANON.get(tok) ?? []) features.push(`c:${canon}`, `c:${canon}`); // concepts weigh double
    for (let i = 0; i + 3 <= tok.length; i++) features.push(`g:${tok.slice(i, i + 3)}`);
    for (const f of features) {
      const [i, s] = bucket(f, dim);
      v[i] += s;
    }
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

const CONDITION_WORDS: [RegExp, Condition][] = [
  [/\bbrand[- ]new\b|\bsealed\b|\bnew\b/, "new"],
  [/\blike[- ]new\b|\bmint\b/, "like_new"],
  [/\bgood condition\b|\bworking\b/, "good"],
  [/\bany condition\b|\bfor parts\b|\bbroken ok\b/, "for_parts"],
];

// Asking for a person to do something: "find someone to pick up my lunch",
// "get me a guy to help with the event", "I need lunch delivered".
const SERVICE_ASK = new RegExp(
  String.raw`\b(?:some ?one|somebody|anyone|any ?body|a (?:guy|person|helper|runner|hand|tutor|student))\s+(?:to|who|for)\b` +
    String.raw`|\b(?:errands?|deliver(?:y|ed)?|courier|hire|help(?:ers?)? (?:out )?(?:with|at|for)|pick(?:ed)? up my|grab my|bring me)\b`,
);
const HOURLY = /\/\s*h(?:ou)?r\b|\bper hour\b|\ban hour\b|\bhourly\b|\ba hr\b/;

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_RE = new RegExp(String.raw`\b(today|tonight|tomorrow|${DAYS.join("|")})\b`);
// "2-6pm", "2pm to 6pm", "10:30am until 1pm"
const RANGE_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/;
// "by 12:30", "at 1pm", "before 3"
const TIME_RE = /\b(by|at|before|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?![\d.])/;

/** 24h hour from a spoken clock time; a bare 1–7 means afternoon, as in "by 2". */
function hour24(h: number, ampm: string | undefined) {
  if (ampm === "pm") return (h % 12) + 12;
  if (ampm === "am") return h % 12;
  return h >= 1 && h <= 7 ? h + 12 : h;
}

interface When { needed_by?: string; schedule?: string; hours?: number }

/** Day, time window and deadline, in server-local time like "today 23:59". */
function readWhen(t: string, now: Date): When {
  const dayWord = t.match(DAY_RE)?.[1];
  const day = new Date(now);
  if (dayWord === "tomorrow") day.setDate(day.getDate() + 1);
  else if (dayWord && DAYS.includes(dayWord)) day.setDate(day.getDate() + ((DAYS.indexOf(dayWord) - day.getDay() + 7) % 7 || 7));

  const out: When = {};
  const range = t.match(RANGE_RE);
  const at = range ? null : t.match(TIME_RE);
  // "at 5" alone is too vague to be a time; "by 5", "at 5pm" and "at 5:30" are not.
  const time = at && (at[3] || at[4] || at[1] === "by" || at[1] === "before") ? at : null;
  let label: string | undefined;
  if (range) {
    const startAmPm = range[3] ?? (Number(range[1]) <= Number(range[4]) ? range[6] : undefined);
    const start = hour24(Number(range[1]), startAmPm) + Number(range[2] ?? 0) / 60;
    let end = hour24(Number(range[4]), range[6]) + Number(range[5] ?? 0) / 60;
    if (end <= start) end += 12;
    out.hours = +(end - start).toFixed(2);
    day.setHours(Math.floor(start), Math.round((start % 1) * 60), 0, 0);
    label = range[0];
  } else if (time) {
    day.setHours(hour24(Number(time[2]), time[4]), Number(time[3] ?? 0), 0, 0);
    label = time[0];
  } else if (dayWord || /\basap\b|\bright now\b|\bnow\b/.test(t)) {
    day.setHours(23, 59, 0, 0);
  } else {
    return out;
  }
  if (!dayWord && day <= now) day.setDate(day.getDate() + 1); // "by 12:30" said at 13:00 means tomorrow
  out.needed_by = day.toISOString();
  const dayLabel = dayWord && DAYS.includes(dayWord) ? dayWord[0].toUpperCase() + dayWord.slice(1) : dayWord;
  if (label || dayLabel) out.schedule = [dayLabel, label].filter(Boolean).join(" ");
  return out;
}

// Where an errand starts and ends: "from LG7 canteen to Hall 5 by 12:30".
const STOP = String.raw`(?=\s+(?:by|before|at|around|for|on|today|tonight|tomorrow)\b|\s*[,.;!?]|$)`;
const ROUTE_RE = new RegExp(String.raw`\bfrom\s+([^,;!?]+?)\s+to\s+([^,;!?]+?)${STOP}`, "i");
const FROM_RE = new RegExp(String.raw`\bfrom\s+([^,;!?]+?)${STOP}`, "i");

export function mockExtractIntent(text: string, now = new Date()): ExtractedIntent {
  const t = text.toLowerCase();
  const out: ExtractedIntent = { need: text.trim() };

  const price =
    t.match(/(?:under|below|max(?:imum)?|up to|at most|budget(?: of)?|pay|no more than)\s*(?:hk)?\$?\s*(\d+(?:\.\d+)?)/) ??
    t.match(/\$\s*(\d+(?:\.\d+)?)/);
  if (price) out.max_price = Number(price[1]);

  for (const tok of tokenize(t)) {
    const category = categoryOf(tok);
    if (category) { out.category = category; break; }
  }
  const service = SERVICE_ASK.test(t) || (out.category != null && SERVICE_CATEGORIES.has(out.category));
  const when = readWhen(t, now);
  if (when.needed_by) out.needed_by = when.needed_by;

  if (service) {
    out.kind = "service";
    out.price_unit = HOURLY.test(t) ? "hour" : "job";
    const hours = t.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/);
    if (out.price_unit === "hour" && (hours || when.hours)) out.hours = hours ? Number(hours[1]) : when.hours;
    if (when.schedule) out.schedule = when.schedule;
    const route = text.match(ROUTE_RE);
    const from = route ? null : text.match(FROM_RE);
    if (route) { out.pickup = route[1].trim(); out.location = route[2].trim(); }
    else if (from) out.pickup = from[1].trim();
  } else {
    for (const [re, c] of CONDITION_WORDS) if (re.test(t)) { out.min_condition = c; break; }
    const qty = t.match(/\b(\d+)\s*(?:x|packs?|pieces?|pcs|units?)\b/);
    if (qty) out.quantity = Number(qty[1]);
  }

  if (!out.location) {
    const loc = t.match(/\b(?:on|at|near|around)\s+(campus|[a-z]+ campus|[a-z]+ station|[a-z]+ library)\b/);
    if (loc) out.location = loc[1];
  }

  // Strip filler so "need" is a clean search phrase; for a service, the task itself.
  let need = text
    .replace(/^(alexa,?\s*)?(please\s+)?(can you\s+)?/i, "")
    .replace(/^((i\s+(really\s+)?)?(need|want|buy|am looking for|'m looking for)|find( me)?|get( me)?|looking for|hire)\s+/i, "")
    .replace(/^an? (helper|hand)\s+(for|with|at)\s+/i, "help $2 ")
    .replace(/^(some ?one|somebody|anyone|any ?body|an? (guy|person|helper|runner|hand|tutor|student))\s+(to|who can|who could|for)\s+/i, "");
  if (service) need = need.replace(/\s*,.*$/, "").replace(/\s+(from|by|before|for \d|on (mon|tues|wednes|thurs|fri|satur|sun)day)\b.*$/i, "");
  // "a graphing calculator before the exam": the reason isn't part of the item.
  else need = need.replace(/\s+(before|for|by)\s+(the|my|our|next|this)\s+\w+.*$/i, "");
  out.need = need
    .replace(/\s*(,|\.)?\s*(under|below|max(imum)?|up to|at most|budget|no more than)\b.*$/i, "")
    .replace(/\b(today|tonight|tomorrow|asap|right now)\b/gi, "")
    .replace(/^(a|an|some|the)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim() || text.trim();
  return out;
}

export function createMockAi(dim: number): Ai {
  return {
    mode: "mock",
    embed: async (text) => mockEmbed(text, dim),
    extractIntent: async (text, now) => mockExtractIntent(text, now),
  };
}
