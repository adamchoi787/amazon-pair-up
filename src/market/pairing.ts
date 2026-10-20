import type { Db } from "../db/client.js";
import { logEvent, shortId } from "./events.js";
import { armFor, champion, featuresOf, loadTracks, predict, recordPairing, type Arm, type Features, type Model } from "./learning.js";
import { findIntentsForListing, findMatchesForIntent } from "./matching.js";
import { negotiate, type NegotiationResult } from "./negotiation.js";
import { num, type BuyIntentRow, type DealRow, type ListingRow } from "./types.js";
import { checkSchedule, hasBookingConflict, providerBookings } from "./scheduling.js";

// The pairing engine. Offers (listings) and requests (buy intents) are both
// standing posts, for an item or a service: when
// either side posts, the engine pairs it with the best counterpart a deal is
// possible with, settles the price inside both private limits, and opens a proposed
// deal. A post with no counterpart waits and is paired when one arrives.
//
// Invariants:
//   - a listing is in at most one proposed deal (status 'pending' while held)
//   - a buy request is in at most one proposed deal (status 'matched' while held)
//   - a hold lasts `holdHours`, or until the request's deadline when that comes
//     first (a lunch run can't wait a day); an unanswered deal then expires and
//     both posts are re-paired
//   - a declined or expired listing/request pair is never proposed again
//   - a buyer who walked away from a price for a listing (declined, let it
//     expire, switched or withdrew) is never offered that listing lower, by any
//     later request: declining and asking again with smaller budgets can't
//     step down to the seller's minimum
//   - a buyer gets one offer below the asking price per listing: once it fails,
//     that buyer gets the listing only at the asking price, so asking again with
//     rising budgets can't climb up to the seller's minimum either
//   - expired requests (needed_by in the past) are not paired

// Candidates that pass every hard constraint; the ranking picks among them.
const CANDIDATES = 10;

type Scored = ListingRow & { relevance: number; price_fit: number; loc: number; score: number };

/** What the learning loop records about a proposal. */
interface Learn { features: Features; arm: Arm; model: Model | null; baseline: number }

/**
 * Order candidates for the post that triggered pairing. The control arm keeps
 * the hand-tuned score (src/market/matching.ts); the model arm orders by the
 * learned chance that both sides say yes. Candidates with no price inside both
 * limits are dropped here, as propose would.
 */
async function rank(db: Db, postId: string, candidates: { listing: Scored; intent: BuyIntentRow }[]) {
  const model = await champion(db);
  const arm = armFor(postId, model);
  const settled: { listing: Scored; intent: BuyIntentRow; price: number }[] = [];
  for (const c of candidates) {
    const r = await settlePair(db, c.listing, c.intent);
    if (r.ok) settled.push({ ...c, price: r.price });
  }
  const tracks = await loadTracks(db, [...new Set(settled.map((c) => c.listing.seller_id))], [...new Set(settled.map((c) => c.intent.buyer_id))]);
  const ranked = settled.map((c) => ({ ...c, features: featuresOf(c, tracks) }));
  if (arm === "model" && model) {
    // Stable sort: equal chances keep the hand-tuned order.
    ranked.sort((a, b) => predict(model, b.features) - predict(model, a.features));
  }
  return ranked.map((c) => ({
    ...c,
    learn: { features: c.features, arm, model: arm === "model" ? model : null, baseline: c.listing.score } satisfies Learn,
  }));
}

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
  const matches = await findMatchesForIntent(db, intent, { limit: CANDIDATES, threshold: s.threshold });
  for (const c of await rank(db, intent.id, matches.map((listing) => ({ listing, intent })))) {
    const deal = await propose(db, c.listing, intent, s, by, c.listing.score, c.learn);
    if (deal) return { deal, score: c.listing.score };
  }
  return null;
}

/** Pair a listing with the best waiting buy request that can close inside both limits. */
export async function pairListing(db: Db, listing: ListingRow, s: PairingSettings, by: PairedBy): Promise<Pairing | null> {
  if (listing.status !== "active") return null;
  const intents = await findIntentsForListing(db, listing.id, { limit: CANDIDATES, threshold: s.threshold });
  const candidates = intents.map((intent) => ({
    listing: { ...listing, relevance: intent.relevance, price_fit: intent.price_fit, loc: intent.loc, score: intent.score },
    intent,
  }));
  for (const c of await rank(db, listing.id, candidates)) {
    const deal = await propose(db, listing, c.intent, s, by, c.listing.score, c.learn);
    if (deal) return { deal, score: c.listing.score };
  }
  return null;
}

/**
 * Negotiate one listing/request pair and, when a price exists inside both
 * limits, hold both posts and open a proposed deal. Returns null when there is
 * no overlap or when either post was taken by a concurrent pairing.
 */
/**
 * The best price this buyer already walked away from for this listing, or 0.
 * Confirmed deals don't count: booking the same helper again is a new job.
 */
export async function walkAwayFloor(db: Db, listingId: string, buyerId: string) {
  const { rows } = await db.query<{ floor: string | number | null }>(
    `SELECT max(d.price) AS floor FROM deals d JOIN buy_intents i ON i.id = d.buy_intent_id
     WHERE d.listing_id = $1 AND i.buyer_id = $2 AND d.status IN ('declined', 'expired', 'replaced', 'withdrawn')`,
    [listingId, buyerId],
  );
  return num(rows[0]?.floor) ?? 0;
}

/** Whether this buyer already made an offer below the ask for this listing that failed. */
async function offerFailed(db: Db, listingId: string, buyerId: string) {
  const { rows } = await db.query(`SELECT 1 FROM failed_offers WHERE listing_id = $1 AND buyer_id = $2`, [listingId, buyerId]);
  return rows.length > 0;
}

/** Remember a failed offer below the ask. The buyer's first one for a listing is the one that counts. */
export async function recordFailedOffer(db: Db, listingId: string, buyerId: string, offered: number) {
  await db.query(
    `INSERT INTO failed_offers (listing_id, buyer_id, offered) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [listingId, buyerId, offered],
  );
}

/**
 * Settle one listing/request pair inside both private limits and the buyer's
 * floor: the best price they walked away from, or the full ask once their offer
 * below it failed.
 */
export async function settlePair(db: Db, listing: ListingRow, intent: BuyIntentRow): Promise<NegotiationResult> {
  const ask = num(listing.ask_price)!;
  return negotiate({
    askPrice: ask,
    sellerMin: num(listing.min_price)!,
    buyerMax: num(intent.max_price)!,
    floor: (await offerFailed(db, listing.id, intent.buyer_id)) ? ask : await walkAwayFloor(db, listing.id, intent.buyer_id),
  });
}

export async function propose(
  db: Db,
  listing: ListingRow,
  intent: BuyIntentRow,
  s: PairingSettings,
  by: PairedBy,
  score: number | null = null,
  learn?: Learn,
): Promise<DealRow | null> {
  return db.transaction(async tx => {
    // Serialise bookings across every offer belonging to this provider. The
    // following reads get a fresh READ COMMITTED snapshot after the row lock.
    await tx.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [listing.seller_id]);
    const freshListing = (await tx.query<ListingRow>(`SELECT * FROM listings WHERE id = $1 FOR UPDATE`, [listing.id])).rows[0];
    const freshIntent = (await tx.query<BuyIntentRow>(`SELECT * FROM buy_intents WHERE id = $1 FOR UPDATE`, [intent.id])).rows[0];
    if (!freshListing || !freshIntent || freshListing.status !== "active" || freshIntent.status !== "open" || isExpired(freshIntent)) return null;
    listing = freshListing;
    intent = freshIntent;
    const scheduling = checkSchedule(listing, intent);
    if (scheduling.status === "conflict" || (listing.kind === "service" && hasBookingConflict(intent, await providerBookings(tx, [listing.seller_id])))) return null;
    const result = await settlePair(tx, listing, intent);
    if (!result.ok) return null;

    // One statement, so both posts are claimed together or not at all.
    const { rows } = await tx.query<DealRow>(
      `WITH ok AS (
         SELECT l.id FROM listings l, buy_intents i
         WHERE l.id = $2 AND l.status = 'active' AND i.id = $3 AND i.status = 'open'
         FOR UPDATE OF l, i
       ),
       hold_listing AS (UPDATE listings SET status = 'pending' WHERE id = $2 AND EXISTS (SELECT 1 FROM ok) RETURNING id),
       hold_intent  AS (UPDATE buy_intents SET status = 'matched' WHERE id = $3 AND EXISTS (SELECT 1 FROM ok) RETURNING id)
       INSERT INTO deals (id, listing_id, buy_intent_id, price, currency, seller_confirmed, meetup, expires_at)
       SELECT $1, $2, $3, $4, $5, $6, $7, LEAST(now() + make_interval(secs => $8), $9::timestamptz)
       WHERE EXISTS (SELECT 1 FROM hold_listing) AND EXISTS (SELECT 1 FROM hold_intent)
       RETURNING *`,
      [
        shortId("deal"), listing.id, intent.id, result.price, listing.currency,
        listing.auto_accept && (listing.kind === "item" || scheduling.status === "verified"),
        meetingPlace(listing, intent), s.holdHours * 3600, intent.needed_by,
      ],
    );
    const deal = rows[0];
    if (!deal) return null;
    // Pairings the engine chose are recorded for learning; a buyer's own pick (browse) is not a ranking decision.
    if (learn) await recordPairing(tx, deal.id, learn.features, learn.arm, learn.model, learn.baseline);
    await logEvent(tx, "paired", null, deal.id, {
      by, listing_id: listing.id, intent_id: intent.id, price: result.price,
      rule: result.rule, saved_vs_ask: result.savedVsAsk, score: score == null ? null : +score.toFixed(3),
      arm: learn?.arm ?? null, model: learn?.model?.version ?? null,
    });
    return deal;
  });
}

/** Items change hands where the seller is; a service happens where the requester needs it. */
const meetingPlace = (listing: ListingRow, intent: BuyIntentRow) =>
  listing.kind === "service" ? intent.location ?? listing.location : listing.location;

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
