import type { Db } from "../db/client.js";
import { toVector } from "../db/client.js";
import type { BuyIntentRow, ListingRow } from "./types.js";

// Owner: B (marketplace engine).
//
// Hybrid retrieval in one SQL query:
//   1. hard constraints  — active, not your own, enough quantity, condition >= wanted,
//                          and a deal is possible (seller min <= buyer max; evaluated
//                          server-side, never exposed)
//   2. semantic score    — pgvector cosine similarity of embeddings
//   3. keyword score     — Postgres full-text rank (OR of the query words)
//   4. price fit         — 1 if the ask is within budget, decays above it
//   5. location bonus    — same meetup area
// Tune WEIGHTS and MATCH_THRESHOLD with real seed data.

export const WEIGHTS = { semantic: 0.6, keyword: 0.25, price: 0.1, location: 0.05 };

const CONDITION_RANK = `CASE %s WHEN 'new' THEN 4 WHEN 'like_new' THEN 3 WHEN 'good' THEN 2 WHEN 'fair' THEN 1 ELSE 0 END`;
const rank = (col: string) => CONDITION_RANK.replace("%s", col);

export interface MatchRow extends ListingRow {
  semantic: number;
  keyword: number;
  price_fit: number;
  score: number;
}

export async function findMatchesForIntent(
  db: Db,
  intent: BuyIntentRow,
  intentEmbedding: number[],
  opts: { limit: number; threshold: number },
): Promise<MatchRow[]> {
  const { rows } = await db.query<MatchRow>(
    `
    WITH q AS (
      SELECT $1::vector AS emb,
             replace(plainto_tsquery('english', $2)::text, '&', '|') AS tsq_text
    ),
    scored AS (
      SELECT l.*,
             GREATEST(0, 1 - (l.embedding <=> q.emb))                       AS semantic,
             CASE WHEN q.tsq_text = '' THEN 0
                  ELSE ts_rank_cd(l.search_tsv, q.tsq_text::tsquery, 32) END AS keyword,
             CASE WHEN l.ask_price <= $3 THEN 1
                  ELSE $3 / NULLIF(l.ask_price, 0) END                      AS price_fit,
             CASE WHEN $6::text IS NOT NULL AND l.location ILIKE '%' || $6 || '%'
                  THEN 1 ELSE 0 END                                         AS loc
      FROM listings l, q
      WHERE l.status = 'active'
        AND l.seller_id <> $4
        AND l.quantity >= $5
        AND l.min_price <= $3
        AND ${rank("l.condition")} >= ${rank("$7")}
        AND l.embedding IS NOT NULL
    )
    SELECT *,
           (${WEIGHTS.semantic} * semantic + ${WEIGHTS.keyword} * keyword
            + ${WEIGHTS.price} * price_fit + ${WEIGHTS.location} * loc)::float8 AS score
    FROM scored
    ORDER BY score DESC
    LIMIT $8
    `,
    [
      toVector(intentEmbedding),
      [intent.need, intent.category].filter(Boolean).join(" "),
      intent.max_price,
      intent.buyer_id,
      intent.quantity,
      intent.location,
      intent.min_condition,
      opts.limit * 3,
    ],
  );
  return rows
    .map((r) => ({ ...r, semantic: Number(r.semantic), keyword: Number(r.keyword), price_fit: Number(r.price_fit), score: Number(r.score) }))
    .filter((r) => r.score >= opts.threshold)
    .slice(0, opts.limit);
}

export interface IntentMatchRow extends BuyIntentRow {
  semantic: number;
  keyword: number;
  price_fit: number;
  score: number;
}

// The same hard constraints and score as findMatchesForIntent, run from the
// seller's side: which open buy intents does this (stored) listing satisfy?
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
        AND l.quantity >= i.quantity
        AND l.min_price <= i.max_price
        AND ${rank("l.condition")} >= ${rank("i.min_condition")}
        AND l.embedding IS NOT NULL
        AND i.embedding IS NOT NULL
    )
    SELECT *,
           (${WEIGHTS.semantic} * semantic + ${WEIGHTS.keyword} * keyword
            + ${WEIGHTS.price} * price_fit + ${WEIGHTS.location} * loc)::float8 AS score
    FROM scored
    ORDER BY score DESC
    LIMIT $2
    `,
    [listingId, opts.limit * 3],
  );
  return rows
    .map((r) => ({ ...r, semantic: Number(r.semantic), keyword: Number(r.keyword), price_fit: Number(r.price_fit), score: Number(r.score) }))
    .filter((r) => r.score >= opts.threshold)
    .slice(0, opts.limit);
}
