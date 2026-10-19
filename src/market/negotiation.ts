// Deterministic, explainable negotiation. The LLM never decides a price — it
// only phrases the outcome. Inputs are both parties' delegated limits; output
// is a price both have pre-authorised, or "no deal" without leaking either limit.

export interface NegotiationInput {
  askPrice: number;    // seller's public asking price
  sellerMin: number;   // seller's PRIVATE reserve
  buyerMax: number;    // buyer's PRIVATE budget
}

export type NegotiationResult =
  | { ok: true; price: number; rule: string; savedVsAsk: number }
  | { ok: false; reason: "no_overlap" };

/** Price granularity: half-units below 10, whole units above. */
export const tickFor = (price: number) => (price < 10 ? 0.5 : 1);

const roundToTick = (x: number, tick: number) => Math.round(x / tick) * tick;

/**
 * Split-the-difference inside the zone of possible agreement (ZOPA).
 *
 *   ZOPA = [sellerMin, min(askPrice, buyerMax)]
 *   price = midpoint of ZOPA, rounded to tick, clamped back into ZOPA
 *
 * Example (demo script): ask 20, seller min 15, buyer max 18 → ZOPA [15, 18] → 17.
 */
export function negotiate({ askPrice, sellerMin, buyerMax }: NegotiationInput): NegotiationResult {
  const ceiling = Math.min(askPrice, buyerMax);
  if (ceiling < sellerMin) return { ok: false, reason: "no_overlap" };

  const tick = tickFor(ceiling);
  const mid = roundToTick((sellerMin + ceiling) / 2, tick);
  const price = Math.min(ceiling, Math.max(sellerMin, mid));
  return {
    ok: true,
    price,
    rule: "split_the_difference",
    savedVsAsk: +(askPrice - price).toFixed(2),
  };
}
