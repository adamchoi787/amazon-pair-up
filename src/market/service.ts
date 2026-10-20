import type { Ai, Condition } from "../ai/index.js";
import { mockExtractIntent } from "../ai/mock.js";
import { toVector, type Db } from "../db/client.js";
import { logEvent, shortId } from "./events.js";
import { findIntentsForListing, findMatchesForIntent } from "./matching.js";
import {
  expireHolds, isExpired, pairIntent, pairListing, propose, recordFailedOffer, release, repairAfter, settlePair, type PairingSettings,
} from "./pairing.js";
import { learningReport } from "./learning.js";
import { DEFAULT_POLICY, keywordHit, meaningHit, type PolicyHit, type PolicySettings } from "./policy.js";
import { DEFAULT_PRICE_POLICY, priceBand, verdict, type PriceBand, type PricePolicy } from "./pricing.js";
import {
  decideReview, DEFAULT_REPORT_THRESHOLD, reviewIfReported, reviewQueue, reviewStatus, type ReportReason, type ReviewDecision,
} from "./trust.js";
import { num, type BuyIntentRow, type DealRow, type Kind, type ListingRow, type PriceUnit, type RequestSource, type ServiceUnit } from "./types.js";
import { tradeInCategory, type Handoff } from "./amazon.js";
import type { RingSettings } from "./points.js";
import { checkSchedule, DEFAULT_TIME_ZONE, hasBookingConflict, itemDeadline, providerBookings, resolveServiceTime, validTimeZone } from "./scheduling.js";
import { dealView, fallbackView, offerView, ratingView, reportView, requestView, tradeInView, type DealView, type DealWithParties } from "./views.js";

// Business operations. MCP tools (src/mcp/server.ts) are thin wrappers around
// these, so the web app and the tests call the same functions.
//
// One market for things and for services. An offer is an item to sell or a
// service someone can do (lunch runs, event help); a request is an item someone
// wants or a task they need done. Both kinds go through the same pairing,
// private-limit settlement and two-sided confirmation.

/** Marketplace policy. Only the threshold is required; the rest have production defaults. */
export interface MarketSettings {
  matchThreshold: number;
  dealHoldHours?: number;
  postsPerHour?: number;
  maxOpenRequests?: number;
  /** When a price is far enough from the typical range to ask "did you mean…?". */
  pricePolicy?: Partial<PricePolicy>;
  /** How close in meaning a post must be to a prohibited example to be refused (src/market/policy.ts). */
  policy?: Partial<PolicySettings>;
  /** Different people whose reports put someone under review (src/market/trust.ts). */
  reportThreshold?: number;
  /** Ring at PairUp Points (src/market/points.ts). */
  ring?: RingSettings;
}

export interface Deps {
  db: Db;
  ai: Ai;
  cfg: MarketSettings;
}

/**
 * An error the user can act on. `message` is spoken as is; `code` and `data`
 * let an agent act on it too (code "confirm_price": ask, then call again with
 * confirm_price: true or with the price the user meant).
 */
export class MarketError extends Error {
  constructor(message: string, readonly code?: string, readonly data?: Record<string, unknown>) {
    super(message);
  }
}

const ALTERNATIVES = 4;
/** Relevant offers a new request is checked against when it can't afford them. */
const OUT_OF_REACH = 50;

const pairing = (cfg: MarketSettings): PairingSettings => ({
  threshold: cfg.matchThreshold,
  holdHours: cfg.dealHoldHours ?? 24,
});

const pricePolicy = (cfg: MarketSettings): PricePolicy => ({ ...DEFAULT_PRICE_POLICY, ...cfg.pricePolicy });

/** Expire unanswered holds before acting, so every answer reflects the live market. */
const sweep = (deps: Deps) => expireHolds(deps.db, pairing(deps.cfg));

export async function ensureUser(db: Db, userId: string, displayName?: string) {
  await db.query(
    `INSERT INTO users (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [userId, displayName ?? userId],
  );
}

/**
 * Per-user posting limits against floods. Refused posts count too, so rewording
 * a blocked post again and again runs out. Budget probing is stopped by the
 * one-offer rule (failed_offers).
 */
async function checkPostingLimits(deps: Deps, userId: string, kind: "offer" | "request") {
  const { db, cfg } = deps;
  const { rows } = await db.query<{ recent: number; open_requests: number }>(
    `SELECT
       (SELECT count(*) FROM listings    WHERE seller_id = $1 AND created_at > now() - interval '1 hour')
     + (SELECT count(*) FROM buy_intents WHERE buyer_id  = $1 AND created_at > now() - interval '1 hour')
     + (SELECT count(*) FROM events WHERE actor_id = $1 AND kind = 'post_blocked' AND created_at > now() - interval '1 hour') AS recent,
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

/** Posting and pairing need an account in good standing (src/market/trust.ts). */
async function assertActive(db: Db, userId: string) {
  const status = await reviewStatus(db, userId);
  if (status === "under_review") {
    throw new MarketError(
      "Your account is being reviewed after reports from other people, so I can't post or pair for you until that's done.",
      "account_under_review",
    );
  }
  if (status === "suspended") throw new MarketError("Your account is suspended, so I can't post or pair for you.", "account_suspended");
}

/**
 * Refuse a post the marketplace policy doesn't allow (data/policy.json), before
 * anything is stored: by keyword, then by meaning.
 */
async function screen(deps: Deps, userId: string, as: "offer" | "request", text: string, embedding: number[]) {
  const hit = keywordHit(text) ?? (await meaningHit(deps, embedding, { ...DEFAULT_POLICY, ...deps.cfg.policy }));
  if (!hit) return;
  await logEvent(deps.db, "post_blocked", userId, null, { as, category: hit.category, matched_by: hit.matched_by, text: text.slice(0, 200) });
  throw policyError(hit);
}

function policyError(hit: PolicyHit) {
  const what = hit.label.charAt(0).toLowerCase() + hit.label.slice(1);
  return new MarketError(
    hit.severity === "prohibited"
      ? `I can't post that. PairUp doesn't allow ${what}.`
      : `I can't post that. PairUp doesn't allow ${what}, since ${hit.why}.`,
    hit.severity === "prohibited" ? "prohibited_item" : "restricted_item",
    { category: hit.category, label: hit.label, severity: hit.severity, matched_by: hit.matched_by },
  );
}

/** Items are priced each; a service is priced per job unless it says per hour. */
const unitFor = (kind: Kind, unit?: ServiceUnit): PriceUnit => (kind === "service" ? unit ?? "job" : "each");

// ---------- Offer side ----------

export interface PostOfferInput {
  user_id: string;
  kind?: Kind;
  price_unit?: ServiceUnit;
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
  time_zone?: string;
  /** The user confirmed a price the price check questioned. */
  confirm_price?: boolean;
}

/**
 * Offer an item or a service. If someone is already waiting for it, pair them
 * and open a deal. A service offer is a standing offer: it reopens after each
 * booked job, and by default the provider says yes to each job.
 */
export async function postOffer(deps: Deps, input: PostOfferInput) {
  const { db, ai, cfg } = deps;
  const kind = input.kind ?? "item";
  const unit = unitFor(kind, input.price_unit);
  const timeZone = input.time_zone ?? DEFAULT_TIME_ZONE;
  if (!validTimeZone(timeZone)) throw new MarketError("Use a valid IANA time zone, such as America/Los_Angeles.", "invalid_schedule");
  const minPrice = input.min_price ?? input.ask_price;
  if (minPrice > input.ask_price) throw new MarketError("Your minimum can't be above the asking price.");
  await sweep(deps);
  await ensureUser(db, input.user_id);
  await assertActive(db, input.user_id);
  await checkPostingLimits(deps, input.user_id, "offer");

  const id = shortId("ofr");
  const embedding = await ai.embed(
    [input.title, input.description, input.category, kind === "item" ? input.condition : undefined].filter(Boolean).join(". "),
  );
  await screen(deps, input.user_id, "offer", [input.title, input.description, input.category].filter(Boolean).join(". "), embedding);
  const currency = input.currency ?? "USD";
  const band = await priceBand(deps, { kind, unit, embedding, condition: input.condition ?? "good", posterId: input.user_id });
  const flag = band && checkPrices(band, pricePolicy(cfg), kind, unit, currency, input.confirm_price, [
    ["ask_price", input.ask_price],
    ...(input.min_price != null ? [["min_price", minPrice] as const] : []),
  ]);
  const { rows } = await db.query<ListingRow>(
    `INSERT INTO listings (id, seller_id, kind, price_unit, title, description, category, condition, quantity, currency,
                           ask_price, min_price, auto_accept, location, availability, embedding,
                           ref_low, ref_high, ref_source, price_flag, time_zone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::vector,$17,$18,$19,$20,$21) RETURNING *`,
    [
      id, input.user_id, kind, unit, input.title, input.description ?? "", input.category ?? null,
      input.condition ?? "good", kind === "item" ? input.quantity ?? 1 : 1, currency,
      input.ask_price, minPrice, input.auto_accept ?? kind === "item", input.location ?? null,
      input.availability ?? null, toVector(embedding), band?.low ?? null, band?.high ?? null, band?.source ?? null, flag ?? null, timeZone,
    ],
  );
  const waiting = (await findIntentsForListing(db, id, { limit: 5, threshold: cfg.matchThreshold })).length;
  await logEvent(db, "listing_created", input.user_id, id, {
    title: input.title, kind, unit, ask: input.ask_price, waiting_requests: waiting,
    typical: band && { low: band.low, high: band.high, source: band.source }, price_flag: flag ?? null,
  });

  const paired = await pairListing(db, rows[0], pairing(cfg), "seller");
  const offer = offerView(await getListing(db, id), input.user_id);
  const deal = paired ? dealView(await getDealWithParties(db, paired.deal.id), input.user_id) : null;
  const ask = rate(input.ask_price, unit, offer.currency);
  const posted = kind === "item" ? `Listed ${input.title} for ${ask}.` : `You're on the market: ${input.title}, ${ask}.`;
  // Nobody asking yet for something Amazon Trade-In takes: say it's an option.
  const tradeInFit = kind === "item" && !deal && waiting === 0 ? tradeInCategory(input) : null;
  const trade_in = tradeInFit && tradeInView(tradeInFit);

  let say: string;
  if (deal) {
    const others = waiting - 1;
    const more = others > 0 ? ` ${countWord(others)} more ${others === 1 ? "person is" : "people are"} looking too.` : "";
    say = kind === "item"
      ? `${posted} A buyer was already looking for one: ${agreedLine(deal)}. I've ` +
        (deal.seller_confirmed ? `asked them to confirm.` : `left it for you: should I accept?`) + more
      : `${posted} ${providerJobLine(deal)}` + more;
  } else {
    say = `${posted} ` +
      (input.min_price != null && minPrice < input.ask_price
        ? `I'll accept down to ${rate(minPrice, unit, offer.currency)}${offer.auto_accept ? " without asking you" : ""}, and nobody will see that number. `
        : `I'll hold out for your price. `) +
      (kind === "item" ? `I'll pair you with a buyer as soon as one asks.` : `I'll bring you jobs as people ask.`) +
      (trade_in ? ` ${trade_in.say}` : "");
  }
  return { offer, deal, waiting_requests: waiting, trade_in, say };
}

// ---------- Request side ----------

export interface PostRequestInput {
  user_id: string;
  kind?: Kind;
  price_unit?: ServiceUnit;
  need?: string;
  raw_request?: string;
  max_price?: number;
  min_condition?: Condition;
  quantity?: number;
  hours?: number;
  pickup?: string;
  schedule?: string;
  starts_at?: string;
  ends_at?: string;
  time_zone?: string;
  currency?: string;
  needed_by?: string;
  location?: string;
  source?: RequestSource;
  /** Items: meet up at a Hub point (default), or Amazon Hub delivery. */
  handoff?: Handoff;
  /** The user confirmed a budget the price check questioned. */
  confirm_price?: boolean;
}

/** Item requests that ask for it to come to them: "ship it", "delivered to my locker". */
const WANTS_DELIVERY = /\b(deliver(ed|y)?|ship(ped|ping)?|mail(ed)?|send it|to my (locker|place|door))\b/i;

/** Ask for an item or a task. Pair it with the best offer right away, or keep it waiting for one. */
export async function postRequest(deps: Deps, input: PostRequestInput) {
  const { db, ai, cfg } = deps;
  if (!input.need && !input.raw_request) throw new MarketError("Tell me what you need.");

  // Structured fields from the voice agent win; extraction fills the gaps.
  const extracted = input.raw_request
    ? input.need && input.kind && input.max_price != null
      ? mockExtractIntent(input.raw_request)
      : await ai.extractIntent(input.raw_request)
    : undefined;
  const kind = input.kind ?? extracted?.kind ?? "item";
  const unit = unitFor(kind, input.price_unit ?? extracted?.price_unit);
  const need = input.need ?? extracted?.need ?? input.raw_request!;
  const category = extracted?.category ?? null;

  // What is asked for is checked first, before the budget is even asked for.
  await sweep(deps);
  await ensureUser(db, input.user_id);
  await assertActive(db, input.user_id);
  const embedding = await ai.embed([need, category].filter(Boolean).join(". "));
  await screen(deps, input.user_id, "request", [need, input.raw_request, category].filter(Boolean).join(". "), embedding);

  const maxPrice = input.max_price ?? extracted?.max_price;
  if (maxPrice == null) {
    throw new MarketError(
      `What's the most you'd pay${unit === "hour" ? " per hour" : ""}? I keep that private from ${kind === "item" ? "sellers" : "helpers"}.`,
    );
  }
  const service = kind === "service";
  const timeZone = input.time_zone ?? DEFAULT_TIME_ZONE;
  if (!validTimeZone(timeZone)) throw new MarketError("Use a valid IANA time zone, such as America/Los_Angeles.", "invalid_schedule");
  const schedule = service ? input.schedule ?? extracted?.schedule ?? null : null;
  let work;
  let itemDue: string | null = null;
  try {
    work = service ? resolveServiceTime({
      schedule, needed_by: input.needed_by ?? (schedule ? undefined : extracted?.needed_by),
      starts_at: input.starts_at, ends_at: input.ends_at, hours: input.hours ?? extracted?.hours, time_zone: timeZone,
    }) : null;
  } catch (error) { throw new MarketError((error as Error).message, "invalid_schedule"); }
  if (!service && input.raw_request && !input.needed_by) itemDue = itemDeadline(input.raw_request, timeZone);
  const neededBy = parseDeadline(work?.deadline ?? input.needed_by ?? itemDue ?? extracted?.needed_by);

  await checkPostingLimits(deps, input.user_id, "request");
  const id = shortId("req");
  const currency = input.currency ?? "USD";
  // A budget is checked against the range for a new one: only a budget far
  // above what anything like it costs is questioned.
  const band = await priceBand(deps, { kind, unit, embedding, condition: "new", posterId: input.user_id });
  const policy = pricePolicy(cfg);
  const flag = band && checkPrices(band, policy, kind, unit, currency, input.confirm_price, [["max_price", maxPrice]]);
  const { rows } = await db.query<BuyIntentRow>(
    `INSERT INTO buy_intents (id, buyer_id, kind, price_unit, need, raw_request, source, category, min_condition, quantity,
                              hours, pickup, schedule, currency, max_price, needed_by, location, embedding, price_flag,
                              time_zone, service_start, service_end, handoff)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::vector,$19,$20,$21,$22,$23) RETURNING *`,
    [
      id, input.user_id, kind, unit, need, input.raw_request ?? null, input.source ?? "voice", category,
      service ? "for_parts" : input.min_condition ?? extracted?.min_condition ?? "for_parts",
      service ? 1 : input.quantity ?? extracted?.quantity ?? 1,
      unit === "hour" ? work?.hours ?? input.hours ?? extracted?.hours ?? null : null,
      service ? input.pickup ?? extracted?.pickup ?? null : null,
      schedule,
      currency, maxPrice, neededBy, input.location ?? extracted?.location ?? null, toVector(embedding), flag ?? null,
      timeZone, work?.start ?? null, work?.end ?? null,
      service ? "meetup" : input.handoff ?? (input.raw_request && WANTS_DELIVERY.test(input.raw_request) ? "delivery" : "meetup"),
    ],
  );
  await logEvent(db, "intent_created", input.user_id, id, { need, kind, unit, source: input.source ?? "voice" });

  const paired = await pairIntent(db, rows[0], pairing(cfg), "buyer");
  const intentRow = await getIntent(db, id);
  const alternatives = await findMatchesForIntent(db, intentRow, { limit: ALTERNATIVES, threshold: cfg.matchThreshold });
  // This budget is the buyer's one offer below the ask for every relevant offer
  // it can't close with; from now on they get those at the asking price.
  const outOfReach = await findMatchesForIntent(db, intentRow, { limit: OUT_OF_REACH, threshold: cfg.matchThreshold, priceBlocked: true });
  for (const m of outOfReach) await recordFailedOffer(db, m.id, input.user_id, maxPrice);
  const closest = outOfReach[0];
  const deal = paired ? dealView(await getDealWithParties(db, paired.deal.id), input.user_id) : null;
  const budget = rate(maxPrice, unit, intentRow.currency);
  // A budget far below the usual range rarely finds anyone: say so, so the user can decide.
  const lowBudget = !deal && band && verdict(maxPrice, band, policy) === "far_below"
    ? ` Heads up: ${service ? "jobs like this usually pay" : "these usually go for"} ${range(band, unit, intentRow.currency)}, so it may take a while.`
    : "";
  // An item nobody nearby can sell yet: the same thing new on Amazon, while the request keeps waiting.
  const fallback = !deal && !service
    ? fallbackView(need, closest ? "over_budget" : "no_seller", band?.source === "reference" ? band.newPrice ?? null : null)
    : null;
  const amazonLine = fallback?.new_price != null ? ` If you can't wait, it's about ${fmt(fallback.new_price, "USD")} new on Amazon (demo estimate).` : "";

  return {
    request: requestView(intentRow, input.user_id),
    deal,
    // With nothing in reach, the closest offers at their asking price, the one named in `say` first.
    alternatives: (deal ? alternatives : [...outOfReach, ...alternatives].slice(0, ALTERNATIVES)).map((m) => matchView(m, intentRow, input.user_id)),
    fallback,
    say: deal
      ? buyerOfferLine(deal, "found")
      : closest
        ? `Got it: ${need}, up to ${budget}. ${closest.title} ${service ? "charges" : "is asking"} ${rate(num(closest.ask_price)!, closest.price_unit, closest.currency)}, ` +
          `and ${service ? "they" : "the seller"} can't go as low as your budget. Want ${service ? "them at that rate" : "it at that price"}? Otherwise I'll keep looking.`
      : service
        ? `Got it: ${need}, up to ${budget}. Nobody's free for it yet, so I'll keep asking and pair you as soon as someone offers. Helpers won't see your budget.${lowBudget}`
        : `Got it: ${need}, up to ${budget}. Nothing fits yet, so I'll keep looking and pair you as soon as a seller lists one. Sellers won't see your budget.${lowBudget}${amazonLine}`,
  };
}

/** Browse other offers for a request (the paired one is held, so it isn't repeated). */
export async function findMatches(deps: Deps, userId: string, requestId: string, limit = 3) {
  const { db, cfg } = deps;
  await sweep(deps);
  const intent = await getOwnIntent(db, userId, requestId);
  const matches = await findMatchesForIntent(db, intent, { limit, threshold: cfg.matchThreshold });
  await logEvent(db, "matches_found", userId, requestId, { count: matches.length, top: matches[0]?.id });
  const best = matches[0];
  return {
    request_id: requestId,
    matches: matches.map((m) => matchView(m, intent, userId)),
    say: best
      ? `I found ${matches.length} option${matches.length > 1 ? "s" : ""}. The best is ${best.title}, asking ${rate(num(best.ask_price)!, best.price_unit, best.currency)}. Want me to get it for you?`
      : `No other options right now. I'll keep your request open.`,
  };
}

// ---------- Deal-making ----------

/**
 * The buyer picks a specific offer: settle it, replacing any deal the request
 * already holds. `maxPrice` raises the request's budget first ("Want it at that
 * price?" "Yes.").
 */
export async function negotiateDeal(deps: Deps, userId: string, requestId: string, offerId: string, maxPrice?: number) {
  const { db, cfg } = deps;
  await sweep(deps);
  await assertActive(db, userId);
  let intent = await getOwnIntent(db, userId, requestId);
  if (intent.status === "fulfilled" || intent.status === "cancelled") throw new MarketError("That request is already closed.");
  if (isExpired(intent)) throw new MarketError("That request's deadline has passed. Want to post a new one?");
  const listing = await getListing(db, offerId);
  if (listing.kind !== intent.kind || listing.price_unit !== intent.price_unit) {
    throw new MarketError(listing.kind === intent.kind ? "That one is priced differently. Want to pick another option?" : "That offer doesn't fit this request.");
  }

  const held = await proposedDealOn(db, "buy_intent_id", requestId);
  if (held?.listing_id === offerId) {
    const deal = dealView(await getDealWithParties(db, held.id), userId);
    return { deal, say: buyerOfferLine(deal, "already") };
  }
  if (listing.status !== "active") {
    throw new MarketError(listing.status === "pending" ? "That one is on hold for someone else right now." : "That offer is no longer available.");
  }
  if (checkSchedule(listing, intent).status === "conflict") {
    throw new MarketError("That helper isn't available for your requested time. Ask for other options.", "schedule_conflict");
  }
  // A direct tool call must pass the same non-price constraints as discovery.
  const eligible = await findMatchesForIntent(db, intent, { limit: 1, threshold: cfg.matchThreshold, offerId, ignorePrice: true });
  if (!eligible.length) throw new MarketError("That offer doesn't fit this request or is no longer available. Ask for other options.", "offer_unavailable");
  if (maxPrice != null && maxPrice !== num(intent.max_price)) {
    if (maxPrice < num(intent.max_price)!) throw new MarketError("A request's budget can only go up. For a lower one, post a new request.");
    await db.query(`UPDATE buy_intents SET max_price = $2 WHERE id = $1`, [requestId, maxPrice]);
    intent = await getIntent(db, requestId);
  }

  const preview = await settlePair(db, listing, intent);
  if (!preview.ok) {
    // A failure means the budget was below the ask. That was this buyer's one
    // offer below it, so the public asking price is all that's left to say.
    await recordFailedOffer(db, offerId, userId, num(intent.max_price)!);
    await logEvent(db, "negotiation_failed", userId, offerId, { intent_id: requestId });
    const ask = rate(num(listing.ask_price)!, listing.price_unit, listing.currency);
    return {
      deal: null,
      say: listing.kind === "item"
        ? `The seller can't go that low. It's ${ask}. Want it at that price?`
        : `They can't go that low. They charge ${ask}. Want them at that rate?`,
    };
  }

  // Open the new deal before offering the released post to anyone else, so it
  // can't be handed straight back to this same request.
  if (held) {
    await release(db, held, "replaced");
    await logEvent(db, "deal_switched", userId, held.id, { to_listing: offerId });
  }
  const created = await propose(db, listing, await getIntent(db, requestId), pairing(cfg), "browse");
  if (held) await pairListing(db, await getListing(db, held.listing_id), pairing(cfg), "repair");
  if (!created) {
    await pairIntent(db, await getIntent(db, requestId), pairing(cfg), "repair");
    throw new MarketError("Someone just took that one. Ask me for your deals to see what I found instead.");
  }
  const deal = dealView(await getDealWithParties(db, created.id), userId);
  return { deal, say: buyerOfferLine(deal, "negotiated") };
}

export async function confirmDeal(deps: Deps, userId: string, dealId: string) {
  const { db, cfg } = deps;
  await sweep(deps);
  const initial = await getDealWithParties(db, dealId);
  if (![initial.buyer_id, initial.seller_id].includes(userId)) throw new MarketError("You're not part of this deal.");
  const result = await db.transaction(async tx => {
    await tx.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [initial.seller_id]);
    await tx.query(`SELECT id FROM deals WHERE id = $1 FOR UPDATE`, [dealId]);
    const d = await getDealWithParties(tx, dealId);
    const isBuyer = userId === d.buyer_id;
    const isSeller = userId === d.seller_id;
    if (d.status !== "proposed") throw new MarketError(closedDealLine(d.status));
    if (d.expires_at && new Date(d.expires_at) <= new Date()) throw new MarketError("That offer has expired. Ask for your deals to see the latest options.");
    await assertActive(tx, userId);
    if (d.kind === "service") {
      const listing = await getListing(tx, d.listing_id);
      const intent = await getIntent(tx, d.buy_intent_id);
      if (checkSchedule(listing, intent).status === "conflict" || hasBookingConflict(intent, await providerBookings(tx, [d.seller_id]))) {
        throw new MarketError("That helper isn't available for this time. Decline this offer and ask for other options.", "schedule_conflict");
      }
    }

    const buyer = d.buyer_confirmed || isBuyer;
    const seller = dealView(d, userId).seller_confirmed || isSeller;
    const done = buyer && seller;
    const { rows } = await tx.query(
      `UPDATE deals SET buyer_confirmed=$2, seller_confirmed=$3, status=$4, updated_at=now()
       WHERE id=$1 AND status='proposed' RETURNING id`,
      [dealId, buyer, seller, done ? "confirmed" : "proposed"],
    );
    if (!rows[0]) throw new MarketError("That deal just changed. Ask me for your deal status.");
    if (done) {
      // An item is sold once; a service offer stands and takes the next job.
      await tx.query(`UPDATE listings SET status=$2 WHERE id=$1`, [d.listing_id, d.kind === "item" ? "sold" : "active"]);
      await tx.query(`UPDATE buy_intents SET status='fulfilled' WHERE id=$1`, [d.buy_intent_id]);
      // Amazon Hub delivery: book the shipment (a demo reference until the Amazon Shipping API is connected).
      if (d.kind === "item" && d.handoff === "delivery") {
        await tx.query(`UPDATE deals SET delivery_ref=$2 WHERE id=$1`, [dealId, `DEMO-${dealId.replace(/^deal_/, "").toUpperCase()}`]);
      }
    }
    await logEvent(tx, done ? "deal_confirmed" : "deal_half_confirmed", userId, dealId, { by: isBuyer ? "buyer" : "seller" });
    const deal = dealView(await getDealWithParties(tx, dealId), userId);
    const other = isBuyer ? (d.kind === "item" ? "seller" : deal.counterpart ?? "they") : (d.kind === "item" ? "buyer" : deal.counterpart ?? "they");
    return {
      deal,
      say: done
        ? doneLine(deal)
        : `Confirmed on your side. I'll let you know when ${d.kind === "item" ? `the ${other}` : other} says yes.`,
    };
  });
  if (result.deal.status === "confirmed" && result.deal.kind === "service") await pairListing(db, await getListing(db, initial.listing_id), pairing(cfg), "repair");
  return result;
}

/**
 * The question a host asks the user before confirm_deal records their yes
 * (MCP elicitation), or null when the deal isn't waiting for this user, so
 * confirmDeal gives its usual answer.
 */
export async function confirmQuestion(deps: Deps, userId: string, dealId: string) {
  await sweep(deps);
  const { rows } = await deps.db.query<DealWithParties>(`${DEAL_WITH_PARTIES} WHERE d.id = $1`, [dealId]);
  if (!rows[0] || rows[0].status !== "proposed") return null;
  const deal = dealView(rows[0], userId);
  if (!deal.waiting_for_you) return null;
  const what = deal.kind === "item"
    ? `${deal.your_role === "buyer" ? "Buy" : "Sell"} ${deal.title} for ${dealPrice(deal)}, with ${deal.counterpart}?`
    : deal.your_role === "buyer"
      ? `Book ${deal.counterpart} for ${deal.task ?? deal.title}, ${dealPrice(deal)}?`
      : `Take the job ${deal.task ?? deal.title} for ${deal.counterpart}, ${dealPrice(deal)}?`;
  return `${what}${placeLine(deal)}${deal.your_role === "buyer" ? priceWarning(deal) : ""}`;
}

/**
 * The buyer picks how an item changes hands: a Hub meet-up, or Amazon Hub
 * delivery (the seller drops it at a Hub Counter, the buyer collects it from a
 * Hub Locker, the buyer pays the fee). Switching asks the seller again, since a
 * drop-off is a different errand from a meet-up. The price stays as settled.
 */
export async function chooseHandoff(deps: Deps, userId: string, dealId: string, method: Handoff) {
  const { db } = deps;
  await sweep(deps);
  const d = await getDealWithParties(db, dealId);
  if (userId !== d.buyer_id) throw new MarketError(userId === d.seller_id ? "The buyer chooses meet-up or delivery." : "You're not part of this deal.");
  if (d.kind !== "item") throw new MarketError("Delivery is for items. For a task, the helper comes to you.");
  if (d.status !== "proposed") throw new MarketError(closedDealLine(d.status));
  const before = dealView(d, userId);
  if (method === "delivery" && !before.delivery) {
    throw new MarketError("Amazon Hub delivery isn't available between these two areas yet. You can meet up instead.", "delivery_unavailable");
  }
  if (before.handoff === method) return { deal: before, say: handoffLine(before, "already") };
  await db.query(
    `UPDATE deals SET handoff=$2, seller_confirmed=false, updated_at=now() WHERE id=$1 AND status='proposed'`,
    [dealId, method],
  );
  await logEvent(db, "handoff_chosen", userId, dealId, { method });
  const deal = dealView(await getDealWithParties(db, dealId), userId);
  return { deal, say: handoffLine(deal, "changed") };
}

function handoffLine(deal: DealView, mode: "changed" | "already") {
  const lead = mode === "already" ? "That's already the plan." : deal.handoff === "delivery" ? "Switched to Amazon Hub delivery." : "Switched to a meet-up.";
  const ask = deal.buyer_confirmed ? ` I'll ask the seller to confirm.` : ` Should I confirm? The seller gives the final yes.`;
  return `${lead}${placeLine(deal)} Total ${fmt(deal.total ?? deal.price, deal.currency)}.${mode === "changed" ? ask : ""}`;
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
  } else if (d.kind === "service") {
    say = next ? `Passed on that one. ${providerJobLine(next)}` : `Passed on that one. You're still available, and I'll bring you the next job.`;
  } else {
    say = next
      ? `Cancelled. Another buyer was waiting: ${agreedLine(next)}` +
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
        deals.slice(0, 3).map((d) => capitalize(statusLine(d))).join(" ")
      : "You don't have any deals yet.",
  };
}

// ---------- Managing posts ----------

/** The user's own offers and requests, newest first. */
export async function listMyPosts(deps: Deps, userId: string) {
  const { db } = deps;
  await sweep(deps);
  const [listings, requests] = await Promise.all([
    db.query<ListingRow>(`SELECT * FROM listings WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 20`, [userId]),
    db.query<BuyIntentRow>(`SELECT * FROM buy_intents WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 20`, [userId]),
  ]);
  const live = listings.rows.filter((l) => l.status === "active" || l.status === "pending");
  const items = live.filter((l) => l.kind === "item");
  const services = live.filter((l) => l.kind === "service");
  const open = requests.rows.filter((i) => i.status === "open" || i.status === "matched");
  const some = (rows: { length: number }, one: string, many = `${one}s`) => `${countWord(rows.length).toLowerCase()} ${rows.length > 1 ? many : one}`;
  const parts = [
    items.length ? `${some(items, "item")} for sale: ${items.slice(0, 3).map((l) => l.title).join(", ")}` : "",
    services.length ? `${some(services, "service")} on offer: ${services.slice(0, 3).map((l) => l.title).join(", ")}` : "",
    open.length ? `${some(open, "open request")}: ${open.slice(0, 3).map((i) => i.need).join(", ")}` : "",
  ].filter(Boolean);
  return {
    offers: listings.rows.map((l) => offerView(l, userId)),
    requests: requests.rows.map((i) => requestView(i, userId)),
    say: parts.length ? `You have ${parts.join("; and ")}.` : "You don't have any offers or requests right now.",
  };
}

/** Take down an offer or cancel a request. A deal it held is released and the other side re-paired. */
export async function withdrawPost(deps: Deps, userId: string, postId: string) {
  const { db, cfg } = deps;
  await sweep(deps);
  const listing = (await db.query<ListingRow>(`SELECT * FROM listings WHERE id = $1`, [postId])).rows[0];
  if (listing) {
    const l = listing;
    if (l.seller_id !== userId) throw new MarketError("That offer belongs to someone else.");
    if (l.status === "sold") throw new MarketError("That item is already sold.");
    if (l.status === "withdrawn") throw new MarketError("That offer is already down.");
    const held = await proposedDealOn(db, "listing_id", postId);
    if (held) await release(db, held, "withdrawn", { listing: "withdrawn" });
    await db.query(`UPDATE listings SET status = 'withdrawn' WHERE id = $1 AND status IN ('active', 'pending')`, [postId]);
    await logEvent(db, "listing_withdrawn", userId, postId, { released_deal: held?.id ?? null });
    if (held) await repairAfter(db, held, pairing(cfg));
    return {
      post_id: postId,
      kind: "offer" as const,
      status: "withdrawn" as const,
      released_deal_id: held?.id ?? null,
      say: `I've taken down ${l.title}.` + (held ? ` The person it was on hold for goes back to their other options.` : ""),
    };
  }
  const intent = (await db.query<BuyIntentRow>(`SELECT * FROM buy_intents WHERE id = $1`, [postId])).rows[0];
  if (intent) {
    const i = intent;
    if (i.buyer_id !== userId) throw new MarketError("That request belongs to someone else.");
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
      say: `I've cancelled your request for ${i.need}.` + (held ? ` The offer it was holding goes back on the market.` : ""),
    };
  }
  throw new MarketError("I can't find that post.");
}

// ---------- Trust and safety ----------

type ReportRow = { id: string; reason: string; deal_id: string | null; post_id: string | null };

export interface ReportInput {
  reason: ReportReason;
  deal_id?: string;
  /** A post the user was shown, such as an offer among the options, when there is no deal. */
  post_id?: string;
  details?: string;
}

/**
 * Report the other side of a deal, or the owner of a post. The two are never
 * paired again, a deal they still have open is cancelled, and reports from
 * enough different people put the reported person under review.
 */
export async function reportUser(deps: Deps, userId: string, input: ReportInput) {
  const { db, cfg } = deps;
  await sweep(deps);
  await ensureUser(db, userId);
  let reportedId: string;
  if (input.deal_id) {
    const d = await getDealWithParties(db, input.deal_id);
    if (userId !== d.buyer_id && userId !== d.seller_id) throw new MarketError("You're not part of this deal.");
    reportedId = userId === d.buyer_id ? d.seller_id : d.buyer_id;
  } else if (input.post_id) {
    const { rows } = await db.query<{ owner: string }>(
      `SELECT seller_id AS owner FROM listings WHERE id = $1 UNION ALL SELECT buyer_id FROM buy_intents WHERE id = $1`,
      [input.post_id],
    );
    if (!rows[0]) throw new MarketError("I can't find that post.");
    reportedId = rows[0].owner;
  } else {
    throw new MarketError("Which deal or offer is this about?");
  }
  if (reportedId === userId) throw new MarketError("That's your own post.");

  const created = await db.query<ReportRow>(
    `INSERT INTO reports (id, reporter_id, reported_id, reason, deal_id, post_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (reporter_id, reported_id) WHERE status = 'open' DO NOTHING RETURNING id, reason, deal_id, post_id`,
    [shortId("rpt"), userId, reportedId, input.reason, input.deal_id ?? null, input.post_id ?? null, input.details ?? null],
  );
  const fresh = created.rows[0];
  if (!fresh) {
    const { rows } = await db.query<ReportRow>(
      `SELECT id, reason, deal_id, post_id FROM reports WHERE reporter_id = $1 AND reported_id = $2 AND status = 'open'`,
      [userId, reportedId],
    );
    return {
      report: reportView(rows[0], false, null),
      say: "You've already reported them. It's with our reviewers, and I won't pair you with them.",
    };
  }

  // Whatever the two of them still have open ends here; both sides are paired with others.
  const { rows: open } = await db.query<DealRow>(
    `SELECT d.* FROM deals d JOIN listings l ON l.id = d.listing_id JOIN buy_intents i ON i.id = d.buy_intent_id
     WHERE d.status = 'proposed' AND ((l.seller_id = $1 AND i.buyer_id = $2) OR (l.seller_id = $2 AND i.buyer_id = $1))`,
    [userId, reportedId],
  );
  let released: string | null = null;
  for (const d of open) {
    if (!(await release(db, d, "declined"))) continue;
    released ??= d.id;
    await logEvent(db, "deal_declined", userId, d.id, { by: "report" });
    await repairAfter(db, d, pairing(cfg));
  }
  await logEvent(db, "user_reported", userId, reportedId, { reason: input.reason, deal_id: input.deal_id ?? null, post_id: input.post_id ?? null });
  await reviewIfReported(db, reportedId, cfg.reportThreshold ?? DEFAULT_REPORT_THRESHOLD, pairing(cfg));

  return {
    report: reportView(fresh, true, released),
    say: (input.reason === "unsafe" ? "If you're in danger right now, call emergency services. " : "") +
      "Thanks for telling me. I've passed this on for review, and I won't pair you with them again." +
      (released ? " I've also cancelled the deal you had with them." : ""),
  };
}

/** Rate the other side of a confirmed deal, 1 to 5 stars, once per side. Ratings feed the ranking's track records. */
export async function rateDeal(deps: Deps, userId: string, dealId: string, stars: number) {
  const { db } = deps;
  const d = await getDealWithParties(db, dealId);
  const isBuyer = userId === d.buyer_id;
  if (!isBuyer && userId !== d.seller_id) throw new MarketError("You're not part of this deal.");
  if (d.status !== "confirmed") throw new MarketError("You can rate a deal once both of you have confirmed it.", "not_confirmed");
  const { rows } = await db.query<{ deal_id: string; stars: number; ratee_role: string }>(
    `INSERT INTO ratings (deal_id, rater_id, ratee_id, ratee_role, stars) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (deal_id, rater_id) DO NOTHING RETURNING deal_id, stars, ratee_role`,
    [dealId, userId, isBuyer ? d.seller_id : d.buyer_id, isBuyer ? "seller" : "buyer", stars],
  );
  if (!rows[0]) throw new MarketError("You've already rated this deal.", "already_rated");
  await logEvent(db, "deal_rated", userId, dealId, { stars, rated: isBuyer ? "seller" : "buyer" });
  const name = isBuyer ? d.seller_name : d.buyer_name;
  return {
    rating: ratingView(rows[0]),
    say: `Thanks! I've given ${name} ${countWord(stars).toLowerCase()} star${stars === 1 ? "" : "s"}.` +
      (stars <= 2 ? " If something went wrong, I can report it for review." : ""),
  };
}

// ---------- Dashboard ----------

export async function dashboard(db: Db) {
  const [listings, intents, deals, events, learning, review] = await Promise.all([
    db.query(`SELECT id, seller_id, kind, price_unit, title, condition, ask_price, currency, location, status, created_at FROM listings ORDER BY created_at DESC LIMIT 50`),
    db.query(`SELECT id, buyer_id, kind, price_unit, need, source, quantity, hours, pickup, schedule, currency, status, created_at FROM buy_intents ORDER BY created_at DESC LIMIT 50`),
    db.query(`${DEAL_WITH_PARTIES} ORDER BY d.created_at DESC LIMIT 50`),
    db.query(`SELECT * FROM events ORDER BY id DESC LIMIT 100`),
    learningReport(db),
    reviewQueue(db),
  ]);
  // Private limits are intentionally absent: the dashboard proves they stay hidden.
  return { listings: listings.rows, intents: intents.rows, deals: deals.rows, events: events.rows, learning, review_queue: review };
}

/** A reviewer's decision on someone in the review queue (dashboard, POST /api/review). */
export async function reviewUser(deps: Deps, userId: string, decision: ReviewDecision) {
  const status = await decideReview(deps.db, userId, decision, pairing(deps.cfg));
  if (!status) throw new MarketError("I can't find that user.");
  return { user_id: userId, review_status: status };
}

// ---------- helpers ----------

// For a service, the place and time come from the request when it gives them:
// the job happens where and when the requester needs it.
const DEAL_WITH_PARTIES = `
  SELECT d.*, l.kind, l.price_unit, l.title, l.condition, l.ask_price, l.ref_low, l.ref_high, l.ref_source,
         CASE WHEN l.kind = 'service' THEN i.schedule ELSE l.availability END AS availability,
         l.availability AS offer_availability, l.time_zone AS offer_time_zone, i.time_zone AS request_time_zone,
         i.schedule AS request_schedule, i.created_at AS request_created_at, i.service_start, i.service_end,
         EXISTS (SELECT 1 FROM events e WHERE e.ref_id = d.id AND e.actor_id = l.seller_id
                 AND e.kind IN ('deal_half_confirmed', 'deal_confirmed')) AS provider_explicit_yes,
         i.hours, i.pickup, i.needed_by, i.need AS task, l.seller_id, i.buyer_id,
         su.display_name AS seller_name, bu.display_name AS buyer_name,
         l.location AS offer_location, i.location AS request_location, su.home_area AS seller_home, bu.home_area AS buyer_home,
         mp.point_id AS meetup_point_id, mp.status AS meetup_status, mp.both_here_at AS meetup_both_here_at,
         (SELECT coalesce(json_agg(json_build_object('user_id', a.user_id, 'checked_in_at', a.checked_in_at, 'verified_at', a.verified_at,
                 'ring_event_type', a.ring_event_type)), '[]'::json) FROM meetup_arrivals a WHERE a.deal_id = d.id) AS meetup_arrivals
  FROM deals d
  JOIN listings l    ON l.id = d.listing_id
  JOIN buy_intents i ON i.id = d.buy_intent_id
  JOIN users su      ON su.id = l.seller_id
  JOIN users bu      ON bu.id = i.buyer_id
  LEFT JOIN meetups mp ON mp.deal_id = d.id`;

function matchView(m: ListingRow & { score: number }, intent: BuyIntentRow, viewerId: string) {
  return {
    ...offerView(m, viewerId),
    within_budget_at_ask: num(m.ask_price)! <= num(intent.max_price)!,
    score: +m.score.toFixed(3),
  };
}

/** "$17", "$4 a job", "$9 an hour". */
export function rate(amount: number, unit: PriceUnit, currency: string) {
  return fmt(amount, currency) + (unit === "hour" ? " an hour" : unit === "job" ? " a job" : "");
}

/** The deal's price as spoken: an hourly rate also gives the total when the hours are known. */
function dealPrice(deal: DealView) {
  if (deal.price_unit !== "hour") return fmt(deal.price, deal.currency);
  const total = deal.total != null && deal.hours != null ? `, ${fmt(deal.total, deal.currency)} for ${hoursText(deal.hours)}` : "";
  return `${fmt(deal.price, deal.currency)} an hour${total}`;
}

const hoursText = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? "" : "s"}`;

/** Where and when, as spoken: items meet up; services name the pickup, the place and the time. */
function placeLine(deal: DealView) {
  const { place, availability } = deal.meetup;
  if (deal.kind === "item" && deal.handoff === "delivery" && deal.delivery) {
    const v = deal.delivery;
    return ` Amazon Hub delivery: drop-off at ${v.drop_off.name}, pickup at ${v.pick_up.name}, ${v.pick_up.area}, ${v.eta},` +
      ` ${fmt(v.fee, deal.currency)} delivery (demo estimate).`;
  }
  if (deal.kind === "item") return place ? ` Meet-up: ${place}.` : "";
  const route = deal.pickup && place ? `From ${deal.pickup} to ${place}` : deal.pickup ? `Pickup at ${deal.pickup}` : place ? `At ${place}` : "";
  const work = deal.scheduling;
  const time = availability ?? (work?.starts_at
    ? `${new Date(work.starts_at).toLocaleString("en-US", { timeZone: work.time_zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${work.ends_at ? ` to ${new Date(work.ends_at).toLocaleTimeString("en-US", { timeZone: work.time_zone, hour: "numeric", minute: "2-digit" })}` : ""} (${work.time_zone})`
    : (deal.needed_by ? `by ${clock(deal.needed_by, work?.time_zone)}` : ""));
  const line = [route, time].filter(Boolean).join(", ");
  return line ? ` ${line}.` : "";
}

const clock = (iso: string, timeZone = DEFAULT_TIME_ZONE) => new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });

function buyerOfferLine(deal: DealView, mode: "found" | "negotiated" | "next" | "already") {
  const price = dealPrice(deal);
  // An item is named; for a service the person is, and the card shows what they offer.
  const what = deal.kind === "item" ? `${deal.title} for ${price}` : `${deal.counterpart} can do it for ${price}`;
  const lead = {
    found: deal.kind === "item" ? `Found it: ${what}` : `Found someone: ${what}`,
    negotiated: `Got it: ${what}`,
    next: `Next best: ${what}`,
    already: `That one's already on hold for you: ${what}`,
  }[mode];
  const below = deal.kind === "item" ? "below asking" : "below their rate";
  const saved = deal.saved_vs_ask > 0 ? `, ${fmt(deal.saved_vs_ask, deal.currency)} ${below}` : "";
  const ask = deal.seller_confirmed
    ? " Should I confirm it?"
    : ` Should I confirm? ${deal.kind === "item" ? "The seller" : deal.counterpart} gives the final yes.`;
  const scheduling = deal.scheduling?.status === "needs_confirmation" && !deal.seller_confirmed
    ? " The helper still needs to check the time." : "";
  return `${lead}${saved}.${placeLine(deal)}${priceWarning(deal)}${scheduling}${ask}`;
}

/** Said to the buyer when the price is far from what similar things go for. */
function priceWarning(deal: DealView) {
  const c = deal.price_check;
  if (!c) return "";
  const usual = `the usual ${fmt(c.typical_low, deal.currency)} to ${fmt(c.typical_high, deal.currency)}`;
  if (c.verdict === "far_below") {
    return deal.kind === "item"
      ? ` Heads up: that's far below ${usual}. Meet somewhere public, check it works, and only pay once you have it.`
      : ` Heads up: that's far below ${usual} for a job like this.`;
  }
  if (c.verdict === "far_above") return ` Note: that's well above ${usual}.`;
  return "";
}

/** Ask the user to confirm the first price that is far outside the band; returns the flag to store once they have. */
function checkPrices(
  band: PriceBand, policy: PricePolicy, kind: Kind, unit: PriceUnit, currency: string, confirmed: boolean | undefined,
  prices: readonly (readonly ["ask_price" | "min_price" | "max_price", number])[],
) {
  for (const [field, price] of prices) {
    const v = verdict(price, band, policy);
    // A low minimum or a high budget only costs its owner; a low ask also lures buyers.
    const far = field === "max_price" ? v === "far_above" : field === "min_price" ? v === "far_below" : v === "far_below" || v === "far_above";
    if (!far) continue;
    if (confirmed) return v as "far_below" | "far_above";
    const usual = `${kind === "item" ? "Items like this usually sell for" : "Jobs like this usually pay"} ${range(band, unit, currency)}`;
    const yours = { ask_price: "you're asking", min_price: "your lowest price is", max_price: "your budget is" }[field];
    throw new MarketError(
      `${usual}, and ${yours} ${rate(price, unit, currency)}. Is ${fmt(price, currency)} right? Say yes to go ahead, or tell me the price you meant.`,
      "confirm_price",
      { field, price, verdict: v, typical_low: band.low, typical_high: band.high, source: band.source },
    );
  }
  return null;
}

/** "$220 to $380", "$8 to $20 an hour". */
const range = (band: Pick<PriceBand, "low" | "high">, unit: PriceUnit, currency: string) =>
  `${fmt(band.low, currency)} to ${rate(band.high, unit, currency)}`;

/** What a seller hears about the price: their ask, or a lower offer their minimum accepted. */
const agreedLine = (deal: DealView) =>
  deal.saved_vs_ask > 0
    ? `they offered ${fmt(deal.price, deal.currency)}, inside your limit`
    : `they'll pay your asking price of ${fmt(deal.price, deal.currency)}`;

/** What a provider hears about a job: the task, the pay and where and when. */
function providerJobLine(deal: DealView) {
  return `New job from ${deal.counterpart}: ${deal.task ?? deal.title}, for ${dealPrice(deal)}.${placeLine(deal)}` +
    (deal.seller_confirmed ? ` You pre-approved it, so I've asked them to confirm.` : ` Want it?`);
}

function doneLine(deal: DealView) {
  if (deal.kind === "item") {
    return `Done! ${deal.title} for ${fmt(deal.price, deal.currency)} with ${deal.counterpart}.` +
      (deal.handoff === "delivery"
        ? `${placeLine(deal)}${deal.delivery?.reference ? ` Shipment ${deal.delivery.reference}: the seller gets the drop-off label and you get a pickup code.` : ""}`
        : deal.meetup.place ? ` Meet-up: ${deal.meetup.place}${deal.meetup.availability ? `, ${deal.meetup.availability}` : ""}.` : "");
  }
  return `Booked! ${deal.title} with ${deal.counterpart}, ${dealPrice(deal)}.${placeLine(deal)}`;
}

function statusLine(d: DealView) {
  const what = d.kind === "item" ? `${d.title}, ${dealPrice(d)}`
    : d.your_role === "seller" ? `${d.task} for ${d.counterpart}, ${dealPrice(d)}`
    : `${d.title} with ${d.counterpart}, ${dealPrice(d)}`;
  switch (d.status) {
    case "confirmed":
      return d.kind === "item"
        ? d.handoff === "delivery"
          ? `${what}: confirmed with ${d.counterpart}, by Amazon Hub delivery to ${d.delivery?.pick_up.name ?? "your Hub Locker"}.`
          : `${what}: confirmed with ${d.counterpart}${d.meetup.place ? `, meet-up at ${d.meetup.place}` : ""}.`
        : `${what}: booked.${placeLine(d)}`;
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
    withdrawn: "That offer or request was taken down.",
  }[status] ?? `That deal is ${status}.`;
}

const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  if (!rows[0]) throw new MarketError("I can't find that offer.");
  return rows[0];
}

function fmt(amount: number, currency: string) {
  const sym = currency === "USD" ? "$" : currency === "HKD" ? "HK$" : `${currency} `;
  return `${sym}${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}
