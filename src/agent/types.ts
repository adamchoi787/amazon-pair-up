import { z } from "zod";

// The web app and the agent exchange messages in the Amazon Bedrock Converse
// shape, so the same history works for Bedrock and for the offline planner.

const json = z.record(z.string(), z.unknown());

const block = z.union([
  z.object({ text: z.string().max(4000) }).strict(),
  z.object({
    toolUse: z.object({ toolUseId: z.string().max(100), name: z.string().max(64), input: json }).strict(),
  }).strict(),
  z.object({
    toolResult: z.object({
      toolUseId: z.string().max(100),
      content: z.array(z.union([z.object({ json }).strict(), z.object({ text: z.string().max(20_000) }).strict()])).max(4),
      status: z.enum(["success", "error"]).optional(),
    }).strict(),
  }).strict(),
]);

export const agentRequest = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.array(block).min(1).max(8) }).strict())
    .min(1)
    .max(40)
    .refine((m) => m.length > 0 && m[0].role === "user" && m[m.length - 1].role === "user", "messages must start and end with the user")
    .refine((m) => m.every((x, i) => i === 0 || x.role !== m[i - 1].role), "roles must alternate"),
});

export type Block = z.infer<typeof block>;
export type AgentMessage = z.infer<typeof agentRequest>["messages"][number];

export type TextBlock = Extract<Block, { text: string }>;
export type ToolUseBlock = Extract<Block, { toolUse: unknown }>;
export type ToolResultBlock = Extract<Block, { toolResult: unknown }>;

export interface AgentTurn {
  message: { role: "assistant"; content: Block[] };
  /** "tool_use": run the tool calls over MCP and send the results back. */
  stop: "tool_use" | "end_turn";
  mode: "bedrock" | "offline";
}

export const isText = (b: Block): b is TextBlock => "text" in b;
export const isToolUse = (b: Block): b is ToolUseBlock => "toolUse" in b;
export const isToolResult = (b: Block): b is ToolResultBlock => "toolResult" in b;

/** The user's most recent spoken or typed words. */
export function lastUserText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const t = messages[i].content.find(isText);
    if (t) return t.text;
  }
  return "";
}

const YES = /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|confirm|confirmed|do it|go ahead|deal|sounds good|accept|buy it|that one|please do)\b/i;
const NOT = /\b(no|not|don'?t|cancel|decline|wait|stop)\b/i;

/** An explicit yes: affirmative words up front and no negation anywhere. */
export const isExplicitYes = (text: string) => YES.test(text) && !NOT.test(text);
