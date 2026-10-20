// Run the learning job once: roll back a model the live control beats, or
// train a candidate and promote it if it ranks recent outcomes better.
// The server also runs this every LEARN_INTERVAL_HOURS.
import { config } from "../src/config.js";
import { openDb } from "../src/db/client.js";
import { DEFAULT_LEARN_POLICY, learn, learningReport } from "../src/market/learning.js";

const db = await openDb(config);
console.log(await learn(db, { ...DEFAULT_LEARN_POLICY, minOutcomes: config.learnMinOutcomes }));
const report = await learningReport(db);
console.log(JSON.stringify({ arms: report.arms, model: report.model }, null, 2));
await db.close();
