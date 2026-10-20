import { createAi } from "./ai/index.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db/client.js";
import { isEmpty, seedMarketplace } from "./db/seed.js";
import { log } from "./http/log.js";
import { purgeIdempotentCalls } from "./market/idempotency.js";
import { DEFAULT_LEARN_POLICY, learn } from "./market/learning.js";
import { expireHolds } from "./market/pairing.js";
import type { McpSessions } from "./mcp/sessions.js";

const db = await openDb(config);
const ai = createAi(config);
const deps = { db, ai, cfg: config };
if (config.seedOnStart && (await isEmpty(deps))) {
  log("info", "seeded the market (SEED_ON_START)", { listings: await seedMarketplace(deps) });
}
const app = createApp(deps, config);

// Every operation already expires stale holds first; this timer also frees
// items, and re-pairs them, when nobody is calling.
let sweeping = false;
const sweeper = setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    const n = await expireHolds(db, { threshold: config.matchThreshold, holdHours: config.dealHoldHours });
    if (n) log("info", "expired unanswered deals and re-paired their posts", { deals: n });
    await purgeIdempotentCalls(db);
  } catch (err) {
    log("error", "hold sweep failed", { err });
  } finally {
    sweeping = false;
  }
}, 60_000);
sweeper.unref();

// Learning to pair better: train a candidate ranking on how deals ended, keep
// it only if it beats the current one, roll back if the live control wins.
const learner = setInterval(async () => {
  try {
    log("info", "learning run", { result: await learn(db, { ...DEFAULT_LEARN_POLICY, minOutcomes: config.learnMinOutcomes }) });
  } catch (err) {
    log("error", "learning run failed", { err });
  }
}, config.learnIntervalHours * 3600_000);
learner.unref();

const server = app.listen(config.port, config.host, () => {
  log("info", `amazon-pairup MCP server on http://${config.host}:${config.port}/mcp`, {
    db: config.databaseUrl ? "postgres" : `pglite (${config.pgliteDir})`, ai: ai.mode, auth: config.authMode,
  });
});
// Longer than CloudFront's origin keep-alive, so the origin never closes a connection CloudFront is reusing.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// Graceful shutdown (deploys, instance stops): stop accepting connections, let
// calls in flight finish (at most 10 s, inside systemd's 20 s), then close the database.
let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log("info", "shutting down", { signal });
  clearInterval(sweeper);
  clearInterval(learner);
  // Open session streams would hold server.close() until the force timeout.
  void (app.locals.mcpSessions as McpSessions).closeAll();
  const force = setTimeout(() => {
    log("warn", "calls still running after 10 s; closing them");
    server.closeAllConnections();
  }, 10_000);
  force.unref();
  server.close(async () => {
    clearTimeout(force);
    await db.close();
    process.exit(0);
  });
  server.closeIdleConnections();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => log("error", "unhandled rejection", { err }));
