import { randomUUID } from "node:crypto";
import { Agent, BedrockModel, BeforeToolCallEvent, McpClient, type Model } from "@strands-agents/sdk";

// The AmazonPairUp voice agent, built with Strands Agents. Its only tools are
// the AmazonPairUp MCP server's, discovered over Streamable HTTP with the
// user's own credentials, so the agent can do exactly what the user could do
// and nothing more. Two guards run outside the model:
//   - confirm_deal is cancelled unless the user's latest words are a yes;
//   - every write carries an idempotency_key, so a transport retry never posts twice.

export interface PairUpAgentOptions {
  /** AmazonPairUp MCP endpoint, e.g. https://d3cxpkmhl89rw9.cloudfront.net/mcp */
  mcpUrl: string;
  /** The user's AmazonPairUp OAuth access token (production). */
  token?: string;
  /** Local development only (server AUTH_MODE=none): who is speaking. */
  userId?: string;
  modelId: string;
  region: string;
  /** Another model provider (tests use a scripted one); defaults to Bedrock with modelId. */
  model?: Model;
}

const WRITES = new Set(["post_offer", "post_request", "negotiate", "confirm_deal", "decline_deal", "withdraw_post", "report_user", "rate_deal"]);
const YES = /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|confirm|confirmed|do it|go ahead|deal|sounds good|accept|buy it|that one|please do)\b/i;
const NOT = /\b(no|not|don'?t|cancel|decline|wait|stop)\b/i;
export const isExplicitYes = (text: string) => YES.test(text) && !NOT.test(text);

export const systemPrompt = (now = new Date()) => `You are AmazonPairUp, a voice assistant that pairs people directly: people who need something with people nearby who have it or can do it, for things to buy and sell and for services such as lunch runs, errands and event help.
Current time: ${now.toISOString()}.
- Use the tools for every marketplace action. Never invent items, prices, people or deals.
- Offering something: post_offer. Needing something: post_request with the user's own words as raw_request.
- Reply in one or two short spoken sentences, usually the result's "say" field. No markdown, lists or emoji.
- Call confirm_deal only when the user's latest words are an explicit yes to the deal you just read; otherwise ask.
- On a no call decline_deal; for more options find_matches; for news or meet-ups get_deal_status.
- Private limits (min_price, max_price) belong to their owner: never ask for or reveal anyone else's.
- Prices come from a fixed rule. Never bargain or suggest a price on anyone's behalf.
- An error with code "confirm_price" already asked the user about the price: on a yes call the same tool again with confirm_price true.
- An error with code "prohibited_item" or "restricted_item" means the market doesn't allow that post: say so, and never reword it to get around the rule.
- After a confirmed deal you may ask how it went and call rate_deal with 1-5 stars. If the user complains about someone, confirm, then call report_user.`;

export function createPairUpAgent(o: PairUpAgentOptions) {
  const headers: Record<string, string> = {};
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  else if (o.userId) headers["X-User-Id"] = o.userId;

  const mcp = new McpClient({ url: o.mcpUrl, headers, applicationName: "amazonpairup-agentcore", applicationVersion: "0.1.0" });
  const agent = new Agent({
    model: o.model ?? new BedrockModel({ region: o.region, modelId: o.modelId, temperature: 0.2, maxTokens: 600 }),
    tools: [mcp],
    systemPrompt: systemPrompt(),
    printer: false,
  });

  let lastUserText = "";
  agent.addHook(BeforeToolCallEvent, (event) => {
    const name = event.toolUse.name;
    if (name === "confirm_deal" && !isExplicitYes(lastUserText)) {
      event.cancel = "The user has not said yes to this deal yet. Ask them: Should I confirm it?";
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
      return result.toString().trim();
    },
    /** One user turn, streamed as text deltas. */
    async *stream(text: string) {
      lastUserText = text;
      for await (const event of agent.stream(text)) {
        if (event.type !== "modelStreamUpdateEvent") continue;
        const e = event.event;
        if (e.type === "modelContentBlockDeltaEvent" && e.delta.type === "textDelta") yield e.delta.text;
      }
    },
    close: () => mcp.disconnect(),
  };
}

export type PairUpAgent = ReturnType<typeof createPairUpAgent>;
