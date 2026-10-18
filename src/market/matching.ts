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
