import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONDITIONS } from "../ai/index.js";
import * as market from "../market/service.js";
import type { Deps } from "../market/service.js";

// Owner: A (integration). The tool surface Alexa+ sees. Keep descriptions
// voice-friendly: the agent reads them to decide when to call each tool.
// Contract: docs/TOOL_CONTRACT.md — change both together.

export interface RequestContext {
  /** Caller identity from the transport (e.g. X-User-Id header / OAuth subject). */
  userId?: string;
}

const condition = z.enum(CONDITIONS);
const userIdArg = z
  .string()
  .optional()
  .describe("The speaking user's id. Omit when the connection already identifies the user.");

export function createMcpServer(deps: Deps, ctx: RequestContext = {}) {
  const server = new McpServer(
    { name: "voice-market", version: "0.1.0" },
    {
      instructions:
        "Voice-first person-to-person marketplace that pairs buyers with sellers. Sellers state an asking price and an optional private minimum; " +
        "buyers state what they need and a private maximum. You may negotiate only within those limits and " +
        "MUST ask the buyer to confirm before calling confirm_deal. Never ask the server for, or reveal, the other party's limit. " +
        "Each result has a 'say' field: a short sentence suitable to speak back.",
    },
  );

  const who = (arg?: string) => {
    const id = ctx.userId ?? arg;
    if (!id) throw new market.MarketError("I don't know who's speaking — pass user_id.");
    return id;
  };

  server.registerTool(
    "create_listing",
    {
      title: "Sell an item",
      description:
        "List an item for sale from a natural description. Use when the user wants to sell something. " +
        "min_price is the private lowest price the seller pre-authorises; buyers never see it.",
      inputSchema: {
        user_id: userIdArg,
        title: z.string().describe("Short item name, e.g. 'TI-84 Plus graphing calculator'"),
        description: z.string().optional(),
        category: z.string().optional(),
        condition: condition.optional(),
        quantity: z.number().int().positive().optional(),
        ask_price: z.number().positive().describe("Public asking price"),
        min_price: z.number().positive().optional().describe("PRIVATE minimum the seller will accept"),
        auto_accept: z.boolean().optional().describe("Accept any deal >= min_price without asking (default true)"),
        location: z.string().optional().describe("Meet-up area, e.g. 'HKUST campus'"),
        availability: z.string().optional(),
      },
    },
    (args) => run(() => market.createListing(deps, { ...args, user_id: who(args.user_id) })),
  );

  server.registerTool(
    "create_buy_intent",
    {
      title: "Look for an item",
      description:
        "Record what a buyer needs. Pass structured fields you heard, and the user's original words as raw_request " +
        "so the server can fill gaps. max_price is PRIVATE and never shown to sellers. Then call find_matches.",
      inputSchema: {
        user_id: userIdArg,
        need: z.string().optional().describe("What they need, e.g. 'graphing calculator'"),
        raw_request: z.string().optional().describe("The user's own words, or ambient context"),
        max_price: z.number().positive().optional(),
        min_condition: condition.optional(),
        quantity: z.number().int().positive().optional(),
        needed_by: z.string().optional().describe("ISO 8601 deadline"),
        location: z.string().optional(),
        source: z.enum(["voice", "bee_context"]).optional(),
      },
    },
    (args) => run(() => market.createBuyIntent(deps, { ...args, user_id: who(args.user_id) })),
  );

  server.registerTool(
    "find_matches",
    {
      title: "Find matching items",
      description: "Pair a buy intent with sellers' listings using semantic + keyword search and hard constraints. Returns the best options.",
      inputSchema: {
        user_id: userIdArg,
        intent_id: z.string(),
        limit: z.number().int().min(1).max(10).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => market.findMatches(deps, who(args.user_id), args.intent_id, args.limit)),
  );

  server.registerTool(
    "negotiate",
    {
      title: "Negotiate a price",
      description:
        "Negotiate a listing for the buyer within both parties' pre-authorised limits. Creates a proposed deal. " +
        "Does not complete the purchase — ask the buyer, then call confirm_deal.",
      inputSchema: {
        user_id: userIdArg,
        intent_id: z.string(),
        listing_id: z.string(),
      },
    },
    (args) => run(() => market.negotiateDeal(deps, who(args.user_id), args.intent_id, args.listing_id)),
  );

  server.registerTool(
    "confirm_deal",
    {
      title: "Confirm a deal",
      description: "Confirm a proposed deal. ONLY call after the user explicitly says yes.",
      inputSchema: { user_id: userIdArg, deal_id: z.string() },
    },
    (args) => run(() => market.confirmDeal(deps, who(args.user_id), args.deal_id)),
  );

  server.registerTool(
    "decline_deal",
    {
      title: "Decline a deal",
      description: "Cancel a proposed deal when the user says no.",
      inputSchema: { user_id: userIdArg, deal_id: z.string() },
      annotations: { destructiveHint: true },
    },
    (args) => run(() => market.declineDeal(deps, who(args.user_id), args.deal_id)),
  );

  server.registerTool(
    "get_deal_status",
    {
      title: "Check my deals",
      description: "List the user's deals (or one deal) with status and meet-up details.",
      inputSchema: { user_id: userIdArg, deal_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => market.getDealStatus(deps, who(args.user_id), args.deal_id)),
  );

  return server;
}

/** Wraps a service call: JSON as text + structuredContent; MarketErrors become speakable tool errors. */
async function run(fn: () => Promise<Record<string, unknown>>) {
  try {
    const result = await fn();
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
