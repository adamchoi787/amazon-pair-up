import { randomUUID } from "node:crypto";
import type { Ai, Condition } from "../ai/index.js";
import type { Config } from "../config.js";
import { toVector, type Db } from "../db/client.js";
import { findIntentsForListing, findMatchesForIntent } from "./matching.js";
import { negotiate } from "./negotiation.js";
import { num, type BuyIntentRow, type DealRow, type ListingRow } from "./types.js";
import { dealView, intentView, listingView } from "./views.js";

// Business operations. MCP tools (src/mcp/tools.ts) are thin wrappers around these,
// so a web simulator or tests can call the same functions directly.

export interface Deps {
  db: Db;
  ai: Ai;
  cfg: Pick<Config, "matchThreshold">;
}

export class MarketError extends Error {}

const shortId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

async function logEvent(db: Db, kind: string, actorId: string | null, refId: string | null, detail: object = {}) {
  await db.query(`INSERT INTO events (kind, actor_id, ref_id, detail) VALUES ($1,$2,$3,$4)`, [
    kind, actorId, refId, JSON.stringify(detail),
  ]);
}

export async function ensureUser(db: Db, userId: string, displayName?: string) {
  await db.query(
    `INSERT INTO users (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [userId, displayName ?? userId],
  );
}

// ---------- Sell side ----------

export interface CreateListingInput {
  user_id: string;
  title: string;
  description?: string;
  category?: string;
  condition?: Condition;
  quantity?: number;
  currency?: string;
  ask_price: number;
  min_price?: number;
  auto_accept?: boolean;
  location?: string;
  availability?: string;
}

export async function createListing(deps: Deps, input: CreateListingInput) {
  const { db, ai } = deps;
  const minPrice = input.min_price ?? input.ask_price;
  if (minPrice > input.ask_price) throw new MarketError("Minimum price can't be above the asking price.");
  await ensureUser(db, input.user_id);

  const id = shortId("lst");
  const embedding = await ai.embed(
    [input.title, input.description, input.category, input.condition].filter(Boolean).join(". "),
  );
  const { rows } = await db.query<ListingRow>(
    `INSERT INTO listings (id, seller_id, title, description, category, condition, quantity, currency,
                           ask_price, min_price, auto_accept, location, availability, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::vector) RETURNING *`,
    [
      id, input.user_id, input.title, input.description ?? "", input.category ?? null,
      input.condition ?? "good", input.quantity ?? 1, input.currency ?? "USD",
      input.ask_price, minPrice, input.auto_accept ?? true, input.location ?? null,
      input.availability ?? null, toVector(embedding),
    ],
  );
  // Pair from the seller's side too: buyers who posted first are waiting for this.
  const waiting = await findIntentsForListing(db, id, { limit: 5, threshold: deps.cfg.matchThreshold });
  await logEvent(db, "listing_created", input.user_id, id, {
    title: input.title, ask: input.ask_price, waiting_buyers: waiting.length,
  });
  const listing = listingView(rows[0], input.user_id);
  return {
    listing,
    waiting_buyers: waiting.length,
    buyer_intents: waiting.map((i) => ({ ...intentView(i, input.user_id), score: +i.score.toFixed(3) })),
    say: `Listed ${input.title} for ${fmt(input.ask_price, listing.currency)}. ` +
      (input.min_price != null
        ? `I'll accept offers down to ${fmt(minPrice, listing.currency)} without asking you, and buyers will never see that number.`
        : `I'll only accept the asking price.`) +
      (waiting.length ? ` ${waitingLine(waiting.length)}` : ""),
  };
}

const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five"];

function waitingLine(count: number) {
  const n = COUNT_WORDS[count] ?? String(count);
  return count === 1 ? `${n} person is already looking for this.` : `${n} people are already looking for this.`;
}

// ---------- Buy side ----------

export interface CreateBuyIntentInput {
  user_id: string;
  need?: string;
  raw_request?: string;
  max_price?: number;
  min_condition?: Condition;
  quantity?: number;
  currency?: string;
  needed_by?: string;
  location?: string;
  source?: "voice" | "bee_context";
}

export async function createBuyIntent(deps: Deps, input: CreateBuyIntentInput) {
  const { db, ai } = deps;
  if (!input.need && !input.raw_request) throw new MarketError("Tell me what you need.");

  // Structured fields from the voice agent win; extraction fills the gaps.
  const extracted = input.raw_request ? await ai.extractIntent(input.raw_request) : undefined;
  const need = input.need ?? extracted?.need ?? input.raw_request!;
  const maxPrice = input.max_price ?? extracted?.max_price;
  if (maxPrice == null) throw new MarketError("What's the most you'd pay? I keep that private from sellers.");

  await ensureUser(db, input.user_id);
  const id = shortId("int");
  const category = extracted?.category ?? null;
  const embedding = await ai.embed([need, category].filter(Boolean).join(". "));
  const { rows } = await db.query<BuyIntentRow>(
    `INSERT INTO buy_intents (id, buyer_id, need, raw_request, source, category, min_condition, quantity,
                              currency, max_price, needed_by, location, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector) RETURNING *`,
    [
      id, input.user_id, need, input.raw_request ?? null, input.source ?? "voice", category,
      input.min_condition ?? extracted?.min_condition ?? "for_parts",
      input.quantity ?? extracted?.quantity ?? 1, input.currency ?? "USD", maxPrice,
      input.needed_by ?? extracted?.needed_by ?? null, input.location ?? extracted?.location ?? null,
      toVector(embedding),
    ],
  );
  await logEvent(db, "intent_created", input.user_id, id, { need, source: input.source ?? "voice" });
  return {
    intent: intentView(rows[0], input.user_id),
    say: `Got it — looking for ${need}, up to ${fmt(maxPrice, rows[0].currency)}. Sellers won't see your budget.`,
  };
}

export async function findMatches(deps: Deps, userId: string, intentId: string, limit = 3) {
  const { db, ai, cfg } = deps;
  const intent = await getIntent(db, intentId);
  if (intent.buyer_id !== userId) throw new MarketError("That request belongs to someone else.");

  const embedding = await ai.embed([intent.need, intent.category].filter(Boolean).join(". "));
  const matches = await findMatchesForIntent(db, intent, embedding, { limit, threshold: cfg.matchThreshold });
  await logEvent(db, "matches_found", userId, intentId, { count: matches.length, top: matches[0]?.id });

  return {
    intent_id: intentId,
    matches: matches.map((m) => ({
      ...listingView(m, userId),
      within_budget_at_ask: num(m.ask_price)! <= num(intent.max_price)!,
      score: +m.score.toFixed(3),
    })),
    say: matches.length
      ? `I found ${matches.length} option${matches.length > 1 ? "s" : ""}. The best is ${matches[0].title}, asking ${fmt(num(matches[0].ask_price)!, matches[0].currency)}. Want me to negotiate?`
      : `Nothing matches yet. I'll keep your request open.`,
  };
}

// ---------- Deal-making ----------

export async function negotiateDeal(deps: Deps, userId: string, intentId: string, listingId: string) {
  const { db } = deps;
  const intent = await getIntent(db, intentId);
  if (intent.buyer_id !== userId) throw new MarketError("That request belongs to someone else.");
  const listing = await getListing(db, listingId);
  if (listing.status !== "active") throw new MarketError("That item is no longer available.");

  const result = negotiate({
    askPrice: num(listing.ask_price)!,
    sellerMin: num(listing.min_price)!,
    buyerMax: num(intent.max_price)!,
  });

  if (!result.ok) {
    await logEvent(db, "negotiation_failed", userId, listingId, { intent_id: intentId });
    // Deliberately vague: never reveal how far apart the limits are.
    return { deal: null, say: `The seller can't meet your budget on this one. Want to try another option or raise your limit?` };
  }

  const id = shortId("deal");
  const { rows } = await db.query<DealRow>(
    `INSERT INTO deals (id, listing_id, buy_intent_id, price, currency, seller_confirmed, meetup)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, listingId, intentId, result.price, listing.currency, listing.auto_accept, listing.location],
  );
  await logEvent(db, "deal_proposed", userId, id, {
    listing_id: listingId, price: result.price, rule: result.rule, saved_vs_ask: result.savedVsAsk,
  });
  return {
    deal: dealView({ ...rows[0], title: listing.title, seller_id: listing.seller_id, buyer_id: intent.buyer_id }, userId),
    saved_vs_ask: result.savedVsAsk,
    say: `I negotiated ${listing.title} down to ${fmt(result.price, listing.currency)}` +
      (result.savedVsAsk > 0 ? ` — ${fmt(result.savedVsAsk, listing.currency)} below asking` : "") +
      `. Should I confirm it?`,
  };
}

export async function confirmDeal(deps: Deps, userId: string, dealId: string) {
  const { db } = deps;
  const d = await getDealWithParties(db, dealId);
  if (d.status !== "proposed") throw new MarketError(`This deal is already ${d.status}.`);
  const isBuyer = userId === d.buyer_id;
  const isSeller = userId === d.seller_id;
  if (!isBuyer && !isSeller) throw new MarketError("You're not part of this deal.");
  if ((await getListing(db, d.listing_id)).status !== "active") {
    throw new MarketError("Sorry, that item was just sold to someone else.");
  }

  const buyer = d.buyer_confirmed || isBuyer;
  const seller = d.seller_confirmed || isSeller;
  const done = buyer && seller;
  await db.query(
    `UPDATE deals SET buyer_confirmed=$2, seller_confirmed=$3, status=$4, updated_at=now() WHERE id=$1`,
    [dealId, buyer, seller, done ? "confirmed" : "proposed"],
  );
  if (done) {
    await db.query(`UPDATE listings SET status='sold' WHERE id=$1`, [d.listing_id]);
    await db.query(`UPDATE buy_intents SET status='fulfilled' WHERE id=$1`, [d.buy_intent_id]);
  }
  await logEvent(db, done ? "deal_confirmed" : "deal_half_confirmed", userId, dealId, { by: isBuyer ? "buyer" : "seller" });
  const fresh = await getDealWithParties(db, dealId);
  return {
    deal: dealView(fresh, userId),
    say: done
      ? `Done! ${fresh.title} for ${fmt(num(fresh.price)!, fresh.currency)}.` + (fresh.meetup ? ` Meet-up: ${fresh.meetup}.` : "")
      : `Confirmed on your side. Waiting for the ${isBuyer ? "seller" : "buyer"}.`,
  };
}

export async function declineDeal(deps: Deps, userId: string, dealId: string) {
  const { db } = deps;
  const d = await getDealWithParties(db, dealId);
  if (userId !== d.buyer_id && userId !== d.seller_id) throw new MarketError("You're not part of this deal.");
  if (d.status !== "proposed") throw new MarketError(`This deal is already ${d.status}.`);
  await db.query(`UPDATE deals SET status='declined', updated_at=now() WHERE id=$1`, [dealId]);
  await logEvent(db, "deal_declined", userId, dealId);
  return { deal_id: dealId, status: "declined", say: "No problem, I've cancelled that deal." };
}

export async function getDealStatus(deps: Deps, userId: string, dealId?: string) {
  const { db } = deps;
  const { rows } = await db.query<DealRow & { title: string; seller_id: string; buyer_id: string }>(
    `${DEAL_WITH_PARTIES} WHERE (l.seller_id = $1 OR i.buyer_id = $1) AND ($2::text IS NULL OR d.id = $2)
     ORDER BY d.created_at DESC LIMIT 10`,
    [userId, dealId ?? null],
  );
  const deals = rows.map((r) => dealView(r, userId));
  return {
    deals,
    say: deals.length
      ? deals.map((d) => `${d.title}: ${d.status} at ${fmt(d.price!, d.currency)}`).join(". ")
      : "You don't have any deals yet.",
  };
}

// ---------- Dashboard (for judges / demo) ----------

export async function dashboard(db: Db) {
  const [listings, intents, deals, events] = await Promise.all([
    db.query(`SELECT id, seller_id, title, condition, ask_price, currency, location, status, created_at FROM listings ORDER BY created_at DESC LIMIT 50`),
    db.query(`SELECT id, buyer_id, need, source, quantity, currency, status, created_at FROM buy_intents ORDER BY created_at DESC LIMIT 50`),
    db.query(`${DEAL_WITH_PARTIES} ORDER BY d.created_at DESC LIMIT 50`),
    db.query(`SELECT * FROM events ORDER BY id DESC LIMIT 100`),
  ]);
  // Private limits are intentionally absent: the dashboard proves they stay hidden.
  return { listings: listings.rows, intents: intents.rows, deals: deals.rows, events: events.rows };
}

// ---------- helpers ----------

const DEAL_WITH_PARTIES = `
  SELECT d.*, l.title, l.seller_id, i.buyer_id
  FROM deals d JOIN listings l ON l.id = d.listing_id JOIN buy_intents i ON i.id = d.buy_intent_id`;

async function getDealWithParties(db: Db, id: string) {
  const { rows } = await db.query<DealRow & { title: string; seller_id: string; buyer_id: string }>(
    `${DEAL_WITH_PARTIES} WHERE d.id = $1`, [id],
  );
  if (!rows[0]) throw new MarketError(`No deal ${id}.`);
  return rows[0];
}

async function getIntent(db: Db, id: string) {
  const { rows } = await db.query<BuyIntentRow>(`SELECT * FROM buy_intents WHERE id = $1`, [id]);
  if (!rows[0]) throw new MarketError(`No request ${id}.`);
  return rows[0];
}

async function getListing(db: Db, id: string) {
  const { rows } = await db.query<ListingRow>(`SELECT * FROM listings WHERE id = $1`, [id]);
  if (!rows[0]) throw new MarketError(`No listing ${id}.`);
  return rows[0];
}

function fmt(amount: number, currency: string) {
  const sym = currency === "USD" ? "$" : currency === "HKD" ? "HK$" : `${currency} `;
  return `${sym}${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}
