import type { Ai, Condition } from "../ai/index.js";
import { toVector, type Db } from "../db/client.js";
import { logEvent, shortId } from "./events.js";
import { findIntentsForListing, findMatchesForIntent } from "./matching.js";
import { negotiate } from "./negotiation.js";
import {
  expireHolds, isExpired, pairIntent, pairListing, propose, release, repairAfter, type PairingSettings,
} from "./pairing.js";
import { num, type BuyIntentRow, type DealRow, type ListingRow } from "./types.js";
import { dealView, intentView, listingView, type DealView, type DealWithParties } from "./views.js";

// Business operations. MCP tools (src/mcp/server.ts) are thin wrappers around
// these, so the web app and the tests call the same functions.

/** Marketplace policy. Only the threshold is required; the rest have production defaults. */
export interface MarketSettings {
  matchThreshold: number;
  dealHoldHours?: number;
  postsPerHour?: number;
  maxOpenRequests?: number;
}

export interface Deps {
  db: Db;
  ai: Ai;
  cfg: MarketSettings;
}

export class MarketError extends Error {}

const ALTERNATIVES = 4;

const pairing = (cfg: MarketSettings): PairingSettings => ({
  threshold: cfg.matchThreshold,
  holdHours: cfg.dealHoldHours ?? 24,
});

/** Expire unanswered holds before acting, so every answer reflects the live market. */
const sweep = (deps: Deps) => expireHolds(deps.db, pairing(deps.cfg));

export async function ensureUser(db: Db, userId: string, displayName?: string) {
  await db.query(
    `INSERT INTO users (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [userId, displayName ?? userId],
  );
}

/** Per-user posting limits. They also stop a buyer from probing a seller's minimum with many budgets. */
async function checkPostingLimits(deps: Deps, userId: string, kind: "listing" | "request") {
  const { db, cfg } = deps;
  const { rows } = await db.query<{ recent: number; open_requests: number }>(
    `SELECT
       (SELECT count(*) FROM listings    WHERE seller_id = $1 AND created_at > now() - interval '1 hour')
     + (SELECT count(*) FROM buy_intents WHERE buyer_id  = $1 AND created_at > now() - interval '1 hour') AS recent,
       (SELECT count(*) FROM buy_intents WHERE buyer_id = $1 AND status IN ('open', 'matched')) AS open_requests`,
    [userId],
  );
  if (Number(rows[0].recent) >= (cfg.postsPerHour ?? 30)) {
    throw new MarketError("You've posted a lot in the last hour. Please try again a little later.");
  }
  const maxOpen = cfg.maxOpenRequests ?? 10;
  if (kind === "request" && Number(rows[0].open_requests) >= maxOpen) {
    throw new MarketError(`You already have ${countWord(maxOpen).toLowerCase()} open requests. Cancel one first, then ask again.`);
  }
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

/** Post an item. If a buyer is already waiting for it, pair them and open a deal. */
export async function createListing(deps: Deps, input: CreateListingInput) {
  const { db, ai, cfg } = deps;
  const minPrice = input.min_price ?? input.ask_price;
  if (minPrice > input.ask_price) throw new MarketError("Your minimum can't be above the asking price.");
  await sweep(deps);
  await ensureUser(db, input.user_id);
  await checkPostingLimits(deps, input.user_id, "listing");

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
  const waiting = (await findIntentsForListing(db, id, { limit: 5, threshold: cfg.matchThreshold })).length;
  await logEvent(db, "listing_created", input.user_id, id, { title: input.title, ask: input.ask_price, waiting_buyers: waiting });

  const paired = await pairListing(db, rows[0], pairing(cfg), "seller");
  const listing = listingView(await getListing(db, id), input.user_id);
  const deal = paired ? dealView(await getDealWithParties(db, paired.deal.id), input.user_id) : null;
  const ask = fmt(input.ask_price, listing.currency);

  let say: string;
  if (deal) {
    const others = waiting - 1;
    say = `Listed ${input.title} for ${ask}. A buyer was already looking for one: I agreed ${fmt(deal.price, deal.currency)}, inside your limit, ` +
      (deal.seller_confirmed ? `and asked them to confirm.` : `so it's your call. Should I accept?`) +
      (others > 0 ? ` ${countWord(others)} more ${others === 1 ? "person is" : "people are"} looking too.` : "");
  } else {
    say = `Listed ${input.title} for ${ask}. ` +
      (input.min_price != null && minPrice < input.ask_price
        ? `I'll accept offers down to ${fmt(minPrice, listing.currency)} without asking you, and buyers will never see that number. `
        : `I'll hold out for the asking price. `) +
      `I'll pair you with a buyer as soon as one asks.`;
  }
  return { listing, deal, waiting_buyers: waiting, say };
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

/** Post a buy request. Pair it with the best seller right away, or keep it waiting for one. */
export async function createBuyIntent(deps: Deps, input: CreateBuyIntentInput) {
  const { db, ai, cfg } = deps;
  if (!input.need && !input.raw_request) throw new MarketError("Tell me what you need.");

  // Structured fields from the voice agent win; extraction fills the gaps.
  const extracted = input.raw_request ? await ai.extractIntent(input.raw_request) : undefined;
  const need = input.need ?? extracted?.need ?? input.raw_request!;
  const maxPrice = input.max_price ?? extracted?.max_price;
  if (maxPrice == null) throw new MarketError("What's the most you'd pay? I keep that private from sellers.");
  const neededBy = parseDeadline(input.needed_by ?? extracted?.needed_by);

  await sweep(deps);
  await ensureUser(db, input.user_id);
  await checkPostingLimits(deps, input.user_id, "request");
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
      neededBy, input.location ?? extracted?.location ?? null, toVector(embedding),
    ],
  );
  await logEvent(db, "intent_created", input.user_id, id, { need, source: input.source ?? "voice" });

  const paired = await pairIntent(db, rows[0], pairing(cfg), "buyer");
  const intentRow = await getIntent(db, id);
  const alternatives = await findMatchesForIntent(db, intentRow, { limit: ALTERNATIVES, threshold: cfg.matchThreshold });
  const deal = paired ? dealView(await getDealWithParties(db, paired.deal.id), input.user_id) : null;

  return {
    intent: intentView(intentRow, input.user_id),
    deal,
    alternatives: alternatives.map((m) => matchView(m, intentRow, input.user_id)),
    say: deal
      ? buyerOfferLine(deal, "found")
      : `Got it: ${need}, up to ${fmt(maxPrice, intentRow.currency)}. Nothing fits yet, so I'll keep looking and pair you as soon as a seller lists one. Sellers won't see your budget.`,
  };
}

/** Browse other listings for a request (the paired one is held, so it isn't repeated). */
export async function findMatches(deps: Deps, userId: string, intentId: string, limit = 3) {
  const { db, cfg } = deps;
  await sweep(deps);
  const intent = await getOwnIntent(db, userId, intentId);
  const matches = await findMatchesForIntent(db, intent, { limit, threshold: cfg.matchThreshold });
  await logEvent(db, "matches_found", userId, intentId, { count: matches.length, top: matches[0]?.id });
  const best = matches[0];
  return {
    intent_id: intentId,
    matches: matches.map((m) => matchView(m, intent, userId)),
    say: best
      ? `I found ${matches.length} option${matches.length > 1 ? "s" : ""}. The best is ${best.title}, asking ${fmt(num(best.ask_price)!, best.currency)}. Want me to negotiate it?`
      : `No other options right now. I'll keep your request open.`,
  };
}

// ---------- Deal-making ----------

/** The buyer picks a specific listing: negotiate it, replacing any deal the request already holds. */
export async function negotiateDeal(deps: Deps, userId: string, intentId: string, listingId: string) {
  const { db, cfg } = deps;
  await sweep(deps);
  const intent = await getOwnIntent(db, userId, intentId);
  if (intent.status === "fulfilled" || intent.status === "cancelled") throw new MarketError("That request is already closed.");
  if (isExpired(intent)) throw new MarketError("That request's deadline has passed. Want to post a new one?");
  const listing = await getListing(db, listingId);

  const held = await proposedDealOn(db, "buy_intent_id", intentId);
  if (held?.listing_id === listingId) {
    const deal = dealView(await getDealWithParties(db, held.id), userId);
    return { deal, say: buyerOfferLine(deal, "already") };
  }
  if (listing.status !== "active") {
    throw new MarketError(listing.status === "pending" ? "That one is on hold for another buyer right now." : "That item is no longer available.");
  }

  const preview = negotiate({ askPrice: num(listing.ask_price)!, sellerMin: num(listing.min_price)!, buyerMax: num(intent.max_price)! });
  if (!preview.ok) {
    await logEvent(db, "negotiation_failed", userId, listingId, { intent_id: intentId });
    // Deliberately vague: never reveal how far apart the limits are.
    return { deal: null, say: `The seller can't meet your budget on this one. Want to try another option or raise your limit?` };
  }

  // Open the new deal before offering the released item to anyone else, so it
  // can't be handed straight back to this same request.
  if (held) {
    await release(db, held, "replaced");
    await logEvent(db, "deal_switched", userId, held.id, { to_listing: listingId });
  }
  const created = await propose(db, listing, await getIntent(db, intentId), pairing(cfg), "browse");
  if (held) await pairListing(db, await getListing(db, held.listing_id), pairing(cfg), "repair");
  if (!created) {
    await pairIntent(db, await getIntent(db, intentId), pairing(cfg), "repair");
    throw new MarketError("Someone just took that one. Ask me for your deals to see what I found instead.");
  }
  const deal = dealView(await getDealWithParties(db, created.id), userId);
  return { deal, say: buyerOfferLine(deal, "negotiated") };
}

export async function confirmDeal(deps: Deps, userId: string, dealId: string) {
  const { db } = deps;
  await sweep(deps);
  const d = await getDealWithParties(db, dealId);
  const isBuyer = userId === d.buyer_id;
  const isSeller = userId === d.seller_id;
  if (!isBuyer && !isSeller) throw new MarketError("You're not part of this deal.");
  if (d.status !== "proposed") throw new MarketError(closedDealLine(d.status));

  const buyer = d.buyer_confirmed || isBuyer;
  const seller = d.seller_confirmed || isSeller;
  const done = buyer && seller;
  const { rows } = await db.query(
    `UPDATE deals SET buyer_confirmed=$2, seller_confirmed=$3, status=$4, updated_at=now()
     WHERE id=$1 AND status='proposed' RETURNING id`,
    [dealId, buyer, seller, done ? "confirmed" : "proposed"],
  );
  if (!rows[0]) throw new MarketError("That deal just changed. Ask me for your deal status.");
  if (done) {
    await db.query(`UPDATE listings SET status='sold' WHERE id=$1`, [d.listing_id]);
    await db.query(`UPDATE buy_intents SET status='fulfilled' WHERE id=$1`, [d.buy_intent_id]);
  }
  await logEvent(db, done ? "deal_confirmed" : "deal_half_confirmed", userId, dealId, { by: isBuyer ? "buyer" : "seller" });
  const deal = dealView(await getDealWithParties(db, dealId), userId);
  return {
    deal,
    say: done
      ? `Done! ${deal.title} for ${fmt(deal.price, deal.currency)} with ${deal.counterpart}.` +
        (deal.meetup.place ? ` Meet-up: ${deal.meetup.place}${deal.meetup.availability ? `, ${deal.meetup.availability}` : ""}.` : "")
      : `Confirmed on your side. I'll let you know when the ${isBuyer ? "seller" : "buyer"} says yes.`,
  };
}

/** Say no to a deal. Both posts go back on the market and get re-paired with their next-best match. */
export async function declineDeal(deps: Deps, userId: string, dealId: string) {
  const { db, cfg } = deps;
  await sweep(deps);
  const d = await getDealWithParties(db, dealId);
  const isBuyer = userId === d.buyer_id;
  if (!isBuyer && userId !== d.seller_id) throw new MarketError("You're not part of this deal.");
  if (d.status !== "proposed" || !(await release(db, d, "declined"))) throw new MarketError(closedDealLine(d.status));
  await logEvent(db, "deal_declined", userId, dealId, { by: isBuyer ? "buyer" : "seller" });

  const { intentNext, listingNext } = await repairAfter(db, d, pairing(cfg));
  const own = isBuyer ? intentNext : listingNext;
  const next = own ? dealView(await getDealWithParties(db, own.deal.id), userId) : null;

  let say: string;
  if (isBuyer) {
    say = next ? `No problem, I've cancelled that. ${buyerOfferLine(next, "next")}` : `No problem, I've cancelled that. I'll keep looking for you.`;
  } else {
    say = next
      ? `Cancelled. Another buyer was waiting: I agreed ${fmt(next.price, next.currency)}, inside your limit` +
        (next.seller_confirmed ? `, and asked them to confirm.` : `. Should I accept this one?`)
      : `Cancelled. Your listing is back up, and I'll pair it with the next buyer who asks.`;
  }
  return { deal_id: dealId, status: "declined" as const, next_deal: next, say };
}

/** The user's deals, the ones waiting for their yes first. */
export async function getDealStatus(deps: Deps, userId: string, dealId?: string) {
  const { db } = deps;
  await sweep(deps);
  const { rows } = await db.query<DealWithParties>(
    `${DEAL_WITH_PARTIES} WHERE (l.seller_id = $1 OR i.buyer_id = $1) AND ($2::text IS NULL OR d.id = $2)
     ORDER BY d.created_at DESC LIMIT 10`,
    [userId, dealId ?? null],
  );
  if (dealId && !rows[0]) throw new MarketError("I can't find that deal.");
  const deals = rows.map((r) => dealView(r, userId)).sort((a, b) => Number(b.waiting_for_you) - Number(a.waiting_for_you));
  const waiting = deals.filter((d) => d.waiting_for_you).length;
  return {
    deals,
    waiting_for_you: waiting,
    say: deals.length
      ? (waiting ? `${countWord(waiting)} deal${waiting > 1 ? "s are" : " is"} waiting for your yes. ` : "") +
        deals.slice(0, 3).map(statusLine).join(" ")
      : "You don't have any deals yet.",
  };
}

// ---------- Managing posts ----------

/** The user's own listings and requests, newest first. */
export async function listMyPosts(deps: Deps, userId: string) {
  const { db } = deps;
  await sweep(deps);
  const [listings, requests] = await Promise.all([
    db.query<ListingRow>(`SELECT * FROM listings WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 20`, [userId]),
    db.query<BuyIntentRow>(`SELECT * FROM buy_intents WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 20`, [userId]),
  ]);
  const live = listings.rows.filter((l) => l.status === "active" || l.status === "pending");
  const open = requests.rows.filter((i) => i.status === "open" || i.status === "matched");
  const parts = [
    live.length ? `${countWord(live.length).toLowerCase()} item${live.length > 1 ? "s" : ""} for sale: ${live.slice(0, 3).map((l) => l.title).join(", ")}` : "",
    open.length ? `${countWord(open.length).toLowerCase()} open request${open.length > 1 ? "s" : ""}: ${open.slice(0, 3).map((i) => i.need).join(", ")}` : "",
  ].filter(Boolean);
  return {
    listings: listings.rows.map((l) => listingView(l, userId)),
    requests: requests.rows.map((i) => intentView(i, userId)),
    say: parts.length ? `You have ${parts.join("; and ")}.` : "You don't have anything listed or requested right now.",
  };
}

/** Take down a listing or cancel a request. A deal it held is released and the other side re-paired. */
export async function withdrawPost(deps: Deps, userId: string, postId: string) {
  const { db, cfg } = deps;
  await sweep(deps);
  if (postId.startsWith("lst_")) {
    const l = await getListing(db, postId);
    if (l.seller_id !== userId) throw new MarketError("That listing belongs to someone else.");
    if (l.status === "sold") throw new MarketError("That item is already sold.");
    if (l.status === "withdrawn") throw new MarketError("That listing is already down.");
    const held = await proposedDealOn(db, "listing_id", postId);
    if (held) await release(db, held, "withdrawn", { listing: "withdrawn" });
    await db.query(`UPDATE listings SET status = 'withdrawn' WHERE id = $1 AND status IN ('active', 'pending')`, [postId]);
    await logEvent(db, "listing_withdrawn", userId, postId, { released_deal: held?.id ?? null });
    if (held) await repairAfter(db, held, pairing(cfg));
    return {
      post_id: postId,
      kind: "listing" as const,
      status: "withdrawn" as const,
      released_deal_id: held?.id ?? null,
      say: `I've taken down ${l.title}.` + (held ? ` The buyer it was on hold for goes back to their other options.` : ""),
    };
  }
  if (postId.startsWith("int_")) {
    const i = await getOwnIntent(db, userId, postId);
    if (i.status === "fulfilled") throw new MarketError("That request is already fulfilled.");
    if (i.status === "cancelled") throw new MarketError("That request is already cancelled.");
    const held = await proposedDealOn(db, "buy_intent_id", postId);
    if (held) await release(db, held, "withdrawn", { intent: "cancelled" });
    await db.query(`UPDATE buy_intents SET status = 'cancelled' WHERE id = $1 AND status IN ('open', 'matched')`, [postId]);
    await logEvent(db, "intent_cancelled", userId, postId, { released_deal: held?.id ?? null });
    if (held) await repairAfter(db, held, pairing(cfg));
    return {
      post_id: postId,
      kind: "request" as const,
      status: "cancelled" as const,
      released_deal_id: held?.id ?? null,
      say: `I've cancelled your request for ${i.need}.` + (held ? ` The item goes back to the seller's other buyers.` : ""),
    };
  }
  throw new MarketError("I can't find that post.");
}

// ---------- Dashboard ----------

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
  SELECT d.*, l.title, l.condition, l.ask_price, l.availability, l.seller_id, i.buyer_id,
         su.display_name AS seller_name, bu.display_name AS buyer_name
  FROM deals d
  JOIN listings l    ON l.id = d.listing_id
  JOIN buy_intents i ON i.id = d.buy_intent_id
  JOIN users su      ON su.id = l.seller_id
  JOIN users bu      ON bu.id = i.buyer_id`;

function matchView(m: ListingRow & { score: number }, intent: BuyIntentRow, viewerId: string) {
  return {
    ...listingView(m, viewerId),
    within_budget_at_ask: num(m.ask_price)! <= num(intent.max_price)!,
    score: +m.score.toFixed(3),
  };
}

function buyerOfferLine(deal: DealView, mode: "found" | "negotiated" | "next" | "already") {
  const price = fmt(deal.price, deal.currency);
  const lead = {
    found: `Found it: ${deal.title} for ${price}`,
    negotiated: `Got it: ${deal.title} for ${price}`,
    next: `Next best: ${deal.title} for ${price}`,
    already: `That one's already on hold for you: ${deal.title} for ${price}`,
  }[mode];
  const saved = deal.saved_vs_ask > 0 ? `, ${fmt(deal.saved_vs_ask, deal.currency)} below asking` : "";
  const place = deal.meetup.place ? ` Meet-up: ${deal.meetup.place}.` : "";
  const ask = deal.seller_confirmed ? " Should I confirm it?" : " Should I confirm? The seller gives the final yes.";
  return `${lead}${saved}.${place}${ask}`;
}

function statusLine(d: DealView) {
  const what = `${d.title}, ${fmt(d.price, d.currency)}`;
  switch (d.status) {
    case "confirmed": return `${what}: confirmed with ${d.counterpart}${d.meetup.place ? `, meet-up at ${d.meetup.place}` : ""}.`;
    case "proposed": return d.waiting_for_you ? `${what}: waiting for your yes.` : `${what}: waiting for the ${d.waiting_for.join(" and ")}.`;
    case "expired": return `${what}: expired without an answer.`;
    case "withdrawn": return `${what}: taken off the market.`;
    case "replaced": return `${what}: replaced by another option.`;
    default: return `${what}: cancelled.`;
  }
}

function closedDealLine(status: string) {
  return {
    confirmed: "That deal is already confirmed.",
    declined: "That deal was already cancelled.",
    replaced: "That offer was replaced by another option.",
    expired: "That offer expired. Want me to look again?",
    withdrawn: "That item or request was taken down.",
  }[status] ?? `That deal is ${status}.`;
}

const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);

function parseDeadline(value: string | undefined) {
  if (!value) return null;
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) throw new MarketError("I couldn't understand that deadline.");
  if (t <= new Date()) throw new MarketError("That deadline has already passed.");
  return t.toISOString();
}

async function proposedDealOn(db: Db, column: "listing_id" | "buy_intent_id", id: string) {
  const { rows } = await db.query<DealRow>(`SELECT * FROM deals WHERE ${column} = $1 AND status = 'proposed'`, [id]);
  return rows[0] ?? null;
}

async function getDealWithParties(db: Db, id: string) {
  const { rows } = await db.query<DealWithParties>(`${DEAL_WITH_PARTIES} WHERE d.id = $1`, [id]);
  if (!rows[0]) throw new MarketError("I can't find that deal.");
  return rows[0];
}

async function getIntent(db: Db, id: string) {
  const { rows } = await db.query<BuyIntentRow>(`SELECT * FROM buy_intents WHERE id = $1`, [id]);
  if (!rows[0]) throw new MarketError("I can't find that request.");
  return rows[0];
}

async function getOwnIntent(db: Db, userId: string, id: string) {
  const intent = await getIntent(db, id);
  if (intent.buyer_id !== userId) throw new MarketError("That request belongs to someone else.");
  return intent;
}

async function getListing(db: Db, id: string) {
  const { rows } = await db.query<ListingRow>(`SELECT * FROM listings WHERE id = $1`, [id]);
  if (!rows[0]) throw new MarketError("I can't find that listing.");
  return rows[0];
}

function fmt(amount: number, currency: string) {
  const sym = currency === "USD" ? "$" : currency === "HKD" ? "HK$" : `${currency} `;
  return `${sym}${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}
