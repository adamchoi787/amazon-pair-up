import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { log } from "../http/log.js";
import { MarketError, withdrawPost, type Deps } from "./service.js";

// "Delete my data": the right to erasure, as one idempotent operation.
//
//   1. Live posts are taken down the normal way (withdraw_post), so a deal they
//      held is released and the other person is paired again and notified.
//   2. Posts that never reached a deal are deleted outright.
//   3. Posts the other side of a past deal still needs (what they bought, the
//      job they did, where to meet) move to a fresh anonymous account named
//      "Former member", with the description, the original words, the
//      embedding and the private limit removed.
//   4. The user's events, learning rows (pairing_features), one-offer records,
//      stored retry results, sign-in codes and tokens are deleted, and finally
//      the account itself.
// Every step is safe to repeat, so a second call (or a retry after a failure)
// finishes the job and then reports that nothing is left.

const count = async (db: Db, sql: string, params: unknown[]) =>
  (await db.query<{ n: number }>(`WITH gone AS (${sql} RETURNING 1) SELECT count(*)::int AS n FROM gone`, params)).rows[0]?.n ?? 0;

const ids = async (db: Db, sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows.map((r) => r.id);

export async function deleteMyData(deps: Deps, userId: string) {
  const { db } = deps;

  // 1. Take down live posts; counterparts are re-paired.
  const live = await ids(
    db,
    `SELECT id FROM listings WHERE seller_id = $1 AND status IN ('active', 'pending')
     UNION ALL SELECT id FROM buy_intents WHERE buyer_id = $1 AND status IN ('open', 'matched')`,
    [userId],
  );
  let released = 0;
  for (const postId of live) {
    try {
      if ((await withdrawPost(deps, userId, postId)).released_deal_id) released++;
    } catch (err) {
      // Closed between the query and the withdrawal (sold, cancelled): nothing to take down.
      if (!(err instanceof MarketError)) throw err;
    }
  }

  const listings = await ids(db, `SELECT id FROM listings WHERE seller_id = $1`, [userId]);
  const intents = await ids(db, `SELECT id FROM buy_intents WHERE buyer_id = $1`, [userId]);
  const posts = [...listings, ...intents];
  const deals = await ids(
    db,
    `SELECT d.id FROM deals d WHERE d.listing_id = ANY($1) OR d.buy_intent_id = ANY($2)`,
    [listings, intents],
  );
  const keptListings = await ids(db, `SELECT DISTINCT listing_id AS id FROM deals WHERE listing_id = ANY($1)`, [listings]);
  const keptIntents = await ids(db, `SELECT DISTINCT buy_intent_id AS id FROM deals WHERE buy_intent_id = ANY($1)`, [intents]);
  const dropListings = listings.filter((id) => !keptListings.includes(id));
  const dropIntents = intents.filter((id) => !keptIntents.includes(id));

  // 4a. Learning rows and the audit trail about this user and their posts.
  const learningRows = await count(db, `DELETE FROM pairing_features WHERE deal_id = ANY($1)`, [deals]);
  const events = await count(
    db,
    `DELETE FROM events WHERE actor_id = $1 OR ref_id = ANY($2) OR detail->>'listing_id' = ANY($2) OR detail->>'intent_id' = ANY($2)`,
    [userId, posts],
  );
  await db.query(`DELETE FROM failed_offers WHERE buyer_id = $1 OR listing_id = ANY($2)`, [userId, dropListings]);

  // 2. Posts no one else needs.
  const deleted =
    (await count(db, `DELETE FROM listings WHERE id = ANY($1)`, [dropListings])) +
    (await count(db, `DELETE FROM buy_intents WHERE id = ANY($1)`, [dropIntents]));

  // 3. Posts a counterpart still needs, without the person.
  if (keptListings.length || keptIntents.length) {
    const anon = `anon_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await db.query(`INSERT INTO users (id, display_name) VALUES ($1, 'Former member')`, [anon]);
    await db.query(
      `UPDATE listings SET seller_id = $2, description = '', embedding = NULL, min_price = ask_price WHERE id = ANY($1)`,
      [keptListings, anon],
    );
    // The private budget becomes the highest price actually agreed, which the counterpart already knows.
    await db.query(
      `UPDATE buy_intents i SET buyer_id = $2, raw_request = NULL, embedding = NULL,
         max_price = COALESCE((SELECT max(d.price) FROM deals d WHERE d.buy_intent_id = i.id), i.max_price)
       WHERE i.id = ANY($1)`,
      [keptIntents, anon],
    );
  }

  // 4b. Retry results, sign-in codes and tokens (deleting a token revokes it), then the account.
  await db.query(`DELETE FROM idempotent_calls WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM oauth_codes WHERE user_id = $1`, [userId]);
  const tokens = await count(db, `DELETE FROM oauth_tokens WHERE user_id = $1`, [userId]);
  let account = 0;
  try {
    account = await count(db, `DELETE FROM users WHERE id = $1`, [userId]);
  } catch (err) {
    // A table added later still points at the account: keep the row, drop the name.
    log("warn", "account row kept after deletion; clearing its name", { err });
    await db.query(`UPDATE users SET display_name = 'Former member', home_area = NULL WHERE id = $1`, [userId]);
  }

  const anonymised = keptListings.length + keptIntents.length;
  const anything = live.length + deleted + anonymised + events + learningRows + tokens + account > 0;
  return {
    deleted: true as const,
    posts_taken_down: live.length,
    released_deals: released,
    posts_deleted: deleted,
    posts_anonymised: anonymised,
    deals_kept_anonymised: deals.length,
    events_deleted: events,
    learning_rows_deleted: learningRows,
    tokens_revoked: tokens,
    say: !anything
      ? "There's nothing stored for you."
      : `Done: I've deleted your data${live.length ? " and taken down your posts" : ""}.` +
        (deals.length ? ` ${deals.length === 1 ? "One past deal stays" : "Your past deals stay"} on record for the other person, without your name.` : "") +
        (tokens ? " You're signed out everywhere." : ""),
  };
}
