import { readFileSync } from "node:fs";

// Where the local market hands off to Amazon. PairUp covers what Amazon
// retail doesn't serve (used items under $20, errands, an hour of help); when
// the local market can't help, it points the person at Amazon instead:
//   - a request nobody nearby can fill gets a search link and the new price,
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
