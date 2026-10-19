import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { Config } from "../config.js";
import { CONDITIONS, type Ai, type ExtractedIntent } from "./types.js";
import { mockExtractIntent } from "./mock.js";

// Amazon Bedrock implementation. Credentials come from the standard AWS chain
// (env vars, ~/.aws, or the IAM role of the host — AgentCore / Lambda / App Runner).

const INTENT_SYSTEM = `You turn a shopper's request (or ambient context about their day) into JSON for a person-to-person marketplace that pairs buyers with sellers.
Return ONLY a JSON object with these keys (omit unknown ones):
- need: short search phrase for the item, e.g. "graphing calculator"
- category: one lowercase word
- max_price: number, the most they will pay
- min_condition: one of ${CONDITIONS.join(", ")}
- quantity: integer
- needed_by: ISO 8601 datetime, resolved against the current time given
- location: where they want to meet / pick up
Never invent a budget that was not stated.`;

export function createBedrockAi(cfg: Config): Ai {
  const client = new BedrockRuntimeClient({ region: cfg.awsRegion });

  return {
    mode: "bedrock",

    async embed(text) {
      const res = await client.send(
        new InvokeModelCommand({
          modelId: cfg.embeddingModelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({ inputText: text, dimensions: cfg.embeddingDim, normalize: true }),
        }),
      );
      const json = JSON.parse(new TextDecoder().decode(res.body));
      return json.embedding as number[];
    },

    async extractIntent(text, now = new Date()) {
      if (!cfg.intentModelId) {
        // Embeddings on Bedrock, parsing local — lets you start before LLM access is approved.
        return mockExtractIntent(text, now);
      }
      const res = await client.send(
        new ConverseCommand({
          modelId: cfg.intentModelId,
          system: [{ text: INTENT_SYSTEM }],
          messages: [
            { role: "user", content: [{ text: `Current time: ${now.toISOString()}\nRequest: ${text}` }] },
          ],
          inferenceConfig: { maxTokens: 400, temperature: 0 },
        }),
      );
      const out = res.output?.message?.content?.map((c) => c.text ?? "").join("") ?? "";
      const json = out.match(/\{[\s\S]*\}/)?.[0];
      if (!json) return mockExtractIntent(text, now);
      const parsed = JSON.parse(json) as Partial<ExtractedIntent>;
      return { ...parsed, need: parsed.need?.trim() || text.trim() };
    },
  };
}
