import { verdict, type BandSource } from "./pricing.js";
import { num, type BuyIntentRow, type DealRow, type Kind, type ListingRow, type PriceUnit } from "./types.js";

// The ONLY place rows become tool output. Private limits are included solely
// for their owner. Every tool response goes through these functions, and
// test/e2e.test.ts fails if a counterparty limit ever leaks.

const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);

export function offerView(l: ListingRow, viewerId: string) {
  const isOwner = l.seller_id === viewerId;
  return {
    offer_id: l.id,
    kind: l.kind,
    title: l.title,
    description: l.description,
    category: l.category,
    condition: l.kind === "item" ? l.condition : null,
    quantity: l.quantity,
    currency: l.currency,
    ask_price: num(l.ask_price),
    price_unit: l.price_unit,
    location: l.location,
    availability: l.availability,
    status: l.status,
    typical_price: typicalPrice(l),
    ...(isOwner ? { your_min_price: num(l.min_price), auto_accept: l.auto_accept } : {}),
  };
}

/** The public typical range an offer was checked against. */
function typicalPrice(r: { ref_low: string | number | null; ref_high: string | number | null; ref_source: string | null }) {
  if (r.ref_low == null || r.ref_high == null) return null;
  return { low: num(r.ref_low)!, high: num(r.ref_high)!, source: r.ref_source as BandSource };
}

export function requestView(i: BuyIntentRow, viewerId: string) {
  const isOwner = i.buyer_id === viewerId;
  return {
    request_id: i.id,
    kind: i.kind,
    need: i.need,
    source: i.source,
    category: i.category,
    min_condition: i.kind === "item" ? i.min_condition : null,
    quantity: i.quantity,
    price_unit: i.price_unit,
    hours: num(i.hours),
    pickup: i.pickup,
    schedule: i.schedule,
    currency: i.currency,
    needed_by: iso(i.needed_by),
    location: i.location,
    status: i.status,
    ...(isOwner ? { your_max_price: num(i.max_price) } : {}),
  };
}

/** A deal joined with the public facts of both posts (see DEAL_WITH_PARTIES). */
export interface DealWithParties extends DealRow {
  kind: Kind;
  price_unit: PriceUnit;
  title: string;
  condition: string;
  ask_price: string | number;
  availability: string | null;
  hours: string | number | null;
  pickup: string | null;
  needed_by: string | Date | null;
  task: string;
  seller_id: string;
  buyer_id: string;
  seller_name: string;
  buyer_name: string;
  ref_low: string | number | null;
  ref_high: string | number | null;
  ref_source: string | null;
}

export type Role = "buyer" | "seller" | "observer";

/** What the buyer pays in all: the hourly rate times the hours when both are known. */
export function dealTotal(price: number, unit: PriceUnit, hours: number | null) {
  if (unit !== "hour") return price;
  return hours == null ? null : +(price * hours).toFixed(2);
}

export function dealView(d: DealWithParties, viewerId: string) {
  const role: Role = viewerId === d.buyer_id ? "buyer" : viewerId === d.seller_id ? "seller" : "observer";
  const price = num(d.price)!;
  const ask = num(d.ask_price)!;
  const hours = num(d.hours);
  const waitingFor =
    d.status !== "proposed" ? [] : [
      ...(d.buyer_confirmed ? [] : ["buyer" as const]),
      ...(d.seller_confirmed ? [] : ["seller" as const]),
    ];
  return {
    deal_id: d.id,
    offer_id: d.listing_id,
    request_id: d.buy_intent_id,
    kind: d.kind,
    title: d.title,
    task: d.kind === "service" ? d.task : null,
    condition: d.kind === "item" ? d.condition : null,
    your_role: role,
    counterpart: role === "buyer" ? d.seller_name : role === "seller" ? d.buyer_name : null,
    price,
    price_unit: d.price_unit,
    hours: d.price_unit === "hour" ? hours : null,
    total: dealTotal(price, d.price_unit, hours),
    ask_price: ask,
    saved_vs_ask: +(ask - price).toFixed(2),
    price_check: priceCheck(d, price),
    currency: d.currency,
    status: d.status,
    buyer_confirmed: d.buyer_confirmed,
    seller_confirmed: d.seller_confirmed,
    waiting_for: waitingFor,
    waiting_for_you: role !== "observer" && waitingFor.includes(role),
    meetup: { place: d.meetup, availability: d.availability },
    pickup: d.kind === "service" ? d.pickup : null,
    needed_by: d.kind === "service" ? iso(d.needed_by) : null,
    on_hold_until: d.status === "proposed" && d.expires_at ? iso(d.expires_at) : null,
    created_at: iso(d.created_at)!,
    updated_at: iso(d.updated_at)!,
  };
}

/** How the agreed price compares with the typical range for the offer. */
function priceCheck(d: DealWithParties, price: number) {
  const typical = typicalPrice(d);
  if (!typical) return null;
  return { verdict: verdict(price, typical), typical_low: typical.low, typical_high: typical.high, source: typical.source };
}

export type DealView = ReturnType<typeof dealView>;

/**
 * A report as its author sees it. Never who else reported the person, how many
 * did, or whether they are under review.
 */
export function reportView(r: { id: string; reason: string; deal_id: string | null; post_id: string | null }, fresh: boolean, releasedDealId: string | null) {
  return {
    report_id: r.id,
    reason: r.reason,
    deal_id: r.deal_id,
    post_id: r.post_id,
    status: fresh ? ("received" as const) : ("already_reported" as const),
    released_deal_id: releasedDealId,
  };
}

/** A rating as its author sees it; the other side's rating of them stays private. */
export function ratingView(r: { deal_id: string; stars: number; ratee_role: string }) {
  return { deal_id: r.deal_id, stars: Number(r.stars), rated_role: r.ratee_role as "buyer" | "seller" };
}
