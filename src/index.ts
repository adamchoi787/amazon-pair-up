import { createAi } from "./ai/index.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db/client.js";

const db = await openDb(config);
const ai = createAi(config);
const app = createApp({ db, ai, cfg: config }, config);

app.listen(config.port, config.host, () => {
  console.log(`voice-market MCP server on http://${config.host}:${config.port}/mcp`);
  console.log(`  db: ${config.databaseUrl ? "postgres" : `pglite (${config.pgliteDir})`}  ai: ${ai.mode}`);
  console.log(`  dashboard: http://${config.host}:${config.port}/`);
});

const shutdown = async () => {
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
