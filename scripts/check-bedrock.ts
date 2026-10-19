// Preflight for Bedrock: runs the exact calls the server makes, with your local
// AWS profile, before anything is deployed.
//   AWS_PROFILE=amazonpairup AWS_REGION=us-east-1 npx tsx scripts/check-bedrock.ts
// Optional: BEDROCK_AGENT_MODEL_ID / BEDROCK_INTENT_MODEL_ID (default us.amazon.nova-lite-v1:0).
import { bedrockTurn } from "../src/agent/bedrock.js";
import { toolSpecs } from "../src/agent/tools.js";
import { createBedrockAi } from "../src/ai/bedrock.js";
import { createMockAi } from "../src/ai/mock.js";
import { config } from "../src/config.js";
import { openDb } from "../src/db/client.js";

const model = process.env.BEDROCK_AGENT_MODEL_ID || process.env.BEDROCK_INTENT_MODEL_ID || "us.amazon.nova-lite-v1:0";
const cfg = { ...config, aiMode: "bedrock" as const, intentModelId: process.env.BEDROCK_INTENT_MODEL_ID || model, agentModelId: model, embeddingDim: 1024 };
const ok = (label: string, detail: string) => console.log(`✔ ${label}: ${detail}`);
let failed = false;
const check = async (label: string, fn: () => Promise<string>) => {
  const t = performance.now();
  try {
    ok(label, `${await fn()} (${Math.round(performance.now() - t)} ms)`);
  } catch (err) {
    failed = true;
    console.error(`✘ ${label}: ${(err as Error).name}: ${(err as Error).message}`);
  }
};

console.log(`Region ${cfg.awsRegion} · embeddings ${cfg.embeddingModelId} · intent/agent ${model}\n`);
const ai = createBedrockAi(cfg);

await check("Titan embeddings", async () => `${(await ai.embed("TI-84 Plus graphing calculator")).length} dimensions`);

await check("Intent extraction", async () => {
  // In production a Bedrock failure falls back to the local parser with a warning; here it must not.
  const warn = console.warn;
  let fellBack = "";
  console.warn = (...args: unknown[]) => { fellBack = args.map(String).join(" "); };
  const i = await ai.extractIntent("I need a graphing calculator today, maximum $18").finally(() => { console.warn = warn; });
  if (fellBack) throw new Error(fellBack);
  if (i.max_price !== 18) throw new Error(`expected max_price 18, got ${JSON.stringify(i)}`);
  return JSON.stringify(i);
});

await check("Agent tool use", async () => {
  const db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: 64 }, { inMemory: true });
  const specs = await toolSpecs({ db, ai: createMockAi(64), cfg: { matchThreshold: 0.35 } });
  const step = await bedrockTurn(cfg, [{ role: "user", content: [{ text: "Sell my TI-84 for $20, I'll take anything above $15." }] }], specs);
  await db.close();
  const use = step.content.find((b) => "toolUse" in b) as { toolUse: { name: string; input: unknown } } | undefined;
  if (!use) throw new Error(`no tool call: ${JSON.stringify(step.content)}`);
  return `${use.toolUse.name} ${JSON.stringify(use.toolUse.input)}`;
});

if (failed) {
  console.error("\nFix the failures above (model access in the Bedrock console, region, or permissions) before deploying.");
  process.exit(1);
}
console.log("\nBedrock is ready.");
