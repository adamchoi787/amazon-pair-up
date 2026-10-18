import { readFileSync } from "node:fs";
import type { Condition } from "../ai/index.js";
import { createListing, ensureUser, type Deps } from "../market/service.js";

// Loads data/seed-listings.json. Used by `npm run seed` and SEED_ON_START.

interface SeedFile {
  users: { id: string; display_name: string; home_area?: string }[];
  listings: {
    seller: string; title: string; description?: string; category?: string; condition?: Condition;
    quantity?: number; ask_price: number; min_price?: number; location?: string;
  }[];
}

export async function seedMarketplace(deps: Deps, file = "data/seed-listings.json") {
  const seed = JSON.parse(readFileSync(file, "utf8")) as SeedFile;
  for (const u of seed.users) {
    await ensureUser(deps.db, u.id, u.display_name);
    if (u.home_area) await deps.db.query(`UPDATE users SET home_area=$2 WHERE id=$1`, [u.id, u.home_area]);
  }
  for (const l of seed.listings) {
    await createListing(deps, { ...l, user_id: l.seller });
  }
  return seed.listings.length;
}

export async function isEmpty(deps: Deps) {
  const { rows } = await deps.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM listings`);
  return rows[0].n === 0;
}
