import { num, type BuyIntentRow, type DealRow, type ListingRow } from "./types.js";

// The ONLY place rows become tool output. Private limits are included solely
// for their owner. Every tool response must go through these functions —
// test/privacy.test.ts fails if a counterparty limit ever leaks.

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

export function dealView(d: DealRow & { title?: string; seller_id?: string; buyer_id?: string }, viewerId: string) {
  const role = viewerId === d.buyer_id ? "buyer" : viewerId === d.seller_id ? "seller" : "observer";
  return {
    deal_id: d.id,
    listing_id: d.listing_id,
    title: d.title,
    your_role: role,
    price: num(d.price),
    currency: d.currency,
    status: d.status,
    buyer_confirmed: d.buyer_confirmed,
    seller_confirmed: d.seller_confirmed,
    meetup: d.meetup,
  };
}
