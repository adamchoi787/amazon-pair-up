import { readFileSync, existsSync } from "node:fs";

// Minimal .env loader so nobody needs dotenv. Real env vars win.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const env = (k: string, d = "") => process.env[k] ?? d;

export const config = {
  port: Number(env("PORT", "3000")),
  host: env("HOST", "127.0.0.1"),
  allowedHosts: env("ALLOWED_HOSTS").split(",").map((s) => s.trim()).filter(Boolean),
  mcpApiKey: env("MCP_API_KEY"),

  databaseUrl: env("DATABASE_URL"),
  pgliteDir: env("PGLITE_DIR", ".data/pglite"),
  seedOnStart: env("SEED_ON_START") === "true",

  aiMode: env("AI_MODE", "mock") as "mock" | "bedrock",
  awsRegion: env("AWS_REGION", "us-east-1"),
  embeddingModelId: env("BEDROCK_EMBEDDING_MODEL_ID", "amazon.titan-embed-text-v2:0"),
  intentModelId: env("BEDROCK_INTENT_MODEL_ID"),
  embeddingDim: Number(env("EMBEDDING_DIM", "1024")),
  matchThreshold: Number(env("MATCH_THRESHOLD", "0.2")),
};

export type Config = typeof config;
