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
  allowedOrigins: env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean),
  mcpApiKey: env("MCP_API_KEY"),

  // "none": identity from X-User-Id / user_id (local dev). "oauth": Alexa+ account linking.
  authMode: env("AUTH_MODE", "none") as "none" | "oauth",
  publicBaseUrl: env("PUBLIC_BASE_URL").replace(/\/$/, ""),
  oauthClientId: env("OAUTH_CLIENT_ID"),
  oauthClientSecret: env("OAUTH_CLIENT_SECRET"),
  oauthRedirectUris: env("OAUTH_REDIRECT_URIS").split(",").map((s) => s.trim()).filter(Boolean),
  demoLoginPasscode: env("DEMO_LOGIN_PASSCODE"),

  databaseUrl: env("DATABASE_URL"),
  pgliteDir: env("PGLITE_DIR", ".data/pglite"),
  seedOnStart: env("SEED_ON_START") === "true",

  aiMode: env("AI_MODE", "mock") as "mock" | "bedrock",
  awsRegion: env("AWS_REGION", "us-east-1"),
  embeddingModelId: env("BEDROCK_EMBEDDING_MODEL_ID", "amazon.titan-embed-text-v2:0"),
  intentModelId: env("BEDROCK_INTENT_MODEL_ID"),
  // The web app's assistant (tool use). Defaults to the intent model.
  agentModelId: env("BEDROCK_AGENT_MODEL_ID") || env("BEDROCK_INTENT_MODEL_ID"),
  embeddingDim: Number(env("EMBEDDING_DIM", "1024")),
  matchThreshold: Number(env("MATCH_THRESHOLD", "0.35")),

  // Marketplace policy
  dealHoldHours: Number(env("DEAL_HOLD_HOURS", "24")),
  postsPerHour: Number(env("POSTS_PER_HOUR", "30")),
  maxOpenRequests: Number(env("MAX_OPEN_REQUESTS", "10")),
  mcpCallsPerMinute: Number(env("MCP_CALLS_PER_MINUTE", "120")),
  // Learning to pair better (src/market/learning.ts): how often to train and judge a ranking model.
  learnIntervalHours: Number(env("LEARN_INTERVAL_HOURS", "24")),
  learnMinOutcomes: Number(env("LEARN_MIN_OUTCOMES", "60")),
  // Price check (src/market/pricing.ts): when to ask "did you mean…?".
  pricePolicy: {
    farBelow: Number(env("PRICE_FAR_BELOW", "0.5")),
    farAbove: Number(env("PRICE_FAR_ABOVE", "2")),
    referenceMatch: Number(env("PRICE_REFERENCE_MATCH", "0.55")),
    tradeMatch: Number(env("PRICE_TRADE_MATCH", "0.8")),
  },

  // /api/dashboard shows every post and deal. Open in AUTH_MODE=none (local);
  // otherwise it needs this token, and stays off when the token is unset.
  dashboardToken: env("DASHBOARD_TOKEN"),

  // Behind a CDN: requests must carry X-Origin-Verify with this value (the CDN
  // adds it), so the origin can't be reached around the CDN. /health is exempt.
  originSecret: env("ORIGIN_SECRET"),
};

export type Config = typeof config;

if (config.authMode === "oauth") {
  if (!config.publicBaseUrl) throw new Error("AUTH_MODE=oauth requires PUBLIC_BASE_URL");
  // The web app's client is built in; the Alexa+ client is all-or-nothing.
  const alexa = [
    ["OAUTH_CLIENT_ID", config.oauthClientId],
    ["OAUTH_CLIENT_SECRET", config.oauthClientSecret],
    ["OAUTH_REDIRECT_URIS", config.oauthRedirectUris.join(",")],
  ] as const;
  const missing = alexa.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length && missing.length < alexa.length) {
    throw new Error(`Alexa+ account linking needs all of: ${missing.join(", ")}`);
  }
}
