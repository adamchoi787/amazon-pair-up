// Load data/seed-listings.json. `npm run reset` wipes all tables first.
import { readFileSync } from "node:fs";
import { createAi } from "../src/ai/index.js";
import { config } from "../src/config.js";
import { openDb } from "../src/db/client.js";
import { createListing, ensureUser } from "../src/market/service.js";
import type { Condition } from "../src/ai/index.js";

interface SeedFile {
  users: { id: string; display_name: string; home_area?: string }[];
  listings: {
    seller: string; title: string; description?: string; category?: string; condition?: Condition;
    quantity?: number; ask_price: number; min_price?: number; location?: string;
  }[];
}

const seed = JSON.parse(readFileSync("data/seed-listings.json", "utf8")) as SeedFile;

let db = await openDb(config);
if (process.argv.includes("--reset")) {
  await db.query(`DROP TABLE IF EXISTS events, deals, buy_intents, listings, users CASCADE`);
  await db.close();
  db = await openDb(config); // re-runs migrations
  console.log("Reset all tables.");
}
const deps = { db, ai: createAi(config), cfg: config };

for (const u of seed.users) {
  await ensureUser(db, u.id, u.display_name);
  if (u.home_area) await db.query(`UPDATE users SET home_area=$2 WHERE id=$1`, [u.id, u.home_area]);
}
for (const l of seed.listings) {
  await createListing(deps, { ...l, user_id: l.seller });
}
const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM listings`);
console.log(`Seeded ${seed.listings.length} listings (${rows[0].n} total) with ${deps.ai.mode} embeddings.`);
await db.close();
