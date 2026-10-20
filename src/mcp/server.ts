import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { CONDITIONS } from "../ai/index.js";
import { log, metric } from "../http/log.js";
import { once } from "../market/idempotency.js";
import * as suggestions from "../market/context.js";
import * as market from "../market/service.js";
import type { Deps } from "../market/service.js";
import { KINDS, REQUEST_SOURCES, SERVICE_UNITS } from "../market/types.js";
import { registerViews, VIEWS, type ViewName } from "./apps.js";
import { registerPrompts } from "./prompts.js";
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

const confirmPrice = z.boolean().optional().describe(
  "Only after an error with code 'confirm_price': the user heard the usual range and confirmed this price anyway",
);

const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,64}$/).optional().describe(
  "Optional, 8-64 characters, unique per action (e.g. a UUID). Send the same key when retrying after a timeout: " +
    "the first result comes back and nothing is posted or changed twice.",
);

// Closed world: every tool acts only on this marketplace.
const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const reads = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

/** Shown in initialize and in the server card (/.well-known/mcp/server-card.json). */
export const SERVER_INFO = { name: "amazon-pairup", title: "AmazonPairUp", version: "0.5.0" };

export function createMcpServer(deps: Deps, ctx: RequestContext = {}) {
  const server = new McpServer(
    SERVER_INFO,
    {
      instructions:
        "AmazonPairUp pairs people directly, by voice: people who need something with people who have it or can do it. " +
        "That covers things (a graphing calculator) and services (someone to pick up lunch, a helper for an event at " +
        "$10 an hour). Both sides post: post_offer for what the user has or can do, post_request for what they need. " +
        "Whenever either side posts, the server pairs it with the best counterpart and settles a price inside both " +
        "people's private limits in the same call, returning a proposed deal. Read the offer and ask the user; call " +
        "confirm_deal only after an explicit yes, and decline_deal on a no. A deal closes when both sides have confirmed; " +
        "an unanswered offer expires and both posts are paired again. Posts that find no counterpart wait and are paired " +
        "when one arrives, so use get_deal_status for news and list_my_posts / withdraw_post to manage posts. Private " +
        "limits (min_price, max_price) are never shown to the other side; never ask for or reveal them. Prices are settled " +
        "by a fixed rule, never by haggling: the asking price, or a lower budget as an offer the seller's minimum accepts. " +
        "A buyer gets one such offer per offer; after a no, the asking price stands (negotiate with max_price on a yes). " +
        "A price far from what similar things go for returns an error with code 'confirm_price': read its 'say', then " +
        "call again with confirm_price: true if the user confirms, or with the price they meant. Every result has " +
        "a 'say' field: one short sentence you can speak as is. Write tools take an optional idempotency_key: " +
        "send a fresh one per action and the same one on a retry, so nothing is posted or confirmed twice.",
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

  /** A tool that changes the market: identified, and retry-safe with an idempotency_key. */
  const write = <A extends { user_id?: string; idempotency_key?: string }>(
    tool: string, args: A, fn: (userId: string) => Promise<object>, view?: ViewName,
  ) =>
    run(tool, () => {
      const userId = who(args.user_id);
      return once(deps.db, { userId, tool, key: args.idempotency_key, args: args as Record<string, unknown> }, () => fn(userId));
    }, view);

  registerAppTool(
    server,
    "post_offer",
    {
      _meta: ui("market"),
      title: "Offer an item or a service",
      description:
        "Post something the user has to sell (kind 'item') or can do for others (kind 'service': lunch runs, errands, " +
        "deliveries, event help, tutoring). If someone is already waiting for it, the server pairs them and settles " +
        "the price inside both private limits in the same call, and returns the proposed deal. min_price is the user's private " +
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
        confirm_price: confirmPrice,
        idempotency_key: idempotencyKey,
      },
      outputSchema: outputs.post_offer,
      annotations: writes,
    },
    (args) => write("post_offer", args, (userId) => market.postOffer(deps, { ...args, user_id: userId }), "market"),
  );

  registerAppTool(
    server,
    "post_request",
    {
      _meta: ui("market"),
      title: "Ask for an item or a service",
      description:
        "Post what the user needs: an item to buy, or someone to do a task (pick up lunch, run an errand, help at an " +
        "event). The server pairs the request with the best offer and settles the price inside both private limits in the same " +
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
        source: z.enum(REQUEST_SOURCES).optional().describe("'bee_context' when inferred from Bee, 'device_context' from a watch or phone"),
        confirm_price: confirmPrice,
        idempotency_key: idempotencyKey,
      },
      outputSchema: outputs.post_request,
      annotations: writes,
    },
    (args) => write("post_request", args, (userId) => market.postRequest(deps, { ...args, user_id: userId }), "market"),
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
    (args) => run("find_matches", () => market.findMatches(deps, who(args.user_id), args.request_id, args.limit), "market"),
  );

  registerAppTool(
    server,
    "negotiate",
    {
      _meta: ui("market"),
      title: "Get this one instead",
      description:
        "Settle a specific offer the user picked from the options, by the same fixed rule. It replaces the deal the request already " +
        "holds and returns a proposed deal; ask the user, then call confirm_deal. Returns deal: null when no price fits both limits. " +
        "A buyer gets one offer below the asking price per offer; after a no, 'say' names the asking price, and on a yes call " +
        "again with max_price set to it.",
      inputSchema: {
        user_id: userIdArg, request_id: id, offer_id: id,
        max_price: price.optional().describe("Raise the request's PRIVATE budget first, e.g. to the asking price the user just agreed to. Only upward."),
        idempotency_key: idempotencyKey,
      },
      outputSchema: outputs.negotiate,
      annotations: writes,
    },
    (args) => write("negotiate", args, (userId) => market.negotiateDeal(deps, userId, args.request_id, args.offer_id, args.max_price), "market"),
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
      inputSchema: { user_id: userIdArg, deal_id: id, idempotency_key: idempotencyKey },
      outputSchema: outputs.confirm_deal,
      annotations: writes,
    },
    (args) => write("confirm_deal", args, (userId) => market.confirmDeal(deps, userId, args.deal_id), "market"),
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
      inputSchema: { user_id: userIdArg, deal_id: id, idempotency_key: idempotencyKey },
      outputSchema: outputs.decline_deal,
      annotations: { ...writes, destructiveHint: true },
    },
    (args) => write("decline_deal", args, (userId) => market.declineDeal(deps, userId, args.deal_id), "market"),
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
    (args) => run("get_deal_status", () => market.getDealStatus(deps, who(args.user_id), args.deal_id), "market"),
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
    (args) => run("list_my_posts", () => market.listMyPosts(deps, who(args.user_id)), "market"),
  );

  server.registerTool(
    "withdraw_post",
    {
      title: "Take down a post",
      description:
        "Take down one of the user's offers or cancel one of their requests. A deal it was holding is released and " +
        "the other person is paired again. Confirm with the user first.",
      inputSchema: { user_id: userIdArg, post_id: id.describe("offer_id or request_id from list_my_posts"), idempotency_key: idempotencyKey },
      outputSchema: outputs.withdraw_post,
      annotations: { ...writes, destructiveHint: true, idempotentHint: true },
    },
    (args) => write("withdraw_post", args, (userId) => market.withdrawPost(deps, userId, args.post_id)),
  );

  // ---------- knowing what the user needs (src/market/context.ts) ----------

  registerAppTool(
    server,
    "get_suggestions",
    {
      _meta: ui("market"),
      title: "What I might need",
      description:
        "Requests the user will probably want now, ready to post with one yes: needs picked up by their Bee, watch or " +
        "phone ('my calculator broke', a to-do 'buy printer paper'), and routines learned from their own past requests " +
        "that are due soon ('lunch run on weekdays around 12:15'). Call when the user opens the app, asks 'anything I " +
        "need?' or 'what do you suggest?', and after add_context. Read one suggestion's 'say'; on a yes call " +
        "accept_suggestion, on a no dismiss_suggestion.",
      inputSchema: { user_id: userIdArg },
      outputSchema: outputs.get_suggestions,
      annotations: reads,
    },
    (args) => run("get_suggestions", () => suggestions.getSuggestions(deps, who(args.user_id)), "market"),
  );

  registerAppTool(
    server,
    "accept_suggestion",
    {
      _meta: ui("market"),
      title: "Yes to a suggestion",
      description:
        "Post a suggested request after the user's explicit yes. It is paired and settled like post_request, and returns " +
        "the same result (a proposed deal to confirm, or a waiting request). Pass max_price when the suggestion has none " +
        "or the user names a different budget.",
      inputSchema: {
        user_id: userIdArg,
        suggestion_id: id,
        max_price: price.optional().describe("PRIVATE budget, when the user gives one"),
        idempotency_key: idempotencyKey,
      },
      outputSchema: outputs.accept_suggestion,
      annotations: writes,
    },
    (args) => write("accept_suggestion", args, (userId) => suggestions.acceptSuggestion(deps, userId, args.suggestion_id, args.max_price), "market"),
  );

  server.registerTool(
    "dismiss_suggestion",
    {
      title: "No to a suggestion",
      description:
        "The user doesn't want a suggestion now. With forget: true (\"don't suggest that again\") a routine is never " +
        "suggested again; a routine dismissed twice in two weeks pauses by itself.",
      inputSchema: {
        user_id: userIdArg,
        suggestion_id: id,
        forget: z.boolean().optional().describe("Stop suggesting this routine"),
        idempotency_key: idempotencyKey,
      },
      outputSchema: outputs.dismiss_suggestion,
      annotations: { ...writes, idempotentHint: true },
    },
    (args) => write("dismiss_suggestion", args, (userId) => suggestions.dismissSuggestion(deps, userId, args.suggestion_id, args.forget)),
  );

  server.registerTool(
    "add_context",
    {
      title: "Share context from a device",
      description:
        "Pass on something from the user's Bee, watch or phone that may show a need: a to-do, a conversation summary, a " +
        "voice note, or a place they arrived at. For agents that also hold the user's Bee data (Bee MCP: bee_list_todos, " +
        "bee_get_today): send the user's own items that mention needing, buying, fixing or getting help, one call each, " +
        "never other people's words. Returns a suggestion when the text names a need; nothing is posted until the user " +
        "says yes. Snippets that name no need are not kept.",
      inputSchema: {
        user_id: userIdArg,
        source: z.enum(suggestions.SIGNAL_SOURCES),
        kind: z.enum(suggestions.SIGNAL_KINDS),
        text: z.string().trim().max(500).optional().describe("The to-do, summary or note, as written"),
        place: text(120).optional().describe("location: the place the user arrived at, e.g. 'Hall 5'"),
        observed_at: z.string().max(40).optional().describe("ISO 8601; defaults to now"),
        external_id: z.string().max(128).optional().describe("The device's id for this item, so a resend is ignored"),
        time_zone: z.string().max(64).optional().describe("IANA zone, e.g. 'Asia/Hong_Kong'"),
      },
      outputSchema: outputs.add_context,
      annotations: { ...writes, idempotentHint: true },
    },
    (args) => run("add_context", async () => {
      const r = await suggestions.addContext(deps, who(args.user_id), args);
      return { ...r, say: r.suggestion?.say ?? (r.duplicate ? "Already noted." : "Noted.") };
    }),
  );

  registerAppTool(
    server,
    "get_my_routines",
    {
      _meta: ui("market"),
      title: "What you've learned about me",
      description:
        "The routines learned from the user's own requests (what, when, usual budget and place) and which devices send " +
        "context. Use for 'what do you know about me?' or 'what are my routines?'. Only the user sees this.",
      inputSchema: { user_id: userIdArg },
      outputSchema: outputs.get_my_routines,
      annotations: reads,
    },
    (args) => run("get_my_routines", () => suggestions.getMyRoutines(deps, who(args.user_id)), "market"),
  );

  registerPrompts(server);
  return server;
}

/**
 * Wraps a service call: JSON as text + structuredContent. Errors the user can
 * act on become speakable tool errors; anything unexpected is logged and the
 * user still hears a sentence, so Alexa never meets an empty result.
 */
async function run(tool: string, fn: () => Promise<object>, view?: ViewName) {
  const start = performance.now();
  const done = (outcome: "ok" | "user_error" | "error") =>
    metric("tool", { Tool: tool }, { ToolLatencyMs: Math.round(performance.now() - start), ToolErrors: outcome === "error" ? 1 : 0 }, { outcome }, { text: false });
  try {
    const result = (await fn()) as Record<string, unknown>;
    done("ok");
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result,
      // Alexa+ renders the view named in the result; other hosts use the tool's metadata.
      ...(view ? { _meta: { ui: { resourceUri: VIEWS[view].uri } } } : {}),
    };
  } catch (err) {
    const known = err instanceof market.MarketError;
    done(known ? "user_error" : "error");
    if (!known) log("error", "tool failed", { tool, err });
    const say = known ? err.message : "Sorry, something went wrong on my side. Please try again in a moment.";
    const body = known && err.code ? { say, code: err.code, ...err.data } : { say };
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(body) }] };
  }
}
