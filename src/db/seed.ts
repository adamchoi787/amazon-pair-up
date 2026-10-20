import { readFileSync } from "node:fs";
import type { Condition } from "../ai/index.js";
import { ensureUser, postOffer, type Deps } from "../market/service.js";
import type { Kind, ServiceUnit } from "../market/types.js";

// Loads data/seed-listings.json: items for sale and services on offer.
// Used by `npm run seed` and SEED_ON_START.

interface SeedFile {
  users: { id: string; display_name: string; home_area?: string }[];
  listings: {
    seller: string; kind?: Kind; price_unit?: ServiceUnit; title: string; description?: string; category?: string;
    condition?: Condition; quantity?: number; ask_price: number; min_price?: number; auto_accept?: boolean;
    location?: string; availability?: string;
  }[];
}

export async function seedMarketplace(deps: Deps, file = "data/seed-listings.json") {
  const seed = JSON.parse(readFileSync(file, "utf8")) as SeedFile;
  for (const u of seed.users) {
    await ensureUser(deps.db, u.id, u.display_name);
    if (u.home_area) await deps.db.query(`UPDATE users SET home_area=$2 WHERE id=$1`, [u.id, u.home_area]);
  }
  for (const l of seed.listings) {
    // These prices are deliberately chosen and labelled in the reviewed demo
    // fixture, including damaged items below the usual range.
    await postOffer(deps, { ...l, user_id: l.seller, confirm_price: true });
  }
  return seed.listings.length;
}

export async function isEmpty(deps: Deps) {
  const { rows } = await deps.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM listings`);
  return rows[0].n === 0;
}
