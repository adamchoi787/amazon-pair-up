import { McpClient } from "@strands-agents/sdk";
import { config } from "./config.js";

// Checks the agent's wiring without calling a model (no AWS credentials needed):
// the Strands MCP client connects to the PairUp server and lists the tools
// the agent will have, and one read-only tool call goes through.
//   PAIRUP_MCP_URL=http://127.0.0.1:3000/mcp npm run check

const mcp = new McpClient({
  url: config.mcpUrl,
  headers: process.env.PAIRUP_TOKEN
    ? { Authorization: `Bearer ${process.env.PAIRUP_TOKEN}` }
    : { "X-User-Id": process.env.PAIRUP_USER ?? "u_agentcore_check" },
});

const tools = await mcp.listTools();
console.log(`${tools.length} tools from ${config.mcpUrl}: ${tools.map((t) => t.name).join(", ")}`);
const required = ["post_offer", "post_request", "confirm_deal", "decline_deal", "get_deal_status"];
const missing = required.filter((name) => !tools.some((t) => t.name === name));
if (missing.length) throw new Error(`missing tools: ${missing.join(", ")}`);

const status = tools.find((t) => t.name === "list_my_posts")!;
const result = await mcp.callTool(status, {});
console.log("list_my_posts →", JSON.stringify(result).slice(0, 200));
await mcp.disconnect();
console.log("Agent wiring OK.");
