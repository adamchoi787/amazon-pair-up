import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Config } from "../config.js";
import type { Deps } from "../market/service.js";
import { createMcpServer, SERVER_INFO } from "./server.js";

// How agents find and learn this server without a human in the loop:
//   /.well-known/mcp/server-card.json  what the server is, where /mcp is, how to authenticate,
//                                      and its tools, prompts and views (MCP server card, SEP-1649)
//   /llms.txt                          the same in plain Markdown, for agents that read the web
//   /skills/amazonpairup/SKILL.md      the Agent Skill: how to run a deal well, step by step
// Everything is read from the server's own initialize / tools/list / prompts/list,
// so the card can never drift from what /mcp actually serves.

export const PROTOCOL_VERSION = "2025-11-25";
const REPO = "https://github.com/adamchoi787/voice-market-mcp";

interface Surface {
  instructions?: string;
  capabilities: Record<string, unknown>;
  tools: { name: string; title?: string; description?: string; annotations?: Record<string, unknown>; inputSchema: unknown; outputSchema?: unknown }[];
  prompts: { name: string; title?: string; description?: string; arguments?: unknown[] }[];
  resources: { uri: string; name: string; title?: string; description?: string; mimeType?: string }[];
}

let cached: Promise<Surface> | undefined;

/** The server as an MCP client sees it (computed once per process). */
export function surface(deps: Deps): Promise<Surface> {
  cached ??= (async () => {
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(deps).connect(serverSide);
    const client = new Client({ name: "amazonpairup-discovery", version: SERVER_INFO.version });
    await client.connect(clientSide);
    const [tools, prompts, resources] = await Promise.all([client.listTools(), client.listPrompts(), client.listResources()]);
    const s: Surface = {
      instructions: client.getInstructions(),
      capabilities: (client.getServerCapabilities() ?? {}) as Record<string, unknown>,
      tools: tools.tools as Surface["tools"],
      prompts: prompts.prompts as Surface["prompts"],
      resources: resources.resources as Surface["resources"],
    };
    await client.close();
    return s;
  })();
  return cached;
}

const base = (cfg: Pick<Config, "publicBaseUrl">, host: string | undefined) =>
  cfg.publicBaseUrl || (host ? `http://${host}` : "");

export async function serverCard(deps: Deps, cfg: Pick<Config, "publicBaseUrl" | "authMode">, host?: string) {
  const s = await surface(deps);
  const url = base(cfg, host);
  return {
    version: "1.0",
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: SERVER_INFO,
    description:
      "Voice-first C2C marketplace: pairs people who need an item or a service with people who have it or can do it, " +
      "settles the price by a fixed rule inside both sides' private limits, and records each side's yes.",
    documentationUrl: `${REPO}#readme`,
    transport: { type: "streamable-http", endpoint: `${url}/mcp`, stateless: true },
    authentication:
      cfg.authMode === "oauth"
        ? { required: true, schemes: ["oauth2"], protectedResourceMetadata: `${url}/.well-known/oauth-protected-resource` }
        : { required: false, schemes: [], note: "Local development: identify the user with an X-User-Id header." },
    capabilities: s.capabilities,
    instructions: s.instructions,
    agentSkill: `${url}/skills/amazonpairup/SKILL.md`,
    tools: s.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, annotations: t.annotations, inputSchema: t.inputSchema, outputSchema: t.outputSchema })),
    prompts: s.prompts,
    resources: s.resources,
  };
}

export async function llmsTxt(deps: Deps, cfg: Pick<Config, "publicBaseUrl" | "authMode">, host?: string) {
  const s = await surface(deps);
  const url = base(cfg, host);
  const line = (name: string, text?: string) => `- \`${name}\`: ${(text ?? "").replace(/\s+/g, " ").trim()}`;
  return `# AmazonPairUp

> A voice-first C2C marketplace for things and services. People post what they have, can do or need; the server pairs
> each request with the best offer, settles the price by a fixed rule inside limits each side keeps private, and
> asks both for a final yes.

## Connect

- MCP endpoint: ${url}/mcp (Streamable HTTP, protocol ${PROTOCOL_VERSION}, stateless)
- Authentication: ${cfg.authMode === "oauth" ? `OAuth 2.1 with PKCE; metadata at ${url}/.well-known/oauth-protected-resource` : "none in local development (send X-User-Id)"}
- Server card: ${url}/.well-known/mcp/server-card.json
- Agent Skill: ${url}/skills/amazonpairup/SKILL.md
- Web app (an MCP host with voice): ${url}/app/
- Source and tool contract: ${REPO}

## Rules an agent must follow

- Call confirm_deal only after the user's explicit yes to the offer you just read.
- Never ask for or reveal anyone else's private limit (min_price, max_price). Prices are set by the server, never haggled.
- Every result has a \`say\` sentence you can speak as is. An error with code \`confirm_price\` asks the user to check a price.
- Send a fresh \`idempotency_key\` with each write and reuse it on a retry.

## Tools

${s.tools.map((t) => line(t.name, t.description)).join("\n")}

## Prompts

${s.prompts.map((p) => line(p.name, p.description)).join("\n")}
`;
}
