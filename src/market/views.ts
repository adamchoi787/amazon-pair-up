import { num, type BuyIntentRow, type DealRow, type ListingRow } from "./types.js";

// The ONLY place rows become tool output. Private limits are included solely
// for their owner. Every tool response goes through these functions, and
// test/e2e.test.ts fails if a counterparty limit ever leaks.

export function listingView(l: ListingRow, viewerId: string) {
  const isOwner = l.seller_id === viewerId;
  return {
    listing_id: l.id,
    title: l.title,
    description: l.description,
    category: l.category,
    condition: l.condition,
    quantity: l.quantity,
    currency: l.currency,
    ask_price: num(l.ask_price),
    location: l.location,
    availability: l.availability,
    status: l.status,
    ...(isOwner ? { your_min_price: num(l.min_price), auto_accept: l.auto_accept } : {}),
  };
}

export function intentView(i: BuyIntentRow, viewerId: string) {
  const isOwner = i.buyer_id === viewerId;
  return {
    intent_id: i.id,
    need: i.need,
    source: i.source,
    category: i.category,
    min_condition: i.min_condition,
    quantity: i.quantity,
    currency: i.currency,
    needed_by: i.needed_by ? new Date(i.needed_by).toISOString() : null,
    location: i.location,
    status: i.status,
    ...(isOwner ? { your_max_price: num(i.max_price) } : {}),
  };
}

/** A deal joined with the public facts of both posts (see DEAL_WITH_PARTIES). */
export interface DealWithParties extends DealRow {
  title: string;
  condition: string;
  ask_price: string | number;
  availability: string | null;
  seller_id: string;
  buyer_id: string;
  seller_name: string;
  buyer_name: string;
}

export type Role = "buyer" | "seller" | "observer";

export function dealView(d: DealWithParties, viewerId: string) {
  const role: Role = viewerId === d.buyer_id ? "buyer" : viewerId === d.seller_id ? "seller" : "observer";
  const price = num(d.price)!;
  const ask = num(d.ask_price)!;
  const waitingFor =
    d.status !== "proposed" ? [] : [
      ...(d.buyer_confirmed ? [] : ["buyer" as const]),
      ...(d.seller_confirmed ? [] : ["seller" as const]),
    ];
  return {
    deal_id: d.id,
    listing_id: d.listing_id,
    title: d.title,
    condition: d.condition,
    your_role: role,
    counterpart: role === "buyer" ? d.seller_name : role === "seller" ? d.buyer_name : null,
    price,
    ask_price: ask,
    saved_vs_ask: +(ask - price).toFixed(2),
    currency: d.currency,
    status: d.status,
    buyer_confirmed: d.buyer_confirmed,
    seller_confirmed: d.seller_confirmed,
    waiting_for: waitingFor,
    waiting_for_you: role !== "observer" && waitingFor.includes(role),
    meetup: { place: d.meetup, availability: d.availability },
    on_hold_until: d.status === "proposed" && d.expires_at ? new Date(d.expires_at).toISOString() : null,
    created_at: new Date(d.created_at).toISOString(),
    updated_at: new Date(d.updated_at).toISOString(),
  };
}

export type DealView = ReturnType<typeof dealView>;
