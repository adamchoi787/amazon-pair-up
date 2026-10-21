import { randomUUID } from "node:crypto";
import { Agent, BedrockModel, BeforeToolCallEvent, McpClient, type Model } from "@strands-agents/sdk";

// The PairUp voice agent, built with Strands Agents. Its only tools are
// the PairUp MCP server's, discovered over Streamable HTTP with the
// user's own credentials, so the agent can do exactly what the user could do
// and nothing more. Two guards run outside the model:
//   - confirm_deal is cancelled unless the user's latest words are a yes;
//   - every write carries an idempotency_key, so a transport retry never posts twice.

export interface PairUpAgentOptions {
  /** PairUp MCP endpoint, e.g. https://d3cxpkmhl89rw9.cloudfront.net/mcp */
  mcpUrl: string;
  /** The user's PairUp OAuth access token (production). */
  token?: string;
  /** Local development only (server AUTH_MODE=none): who is speaking. */
  userId?: string;
  modelId: string;
  region: string;
  /** Another model provider (tests use a scripted one); defaults to Bedrock with modelId. */
  model?: Model;
}

const WRITES = new Set(["post_offer", "post_request", "negotiate", "confirm_deal", "decline_deal", "withdraw_post", "report_user", "rate_deal", "accept_suggestion", "dismiss_suggestion", "add_context", "delete_my_data"]);
const YES = /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|confirm|confirmed|do it|go ahead|deal|sounds good|accept|buy it|that one|please do)\b/i;
const NOT = /\b(no|not|don'?t|cancel|decline|wait|stop)\b/i;
const QUALIFIED = /\b(if|unless|provided|assuming|but|only|after|before|except|instead|first|what|why|how|can you|could you)\b|\?/i;
export const isExplicitYes = (text: string) => YES.test(text) && !NOT.test(text) && !QUALIFIED.test(text);

export const systemPrompt = (now = new Date()) => `You are PairUp, a voice assistant that pairs people directly: people who need something with people who have it or can do it, for things to buy and sell and for services such as lunch runs, errands and event help.
Current time: ${now.toISOString()}.
- Use the tools for every marketplace action. Never invent items, prices, people or deals.
- Offering something: post_offer. Needing something: post_request with the user's own words as raw_request.
- Reply in one or two short spoken sentences, usually the result's "say" field. No markdown, lists or emoji.
- Call confirm_deal only when the user's latest words are an explicit yes to the deal you just read; otherwise ask.
- Preserve service availability and requested schedule, using America/Los_Angeles unless the user specifies another IANA time_zone. Use starts_at and ends_at with UTC offsets for exact appointments. A tentative time still needs the helper's yes. Conditional approval ("yes if...", "sure but...") is a constraint to clarify, not consent.
- When asked what the user needs or for news, call get_suggestions. Read a suggestion and wait for yes before accept_suggestion; ask for a budget if missing. On not now use dismiss_suggestion; on forget pass forget true. Explain routines with get_my_routines. Use add_context for a need clause from the user’s Bee data.
- Call delete_my_data with confirm true only after an explicit yes to erasing data.
- On a no call decline_deal; for more options find_matches; for news or meet-ups get_deal_status.
- Private limits (min_price, max_price) belong to their owner: never ask for or reveal anyone else's.
- Prices come from a fixed rule. Never bargain or suggest a price on anyone's behalf.
- An error with code "confirm_price" already asked the user about the price: on a yes call the same tool again with confirm_price true.
- An error with code "prohibited_item" or "restricted_item" means the market doesn't allow that post: say so, and never reword it to get around the rule.
- After a confirmed deal you may ask how it went and call rate_deal with 1-5 stars. If the user complains about someone, confirm, then call report_user.`;

/** Removes the model's <thinking>…</thinking> notes, which are never spoken. */
export const stripThinking = (text: string) => text.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/g, "").trim();

/** Streams text with <thinking> blocks removed, even when a tag is split across deltas. */
export async function* withoutThinking(deltas: AsyncIterable<string>) {
  const OPEN = "<thinking>", CLOSE = "</thinking>";
  let buffer = "", inside = false;
  // Length of the longest buffer suffix that could still begin `tag`.
  const partial = (tag: string) => {
    for (let n = Math.min(tag.length - 1, buffer.length); n > 0; n--) if (tag.startsWith(buffer.slice(-n))) return n;
    return 0;
  };
  for await (const delta of deltas) {
    buffer += delta;
    for (;;) {
      const tag = inside ? CLOSE : OPEN, at = buffer.indexOf(tag);
      if (at === -1) break;
      if (!inside && at > 0) yield buffer.slice(0, at);
      buffer = buffer.slice(at + tag.length);
      inside = !inside;
    }
    const keep = partial(inside ? CLOSE : OPEN);
    if (!inside && buffer.length > keep) yield buffer.slice(0, buffer.length - keep);
    buffer = buffer.slice(buffer.length - keep);
  }
  if (!inside && buffer) yield buffer;
}

export function createPairUpAgent(o: PairUpAgentOptions) {
  const headers: Record<string, string> = {};
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  else if (o.userId) headers["X-User-Id"] = o.userId;

  const mcp = new McpClient({ url: o.mcpUrl, headers, applicationName: "pairup-agentcore", applicationVersion: "0.8.0" });
  const agent = new Agent({
    model: o.model ?? new BedrockModel({ region: o.region, modelId: o.modelId, temperature: 0.2, maxTokens: 600 }),
    tools: [mcp],
    systemPrompt: systemPrompt(),
    printer: false,
  });

  let lastUserText = "";
  agent.addHook(BeforeToolCallEvent, (event) => {
    const name = event.toolUse.name;
    if (["confirm_deal", "accept_suggestion", "delete_my_data"].includes(name) && !isExplicitYes(lastUserText) && !(name === "accept_suggestion" && /^\s*\$?\d+(?:\.\d{1,2})?\s*(?:dollars?|bucks)?\s*$/i.test(lastUserText))) {
      event.cancel = "The user has not approved this action yet. Ask for their explicit yes.";
      return;
    }
    if (WRITES.has(name)) {
      const input = (event.toolUse.input ?? {}) as Record<string, unknown>;
      event.toolUse.input = { idempotency_key: randomUUID(), ...input };
    }
  });

  return {
    agent,
    mcp,
    /** One user turn: their words in, the spoken reply out. */
    async ask(text: string) {
      lastUserText = text;
      const result = await agent.invoke(text);
      return stripThinking(result.toString());
    },
    /** One user turn, streamed as spoken text deltas. */
    async *stream(text: string) {
      lastUserText = text;
      async function* deltas() {
        for await (const event of agent.stream(text)) {
          if (event.type !== "modelStreamUpdateEvent") continue;
          const e = event.event;
          if (e.type === "modelContentBlockDeltaEvent" && e.delta.type === "textDelta") yield e.delta.text;
        }
      }
      yield* withoutThinking(deltas());
    },
    close: () => mcp.disconnect(),
  };
}

export type PairUpAgent = ReturnType<typeof createPairUpAgent>;
