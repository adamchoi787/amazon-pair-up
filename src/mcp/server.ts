import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  ElicitResultSchema, ErrorCode, McpError, SubscribeRequestSchema, UnsubscribeRequestSchema,
  type ElicitRequestFormParams, type ElicitResult, type ServerNotification, type ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CONDITIONS } from "../ai/index.js";
import { log, metric } from "../http/log.js";
import { once } from "../market/idempotency.js";
import { deleteMyData } from "../market/privacy.js";
import * as market from "../market/service.js";
import { HANDOFFS } from "../market/amazon.js";
import type { Deps } from "../market/service.js";
import { REPORT_REASONS } from "../market/trust.js";
import { KINDS, REQUEST_SOURCES, SERVICE_UNITS } from "../market/types.js";
import { DEFAULT_TIME_ZONE, validTimeZone } from "../market/scheduling.js";
import * as suggestions from "../market/context.js";
import * as points from "../market/points.js";
import { registerViews, VIEWS, type ViewName } from "./apps.js";
import { registerPrompts } from "./prompts.js";
import { outputs } from "./schemas.js";
import { MY_DEALS, MY_POSTS, SUBSCRIBABLE, subscribe, unsubscribe, type Subscriber } from "./subscriptions.js";

// The tool surface Alexa+ (or any MCP host) sees. Descriptions say when to
// call each tool and what it returns; the agent reads them to pick a tool.
// Every declared input is honoured and bounded, and every result matches its
// outputSchema. Contract: docs/TOOL_CONTRACT.md — change both together.

export interface RequestContext {
  /** Caller identity from the transport (OAuth subject, or X-User-Id in local dev). */
  userId?: string;
  /**
   * One request on a fresh server (stateless Streamable HTTP): nothing can be
   * pushed or asked later, so subscriptions and elicitation are off.
   */
  stateless?: boolean;
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type FormSchema = ElicitRequestFormParams["requestedSchema"];

/** How long a host has to bring back the user's answer to a question (elicitation). */
const ELICIT_TIMEOUT_MS = 120_000;

const DELETE_QUESTION =
  "Delete everything PairUp keeps about you? Your offers and requests come down, deals on hold are released, " +
  "your history and sign-ins are erased, and past deals stay for the other person without your name. This can't be undone.";

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
export const SERVER_INFO = { name: "pairup", title: "PairUp", version: "0.8.0" };

export function createMcpServer(deps: Deps, ctx: RequestContext = {}) {
  const server = new McpServer(
    SERVER_INFO,
    {
      instructions:
        "PairUp pairs people directly, by voice: people who need something with people who have it or can do it. " +
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
        "call again with confirm_price: true if the user confirms, or with the price they meant. Weapons, drugs, alcohol, " +
        "tobacco, prescription medicine, recalled or counterfeit goods, fake documents, cheating, adult services, live " +
        "animals and illegal services can't be posted: that returns an error with code 'prohibited_item' or " +
        "'restricted_item'; speak its 'say' and don't rephrase the post to get around it. After a confirmed deal, offer " +
        "rate_deal; when the user complains about someone, use report_user. Every result has " +
        "a 'say' field: one short sentence you can speak as is. Write tools take an optional idempotency_key: " +
        "send a fresh one per action and the same one on a retry, so nothing is posted or confirmed twice. " +
        "With a session, subscribe to deals://me and posts://me (resources/subscribe) to hear when a deal is proposed, " +
        "confirmed, declined or expires instead of polling. Hosts that support elicitation are asked directly to check a " +
        "price and to confirm a deal. delete_my_data erases the user's data after their explicit yes. " +
        "When a user wants a safe place to meet, offer list_meetup_points and choose_meetup_point (an unstaffed " +
        "PairUp Point watched by a Ring doorbell); when they say \"I'm here\", call check_in_at_point. " +
        "When nobody " +
        "nearby can help, results point to Amazon: post_request's 'fallback' (an amazon.com search link and a labelled demo price estimate) and " +
        "post_offer's 'trade_in' (Amazon Trade-In). Offer them as an option; the post keeps waiting either way.",
    },
  );

  if (!ctx.stateless) server.server.registerCapabilities({ resources: { subscribe: true, listChanged: true } });
  registerViews(server);
  /** Tool metadata that points MCP Apps hosts (and Alexa+) at the tool's view. */
  const ui = (view: ViewName) => ({ ui: { resourceUri: VIEWS[view].uri } });

  const who = (arg?: string) => {
    const userId = ctx.userId ?? arg;
    if (!userId) throw new market.MarketError("I don't know who's speaking. Please link your account.");
    return userId;
  };

  /**
   * Ask the user through the host (elicitation/create, form mode) while a tool
   * call is open. null when the host can't ask: no elicitation capability, a
   * stateless request, or the host failed; callers then answer as they would
   * without it. A timeout (the user never answered) is thrown.
   */
  const elicit = async (extra: Extra, message: string, requestedSchema: FormSchema): Promise<ElicitResult | null> => {
    const can = server.server.getClientCapabilities()?.elicitation;
    if (ctx.stateless || !can || (!can.form && can.url)) return null;
    try {
      return await server.server.request(
        { method: "elicitation/create", params: { mode: "form", message, requestedSchema } },
        ElicitResultSchema,
        { relatedRequestId: extra.requestId, timeout: ELICIT_TIMEOUT_MS },
      );
    } catch (err) {
      if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) throw err;
      log("warn", "elicitation failed", { err });
      throw err;
    }
  };

  /** elicit, where a user who never answers counts as a host that can't ask. */
  const elicitOrNull = (extra: Extra, message: string, schema: FormSchema) =>
    elicit(extra, message, schema).catch(() => null);

  /** "Did you mean…?" asked through the host: on a confirm_price error, ask, then post with the user's answer. */
  const checkingPrice = async <A extends { confirm_price?: boolean }>(extra: Extra, input: A, post: (a: A) => Promise<object>) => {
    let args = input;
    for (let round = 0; ; round++) {
      try {
        return await post(args);
      } catch (err) {
        if (!(err instanceof market.MarketError) || err.code !== "confirm_price" || round >= 2) throw err;
        const field = err.data?.field as "ask_price" | "min_price" | "max_price";
        const price = err.data?.price as number;
        const answer = await elicitOrNull(extra, err.message, {
          type: "object",
          properties: {
            confirm: { type: "boolean", title: `Keep ${price}`, description: "Post at this price" },
            price: { type: "number", title: "Or the price you meant", minimum: 0.01, maximum: 100_000 },
          },
        });
        if (!answer) throw err;
        const meant = answer.action === "accept" ? answer.content?.price : undefined;
        if (typeof meant === "number" && meant > 0 && meant !== price) args = { ...args, [field]: meant };
        else if (answer.action === "accept" && answer.content?.confirm === true) args = { ...args, confirm_price: true };
        else throw new market.MarketError("Okay, I haven't posted it. Tell me the price you meant.", "not_confirmed");
      }
    }
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
        "stays open after each booked job. An item nobody is asking for yet, in a category Amazon Trade-In takes " +
        "(candidate electronics and game consoles), comes back with a 'trade_in' link.",
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
        location: text(120).optional().describe("Items: meet-up area. Services: the area the user covers, e.g. 'UW campus'. Requests there rank higher"),
        availability: text(120).optional().describe("When the user can meet or work, e.g. 'weekdays 11am-2pm'. Shown on the deal"),
        time_zone: text(80).refine(validTimeZone).optional().describe(`IANA time zone for availability, default ${DEFAULT_TIME_ZONE}`),
        confirm_price: confirmPrice,
        idempotency_key: idempotencyKey,
      },
      outputSchema: outputs.post_offer,
      annotations: writes,
    },
    (args, extra) =>
      write("post_offer", args, (userId) => checkingPrice(extra, args, (a) => market.postOffer(deps, { ...a, user_id: userId })), "market"),
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
        "when you leave those out. An item with no deal comes back with a 'fallback': an amazon.com search link and the " +
        "typical new price, for a user who can't wait; the request keeps waiting for a seller.",
      inputSchema: {
        user_id: userIdArg,
        need: text(200).optional().describe("The item ('graphing calculator') or the task ('pick up my lunch')"),
        raw_request: text(1000).optional().describe("The user's own words, or ambient context"),
        kind: kind.optional().describe("'service' when someone should do a task; 'item' to buy a thing"),
        max_price: price.optional().describe("PRIVATE budget, per hour for hourly work; required unless stated in raw_request"),
        price_unit: unit.optional().describe("Services: 'job' for a flat fee (default), 'hour' for an hourly rate"),
        hours: z.number().positive().max(336).optional().describe("Hourly work: how long it lasts, used for the total"),
        pickup: text(120).optional().describe("Errands: where to collect from, e.g. 'the HUB'"),
        location: text(120).optional().describe("Items: preferred meet-up area. Services: where the job is or where to deliver"),
        schedule: text(80).optional().describe("Services: when, as said, e.g. 'today by 12:30' or 'Saturday 2-6pm'"),
        starts_at: z.string().max(40).optional().describe("Services: exact ISO start with UTC offset, e.g. 2026-10-24T14:00:00-07:00. Use with ends_at or hours for a checked work window"),
        ends_at: z.string().max(40).optional().describe("Services: exact ISO end with UTC offset; must be after starts_at and agree with hours"),
        time_zone: text(80).refine(validTimeZone).optional().describe(`IANA time zone for the request, default ${DEFAULT_TIME_ZONE}; never infer it from the server clock`),
        needed_by: z.string().max(40).optional()
          .describe("ISO 8601: an item's deadline or a job's start time; the request stops pairing after it and offers expire by then"),
        min_condition: condition.optional().describe("Items: worst acceptable condition"),
        quantity: z.number().int().positive().max(1000).optional().describe("Items: how many"),
        handoff: z.enum(HANDOFFS).optional().describe("Items: 'delivery' when the user wants it brought to them (Amazon Hub delivery to a locker in their area); default 'meetup'"),
        source: z.enum(REQUEST_SOURCES).optional().describe("'bee_context' when inferred from Bee, 'device_context' from a watch or phone"),
        confirm_price: confirmPrice,
        idempotency_key: idempotencyKey,
      },
      outputSchema: outputs.post_request,
      annotations: writes,
    },
    (args, extra) =>
      write("post_request", args, (userId) => checkingPrice(extra, args, (a) => market.postRequest(deps, { ...a, user_id: userId })), "market"),
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
        "with where and when to meet, once both sides have confirmed. Hosts that support elicitation also show the " +
        "user the deal and record the yes only if they confirm it there.",
      inputSchema: { user_id: userIdArg, deal_id: id, idempotency_key: idempotencyKey },
      outputSchema: outputs.confirm_deal,
      annotations: writes,
    },
    (args, extra) =>
      write("confirm_deal", args, async (userId) => {
        const question = await market.confirmQuestion(deps, userId, args.deal_id);
        if (question) {
          let answer: ElicitResult | null;
          try {
            answer = await elicit(extra, question, {
              type: "object",
              properties: { confirm: { type: "boolean", title: "Yes, confirm this deal" } },
              required: ["confirm"],
            });
          } catch {
            throw new market.MarketError("I didn't hear back, so I haven't confirmed it. It's still on hold for you.", "not_confirmed");
          }
          if (answer && !(answer.action === "accept" && answer.content?.confirm === true)) {
            throw new market.MarketError("Okay, I haven't confirmed it. It's still on hold for you.", "not_confirmed");
          }
        }
        return market.confirmDeal(deps, userId, args.deal_id);
      }, "market"),
  );

  registerAppTool(
    server,
    "choose_handoff",
    {
      _meta: ui("market"),
      title: "Meet up or deliver",
      description:
        "Buyer only, item deals while proposed: choose 'delivery' (the seller drops the item at an Amazon Hub Counter, " +
        "Amazon carries it to a Hub Locker in the buyer's area, the buyer pays the fee shown in deal.delivery) or 'meetup' " +
        "(hand-off in person at a Hub point). The price stays as settled; the seller is asked to confirm again. Offer " +
        "delivery when deal.delivery is set and the user can't meet, lives in another area, or asks for it.",
      inputSchema: { user_id: userIdArg, deal_id: id, method: z.enum(HANDOFFS), idempotency_key: idempotencyKey },
      outputSchema: outputs.choose_handoff,
      annotations: writes,
    },
    (args) => write("choose_handoff", args, (userId) => market.chooseHandoff(deps, userId, args.deal_id, args.method), "market"),
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

  server.registerTool(
    "list_meetup_points",
    {
      title: "PairUp Points nearby",
      description:
        "List PairUp Points: small unstaffed hand-off spots, each watched by one Ring doorbell or camera. Offer one when " +
        "the user would rather not meet a stranger elsewhere ('somewhere safe', 'a public place'). Pass the user's area to " +
        "list the nearest first.",
      inputSchema: { area: text(120).optional().describe("e.g. 'UW campus'") },
      outputSchema: outputs.list_meetup_points,
      annotations: reads,
    },
    (args) => run("list_meetup_points", () => points.listMeetupPoints(deps, args.area)),
  );

  registerAppTool(
    server,
    "choose_meetup_point",
    {
      _meta: ui("market"),
      title: "Meet at a PairUp Point",
      description:
        "Set a PairUp Point as the hand-off place for one of the user's open or confirmed deals. Without point_id the " +
        "nearest point to both people is chosen. Both people see it on the deal. At the point they press the Ring doorbell " +
        "and call check_in_at_point; Ring confirms each arrival. Without deal_id the user's latest open deal is used.",
      inputSchema: {
        user_id: userIdArg,
        deal_id: id.optional(),
        point_id: id.optional().describe("From list_meetup_points"),
        idempotency_key: idempotencyKey,
      },
      outputSchema: outputs.choose_meetup_point,
      annotations: { ...writes, idempotentHint: true },
    },
    (args) => write("choose_meetup_point", args, (userId) => points.chooseMeetupPoint(deps, userId, args), "market"),
  );

  registerAppTool(
    server,
    "check_in_at_point",
    {
      _meta: ui("market"),
      title: "I'm at the PairUp Point",
      description:
        "The user says they have arrived at the PairUp Point of a confirmed deal ('I'm here'). Records the arrival and " +
        "reads the point's Ring Event History: a doorbell press or a person within ten minutes confirms it. When Ring has " +
        "confirmed both people, arrival.status is 'both_here' and the hand-off can go ahead. Without deal_id the user's " +
        "latest confirmed deal at a point is used.",
      inputSchema: { user_id: userIdArg, deal_id: id.optional(), idempotency_key: idempotencyKey },
      outputSchema: outputs.check_in_at_point,
      annotations: { ...writes, idempotentHint: true },
    },
    (args) => write("check_in_at_point", args, (userId) => points.checkInAtPoint(deps, userId, args), "market"),
  );

  server.registerTool(
    "report_user",
    {
      title: "Report someone",
      description:
        "Report the other person in one of the user's deals (deal_id), or the owner of an offer the user was shown " +
        "(post_id), when the user says they were scammed, didn't show up, sent something not as described, made them " +
        "feel unsafe, harassed them, or offered something not allowed. Reviewers look at every report. The two are never " +
        "paired again, and a deal still open between them is cancelled. Confirm with the user first.",
      inputSchema: {
        user_id: userIdArg,
        reason: z.enum(REPORT_REASONS).describe(
          "prohibited_item: offered or asked for something not allowed; scam: asked for money up front, fake payment; " +
            "no_show; not_as_described; unsafe; harassment; other",
        ),
        deal_id: id.optional().describe("The deal with the person being reported"),
        post_id: id.optional().describe("Without a deal: the offer_id of the post being reported"),
        details: z.string().trim().max(500).optional().describe("What happened, in the user's words. Only reviewers read it"),
        idempotency_key: idempotencyKey,
      },
      outputSchema: outputs.report_user,
      annotations: writes,
    },
    (args) => write("report_user", args, (userId) => market.reportUser(deps, userId, args)),
  );

  server.registerTool(
    "rate_deal",
    {
      title: "Rate a deal",
      description:
        "Record the user's 1-5 star rating of the other person in a confirmed deal: the seller or helper when the user " +
        "paid, the buyer when the user sold. Once per side and deal. Ratings help the market pair people who follow " +
        "through; the other person never sees them. After a confirmed deal, ask 'How did it go, out of five?'.",
      inputSchema: {
        user_id: userIdArg,
        deal_id: id,
        stars: z.number().int().min(1).max(5).describe("1 = very bad, 5 = excellent"),
        idempotency_key: idempotencyKey,
      },
      outputSchema: outputs.rate_deal,
      annotations: writes,
    },
    (args) => write("rate_deal", args, (userId) => market.rateDeal(deps, userId, args.deal_id, args.stars)),
  );

  server.registerTool(
    "delete_my_data",
    {
      title: "Delete my data",
      description:
        "Erase everything stored about the user: their offers and requests come down (deals on hold are released and the " +
        "other person is paired again), their history, learning data and sign-ins are deleted, and past deals the other " +
        "person still needs stay without the user's name. Cannot be undone. Read the user what it does, and call with " +
        "confirm: true only after their explicit yes; hosts that support elicitation are asked directly. Safe to repeat.",
      inputSchema: {
        user_id: userIdArg,
        confirm: z.boolean().optional().describe("true only after the user explicitly agreed to delete their data"),
      },
      outputSchema: outputs.delete_my_data,
      annotations: { ...writes, destructiveHint: true, idempotentHint: true },
    },
    (args, extra) =>
      run("delete_my_data", async () => {
        const userId = who(args.user_id);
        if (args.confirm !== true) {
          const answer = await elicitOrNull(extra, DELETE_QUESTION, {
            type: "object",
            properties: { confirm: { type: "boolean", title: "Yes, delete my data" } },
            required: ["confirm"],
          });
          if (!answer) throw new market.MarketError(`${DELETE_QUESTION} Say yes and I'll do it.`, "confirm_delete");
          if (!(answer.action === "accept" && answer.content?.confirm === true)) {
            throw new market.MarketError("Okay, I haven't deleted anything.", "not_confirmed");
          }
        }
        return deleteMyData(deps, userId);
      }),
  );

  // The user's deals and posts as resources. With a session, resources/subscribe
  // on either URI brings notifications/resources/updated whenever they change.
  const json = (uri: string, body: object) => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(body) }] });
  server.registerResource(
    "my_deals", MY_DEALS,
    { title: "My deals", description: "The user's deals and booked jobs, as get_deal_status returns them. Subscribe for changes.", mimeType: "application/json" },
    async (uri) => json(uri.href, await market.getDealStatus(deps, who())),
  );
  server.registerResource(
    "my_posts", MY_POSTS,
    { title: "My offers and requests", description: "The user's own posts, as list_my_posts returns them. Subscribe for changes.", mimeType: "application/json" },
    async (uri) => json(uri.href, await market.listMyPosts(deps, who())),
  );

  if (!ctx.stateless) {
    let sub: Subscriber | undefined;
    server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
      const { uri } = req.params;
      if (!SUBSCRIBABLE.includes(uri)) throw new McpError(ErrorCode.InvalidParams, `Subscribe to ${SUBSCRIBABLE.join(" or ")}`);
      if (!ctx.userId) throw new McpError(ErrorCode.InvalidRequest, "Subscriptions need a signed-in user (or an X-User-Id header locally).");
      sub ??= { userId: ctx.userId, uris: new Set(), send: (u) => server.server.sendResourceUpdated({ uri: u }) };
      subscribe(sub, uri);
      return {};
    });
    server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
      if (sub) unsubscribe(sub, req.params.uri);
      return {};
    });
    const closed = server.server.onclose;
    server.server.onclose = () => {
      closed?.();
      if (sub) unsubscribe(sub);
    };
  }


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
        place: text(120).optional().describe("location: the place the user arrived at, e.g. 'McCarty Hall'"),
        observed_at: z.string().max(40).optional().describe("ISO 8601; defaults to now"),
        external_id: z.string().max(128).optional().describe("The device's id for this item, so a resend is ignored"),
        time_zone: z.string().max(64).optional().describe("IANA zone, e.g. 'America/Los_Angeles'"),
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
