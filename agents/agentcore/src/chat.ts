import { createInterface } from "node:readline/promises";
import { createPairUpAgent } from "./agent.js";
import { config } from "./config.js";

// Talk to the Strands agent from a terminal. Needs AWS credentials with Bedrock
// access. Against a local server (npm start in the repo root, AUTH_MODE=none):
//   PAIRUP_MCP_URL=http://127.0.0.1:3000/mcp PAIRUP_USER=u_mei npm run chat
// Against production, pass the user's access token as PAIRUP_TOKEN instead.

const pairup = createPairUpAgent({
  mcpUrl: config.mcpUrl,
  token: process.env.PAIRUP_TOKEN,
  userId: process.env.PAIRUP_USER ?? "u_agentcore_demo",
  modelId: config.modelId,
  region: config.region,
});

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`AmazonPairUp agent (${config.modelId}) on ${config.mcpUrl}. Empty line to quit.`);
for (;;) {
  const text = (await rl.question("you> ")).trim();
  if (!text) break;
  process.stdout.write("agent> ");
  for await (const chunk of pairup.stream(text)) process.stdout.write(chunk);
  process.stdout.write("\n");
}
rl.close();
await pairup.close();
