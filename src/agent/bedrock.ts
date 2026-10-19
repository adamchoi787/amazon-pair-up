import { BedrockRuntimeClient, ConverseCommand, type Message, type Tool } from "@aws-sdk/client-bedrock-runtime";
import type { Config } from "../config.js";
import type { ToolSpec } from "./tools.js";
import type { AgentMessage, Block } from "./types.js";

// One reasoning step on Amazon Bedrock (Converse API with tool use). The web
// app runs any requested tool over MCP and calls again with the results.

const clients = new Map<string, BedrockRuntimeClient>();
const client = (region: string) => {
  if (!clients.has(region)) clients.set(region, new BedrockRuntimeClient({ region }));
  return clients.get(region)!;
};

export function systemPrompt(now = new Date()) {
  return `You are VoiceMarket, a voice assistant that pairs people who want to buy something with people nearby who want to sell it.
Current time: ${now.toISOString()}.

How to act:
- Use the tools for every marketplace action. Never invent items, prices, people or deals.
- Selling: call create_listing with the item, the asking price and, if stated, the lowest price the user accepts (min_price).
- Buying: call create_buy_intent with the user's own words as raw_request, plus any fields you clearly heard.
- After a tool result, reply in one or two short sentences for a speaker, usually the result's "say" field, which is already phrased for speech. No markdown, lists or emoji.
- Call confirm_deal only when the user's latest words are an explicit yes to the offer you just read; otherwise ask.
- On a no, call decline_deal. For "more options", call find_matches. For news or meet-up details, call get_deal_status.
- A seller's minimum and a buyer's maximum are private. You may repeat the user's own limit back to them, never anyone else's.
- If something is missing (an item, a price), ask one short question.`;
}

export async function bedrockTurn(cfg: Pick<Config, "awsRegion" | "agentModelId">, messages: AgentMessage[], tools: ToolSpec[]) {
  const res = await client(cfg.awsRegion).send(
    new ConverseCommand({
      modelId: cfg.agentModelId,
      system: [{ text: systemPrompt() }],
      messages: messages as Message[],
      toolConfig: { tools: tools as Tool[] },
      inferenceConfig: { maxTokens: 600, temperature: 0.2 },
    }),
  );
  const content: Block[] = [];
  for (const b of res.output?.message?.content ?? []) {
    if (b.text) content.push({ text: b.text });
    else if (b.toolUse?.toolUseId && b.toolUse.name) {
      content.push({ toolUse: { toolUseId: b.toolUse.toolUseId, name: b.toolUse.name, input: (b.toolUse.input ?? {}) as Record<string, unknown> } });
    }
  }
  return { content, stop: res.stopReason === "tool_use" ? ("tool_use" as const) : ("end_turn" as const) };
}
