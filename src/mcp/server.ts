import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONDITIONS } from "../ai/index.js";
import * as market from "../market/service.js";
import type { Deps } from "../market/service.js";
import { outputs } from "./schemas.js";

// The tool surface Alexa+ (or any MCP host) sees. Descriptions say when to
// call each tool and what it returns; the agent reads them to pick a tool.
// Every declared input is honoured, and every result matches its outputSchema.
// Contract: docs/TOOL_CONTRACT.md — change both together.

export interface RequestContext {
  /** Caller identity from the transport (OAuth subject, or X-User-Id in local dev). */
  userId?: string;
}

const condition = z.enum(CONDITIONS);
const userIdArg = z
  .string()
  .optional()
  .describe("The speaking user's id. Omit when the connection already identifies the user.");

// Closed world: every tool acts only on this marketplace.
const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const reads = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

export function createMcpServer(deps: Deps, ctx: RequestContext = {}) {
  const server = new McpServer(
    { name: "voice-market", title: "VoiceMarket", version: "0.2.0" },
    {
      instructions:
        "VoiceMarket pairs people who want to buy something with people who want to sell it, by voice. " +
        "Both sides post: create_listing for sellers, create_buy_intent for buyers. Whenever either side posts, the server " +
        "pairs it with the best counterpart and negotiates a price inside both people's private limits in the same call, " +
        "returning a proposed deal. Read the offer and ask the user; call confirm_deal only after an explicit yes, and " +
        "decline_deal on a no. A deal closes when both buyer and seller have confirmed. Posts that find no counterpart " +
        "wait and are paired when one arrives, so use get_deal_status for news. Private limits (min_price, max_price) are " +
        "never shown to the other side; never ask for or reveal them. Every result has a 'say' field: one short sentence " +
        "you can speak as is.",
    },
  );

  const who = (arg?: string) => {
    const id = ctx.userId ?? arg;
    if (!id) throw new market.MarketError("I don't know who's speaking. Please link your account.");
    return id;
  };

  server.registerTool(
    "create_listing",
    {
      title: "Sell an item",
      description:
        "Post an item the user wants to sell. If a buyer is already waiting for it, the server pairs them and " +
        "negotiates inside both private limits in the same call, and returns the proposed deal. min_price is the " +
        "seller's private lowest price (buyers never see it); with auto_accept the seller pre-approves any deal at or above it.",
      inputSchema: {
        user_id: userIdArg,
        title: z.string().min(1).describe("Short item name, e.g. 'TI-84 Plus graphing calculator'"),
        description: z.string().optional().describe("Details a buyer would care about"),
        category: z.string().optional().describe("One lowercase word, e.g. 'calculator'"),
        condition: condition.optional().describe("Defaults to 'good'"),
        quantity: z.number().int().positive().optional().describe("Units for sale; buyers needing more are not paired"),
        ask_price: z.number().positive().describe("Public asking price"),
        min_price: z.number().positive().optional().describe("PRIVATE lowest price the seller accepts. Defaults to ask_price"),
        auto_accept: z.boolean().optional().describe("Pre-approve any deal at or above min_price (default true)"),
        location: z.string().optional().describe("Meet-up area, e.g. 'HKUST campus'. Buyers in the same area rank higher"),
        availability: z.string().optional().describe("When the seller can meet, e.g. 'weekdays after 5pm'. Shown on the deal"),
      },
      outputSchema: outputs.create_listing,
      annotations: writes,
    },
    (args) => run(() => market.createListing(deps, { ...args, user_id: who(args.user_id) })),
  );

  server.registerTool(
    "create_buy_intent",
    {
      title: "Buy an item",
      description:
        "Post what the user wants to buy. The server pairs the request with the best seller and negotiates inside both " +
        "private limits in the same call: when 'deal' is returned, read the offer and ask the user to confirm. When no " +
        "seller fits yet, the request waits and is paired as soon as one lists. Also returns up to four alternatives. " +
        "Pass the fields you heard plus the user's own words as raw_request so the server can fill gaps.",
      inputSchema: {
        user_id: userIdArg,
        need: z.string().optional().describe("What they need, e.g. 'graphing calculator'"),
        raw_request: z.string().optional().describe("The user's own words, or ambient context"),
        max_price: z.number().positive().optional().describe("PRIVATE budget; required unless stated in raw_request"),
        min_condition: condition.optional().describe("Worst acceptable condition"),
        quantity: z.number().int().positive().optional(),
        needed_by: z.string().optional().describe("ISO 8601 deadline; the request stops pairing after it"),
        location: z.string().optional().describe("Preferred meet-up area; sellers there rank higher"),
        source: z.enum(["voice", "bee_context"]).optional().describe("'bee_context' when inferred from Bee ambient context"),
      },
      outputSchema: outputs.create_buy_intent,
      annotations: writes,
    },
    (args) => run(() => market.createBuyIntent(deps, { ...args, user_id: who(args.user_id) })),
  );

  server.registerTool(
    "find_matches",
    {
      title: "More options",
      description:
        "Other listings for one of the user's buy requests, best first, e.g. when they ask for more options. " +
        "The item already offered to them is not repeated.",
      inputSchema: {
        user_id: userIdArg,
        intent_id: z.string(),
        limit: z.number().int().min(1).max(10).optional().describe("Default 3"),
      },
      outputSchema: outputs.find_matches,
      annotations: reads,
    },
    (args) => run(() => market.findMatches(deps, who(args.user_id), args.intent_id, args.limit)),
  );

  server.registerTool(
    "negotiate",
    {
      title: "Get this one instead",
      description:
        "Negotiate a specific listing the user picked from the options. It replaces the offer the request already " +
        "holds and returns a proposed deal; ask the user, then call confirm_deal. Returns deal: null when no price fits both limits.",
      inputSchema: {
        user_id: userIdArg,
        intent_id: z.string(),
        listing_id: z.string(),
      },
      outputSchema: outputs.negotiate,
      annotations: writes,
    },
    (args) => run(() => market.negotiateDeal(deps, who(args.user_id), args.intent_id, args.listing_id)),
  );

  server.registerTool(
    "confirm_deal",
    {
      title: "Say yes to a deal",
      description:
        "Record the user's yes to a proposed deal. ONLY call after the user explicitly says yes. The deal closes, " +
        "with meet-up details, once both buyer and seller have confirmed.",
      inputSchema: { user_id: userIdArg, deal_id: z.string() },
      outputSchema: outputs.confirm_deal,
      annotations: writes,
    },
    (args) => run(() => market.confirmDeal(deps, who(args.user_id), args.deal_id)),
  );

  server.registerTool(
    "decline_deal",
    {
      title: "Say no to a deal",
      description:
        "Record the user's no to a proposed deal. Both posts go back on the market and are re-paired; the result " +
        "includes the user's next best offer when there is one.",
      inputSchema: { user_id: userIdArg, deal_id: z.string() },
      outputSchema: outputs.decline_deal,
      annotations: { ...writes, destructiveHint: true },
    },
    (args) => run(() => market.declineDeal(deps, who(args.user_id), args.deal_id)),
  );

  server.registerTool(
    "get_deal_status",
    {
      title: "My deals",
      description:
        "The user's deals, those waiting for their yes first, with price, counterpart and meet-up details. " +
        "Use for 'any news?', 'did anyone want my calculator?' or 'when is my meet-up?'.",
      inputSchema: { user_id: userIdArg, deal_id: z.string().optional() },
      outputSchema: outputs.get_deal_status,
      annotations: reads,
    },
    (args) => run(() => market.getDealStatus(deps, who(args.user_id), args.deal_id)),
  );

  return server;
}

/** Wraps a service call: JSON as text + structuredContent; MarketErrors become speakable tool errors. */
async function run(fn: () => Promise<object>) {
  try {
    const result = (await fn()) as Record<string, unknown>;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (err) {
    if (err instanceof market.MarketError) {
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ say: err.message }) }] };
    }
    throw err;
  }
}
