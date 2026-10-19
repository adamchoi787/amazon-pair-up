import type { Config } from "../config.js";
import { createBedrockAi } from "./bedrock.js";
import { createMockAi } from "./mock.js";
import type { Ai } from "./types.js";

// Two implementations behind one interface:
// - mock:    offline, deterministic, no AWS account needed (dev + tests)
// - bedrock: Amazon Bedrock embeddings + LLM (demo + AWS Builder mini challenge)

export * from "./types.js";

export function createAi(cfg: Config): Ai {
  return cfg.aiMode === "bedrock" ? createBedrockAi(cfg) : createMockAi(cfg.embeddingDim);
}
