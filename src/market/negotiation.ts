import { loadSync } from "pairing-core";

// Deterministic, explainable negotiation. The LLM never decides a price — it
// only phrases the outcome. Settlement runs in pairing-core (Rust compiled to
// WebAssembly, vendor/pairing-core): integer cents, the midpoint of the zone of
// possible agreement rounded to a price tick, and a refusal that carries no
// data, so it can't leak how far apart the limits were.

const core = loadSync();

export interface NegotiationInput {
  askPrice: number;    // seller's public asking price
  sellerMin: number;   // seller's PRIVATE reserve
  buyerMax: number;    // buyer's PRIVATE budget
}

export type NegotiationResult =
  | { ok: true; price: number; rule: "split_the_difference"; savedVsAsk: number }
  | { ok: false; reason: "no_overlap" };

const toCents = (amount: number) => Math.round(amount * 100);
const fromCents = (cents: number) => cents / 100;

/**
 * Split the difference inside the zone of possible agreement (ZOPA):
 *
 *   ZOPA  = [sellerMin, min(askPrice, buyerMax)]
 *   price = ZOPA midpoint, rounded to $0.50 below $10 and $1 from $10 up, kept inside the ZOPA
 *
 * Example (demo script): ask 20, seller min 15, buyer max 18 → ZOPA [15, 18] → 17.
 * Amounts are dollars (or another currency's major unit) with at most two decimals.
 */
export function negotiate({ askPrice, sellerMin, buyerMax }: NegotiationInput): NegotiationResult {
  const ask = toCents(askPrice);
  const s = core.settle({ ask, sellerMin: toCents(sellerMin), buyerMax: toCents(buyerMax) });
  if (!s.ok) return { ok: false, reason: "no_overlap" };
  return { ok: true, price: fromCents(s.price), rule: "split_the_difference", savedVsAsk: fromCents(s.savedVsAsk) };
}
