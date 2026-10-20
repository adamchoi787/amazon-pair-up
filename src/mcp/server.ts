import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { CONDITIONS } from "../ai/index.js";
import * as market from "../market/service.js";
import type { Deps } from "../market/service.js";
import { KINDS, SERVICE_UNITS } from "../market/types.js";
import { registerViews, VIEWS, type ViewName } from "./apps.js";
import { outputs } from "./schemas.js";

// The tool surface Alexa+ (or any MCP host) sees. Descriptions say when to
// call each tool and what it returns; the agent reads them to pick a tool.
// Every declared input is honoured and bounded, and every result matches its
// outputSchema. Contract: docs/TOOL_CONTRACT.md — change both together.

export interface RequestContext {
  /** Caller identity from the transport (OAuth subject, or X-User-Id in local dev). */
  userId?: string;
}

const condition = z.enum(CONDITIONS);
const kind = z.enum(KINDS);
const unit = z.enum(SERVICE_UNITS);
const text = (max: number) => z.string().trim().min(1).max(max);
const price = z.number().positive().max(100_000);
const id = z.string().max(64);
const userIdArg = z
  .string()
  .max(128)
  .optional()
  .describe("The speaking user's id. Omit when the connection already identifies the user.");

// Closed world: every tool acts only on this marketplace.
const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const reads = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

export function createMcpServer(deps: Deps, ctx: RequestContext = {}) {
  const server = new McpServer(
    { name: "amazon-pairup", title: "AmazonPairUp", version: "0.4.0" },
    {
      instructions:
        "AmazonPairUp pairs people directly, by voice: people who need something with people who have it or can do it. " +
        "That covers things (a graphing calculator) and services (someone to pick up lunch, a helper for an event at " +
        "$10 an hour). Both sides post: post_offer for what the user has or can do, post_request for what they need. " +
        "Whenever either side posts, the server pairs it with the best counterpart and negotiates a price inside both " +
        "people's private limits in the same call, returning a proposed deal. Read the offer and ask the user; call " +
        "confirm_deal only after an explicit yes, and decline_deal on a no. A deal closes when both sides have confirmed; " +
        "an unanswered offer expires and both posts are paired again. Posts that find no counterpart wait and are paired " +
        "when one arrives, so use get_deal_status for news and list_my_posts / withdraw_post to manage posts. Private " +
        "limits (min_price, max_price) are never shown to the other side; never ask for or reveal them. Every result has " +
        "a 'say' field: one short sentence you can speak as is.",
    },
  );

  registerViews(server);
  /** Tool metadata that points MCP Apps hosts (and Alexa+) at the tool's view. */
  const ui = (view: ViewName) => ({ ui: { resourceUri: VIEWS[view].uri } });

  const who = (arg?: string) => {
    const userId = ctx.userId ?? arg;
    if (!userId) throw new market.MarketError("I don't know who's speaking. Please link your account.");
    return userId;
  };

  registerAppTool(
    server,
    "post_offer",
    {
      _meta: ui("market"),
      title: "Offer an item or a service",
      description:
        "Post something the user has to sell (kind 'item') or can do for others (kind 'service': lunch runs, errands, " +
        "deliveries, event help, tutoring). If someone is already waiting for it, the server pairs them and negotiates " +
        "inside both private limits in the same call, and returns the proposed deal. min_price is the user's private " +
        "lowest price (nobody sees it); with auto_accept the user pre-approves any deal at or above it. A service offer " +
        "stays open after each booked job.",
      inputSchema: {
        user_id: userIdArg,
        kind: kind.optional().describe("'item' to sell a thing (default), 'service' to offer to do a task"),
        title: text(120).describe("Short name, e.g. 'TI-84 Plus graphing calculator' or 'Lunch runs around campus'"),
        description: z.string().max(1000).optional().describe("Details the other side would care about"),
        category: text(40).optional().describe("One lowercase word, e.g. 'calculator', 'delivery', 'event'"),
        price_unit: unit.optional().describe("Services: 'job' for a flat fee per task (default), 'hour' for an hourly rate"),
        ask_price: price.describe("Public price: for an item the asking price, for a service the fee per job or per hour"),
        min_price: price.optional().describe("PRIVATE lowest price the user accepts. Defaults to ask_price"),
        auto_accept: z.boolean().optional()
          .describe("Pre-approve any deal at or above min_price. Default true for items, false for services (the user says yes to each job)"),
        condition: condition.optional().describe("Items: defaults to 'good'"),
        quantity: z.number().int().positive().max(1000).optional().describe("Items: units for sale; buyers needing more are not paired"),
        location: text(120).optional().describe("Items: meet-up area. Services: the area the user covers, e.g. 'HKUST campus'. Requests there rank higher"),
        availability: text(120).optional().describe("When the user can meet or work, e.g. 'weekdays 11am-2pm'. Shown on the deal"),
      },
      outputSchema: outputs.post_offer,
      annotations: writes,
    },
    (args) => run(() => market.postOffer(deps, { ...args, user_id: who(args.user_id) }), "market"),
  );

  registerAppTool(
    server,
    "post_request",
    {
      _meta: ui("market"),
      title: "Ask for an item or a service",
      description:
        "Post what the user needs: an item to buy, or someone to do a task (pick up lunch, run an errand, help at an " +
        "event). The server pairs the request with the best offer and negotiates inside both private limits in the same " +
        "call: when 'deal' is returned, read the offer and ask the user to confirm. When nothing fits yet, the request " +
        "waits and is paired as soon as someone offers. Also returns up to four alternatives. Pass the fields you heard " +
        "plus the user's own words as raw_request; the server reads kind, price unit, hours, pickup and time from them " +
        "when you leave those out.",
      inputSchema: {
        user_id: userIdArg,
        need: text(200).optional().describe("The item ('graphing calculator') or the task ('pick up my lunch')"),
        raw_request: text(1000).optional().describe("The user's own words, or ambient context"),
        kind: kind.optional().describe("'service' when someone should do a task; 'item' to buy a thing"),
        max_price: price.optional().describe("PRIVATE budget, per hour for hourly work; required unless stated in raw_request"),
        price_unit: unit.optional().describe("Services: 'job' for a flat fee (default), 'hour' for an hourly rate"),
        hours: z.number().positive().max(336).optional().describe("Hourly work: how long it lasts, used for the total"),
        pickup: text(120).optional().describe("Errands: where to collect from, e.g. 'LG7 canteen'"),
        location: text(120).optional().describe("Items: preferred meet-up area. Services: where the job is or where to deliver"),
        schedule: text(80).optional().describe("Services: when, as said, e.g. 'today by 12:30' or 'Saturday 2-6pm'"),
        needed_by: z.string().max(40).optional()
          .describe("ISO 8601: an item's deadline or a job's start time; the request stops pairing after it and offers expire by then"),
        min_condition: condition.optional().describe("Items: worst acceptable condition"),
        quantity: z.number().int().positive().max(1000).optional().describe("Items: how many"),
        source: z.enum(["voice", "bee_context"]).optional().describe("'bee_context' when inferred from Bee ambient context"),
      },
      outputSchema: outputs.post_request,
      annotations: writes,
    },
    (args) => run(() => market.postRequest(deps, { ...args, user_id: who(args.user_id) }), "market"),
  );

  registerAppTool(
    server,
    "find_matches",
    {
      _meta: ui("market"),
      title: "More options",
      description:
        "Other offers for one of the user's requests, best first, e.g. when they ask for more options. " +
        "The offer already proposed to them is not repeated.",
      inputSchema: {
        user_id: userIdArg,
        request_id: id,
        limit: z.number().int().min(1).max(10).optional().describe("Default 3"),
      },
      outputSchema: outputs.find_matches,
      annotations: reads,
    },
    (args) => run(() => market.findMatches(deps, who(args.user_id), args.request_id, args.limit), "market"),
  );

  registerAppTool(
    server,
    "negotiate",
    {
      _meta: ui("market"),
      title: "Get this one instead",
      description:
        "Negotiate a specific offer the user picked from the options. It replaces the deal the request already " +
        "holds and returns a proposed deal; ask the user, then call confirm_deal. Returns deal: null when no price fits both limits.",
      inputSchema: { user_id: userIdArg, request_id: id, offer_id: id },
      outputSchema: outputs.negotiate,
      annotations: writes,
    },
    (args) => run(() => market.negotiateDeal(deps, who(args.user_id), args.request_id, args.offer_id), "market"),
  );

  registerAppTool(
    server,
    "confirm_deal",
    {
      _meta: ui("market"),
      title: "Say yes to a deal",
      description:
        "Record the user's yes to a proposed deal. ONLY call after the user explicitly says yes. The deal closes, " +
        "with where and when to meet, once both sides have confirmed.",
      inputSchema: { user_id: userIdArg, deal_id: id },
      outputSchema: outputs.confirm_deal,
      annotations: writes,
    },
    (args) => run(() => market.confirmDeal(deps, who(args.user_id), args.deal_id), "market"),
  );

  registerAppTool(
    server,
    "decline_deal",
    {
      _meta: ui("market"),
      title: "Say no to a deal",
      description:
        "Record the user's no to a proposed deal. Both posts go back on the market and are re-paired; the result " +
        "includes the user's next best offer when there is one.",
      inputSchema: { user_id: userIdArg, deal_id: id },
      outputSchema: outputs.decline_deal,
      annotations: { ...writes, destructiveHint: true },
    },
    (args) => run(() => market.declineDeal(deps, who(args.user_id), args.deal_id), "market"),
  );

  registerAppTool(
    server,
    "get_deal_status",
    {
      _meta: ui("market"),
      title: "My deals",
      description:
        "The user's deals and booked jobs, those waiting for their yes first, with price, counterpart, place and time. " +
        "Use for 'any news?', 'did anyone want my calculator?', 'any jobs for me?' or 'when is my meet-up?'.",
      inputSchema: { user_id: userIdArg, deal_id: id.optional() },
      outputSchema: outputs.get_deal_status,
      annotations: reads,
    },
    (args) => run(() => market.getDealStatus(deps, who(args.user_id), args.deal_id), "market"),
  );

  registerAppTool(
    server,
    "list_my_posts",
    {
      _meta: ui("market"),
      title: "My offers and requests",
      description:
        "The user's own offers (items for sale, services on offer) and requests, newest first, with their status. " +
        "Use for 'what am I selling?' or before withdraw_post to find the right post.",
      inputSchema: { user_id: userIdArg },
      outputSchema: outputs.list_my_posts,
      annotations: reads,
    },
    (args) => run(() => market.listMyPosts(deps, who(args.user_id)), "market"),
  );

  server.registerTool(
    "withdraw_post",
    {
      title: "Take down a post",
      description:
        "Take down one of the user's offers or cancel one of their requests. A deal it was holding is released and " +
        "the other person is paired again. Confirm with the user first.",
      inputSchema: { user_id: userIdArg, post_id: id.describe("offer_id or request_id from list_my_posts") },
      outputSchema: outputs.withdraw_post,
      annotations: { ...writes, destructiveHint: true, idempotentHint: true },
    },
    (args) => run(() => market.withdrawPost(deps, who(args.user_id), args.post_id)),
  );

  return server;
}

/**
 * Wraps a service call: JSON as text + structuredContent. Errors the user can
 * act on become speakable tool errors; anything unexpected is logged and the
 * user still hears a sentence, so Alexa never meets an empty result.
 */
async function run(fn: () => Promise<object>, view?: ViewName) {
  try {
    const result = (await fn()) as Record<string, unknown>;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result,
      // Alexa+ renders the view named in the result; other hosts use the tool's metadata.
      ...(view ? { _meta: { ui: { resourceUri: VIEWS[view].uri } } } : {}),
    };
  } catch (err) {
    const known = err instanceof market.MarketError;
    if (!known) console.error("[tool] unexpected error", err);
    const say = known ? err.message : "Sorry, something went wrong on my side. Please try again in a moment.";
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ say }) }] };
  }
}
