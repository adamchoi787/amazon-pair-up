import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { z } from "zod";
import { createPairUpAgent, type PairUpAgent } from "./agent.js";
import { config } from "./config.js";

// Amazon Bedrock AgentCore Runtime entrypoint: POST /invocations, GET /ping on
// port 8080 (the runtime contract). Each AgentCore session gets its own
// Strands agent, so a conversation keeps its context across invocations.
//
// Who is speaking: the caller passes the user's AmazonPairUp access token in
// the X-Amzn-Bedrock-AgentCore-Runtime-Custom-PairUp-Token header (once the
// runtime's request header allowlist includes it) or as pairup_token in the
// payload. In local development, where the MCP server runs with
// AUTH_MODE=none, a user_id in the payload is enough.

const TOKEN_HEADER = "x-amzn-bedrock-agentcore-runtime-custom-pairup-token";

const request = z.object({
  prompt: z.string().trim().min(1).max(2000),
  pairup_token: z.string().max(512).optional(),
  user_id: z.string().max(128).optional(),
});

const sessions = new Map<string, PairUpAgent>();

function agentFor(sessionId: string, token: string | undefined, userId: string | undefined) {
  const key = `${sessionId}:${token ?? userId ?? ""}`;
  let agent = sessions.get(key);
  if (agent) {
    sessions.delete(key); // re-insert below: most recently used last
  } else {
    agent = createPairUpAgent({ mcpUrl: config.mcpUrl, token, userId, modelId: config.modelId, region: config.region });
  }
  sessions.set(key, agent);
  while (sessions.size > config.maxSessions) {
    const [oldest, old] = sessions.entries().next().value!;
    sessions.delete(oldest);
    void old.close();
  }
  return agent;
}

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: request,
    process: async function* (req, context) {
      const token = Object.entries(context.headers).find(([k]) => k.toLowerCase() === TOKEN_HEADER)?.[1] ?? req.pairup_token;
      if (!token && !req.user_id) {
        yield { event: "error", data: { text: "Please link your AmazonPairUp account first." } };
        return;
      }
      const agent = agentFor(context.sessionId, token, req.user_id);
      for await (const text of agent.stream(req.prompt)) yield { event: "message", data: { text } };
    },
  },
});

app.run({ port: config.port });
