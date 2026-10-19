// Load data/seed-listings.json. `npm run reset` wipes all tables first.
import { createAi } from "../src/ai/index.js";
import { config } from "../src/config.js";
import { openDb } from "../src/db/client.js";
import { seedMarketplace } from "../src/db/seed.js";

let db = await openDb(config);
if (process.argv.includes("--reset")) {
  await db.query(`DROP TABLE IF EXISTS events, deals, buy_intents, listings, users CASCADE`);
  await db.close();
  db = await openDb(config); // re-runs migrations
  console.log("Reset all tables.");
}
const deps = { db, ai: createAi(config), cfg: config };

const added = await seedMarketplace(deps);
const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM listings`);
console.log(`Seeded ${added} listings (${rows[0].n} total) with ${deps.ai.mode} embeddings.`);
await db.close();
