import type { Db } from "../db/client.js";
import { logEvent, shortId } from "./events.js";
import { findIntentsForListing, findMatchesForIntent } from "./matching.js";
import { negotiate } from "./negotiation.js";
import { num, type BuyIntentRow, type DealRow, type ListingRow } from "./types.js";

// The pairing engine. Listings and buy requests are both standing posts: when
// either side posts, the engine pairs it with the best counterpart a deal is
// possible with, negotiates inside both private limits, and opens a proposed
// deal. A post with no counterpart waits and is paired when one arrives.
//
// Invariants:
//   - a listing is in at most one proposed deal (status 'pending' while held)
//   - a buy request is in at most one proposed deal (status 'matched' while held)
//   - a hold lasts `holdHours`; an unanswered deal then expires and both posts
//     are re-paired
//   - a declined or expired listing/request pair is never proposed again
//   - expired requests (needed_by in the past) are not paired

const CANDIDATES = 5;

export interface PairingSettings {
  /** Minimum relevance (0..1) for two posts to count as a match. */
  threshold: number;
  /** How long a proposed deal holds both posts before it expires. */
  holdHours: number;
}

export interface Pairing {
  deal: DealRow;
  score: number;
}

export type PairedBy = "buyer" | "seller" | "browse" | "repair";

/** How a proposed deal ended without closing. */
export type ReleaseOutcome = "declined" | "replaced" | "expired" | "withdrawn";

export const isExpired = (i: Pick<BuyIntentRow, "needed_by">, now = new Date()) =>
  i.needed_by != null && new Date(i.needed_by) <= now;

/** Pair a buy request with the best listing that can close inside both limits. */
export async function pairIntent(db: Db, intent: BuyIntentRow, s: PairingSettings, by: PairedBy): Promise<Pairing | null> {
  if (intent.status !== "open" || isExpired(intent)) return null;
  for (const listing of await findMatchesForIntent(db, intent, { limit: CANDIDATES, threshold: s.threshold })) {
    const deal = await propose(db, listing, intent, s, by, listing.score);
    if (deal) return { deal, score: listing.score };
  }
  return null;
}

/** Pair a listing with the best waiting buy request that can close inside both limits. */
export async function pairListing(db: Db, listing: ListingRow, s: PairingSettings, by: PairedBy): Promise<Pairing | null> {
  if (listing.status !== "active") return null;
  for (const intent of await findIntentsForListing(db, listing.id, { limit: CANDIDATES, threshold: s.threshold })) {
    const deal = await propose(db, listing, intent, s, by, intent.score);
    if (deal) return { deal, score: intent.score };
  }
  return null;
}

/**
 * Negotiate one listing/request pair and, when a price exists inside both
 * limits, hold both posts and open a proposed deal. Returns null when there is
 * no overlap or when either post was taken by a concurrent pairing.
 */
export async function propose(
  db: Db,
  listing: ListingRow,
  intent: BuyIntentRow,
  s: PairingSettings,
  by: PairedBy,
  score: number | null = null,
): Promise<DealRow | null> {
  const result = negotiate({
    askPrice: num(listing.ask_price)!,
    sellerMin: num(listing.min_price)!,
    buyerMax: num(intent.max_price)!,
  });
  if (!result.ok) return null;

  // One statement, so both posts are claimed together or not at all.
  const { rows } = await db.query<DealRow>(
    `WITH ok AS (
       SELECT l.id FROM listings l, buy_intents i
       WHERE l.id = $2 AND l.status = 'active' AND i.id = $3 AND i.status = 'open'
       FOR UPDATE OF l, i
     ),
     hold_listing AS (UPDATE listings SET status = 'pending' WHERE id = $2 AND EXISTS (SELECT 1 FROM ok) RETURNING id),
     hold_intent  AS (UPDATE buy_intents SET status = 'matched' WHERE id = $3 AND EXISTS (SELECT 1 FROM ok) RETURNING id)
     INSERT INTO deals (id, listing_id, buy_intent_id, price, currency, seller_confirmed, meetup, expires_at)
     SELECT $1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8)
     WHERE EXISTS (SELECT 1 FROM hold_listing) AND EXISTS (SELECT 1 FROM hold_intent)
     RETURNING *`,
    [shortId("deal"), listing.id, intent.id, result.price, listing.currency, listing.auto_accept, listing.location, s.holdHours * 3600],
  );
  const deal = rows[0];
  if (!deal) return null;
  await logEvent(db, "paired", null, deal.id, {
    by, listing_id: listing.id, intent_id: intent.id, price: result.price,
    rule: result.rule, saved_vs_ask: result.savedVsAsk, score: score == null ? null : +score.toFixed(3),
  });
  return deal;
}

/**
 * End a proposed deal without closing it. By default both posts go back on the
 * market; a withdrawal takes the withdrawn post off it instead. 'declined' and
 * 'expired' keep that pair apart for good; 'replaced' (the buyer picked another
 * option) lets them be paired again later.
 */
export async function release(
  db: Db,
  deal: Pick<DealRow, "id" | "listing_id" | "buy_intent_id">,
  outcome: ReleaseOutcome,
  next: { listing?: "active" | "withdrawn"; intent?: "open" | "cancelled" } = {},
) {
  const { rows } = await db.query(
    `UPDATE deals SET status = $2, updated_at = now() WHERE id = $1 AND status = 'proposed' RETURNING id`,
    [deal.id, outcome],
  );
  if (!rows[0]) return false;
  await db.query(`UPDATE listings SET status = $2 WHERE id = $1 AND status = 'pending'`, [deal.listing_id, next.listing ?? "active"]);
  await db.query(`UPDATE buy_intents SET status = $2 WHERE id = $1 AND status = 'matched'`, [deal.buy_intent_id, next.intent ?? "open"]);
  return true;
}

/** Re-pair both posts of a released deal; posts that left the market are skipped. */
export async function repairAfter(db: Db, deal: Pick<DealRow, "listing_id" | "buy_intent_id">, s: PairingSettings) {
  const intent = (await db.query<BuyIntentRow>(`SELECT * FROM buy_intents WHERE id = $1`, [deal.buy_intent_id])).rows[0];
  const intentNext = intent ? await pairIntent(db, intent, s, "repair") : null;
  const listing = (await db.query<ListingRow>(`SELECT * FROM listings WHERE id = $1`, [deal.listing_id])).rows[0];
  const listingNext = listing ? await pairListing(db, listing, s, "repair") : null;
  return { intentNext, listingNext };
}

/**
 * Expire proposed deals whose hold has run out and re-pair both posts. Called
 * before every marketplace operation and on a timer, so a buyer who never
 * answers can't keep an item off the market.
 */
export async function expireHolds(db: Db, s: PairingSettings) {
  const { rows } = await db.query<DealRow>(
    `SELECT * FROM deals WHERE status = 'proposed' AND expires_at <= now() ORDER BY expires_at LIMIT 50`,
  );
  let expired = 0;
  for (const deal of rows) {
    if (!(await release(db, deal, "expired"))) continue;
    expired++;
    await logEvent(db, "deal_expired", null, deal.id, { listing_id: deal.listing_id, intent_id: deal.buy_intent_id });
    await repairAfter(db, deal, s);
  }
  return expired;
}
