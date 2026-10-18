// Row shapes as stored. NUMERIC comes back as string from Postgres; use num().

export interface ListingRow {
  id: string;
  seller_id: string;
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

export interface BuyIntentRow {
  id: string;
  buyer_id: string;
  need: string;
  raw_request: string | null;
  source: string;
  category: string | null;
  min_condition: string;
  quantity: number;
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
}

export const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));
