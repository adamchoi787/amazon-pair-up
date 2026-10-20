import { loadSync } from "pairing-core";

// Deterministic settlement. No agent haggles and the LLM never decides a price;
// it only phrases the outcome. Settlement runs in pairing-core (Rust compiled to
// WebAssembly, vendor/pairing-core) with integer cents, and a refusal carries no
// data.

const core = loadSync();

export interface NegotiationInput {
  askPrice: number;    // seller's public asking price
  sellerMin: number;   // seller's PRIVATE minimum
  buyerMax: number;    // buyer's PRIVATE budget
  /** The best price this buyer already walked away from for this listing (0 or omitted for none). */
  floor?: number;
}

/** "asking_price": the budget covered the ask. "buyer_offer": the budget was below the ask and the seller's minimum accepted it. */
export type SettlementRule = "asking_price" | "buyer_offer";

export type NegotiationResult =
  | { ok: true; price: number; rule: SettlementRule; savedVsAsk: number }
  | { ok: false; reason: "no_overlap" };

const toCents = (amount: number) => Math.round(amount * 100);
const fromCents = (cents: number) => cents / 100;

/**
 * The asking price is public; a budget below it is the buyer's offer; the
 * seller's private minimum only decides whether that offer is accepted:
 *
 *   price = min(ask, buyer max)     deal iff price >= seller min and price >= floor
 *
 * So the seller's minimum never moves the price (a deal reveals only that it is
 * at most the price), a budget at or above the ask never moves the price, and a
 * buyer who walks away can't come back lower to step down toward the minimum.
 *
 * Example (demo script): ask 20, seller min 15, buyer max 18 → 18, $2 below asking.
 * Amounts are dollars (or another currency's major unit) with at most two decimals.
 */
export function negotiate({ askPrice, sellerMin, buyerMax, floor = 0 }: NegotiationInput): NegotiationResult {
  const ask = toCents(askPrice);
  const s = core.settle({ ask, sellerMin: toCents(sellerMin), buyerMax: toCents(buyerMax), floor: toCents(floor) });
  if (!s.ok) return { ok: false, reason: "no_overlap" };
  return {
    ok: true,
    price: fromCents(s.price),
    rule: s.price === ask ? "asking_price" : "buyer_offer",
    savedVsAsk: fromCents(s.savedVsAsk),
  };
}
