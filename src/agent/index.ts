import type { Config } from "../config.js";
import { log } from "../http/log.js";
import type { Deps } from "../market/service.js";
import { bedrockTurn } from "./bedrock.js";
import { planOffline, spokenLines, WITHDRAW } from "./offline.js";
import { toolSpecs } from "./tools.js";
import {
  agentRequest, isExplicitYes, isToolResult, isToolUse, lastUserText, type AgentMessage, type AgentTurn, type Block,
} from "./types.js";

// One step of the web app's assistant. The browser is the MCP host: it sends
// the conversation here, runs any tool calls this returns over /mcp with the
// user's own token, and sends the results back for the next step.

export type AgentMode = "bedrock" | "offline";

export const agentMode = (cfg: Pick<Config, "aiMode" | "agentModelId">): AgentMode =>
  cfg.aiMode === "bedrock" && cfg.agentModelId ? "bedrock" : "offline";

class BadRequest extends Error {
  status = 400;
}

export async function handleAgentTurn(deps: Deps, cfg: Config, body: unknown): Promise<AgentTurn> {
  const parsed = agentRequest.safeParse(body);
  if (!parsed.success) throw new BadRequest(parsed.error.issues[0]?.message ?? "invalid request");
  const { messages } = parsed.data;

  const mode = agentMode(cfg);
  let step: { content: Block[]; stop: "tool_use" | "end_turn" };
  const spoken = mode === "bedrock" ? sayFromResults(messages) : null;
  if (spoken) {
    // The tool already phrased the outcome for speech: say it, skip a model round trip.
    step = { content: [{ text: spoken }], stop: "end_turn" };
  } else if (mode === "bedrock") {
    try {
      step = await bedrockTurn(cfg, messages, await toolSpecs(deps));
    } catch (err) {
      // Throttling or an outage: the offline planner keeps the app usable.
      log("warn", "Bedrock agent step failed; using the offline planner", { error: (err as Error).message });
      step = planOffline(messages);
    }
  } else {
    step = planOffline(messages);
  }
  const content = requireExplicitYes(step.content, lastUserText(messages));
  return { message: { role: "assistant", content }, stop: content.some(isToolUse) ? step.stop : "end_turn", mode };
}

/**
 * When the conversation ends in tool results that each carry a spoken 'say',
 * those sentences are the reply. The model still gets the next step when it
 * has more to do: a listing lookup on the way to taking a post down.
 */
export function sayFromResults(messages: AgentMessage[]): string | null {
  const results = messages[messages.length - 1].content.filter(isToolResult);
  if (!results.length) return null;
  const toolOf = (id: string) => {
    for (const m of messages) for (const b of m.content) if (isToolUse(b) && b.toolUse.toolUseId === id) return b.toolUse.name;
    return undefined;
  };
  if (results.some((r) => toolOf(r.toolResult.toolUseId) === "list_my_posts") && WITHDRAW.test(lastUserText(messages))) return null;
  for (const r of results) {
    const json = r.toolResult.content.find((c): c is { json: Record<string, unknown> } => "json" in c)?.json;
    if (typeof json?.say !== "string" || !json.say) return null;
  }
  return spokenLines(messages, results);
}

/**
 * A deal is only confirmed on the user's explicit yes, whatever the model
 * decides: a confirm_deal call without one becomes a question.
 */
export function requireExplicitYes(content: Block[], userText: string): Block[] {
  if (!content.some((b) => isToolUse(b) && b.toolUse.name === "confirm_deal") || isExplicitYes(userText)) return content;
  return [{ text: "Just to be sure: should I confirm it?" }];
}
