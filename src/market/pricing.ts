import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Ai, Condition } from "../ai/index.js";
import { toVector, type Db } from "../db/client.js";
import { num, type Kind, type PriceUnit } from "./types.js";

// The price check. Deterministic: it never sets a price and never haggles; it
// only decides when a price is so far from what similar things go for that
// the person should hear the usual range and say it again. That catches a
// voice mis-hearing ($180 for $18), a slip of the tongue (a minimum of $1) and
// the classic lure (an iPhone for $1).
//
// Where the typical range comes from, in order:
//   1. Reference prices (data/reference-prices.json; a product catalog in
//      production): the nearest entry of the same kind and price unit, when
//      it is close enough in meaning, adjusted for the item's condition.
//   2. The market's own confirmed trades of similar posts, made robust against
//      trades staged to move the range (see tradeBand).
// With neither, nothing is checked.

export type BandSource = "reference" | "trades";

export interface PriceBand {
  low: number;
  high: number;
  source: BandSource;
  /** What the range describes: the reference entry, or how many independent sellers it rests on. */
  basis: string;
  /** Reference items only: the typical price new on Amazon.com (the Amazon fallback in amazon.ts). */
  newPrice?: number | null;
}

/** far_* asks the person to confirm; the others are informational. */
export type PriceVerdict = "typical" | "below_typical" | "above_typical" | "far_below" | "far_above";

export interface PricePolicy {
  /** A price under low × farBelow is far below the typical range. */
  farBelow: number;
  /** A price over high × farAbove is far above it. */
  farAbove: number;
  /** Minimum cosine similarity for a reference entry to describe a post. */
  referenceMatch: number;
  /** Minimum cosine similarity for a past trade to count as a similar post. */
  tradeMatch: number;
}

export const DEFAULT_PRICE_POLICY: PricePolicy = { farBelow: 0.5, farAbove: 2, referenceMatch: 0.55, tradeMatch: 0.8 };

/** Reference prices are for good, used condition. */
const CONDITION_FACTOR: Record<Condition, number> = { new: 1.3, like_new: 1.15, good: 1, fair: 0.8, for_parts: 0.35 };
const factor = (kind: Kind, condition: string | null | undefined) =>
  kind === "item" ? CONDITION_FACTOR[(condition ?? "good") as Condition] ?? 1 : 1;

const cents = (x: number) => Math.round(x * 100) / 100;

export function verdict(price: number, band: Pick<PriceBand, "low" | "high">, policy: PricePolicy = DEFAULT_PRICE_POLICY): PriceVerdict {
  if (price < band.low * policy.farBelow) return "far_below";
  if (price > band.high * policy.farAbove) return "far_above";
  if (price < band.low) return "below_typical";
  if (price > band.high) return "above_typical";
  return "typical";
}

// ---------- 1. reference prices ----------

interface ReferenceEntry { id: string; title: string; kind?: Kind; price_unit?: PriceUnit; low: number; high: number; new_price?: number }

const loaded = new WeakMap<Db, Promise<void>>();

/**
 * Make sure every reference entry is in the database with an embedding. Runs
 * once per database; only new or edited entries are embedded.
 */
export function ensureReferences(db: Db, ai: Ai, file = "data/reference-prices.json") {
  let p = loaded.get(db);
  if (!p) {
    p = loadReferences(db, ai, file);
    p.catch(() => loaded.delete(db)); // retry next time, e.g. after a Bedrock hiccup
    loaded.set(db, p);
  }
  return p;
}

async function loadReferences(db: Db, ai: Ai, file: string) {
  const entries = (JSON.parse(readFileSync(file, "utf8")) as { references: ReferenceEntry[] }).references;
  const { rows } = await db.query<{ id: string; hash: string }>(`SELECT id, hash FROM reference_prices`);
  const have = new Map(rows.map((r) => [r.id, r.hash]));
  for (const e of entries) {
    const kind = e.kind ?? "item";
    const unit = e.price_unit ?? (kind === "item" ? "each" : "job");
    const hash = createHash("sha1").update(JSON.stringify([e.title, kind, unit, e.low, e.high, e.new_price ?? null, ai.mode])).digest("hex");
    if (have.get(e.id) === hash) continue;
    const embedding = await ai.embed(e.title);
    await db.query(
      `INSERT INTO reference_prices (id, kind, price_unit, title, low, high, new_price, hash, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
       ON CONFLICT (id) DO UPDATE SET kind = $2, price_unit = $3, title = $4, low = $5, high = $6, new_price = $7, hash = $8, embedding = $9::vector`,
      [e.id, kind, unit, e.title, e.low, e.high, e.new_price ?? null, hash, toVector(embedding)],
    );
  }
}

async function referenceBand(db: Db, q: BandQuery, policy: PricePolicy): Promise<PriceBand | null> {
  const { rows } = await db.query<{ title: string; low: string; high: string; new_price: string | null; sim: number }>(
    `SELECT title, low, high, new_price, (1 - (embedding <=> $1::vector))::float8 AS sim FROM reference_prices
     WHERE kind = $2 AND price_unit = $3 ORDER BY embedding <=> $1::vector LIMIT 1`,
    [toVector(q.embedding), q.kind, q.unit],
  );
  const r = rows[0];
  if (!r || Number(r.sim) < policy.referenceMatch) return null;
  const f = factor(q.kind, q.condition);
  return { low: cents(num(r.low)! * f), high: cents(num(r.high)! * f), source: "reference", basis: r.title, newPrice: num(r.new_price) };
}

// ---------- 2. confirmed trades ----------

export interface Trade { price: number; seller: string; buyer: string }

/** How much independent evidence a trade band needs. */
export const TRADE_EVIDENCE = { minSellers: 3, minBuyers: 3, minAccountAgeDays: 7, windowDays: 90 };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A typical range from confirmed trades that a few staged trades can't move.
 *
 *  - One vote per seller: a seller's trades count once, at their median, so a
 *    seller can't outvote the market by trading with themselves many times.
 *  - Independent evidence: at least three sellers and three distinct buyers,
 *    or no range at all. (The query also drops trades within one account,
 *    trades involving the person posting, and accounts younger than a week.)
 *  - The centre is the median of the votes and the width comes from the
 *    median absolute deviation, so shifting the range takes more than half of
 *    the independent sellers.
 *  - The range is only used to ask "did you mean…?": it never sets, blocks or
 *    settles a price, so moving it gains a manipulator little.
 */
export function tradeBand(trades: Trade[], evidence = TRADE_EVIDENCE): { low: number; high: number; sellers: number } | null {
  const bySeller = new Map<string, number[]>();
  for (const t of trades) bySeller.set(t.seller, [...(bySeller.get(t.seller) ?? []), t.price]);
  const buyers = new Set(trades.map((t) => t.buyer));
  if (bySeller.size < evidence.minSellers || buyers.size < evidence.minBuyers) return null;
  const votes = [...bySeller.values()].map(median);
  const centre = median(votes);
  const mad = median(votes.map((v) => Math.abs(v - centre)));
  const half = Math.max(3 * 1.4826 * mad, 0.3 * centre);
  return { low: cents(Math.max(centre - half, 0.25 * centre)), high: cents(centre + half), sellers: bySeller.size };
}

async function tradesBand(db: Db, q: BandQuery, policy: PricePolicy): Promise<PriceBand | null> {
  const { rows } = await db.query<{ price: string; condition: string; seller_id: string; buyer_id: string }>(
    `SELECT d.price, l.condition, l.seller_id, i.buyer_id
     FROM deals d
     JOIN listings l    ON l.id = d.listing_id
     JOIN buy_intents i ON i.id = d.buy_intent_id
     JOIN users su      ON su.id = l.seller_id
     JOIN users bu      ON bu.id = i.buyer_id
     WHERE d.status = 'confirmed' AND l.kind = $2 AND l.price_unit = $3
       AND d.updated_at > now() - make_interval(days => $5)
       AND l.seller_id <> i.buyer_id AND l.seller_id <> $4 AND i.buyer_id <> $4
       AND su.created_at < now() - make_interval(days => $6) AND bu.created_at < now() - make_interval(days => $6)
       AND l.embedding IS NOT NULL AND 1 - (l.embedding <=> $1::vector) >= $7
     ORDER BY d.updated_at DESC LIMIT 500`,
    [toVector(q.embedding), q.kind, q.unit, q.posterId, TRADE_EVIDENCE.windowDays, TRADE_EVIDENCE.minAccountAgeDays, policy.tradeMatch],
  );
  // Normalise each trade to the condition being checked.
  const f = factor(q.kind, q.condition);
  const band = tradeBand(rows.map((r) => ({
    price: (num(r.price)! / factor(q.kind, r.condition)) * f, seller: r.seller_id, buyer: r.buyer_id,
  })));
  return band && { low: band.low, high: band.high, source: "trades", basis: `${band.sellers} sellers' recent deals` };
}

// ---------- the check ----------

export interface BandQuery {
  kind: Kind;
  unit: PriceUnit;
  /** The post's embedding (title, description, category). */
  embedding: number[];
  /** Items: the condition the range should describe. */
  condition?: string | null;
  /** Whoever is posting; their own trades never count. */
  posterId: string;
}

/** The typical range for a post, or null when nothing reliable describes it. */
export async function priceBand(deps: { db: Db; ai: Ai }, q: BandQuery, policy: PricePolicy = DEFAULT_PRICE_POLICY) {
  await ensureReferences(deps.db, deps.ai);
  return (await referenceBand(deps.db, q, policy)) ?? (await tradesBand(deps.db, q, policy));
}
