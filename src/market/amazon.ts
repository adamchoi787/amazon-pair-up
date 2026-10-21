import { readFileSync } from "node:fs";

// Where the local market hands off to Amazon. PairUp covers what Amazon
// retail doesn't serve (used items under $20, errands, an hour of help); when
// the local market can't help, it points the person at Amazon instead:
//   - a request nobody can fill gets a search link and the new price,
//   - an item offer nobody is asking for, in a category Amazon Trade-In takes,
//     gets a Trade-In link,
//   - two people in the same area meet at an Amazon Hub Locker or Counter.
// Everything here is deterministic and reads data/ only; views.ts shapes it.

export const AMAZON_TRADE_IN_URL = "https://www.amazon.com/tradein";

/** An amazon.com search for what the person asked for. */
export const amazonSearchUrl = (need: string) => `https://www.amazon.com/s?k=${encodeURIComponent(need.trim())}`;

// ---------- Trade-In ----------

interface TradeInCategory { id: string; label: string; keywords: string[] }

let tradeIn: { file: string; categories: TradeInCategory[] } | null = null;

function tradeInCategories(file = "data/trade-in-categories.json") {
  if (tradeIn?.file !== file) {
    tradeIn = { file, categories: (JSON.parse(readFileSync(file, "utf8")) as { categories: TradeInCategory[] }).categories };
  }
  return tradeIn.categories;
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean));

/** The Trade-In category an item falls in, by its category or title words; null when Amazon Trade-In doesn't take it. */
export function tradeInCategory(post: { title: string; category?: string | null }, file?: string) {
  const have = words(`${post.category ?? ""} ${post.title}`);
  return tradeInCategories(file).find((c) => c.keywords.some((k) => have.has(k))) ?? null;
}

// ---------- Amazon Hub points ----------

export interface HubPoint { name: string; type: "locker" | "counter"; area: string }

interface Area { name: string; hub_points: { name: string; type: "locker" | "counter" }[] }

let areas: { file: string; byName: Map<string, Area> } | null = null;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The Hub points of each area. The seed file contains demo locations. Configure verified real places before real meet-ups. */
function hubAreas(file = "data/seed-listings.json") {
  if (areas?.file !== file) {
    const list = (JSON.parse(readFileSync(file, "utf8")) as { areas?: Area[] }).areas ?? [];
    areas = { file, byName: new Map(list.map((a) => [norm(a.name), a])) };
  }
  return areas.byName;
}

/**
 * The suggested hand-off place when both sides are in the same area: that
 * area's first Hub point (public, staffed or watched). Null otherwise.
 */
export function hubPointFor(sellerArea: string | null | undefined, buyerArea: string | null | undefined, file?: string): HubPoint | null {
  if (!sellerArea || !buyerArea || norm(sellerArea) !== norm(buyerArea)) return null;
  const area = hubAreas(file).get(norm(sellerArea));
  const point = area?.hub_points[0];
  return point ? { name: point.name, type: point.type, area: area.name } : null;
}

// ---------- Amazon Hub delivery ----------

/** How an item changes hands: in person at a Hub point, or carried by Amazon between two Hub points. */
export const HANDOFFS = ["meetup", "delivery"] as const;
export type Handoff = (typeof HANDOFFS)[number];

interface DeliveryRates {
  provider: string;
  max_weight_lb: number;
  same_area: { fee: number; eta: string };
  cross_area: { fee: number; eta: string };
}

let rates: { file: string; rates: DeliveryRates } | null = null;

function deliveryRates(file = "data/delivery-rates.json") {
  if (rates?.file !== file) rates = { file, rates: JSON.parse(readFileSync(file, "utf8")) as DeliveryRates };
  return rates.rates;
}

/** The first locker of an area, else its first counter: lockers take pickups at any hour. */
function hubIn(area: string | null | undefined, prefer: "locker" | "counter", file?: string): HubPoint | null {
  if (!area) return null;
  const a = hubAreas(file).get(norm(area));
  const point = a?.hub_points.find((p) => p.type === prefer) ?? a?.hub_points[0];
  return a && point ? { name: point.name, type: point.type, area: a.name } : null;
}

export interface DeliveryQuote {
  provider: string;
  drop_off: HubPoint;
  pick_up: HubPoint;
  fee: number;
  eta: string;
  max_weight_lb: number;
}

/**
 * Amazon Hub delivery for an item: the seller drops it at a Hub Counter in
 * their area, the buyer collects it from a Hub Locker in theirs. Neither side
 * learns the other's address. Null when either area has no Hub point.
 */
export function deliveryQuote(sellerArea: string | null | undefined, buyerArea: string | null | undefined, opts: { hubs?: string; rates?: string } = {}): DeliveryQuote | null {
  const drop = hubIn(sellerArea, "counter", opts.hubs);
  const pick = hubIn(buyerArea, "locker", opts.hubs);
  if (!drop || !pick) return null;
  const r = deliveryRates(opts.rates);
  const band = norm(drop.area) === norm(pick.area) ? r.same_area : r.cross_area;
  return { provider: r.provider, drop_off: drop, pick_up: pick, fee: band.fee, eta: band.eta, max_weight_lb: r.max_weight_lb };
}
