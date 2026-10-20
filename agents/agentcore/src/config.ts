// Settings from the environment, with the production endpoint and Nova Lite as defaults.
export const config = {
  mcpUrl: process.env.PAIRUP_MCP_URL ?? "https://d3cxpkmhl89rw9.cloudfront.net/mcp",
  modelId: process.env.BEDROCK_MODEL_ID ?? "us.amazon.nova-lite-v1:0",
  region: process.env.AWS_REGION ?? "us-east-1",
  port: Number(process.env.PORT ?? 8080),
  /** Agents kept warm per AgentCore session (conversation memory lives in the agent). */
  maxSessions: Number(process.env.MAX_SESSIONS ?? 200),
};
