import type { Db } from "../db/client.js";
import type { BuyIntentRow, ListingRow } from "./types.js";

// Hybrid retrieval in one SQL query, run in both directions (request → listings
// and listing → waiting requests) with the same constraints and the same score:
//   1. hard constraints  — available, not your own, same kind (item or service)
//                          and price unit, enough quantity, condition >= wanted (items),
//                          a deal is possible (seller min <= buyer max; evaluated
//                          server-side, never exposed), request not expired, and
//                          the pair was not declined or left to expire before
//   2. semantic score    — pgvector cosine similarity of the stored embeddings
//   3. keyword score     — Postgres full-text rank (OR of the request's words)
//   4. price fit         — 1 if the ask is within budget, decays above it
//   5. location bonus    — same meet-up area
// Only relevance (semantic + keyword, normalised to 0..1) decides whether a
// post counts as a match at all; price and place then rank the relevant ones,
// so a cheap nearby item never stands in for what was asked. Ties go to the
// earlier post. Tune WEIGHTS and MATCH_THRESHOLD with real seed data.

export const WEIGHTS = { semantic: 0.6, keyword: 0.25, price: 0.1, location: 0.05 };

const CONDITION_RANK = `CASE %s WHEN 'new' THEN 4 WHEN 'like_new' THEN 3 WHEN 'good' THEN 2 WHEN 'fair' THEN 1 ELSE 0 END`;
const rank = (col: string) => CONDITION_RANK.replace("%s", col);

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

/** Offers that could serve this request, best first. Uses the request's stored embedding. */
export async function findMatchesForIntent(
  db: Db,
  intent: BuyIntentRow,
  opts: { limit: number; threshold: number },
): Promise<MatchRow[]> {
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
        AND l.min_price <= $2
        AND (l.kind = 'service' OR ${rank("l.condition")} >= ${rank("$6")})
        AND l.embedding IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM deals d
                        WHERE d.listing_id = l.id AND d.buy_intent_id = $1 AND d.status IN ('declined', 'expired'))
    )
    SELECT *, ${SCORE} AS score, ${RELEVANCE} AS relevance
    FROM scored
    WHERE ${RELEVANCE} >= $8
    ORDER BY score DESC, created_at ASC
    LIMIT $7
    `,
    [
      intent.id, intent.max_price, intent.buyer_id, intent.quantity, intent.location, intent.min_condition,
      opts.limit, opts.threshold, intent.kind, intent.price_unit,
    ],
  );
  return rows.map(toScores);
}

/** Waiting requests this (stored) offer satisfies, best first. */
export async function findIntentsForListing(
  db: Db,
  listingId: string,
  opts: { limit: number; threshold: number },
): Promise<IntentMatchRow[]> {
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
        AND l.quantity >= i.quantity
        AND l.min_price <= i.max_price
        AND (l.kind = 'service' OR ${rank("l.condition")} >= ${rank("i.min_condition")})
        AND l.embedding IS NOT NULL
        AND i.embedding IS NOT NULL
        AND (i.needed_by IS NULL OR i.needed_by > now())
        AND NOT EXISTS (SELECT 1 FROM deals d
                        WHERE d.listing_id = l.id AND d.buy_intent_id = i.id AND d.status IN ('declined', 'expired'))
    )
    SELECT *, ${SCORE} AS score, ${RELEVANCE} AS relevance
    FROM scored
    WHERE ${RELEVANCE} >= $3
    ORDER BY score DESC, created_at ASC
    LIMIT $2
    `,
    [listingId, opts.limit, opts.threshold],
  );
  return rows.map(toScores);
}
