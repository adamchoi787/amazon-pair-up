import type { Config } from "../config.js";
import type { Deps } from "../market/service.js";
import { bedrockTurn } from "./bedrock.js";
import { planOffline } from "./offline.js";
import { toolSpecs } from "./tools.js";
import { agentRequest, isExplicitYes, isToolUse, lastUserText, type AgentTurn, type Block } from "./types.js";

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
  if (mode === "bedrock") {
    try {
      step = await bedrockTurn(cfg, messages, await toolSpecs(deps));
    } catch (err) {
      // Throttling or an outage: the offline planner keeps the app usable.
      console.warn("[agent] Bedrock step failed, using the offline planner:", (err as Error).message);
      step = planOffline(messages);
    }
  } else {
    step = planOffline(messages);
  }
  const content = requireExplicitYes(step.content, lastUserText(messages));
  return { message: { role: "assistant", content }, stop: content.some(isToolUse) ? step.stop : "end_turn", mode };
}

/**
 * A deal is only confirmed on the user's explicit yes, whatever the model
 * decides: a confirm_deal call without one becomes a question.
 */
export function requireExplicitYes(content: Block[], userText: string): Block[] {
  if (!content.some((b) => isToolUse(b) && b.toolUse.name === "confirm_deal") || isExplicitYes(userText)) return content;
  return [{ text: "Just to be sure: should I confirm it?" }];
}
