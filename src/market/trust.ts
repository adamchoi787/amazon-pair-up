import type { Db } from "../db/client.js";
import { logEvent } from "./events.js";
import { pairIntent, pairListing, release, repairAfter, type PairingSettings } from "./pairing.js";
import type { BuyIntentRow, DealRow, ListingRow } from "./types.js";

// Reports and reviews. Deterministic: a fixed number of different people
// reporting someone puts them under review, and a person decides from there.
//   - One open report per reporter and reported person; reports from accounts
//     that are themselves under review or suspended don't count.
//   - A reporter and the person they reported are never paired again, either way.
//   - Under review: the person's proposed deals are released, their posts stop
//     pairing and they can't post, until a reviewer reinstates or suspends them
//     (dashboard: /api/review).

export const REPORT_REASONS = [
  "prohibited_item", "scam", "no_show", "not_as_described", "unsafe", "harassment", "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReviewStatus = "active" | "under_review" | "suspended";

/** Distinct reporters that put someone under review. */
export const DEFAULT_REPORT_THRESHOLD = 3;

export async function reviewStatus(db: Db, userId: string): Promise<ReviewStatus> {
  const { rows } = await db.query<{ review_status: ReviewStatus }>(`SELECT review_status FROM users WHERE id = $1`, [userId]);
  return rows[0]?.review_status ?? "active";
}

/** People counted toward someone's review: active accounts with an open report. */
export async function openReporters(db: Db, userId: string) {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(DISTINCT r.reporter_id)::int AS n FROM reports r JOIN users u ON u.id = r.reporter_id
     WHERE r.reported_id = $1 AND r.status = 'open' AND u.review_status = 'active'`,
    [userId],
  );
  return Number(rows[0].n);
}

/**
 * Put someone under review once enough people reported them: release every
 * deal they are proposed in and re-pair the other side. Returns whether it happened now.
 */
export async function reviewIfReported(db: Db, userId: string, threshold: number, s: PairingSettings) {
  if ((await openReporters(db, userId)) < threshold) return false;
  const { rows } = await db.query(
    `UPDATE users SET review_status = 'under_review' WHERE id = $1 AND review_status = 'active' RETURNING id`,
    [userId],
  );
  if (!rows[0]) return false;
  const held = await proposedDealsOf(db, userId);
  for (const d of held) {
    if (await release(db, d, "withdrawn")) await repairAfter(db, d, s);
  }
  await logEvent(db, "user_under_review", null, userId, { reporters: await openReporters(db, userId), released_deals: held.length });
  return true;
}

async function proposedDealsOf(db: Db, userId: string) {
  const { rows } = await db.query<DealRow>(
    `SELECT d.* FROM deals d JOIN listings l ON l.id = d.listing_id JOIN buy_intents i ON i.id = d.buy_intent_id
     WHERE d.status = 'proposed' AND (l.seller_id = $1 OR i.buyer_id = $1)`,
    [userId],
  );
  return rows;
}

export type ReviewDecision = "reinstate" | "suspend";

/**
 * A reviewer's decision. Reinstating dismisses the open reports (the reporters
 * still never meet them) and puts their posts back into pairing; suspending upholds them.
 */
export async function decideReview(db: Db, userId: string, decision: ReviewDecision, s: PairingSettings) {
  const status: ReviewStatus = decision === "reinstate" ? "active" : "suspended";
  const { rows } = await db.query(`UPDATE users SET review_status = $2, reviewed_at = now() WHERE id = $1 RETURNING id`, [userId, status]);
  if (!rows[0]) return null;
  await db.query(
    `UPDATE reports SET status = $2 WHERE reported_id = $1 AND status = 'open'`,
    [userId, decision === "reinstate" ? "dismissed" : "upheld"],
  );
  if (decision === "suspend") {
    for (const d of await proposedDealsOf(db, userId)) {
      if (await release(db, d, "withdrawn")) await repairAfter(db, d, s);
    }
  } else {
    const listings = await db.query<ListingRow>(`SELECT * FROM listings WHERE seller_id = $1 AND status = 'active'`, [userId]);
    for (const l of listings.rows) await pairListing(db, l, s, "repair");
    const intents = await db.query<BuyIntentRow>(`SELECT * FROM buy_intents WHERE buyer_id = $1 AND status = 'open'`, [userId]);
    for (const i of intents.rows) await pairIntent(db, i, s, "repair");
  }
  await logEvent(db, decision === "reinstate" ? "user_reinstated" : "user_suspended", null, userId, {});
  return status;
}

/** For the dashboard: everyone under review first, then anyone with open reports or blocked posts. */
export async function reviewQueue(db: Db) {
  const { rows } = await db.query<{
    user_id: string; display_name: string; review_status: ReviewStatus; open_reports: number; reporters: number;
    reasons: string[] | null; last_report: string | null; blocked_posts: number; rating: number | null; ratings: number;
  }>(
    `SELECT u.id AS user_id, u.display_name, u.review_status,
            (SELECT count(*)::int FROM reports r WHERE r.reported_id = u.id AND r.status = 'open') AS open_reports,
            (SELECT count(DISTINCT r.reporter_id)::int FROM reports r WHERE r.reported_id = u.id AND r.status = 'open') AS reporters,
            (SELECT array_agg(DISTINCT r.reason) FROM reports r WHERE r.reported_id = u.id AND r.status = 'open') AS reasons,
            (SELECT max(r.created_at) FROM reports r WHERE r.reported_id = u.id) AS last_report,
            (SELECT count(*)::int FROM events e WHERE e.actor_id = u.id AND e.kind = 'post_blocked') AS blocked_posts,
            (SELECT round(avg(g.stars)::numeric, 2)::float8 FROM ratings g WHERE g.ratee_id = u.id) AS rating,
            (SELECT count(*)::int FROM ratings g WHERE g.ratee_id = u.id) AS ratings
     FROM users u
     WHERE u.review_status <> 'active'
        OR EXISTS (SELECT 1 FROM reports r WHERE r.reported_id = u.id AND r.status = 'open')
        OR EXISTS (SELECT 1 FROM events e WHERE e.actor_id = u.id AND e.kind = 'post_blocked')
     ORDER BY (u.review_status = 'under_review') DESC, open_reports DESC, blocked_posts DESC, u.id
     LIMIT 50`,
  );
  return rows.map((r) => ({ ...r, reasons: r.reasons ?? [], rating: r.rating == null ? null : Number(r.rating) }));
}
