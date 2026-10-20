import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Ai } from "../ai/index.js";
import { toVector, type Db } from "../db/client.js";

// What may be offered or requested (data/policy.json): weapons, drugs,
// prescription medicine, alcohol and tobacco, recalled and counterfeit goods,
// fake documents, cheating, adult services, live animals and illegal services.
// Deterministic and server-side, checked before anything is posted:
//   1. Keywords: whole-word rules per category, after removing the category's
//      allowed phrases (a glue gun, cat sitting, a wine glass). Text is also
//      checked with common character swaps undone ("w33d", "c0caine").
//   2. Meaning: the post's own embedding against example phrases per category,
//      to catch wording the keywords miss. Only a close match counts.
// A post that hits either is not stored. Nothing here sets a price or ranks a
// pairing; the check only decides whether a post may enter the market.

export type Severity = "prohibited" | "restricted";

interface Category {
  id: string;
  label: string;
  severity: Severity;
  /** Restricted only: why, as spoken ("selling it needs an age check and a licence"). */
  why?: string;
  keywords: string[];
  allow: string[];
  examples: string[];
}

export interface PolicyHit {
  category: string;
  label: string;
  severity: Severity;
  /** Why a restricted category isn't allowed here, as spoken. */
  why?: string;
  /** keyword: a listed word or phrase; meaning: close to a listed example. */
  matched_by: "keyword" | "meaning";
}

export interface PolicySettings {
  /** Minimum cosine similarity to an example phrase for a post to count as that category. */
  meaningMatch: number;
}

export const DEFAULT_POLICY: PolicySettings = { meaningMatch: 0.8 };

const POLICY_FILE = "data/policy.json";

interface Compiled extends Category { match: RegExp; allowed: RegExp | null }

const words = (patterns: string[]) => new RegExp(`\\b(?:${patterns.join("|")})\\b`, "gi");

let compiled: Compiled[] | undefined;

function categories(file = POLICY_FILE): Compiled[] {
  compiled ??= (JSON.parse(readFileSync(file, "utf8")) as { categories: Category[] }).categories.map((c) => ({
    ...c,
    match: words(c.keywords),
    allowed: c.allow.length ? words(c.allow) : null,
  }));
  return compiled;
}

const SWAPS: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Lower case, accents dropped, separators between letters collapsed. */
const normalise = (text: string) =>
  text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_*.]+(?=\w)/g, "").replace(/\s+/g, " ");

/** The keyword rule a text breaks, if any. */
export function keywordHit(text: string): PolicyHit | null {
  const plain = normalise(text);
  const swapped = plain.replace(/[013457@$]/g, (ch) => SWAPS[ch]);
  for (const c of categories()) {
    for (const t of new Set([plain, swapped])) {
      const rest = c.allowed ? t.replace(c.allowed, " ") : t;
      c.match.lastIndex = 0;
      if (c.match.test(rest)) return hit(c, "keyword");
    }
  }
  return null;
}

const hit = (c: Category, by: PolicyHit["matched_by"]): PolicyHit => ({
  category: c.id, label: c.label, severity: c.severity, why: c.why ?? "selling it needs checks people trading directly can't do", matched_by: by,
});

// ---------- meaning ----------

const loaded = new WeakMap<Db, Promise<void>>();

/** Embed every example phrase once per database; only new or edited ones are embedded again. */
export function ensurePolicyExamples(db: Db, ai: Ai) {
  let p = loaded.get(db);
  if (!p) {
    p = loadExamples(db, ai);
    p.catch(() => loaded.delete(db)); // retry next time, e.g. after a Bedrock hiccup
    loaded.set(db, p);
  }
  return p;
}

async function loadExamples(db: Db, ai: Ai) {
  const { rows } = await db.query<{ id: string; hash: string }>(`SELECT id, hash FROM policy_examples`);
  const have = new Map(rows.map((r) => [r.id, r.hash]));
  const keep: string[] = [];
  for (const c of categories()) {
    for (const text of c.examples) {
      const id = createHash("sha1").update(`${c.id}\n${text}`).digest("hex").slice(0, 16);
      const hash = createHash("sha1").update(JSON.stringify([c.id, text, ai.mode])).digest("hex");
      keep.push(id);
      if (have.get(id) === hash) continue;
      await db.query(
        `INSERT INTO policy_examples (id, category, text, hash, embedding) VALUES ($1, $2, $3, $4, $5::vector)
         ON CONFLICT (id) DO UPDATE SET category = $2, text = $3, hash = $4, embedding = $5::vector`,
        [id, c.id, text, hash, toVector(await ai.embed(text))],
      );
    }
  }
  await db.query(`DELETE FROM policy_examples WHERE NOT (id = ANY($1::text[]))`, [keep]);
}

/** The category whose example phrase is closest in meaning, when it is close enough. */
export async function meaningHit(deps: { db: Db; ai: Ai }, embedding: number[], s: PolicySettings = DEFAULT_POLICY) {
  await ensurePolicyExamples(deps.db, deps.ai);
  const { rows } = await deps.db.query<{ category: string; sim: number }>(
    `SELECT category, (1 - (embedding <=> $1::vector))::float8 AS sim FROM policy_examples
     ORDER BY embedding <=> $1::vector LIMIT 1`,
    [toVector(embedding)],
  );
  const r = rows[0];
  if (!r || Number(r.sim) < s.meaningMatch) return null;
  const c = categories().find((x) => x.id === r.category);
  return c ? hit(c, "meaning") : null;
}
