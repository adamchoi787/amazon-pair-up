// Row shapes as stored. NUMERIC comes back as string from Postgres; use num().
// Tables keep their first names: `listings` hold offers and `buy_intents` hold
// requests. Either can be an item or a service.

export const KINDS = ["item", "service"] as const;
export type Kind = (typeof KINDS)[number];

/** Items are priced each; services per job (a lunch run) or per hour (event help). */
export const SERVICE_UNITS = ["job", "hour"] as const;
export type ServiceUnit = (typeof SERVICE_UNITS)[number];
export type PriceUnit = "each" | ServiceUnit;

/** An offer: an item for sale, or a service someone can do. */
export interface ListingRow {
  id: string;
  seller_id: string;
  kind: Kind;
  price_unit: PriceUnit;
  title: string;
  description: string;
  category: string | null;
  condition: string;
  quantity: number;
  currency: string;
  ask_price: string | number;
  min_price: string | number; // PRIVATE
  auto_accept: boolean;
  location: string | null;
  availability: string | null;
  status: string;
  created_at: string | Date;
}

/** A request: an item someone wants, or a task they need done. */
export interface BuyIntentRow {
  id: string;
  buyer_id: string;
  kind: Kind;
  price_unit: PriceUnit;
  need: string;
  raw_request: string | null;
  source: string;
  category: string | null;
  min_condition: string;
  quantity: number;
  hours: string | number | null;
  pickup: string | null;
  schedule: string | null;
  currency: string;
  max_price: string | number; // PRIVATE
  needed_by: string | Date | null;
  location: string | null;
  status: string;
  created_at: string | Date;
}

export interface DealRow {
  id: string;
  listing_id: string;
  buy_intent_id: string;
  price: string | number;
  currency: string;
  status: string;
  buyer_confirmed: boolean;
  seller_confirmed: boolean;
  meetup: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  expires_at: string | Date | null;
}

export const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));
