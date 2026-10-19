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
};
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

export function mockExtractIntent(text: string, now = new Date()): ExtractedIntent {
  const t = text.toLowerCase();
  const out: ExtractedIntent = { need: text.trim() };

  const price =
    t.match(/(?:under|below|max(?:imum)?|up to|at most|budget(?: of)?|no more than)\s*(?:hk)?\$?\s*(\d+(?:\.\d+)?)/) ??
    t.match(/\$\s*(\d+(?:\.\d+)?)/);
  if (price) out.max_price = Number(price[1]);

  for (const [re, c] of CONDITION_WORDS) if (re.test(t)) { out.min_condition = c; break; }

  const qty = t.match(/\b(\d+)\s*(?:x|packs?|pieces?|pcs|units?)\b/);
  if (qty) out.quantity = Number(qty[1]);

  const day = new Date(now);
  if (/\btonight\b|\btoday\b|\basap\b|\bnow\b/.test(t)) {
    day.setHours(23, 59, 0, 0);
    out.needed_by = day.toISOString();
  } else if (/\btomorrow\b/.test(t)) {
    day.setDate(day.getDate() + 1);
    day.setHours(23, 59, 0, 0);
    out.needed_by = day.toISOString();
  }

  const loc = t.match(/\b(?:on|at|near|around)\s+(campus|[a-z]+ campus|[a-z]+ station|[a-z]+ library)\b/);
  if (loc) out.location = loc[1];

  for (const tok of tokenize(t)) {
    const category = categoryOf(tok);
    if (category) { out.category = category; break; }
  }

  // Strip filler so "need" is a clean search phrase.
  out.need = text
    .replace(/^(alexa,?\s*)?(i\s+(really\s+)?(need|want|am looking for|'m looking for)|find me|get me|looking for)\s+/i, "")
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
