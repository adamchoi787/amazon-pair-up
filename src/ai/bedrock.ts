import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
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

// Model output is untrusted: keep each field only if it is valid on its own.
const FIELDS = {
  need: z.string().trim().min(1).max(200),
  category: z.string().trim().toLowerCase().regex(/^[a-z][a-z-]{0,39}$/),
  max_price: z.coerce.number().positive().max(100_000),
  min_condition: z.enum(CONDITIONS),
  quantity: z.coerce.number().int().positive().max(1000),
  needed_by: z.string().refine((v) => !Number.isNaN(new Date(v).getTime())).transform((v) => new Date(v).toISOString()),
  location: z.string().trim().min(1).max(120),
};

export function sanitizeIntent(raw: unknown, text: string): ExtractedIntent {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(FIELDS)) {
    if (obj[key] == null) continue;
    const parsed = schema.safeParse(obj[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return { ...(out as Partial<ExtractedIntent>), need: (out.need as string | undefined) ?? text.trim() };
}

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
      try {
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
        return sanitizeIntent(JSON.parse(json), text);
      } catch (err) {
        // Throttling, an outage or unparseable output: the local parser keeps requests working.
        console.warn("[ai] Bedrock intent extraction failed, using the local parser:", (err as Error).message);
        return mockExtractIntent(text, now);
      }
    },
  };
}
