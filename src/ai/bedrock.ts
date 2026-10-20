import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import type { Config } from "../config.js";
import { log } from "../http/log.js";
import { CONDITIONS, type Ai, type ExtractedIntent } from "./types.js";
import { mockExtractIntent } from "./mock.js";

// Amazon Bedrock implementation. Credentials come from the standard AWS chain
// (env vars, ~/.aws, or the IAM role of the host — AgentCore / Lambda / App Runner).

const INTENT_SYSTEM = `You turn a person's request (or ambient context about their day) into JSON for a person-to-person marketplace. People ask for things (an item to buy) or for help (someone to do a task: pick up lunch, run an errand, deliver something, help at an event, tutor, help move).
Return ONLY a JSON object. Include a key only when the request states it; every other key is left out:
- need: short search phrase; for an item the item ("graphing calculator"), for help the task ("pick up my lunch") (always include)
- kind: "service" when they want a person to do a task; leave out for items
- category: one lowercase word, the most specific common noun; for items e.g. "calculator", "textbook", "umbrella"; for services one of "delivery", "event", "tutoring", "moving", or another single word
- max_price: number, the most they will pay (per hour when they give an hourly rate)
- price_unit: services only: "hour" for an hourly rate, "job" for a flat fee for the whole task
- hours: services only: how many hours the job lasts, when stated or clear from a time range ("2-6pm" is 4)
- pickup: errands only: where to collect something from
- location: where to meet, deliver to, or do the job, only if they name a place
- schedule: services only: when the job happens, short, as said ("today by 12:30", "Saturday 2-6pm")
- min_condition: items only: one of ${CONDITIONS.join(", ")}, only if they mention condition ("like new", "in good condition", "works")
- quantity: items only: integer, only if they ask for more than one
- needed_by: ISO 8601 datetime, only if they mention a time: the deadline for an item ("today" means 23:59 local time today), the start time for a service; resolved against the current time given
Examples:
"I need a graphing calculator today, maximum $18" → {"need":"graphing calculator","category":"calculator","max_price":18,"needed_by":"<today 23:59>"}
"looking for 3 packs of tissues on campus, under 5 dollars" → {"need":"tissues","category":"tissue","max_price":5,"quantity":3,"location":"campus"}
"find someone to pick up my lunch from the HUB to McCarty Hall by 12:30, $5" → {"need":"pick up my lunch","kind":"service","category":"delivery","max_price":5,"price_unit":"job","pickup":"the HUB","location":"McCarty Hall","schedule":"today by 12:30","needed_by":"<today 12:30>"}
"get me a guy to help with the event on Saturday 2-6pm, budget $10/hr" → {"need":"help with the event","kind":"service","category":"event","max_price":10,"price_unit":"hour","hours":4,"schedule":"Saturday 2-6pm","needed_by":"<Saturday 14:00>"}`;

// Model output is untrusted: keep each field only if it is valid on its own.
const FIELDS = {
  need: z.string().trim().min(1).max(200),
  category: z.string().trim().toLowerCase().regex(/^[a-z][a-z-]{0,39}$/),
  max_price: z.coerce.number().positive().max(100_000),
  min_condition: z.enum(CONDITIONS),
  quantity: z.coerce.number().int().positive().max(1000),
  needed_by: z.string().refine((v) => !Number.isNaN(new Date(v).getTime())).transform((v) => new Date(v).toISOString()),
  location: z.string().trim().min(1).max(120),
  kind: z.enum(["item", "service"]),
  price_unit: z.enum(["job", "hour"]),
  hours: z.coerce.number().positive().max(24 * 14),
  pickup: z.string().trim().min(1).max(120),
  schedule: z.string().trim().min(1).max(80),
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
        log("warn", "Bedrock intent extraction failed; using the local parser", { error: (err as Error).message });
        return mockExtractIntent(text, now);
      }
    },
  };
}
