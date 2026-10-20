import type { Db } from "../db/client.js";
import type { BuyIntentRow, ListingRow } from "./types.js";
import { checkSchedule, hasBookingConflict, providerBookings } from "./scheduling.js";

// Hybrid retrieval in one SQL query, run in both directions (request → listings
// and listing → waiting requests) with the same constraints and the same score:
//   1. hard constraints  — available, not your own, same kind (item or service)
//                          and price unit, enough quantity, condition >= wanted (items),
//                          a deal is possible (seller min <= buyer max, and the
//                          full ask once this buyer's lower offer failed; evaluated
//                          server-side, never exposed), request not expired, and
//                          the pair was not declined or left to expire before,
//                          both people are in good standing and neither
//                          reported the other (src/market/trust.ts)
//   2. semantic score    — pgvector cosine similarity of the stored embeddings
//   3. keyword score     — Postgres full-text rank (OR of the request's words)
//   4. price fit         — 1 if the ask is within budget, decays above it
//   5. location bonus    — same meet-up area
// Only relevance (semantic + keyword, normalised to 0..1) decides whether a
// post counts as a match at all; price and place then rank the relevant ones,
// so a cheap nearby item never stands in for what was asked. Ties go to the
// earlier post. Tune WEIGHTS and MATCH_THRESHOLD with real seed data.

export const WEIGHTS = { semantic: 0.6, keyword: 0.25, price: 0.1, location: 0.05 };

// Similarity alone can put "not graphing" close to "graphing". Respect an
// explicit seller disclaimer before ranking; this is a literal guard, not a
// general claim to understand every product specification.
export function contradictsNeed(need: string, description: string): boolean {
  // "not used much" and "no case scratches" describe wear, not a missing feature.
  const qualifier = /^\s+(?:much|often|very|a lot|once|twice|yet|really|ever|at all|scratch\w*|marks?|dents?|damage|issues?|problems?|cracks?|stains?|scuffs?|wear)\b/;
  const negated = (s: string) => new Set([...s.toLowerCase().matchAll(/\b(?:not\s+|no\s+|without\s+|non[-\s]+)(?:an?\s+)?([a-z][a-z0-9]*)\b/g)]
    .filter(m => !qualifier.test(s.toLowerCase().slice(m.index! + m[0].length))).map(m => m[1]));
  const exclusions = negated(need);
  const unavailable = negated(description);
  const ignored = new Set(["the", "and", "for", "with", "need", "want", "any", "not", "without", "non"]);
  return (need.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? []).some(word => word.length > 2 && !ignored.has(word) && !exclusions.has(word) && unavailable.has(word));
}

const CONDITION_RANK = `CASE %s WHEN 'new' THEN 4 WHEN 'like_new' THEN 3 WHEN 'good' THEN 2 WHEN 'fair' THEN 1 ELSE 0 END`;
const rank = (col: string) => CONDITION_RANK.replace("%s", col);

/**
 * A deal is possible: the seller's minimum is within the budget, and once this
 * buyer's offer below the ask failed (failed_offers), only the ask itself is.
 */
const priceFits = (l: string, budget: string, buyer: string) =>
  `(${l}.min_price <= ${budget} AND (${l}.ask_price <= ${budget} OR NOT EXISTS (
     SELECT 1 FROM failed_offers f WHERE f.listing_id = ${l}.id AND f.buyer_id = ${buyer})))`;

/**
 * Seller and buyer may be paired: neither is under review or suspended, and
 * neither has reported the other (src/market/trust.ts), unless that report was dismissed.
 */
const pairable = (seller: string, buyer: string) => `
  NOT EXISTS (SELECT 1 FROM users u WHERE u.id IN (${seller}, ${buyer}) AND u.review_status <> 'active')
  AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.status <> 'dismissed'
                  AND ((r.reporter_id = ${seller} AND r.reported_id = ${buyer}) OR (r.reporter_id = ${buyer} AND r.reported_id = ${seller})))`;

const SCORE = `(${WEIGHTS.semantic} * semantic + ${WEIGHTS.keyword} * keyword
               + ${WEIGHTS.price} * price_fit + ${WEIGHTS.location} * loc)::float8`;
const RELEVANCE = `((${WEIGHTS.semantic} * semantic + ${WEIGHTS.keyword} * LEAST(keyword, 1))
                   / ${WEIGHTS.semantic + WEIGHTS.keyword})::float8`;

interface Scores {
  semantic: number;
  keyword: number;
  price_fit: number;
  loc: number;
  relevance: number;
  score: number;
}
export type MatchRow = ListingRow & Scores;
export type IntentMatchRow = BuyIntentRow & Scores;

const toScores = <T extends Scores>(r: T): T => ({
  ...r,
  semantic: Number(r.semantic),
  keyword: Number(r.keyword),
  price_fit: Number(r.price_fit),
  loc: Number(r.loc),
  relevance: Number(r.relevance),
  score: Number(r.score),
});

// Check availability before applying the caller's limit. Paging prevents the
// ten highest-scoring but unavailable providers hiding a compatible eleventh.
async function compatible<T>(
  db: Db, limit: number, page: (offset: number, size: number) => Promise<T[]>,
  pair: (row: T) => { listing: ListingRow; intent: BuyIntentRow },
): Promise<T[]> {
  const selected: T[] = [];
  const size = Math.max(32, limit);
  for (let offset = 0; ; offset += size) {
    const rows = await page(offset, size);
    const pairs = rows.map(pair);
    const bookings = await providerBookings(db, [...new Set(pairs.filter(p => p.listing.kind === "service").map(p => p.listing.seller_id))]);
    rows.forEach((row, index) => {
      const { listing, intent } = pairs[index];
      if (!contradictsNeed(intent.need, `${listing.title}. ${listing.description}`)
        && checkSchedule(listing, intent).status !== "conflict"
        && !hasBookingConflict(intent, bookings.filter(b => b.seller_id === listing.seller_id))) selected.push(row);
    });
    if (selected.length >= limit || rows.length < size) return selected.slice(0, limit);
  }
}

/**
 * Offers that could serve this request, best first. Uses the request's stored
 * embedding. With `priceBlocked`, the relevant offers that pass every other
 * constraint but can't close at this budget instead.
 */
export async function findMatchesForIntent(
  db: Db,
  intent: BuyIntentRow,
  opts: { limit: number; threshold: number; priceBlocked?: boolean; offerId?: string; ignorePrice?: boolean },
): Promise<MatchRow[]> {
  const fits = priceFits("l", "$2", "$3");
  return compatible(db, opts.limit, async (offset, size) => {
    const { rows } = await db.query<MatchRow>(
      `
      WITH q AS (
        SELECT i.embedding AS emb,
               replace(plainto_tsquery('english', concat_ws(' ', i.need, i.category))::text, '&', '|') AS tsq_text
        FROM buy_intents i WHERE i.id = $1
      ),
      scored AS (
        SELECT l.*,
               GREATEST(0, 1 - (l.embedding <=> q.emb))                       AS semantic,
               CASE WHEN q.tsq_text = '' THEN 0
                    ELSE ts_rank_cd(l.search_tsv, q.tsq_text::tsquery, 32) END AS keyword,
               CASE WHEN l.ask_price <= $2 THEN 1
                    ELSE $2 / NULLIF(l.ask_price, 0) END                      AS price_fit,
               CASE WHEN $5::text IS NOT NULL AND l.location ILIKE '%' || $5 || '%'
                    THEN 1 ELSE 0 END                                         AS loc
        FROM listings l, q
        WHERE l.status = 'active'
          AND l.seller_id <> $3
          AND l.kind = $9 AND l.price_unit = $10
          AND l.quantity >= $4
          AND ${opts.ignorePrice ? "TRUE" : opts.priceBlocked ? `NOT ${fits}` : fits}
          AND l.currency = $11
          AND ($12::text IS NULL OR l.id = $12)
          AND (l.kind = 'service' OR ${rank("l.condition")} >= ${rank("$6")})
          AND l.embedding IS NOT NULL
          AND ${pairable("l.seller_id", "$3")}
          AND NOT EXISTS (SELECT 1 FROM deals d
                          WHERE d.listing_id = l.id AND d.buy_intent_id = $1 AND d.status IN ('declined', 'expired'))
      )
      SELECT *, ${SCORE} AS score, ${RELEVANCE} AS relevance
      FROM scored
      WHERE ${RELEVANCE} >= $8
      ORDER BY score DESC, created_at ASC, id ASC
      LIMIT $7 OFFSET $13
      `,
      [
        intent.id, intent.max_price, intent.buyer_id, intent.quantity, intent.location, intent.min_condition,
        size, opts.threshold, intent.kind, intent.price_unit, intent.currency, opts.offerId ?? null, offset,
      ],
    );
    return rows.map(toScores);
  }, listing => ({ listing, intent }));
}

/** Waiting requests this (stored) offer satisfies, best first. */
export async function findIntentsForListing(
  db: Db,
  listingId: string,
  opts: { limit: number; threshold: number },
): Promise<IntentMatchRow[]> {
  const listing = (await db.query<ListingRow>(`SELECT * FROM listings WHERE id = $1`, [listingId])).rows[0];
  if (!listing) return [];
  return compatible(db, opts.limit, async (offset, size) => {
    const { rows } = await db.query<IntentMatchRow>(
      `
      WITH scored AS (
        SELECT i.*,
               GREATEST(0, 1 - (l.embedding <=> i.embedding))                 AS semantic,
               CASE WHEN q.tsq_text = '' THEN 0
                    ELSE ts_rank_cd(l.search_tsv, q.tsq_text::tsquery, 32) END AS keyword,
               CASE WHEN l.ask_price <= i.max_price THEN 1
                    ELSE i.max_price / NULLIF(l.ask_price, 0) END             AS price_fit,
               CASE WHEN i.location IS NOT NULL AND l.location ILIKE '%' || i.location || '%'
                    THEN 1 ELSE 0 END                                         AS loc
        FROM listings l
        JOIN buy_intents i ON TRUE
        CROSS JOIN LATERAL (
          SELECT replace(plainto_tsquery('english', concat_ws(' ', i.need, i.category))::text, '&', '|') AS tsq_text
        ) q
        WHERE l.id = $1
          AND i.status = 'open'
          AND i.buyer_id <> l.seller_id
          AND l.kind = i.kind AND l.price_unit = i.price_unit
          AND l.currency = i.currency
          AND l.quantity >= i.quantity
          AND ${priceFits("l", "i.max_price", "i.buyer_id")}
          AND (l.kind = 'service' OR ${rank("l.condition")} >= ${rank("i.min_condition")})
          AND l.embedding IS NOT NULL
          AND i.embedding IS NOT NULL
          AND (i.needed_by IS NULL OR i.needed_by > now())
          AND ${pairable("l.seller_id", "i.buyer_id")}
          AND NOT EXISTS (SELECT 1 FROM deals d
                          WHERE d.listing_id = l.id AND d.buy_intent_id = i.id AND d.status IN ('declined', 'expired'))
      )
      SELECT *, ${SCORE} AS score, ${RELEVANCE} AS relevance
      FROM scored
      WHERE ${RELEVANCE} >= $3
      ORDER BY score DESC, created_at ASC, id ASC
      LIMIT $2 OFFSET $4
      `,
      [listingId, size, opts.threshold, offset],
    );
    return rows.map(toScores);
  }, intent => ({ listing, intent }));
}
