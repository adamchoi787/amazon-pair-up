import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import type { Deps } from "../market/service.js";
import { createMcpServer } from "../mcp/server.js";
import { handleAgentTurn } from "./index.js";
import type { AgentMessage, Block } from "./types.js";

// The whole assistant loop on the server, for devices that can only send words
// and read a sentence back: an Apple Watch Shortcut ("Hey Siri, PairUp") or a
// phone automation. Each step is the same /api/agent step the web app uses
// (Bedrock or the offline planner, with the explicit-yes guard); the tools run
// over an in-process MCP client as the device's user. A short history per
// device lets "yes" answer the offer from the previous call.

const MAX_STEPS = 6;
const HISTORY_MINUTES = 10;
const KEEP_MESSAGES = 24;

interface Conversation { messages: AgentMessage[]; at: number }
const conversations = new Map<string, Conversation>();

export interface VoiceReply {
  say: string;
  /** The last tool result (a deal, suggestions…), for a screen to draw. */
  result: Record<string, unknown> | null;
  tool: string | null;
}

export async function runVoiceTurn(deps: Deps, cfg: Config, userId: string, conversationKey: string, text: string): Promise<VoiceReply> {
  const now = Date.now();
  for (const [k, c] of conversations) if (now - c.at > HISTORY_MINUTES * 60_000) conversations.delete(k);
  const convo = conversations.get(conversationKey) ?? { messages: [], at: now };
  const messages = [...convo.messages, { role: "user" as const, content: [{ text: text.slice(0, 1000) }] }];

  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps, { userId });
  await server.connect(serverSide);
  const client = new Client({ name: "amazonpairup-voice", version: "1.0.0" });
  await client.connect(clientSide);
  let last: VoiceReply = { say: "", result: null, tool: null };
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const turn = await handleAgentTurn(deps, cfg, { messages: trim(messages) });
      messages.push(turn.message);
      const uses = turn.message.content.flatMap((b) => ("toolUse" in b ? [b.toolUse] : []));
      if (turn.stop === "end_turn" || !uses.length) {
        last.say = turn.message.content.flatMap((b) => ("text" in b ? [b.text] : [])).join(" ") || "Done.";
        break;
      }
      const results: Block[] = [];
      for (const use of uses) {
        const r = (await client.callTool({ name: use.name, arguments: use.input })) as CallToolResult;
        const data = dataOf(r);
        if (!r.isError) last = { ...last, result: data, tool: use.name };
        results.push({ toolResult: { toolUseId: use.toolUseId, content: [{ json: data }], status: r.isError ? "error" : "success" } });
      }
      messages.push({ role: "user", content: results });
    }
  } finally {
    await client.close();
    await server.close();
  }
  if (!last.say) last.say = "Sorry, that took too many steps. Please try again.";
  // Keep the history valid for the next call: it must end with the assistant.
  while (messages.length && messages[messages.length - 1].role === "user") messages.pop();
  conversations.set(conversationKey, { messages: messages.slice(-KEEP_MESSAGES), at: now });
  return last;
}

function dataOf(r: CallToolResult): Record<string, unknown> {
  if (r.structuredContent) return r.structuredContent as Record<string, unknown>;
  const text = r.content?.find((c) => c.type === "text")?.text;
  try {
    return JSON.parse(text ?? "{}") as Record<string, unknown>;
  } catch {
    return { say: text ?? "" };
  }
}

/** The newest stretch that starts with the user's words and alternates roles. */
function trim(all: AgentMessage[]) {
  let i = Math.max(0, all.length - KEEP_MESSAGES);
  while (i < all.length && !(all[i].role === "user" && all[i].content.some((b) => "text" in b))) i++;
  return all.slice(i);
}
