import { seedLifestyle } from "../src/db/demo-lifestyle.js";
// Load data/seed-listings.json. `npm run reset` wipes all tables first.
import { createAi } from "../src/ai/index.js";
import { config } from "../src/config.js";
import { openDb } from "../src/db/client.js";
import { seedMarketplace } from "../src/db/seed.js";

let db = await openDb(config);
if (process.argv.includes("--reset")) {
  await db.query(`DROP TABLE IF EXISTS device_tokens, context_signals, routine_feedback,
    oauth_pending, oauth_clients, user_passcodes, oauth_codes, oauth_tokens,
    idempotent_calls, reports, ratings, policy_examples, events, failed_offers,
    pairing_features, ranking_models, deals, buy_intents, listings, users, reference_prices CASCADE`);
  await db.close();
  db = await openDb(config); // re-runs migrations
  console.log("Reset all tables.");
}
const deps = { db, ai: createAi(config), cfg: config };

const added = await seedMarketplace(deps);
const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM listings`);
if(process.argv.includes("--lifestyle"))console.log(`DEMO DATA: added ${await seedLifestyle(deps)} closed lunch-run requests for u_tony.`);
console.log(`Seeded ${added} listings (${rows[0].n} total) with ${deps.ai.mode} embeddings.`);
await db.close();
