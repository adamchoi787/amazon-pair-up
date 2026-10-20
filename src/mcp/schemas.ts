import { z } from "zod";
import { CONDITIONS } from "../ai/index.js";
import { REPORT_REASONS } from "../market/trust.js";
import { KINDS, REQUEST_SOURCES } from "../market/types.js";

// Output schemas for every tool. They mirror src/market/views.ts exactly, so
// clients (and Alexa+) can rely on structuredContent. test/schema.test.ts
// checks real tool results against them.

const condition = z.enum(CONDITIONS);
const kind = z.enum(KINDS).describe("'item' (a thing) or 'service' (someone does a task)");
const priceUnit = z.enum(["each", "job", "hour"]).describe("each = an item; job = flat fee per task; hour = hourly rate");
const money = z.number().nonnegative();
const say = z.string().describe("One short sentence to speak back to the user");

const typical = z.object({
  low: money,
  high: money,
  source: z.enum(["reference", "trades"]).describe("reference = reference prices; trades = this market's confirmed deals"),
}).describe("What similar offers usually go for, per price_unit");

export const offerOut = z.object({
  offer_id: z.string(),
  kind,
  title: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  condition: condition.nullable().describe("Items only"),
  quantity: z.number().int(),
  currency: z.string(),
  ask_price: money.describe("Public price, per price_unit"),
  price_unit: priceUnit,
  location: z.string().nullable().describe("Items: meet-up area. Services: area covered"),
  availability: z.string().nullable().describe("When the person can meet or work"),
  time_zone: z.string().describe("IANA time zone for the provider's availability"),
  status: z.enum(["active", "pending", "sold", "withdrawn"])
    .describe("pending = held by a proposed deal; sold = item sold (a service offer stays active after each job)"),
  typical_price: typical.nullable().describe("null when nothing reliable describes this offer"),
  your_min_price: money.optional().describe("Only for the owner: their private minimum"),
  auto_accept: z.boolean().optional().describe("Only for the owner"),
});

export const matchOut = offerOut.extend({
  within_budget_at_ask: z.boolean().describe("The asking price is already within the requester's budget"),
  score: z.number().describe("Ranking score, higher is better"),
});

export const requestOut = z.object({
  request_id: z.string(),
  kind,
  need: z.string().describe("The item, or the task"),
  source: z.enum(REQUEST_SOURCES)
    .describe("voice = the user said it; bee_context = from Bee; device_context = from a watch or phone; routine = a learned routine the user accepted"),
  category: z.string().nullable(),
  min_condition: condition.nullable().describe("Items only"),
  quantity: z.number().int(),
  price_unit: priceUnit,
  hours: z.number().nullable().describe("Hourly work: expected length"),
  pickup: z.string().nullable().describe("Errands: where to collect from"),
  schedule: z.string().nullable().describe("Services: when, as said"),
  time_zone: z.string(),
  starts_at: z.string().nullable().describe("Resolved service start, with UTC offset; null for deadline-only or vague requests"),
  ends_at: z.string().nullable().describe("Resolved service end; null if the duration is unknown"),
  currency: z.string(),
  needed_by: z.string().nullable().describe("ISO 8601: an item's deadline or a job's start; the request stops pairing after it"),
  location: z.string().nullable(),
  status: z.enum(["open", "matched", "fulfilled", "cancelled"]).describe("matched = held by a proposed deal"),
  your_max_price: money.optional().describe("Only for the owner: their private budget"),
});

const party = z.enum(["buyer", "seller"]);

const hubPoint = z.object({
  name: z.string(),
  type: z.enum(["locker", "counter"]),
  area: z.string(),
  demo: z.boolean().describe("true: a made-up demo location, not a real Amazon Hub point"),
});

const arrivalState = z.enum(["not_here", "checked_in", "confirmed"])
  .describe("checked_in = said they are here; confirmed = the point's Ring device saw a doorbell press or a person within 10 minutes");

export const arrivalOut = z.object({
  status: z.enum(["chosen", "one_here", "both_here"]).describe("both_here = Ring confirmed both arrivals; the hand-off can go ahead"),
  you: arrivalState,
  them: arrivalState,
  both_here_at: z.string().nullable(),
});

export const pointOut = z.object({
  point_id: z.string(),
  name: z.string(),
  area: z.string(),
  hours: z.string().nullable(),
  ring_device: z.boolean().describe("A Ring device is connected and confirms arrivals"),
  demo: z.literal(true).describe("A planned demo location"),
}).describe("A PairUp Point: an unstaffed hand-off spot watched by one Ring camera or doorbell");

export const fallbackOut = z.object({
  reason: z.enum(["no_seller", "over_budget"]).describe("no_seller = nothing like it nearby; over_budget = nothing nearby within the budget"),
  new_price: money.nullable().describe("Curated demo estimate for a new item on Amazon.com; null when unknown"),
  currency: z.literal("USD"),
  amazon_url: z.string().describe("amazon.com search for the request"),
  still_waiting: z.literal(true).describe("The request stays on the market and is paired when a seller lists one"),
  say: z.string().describe("e.g. \"Nobody nearby has one yet. New on Amazon it's about $110.\""),
}).describe("Items only, when no deal: the same thing new on Amazon, as an option if the user can't wait");

export const tradeInOut = z.object({
  category: z.enum(["electronics", "books", "game_consoles"]),
  url: z.literal("https://www.amazon.com/tradein"),
  say: z.string(),
}).describe("Items in an Amazon Trade-In category that nobody is asking for yet");

export const dealOut = z.object({
  deal_id: z.string(),
  offer_id: z.string(),
  request_id: z.string(),
  kind,
  title: z.string().describe("The offer: the item, or the service"),
  task: z.string().nullable().describe("Services: what the requester asked for"),
  condition: condition.nullable().describe("Items only"),
  your_role: z.enum(["buyer", "seller", "observer"]).describe("buyer pays; seller sells the item or does the job"),
  counterpart: z.string().nullable().describe("Display name of the other person"),
  price: money.describe("Agreed price per price_unit, inside both private limits"),
  price_unit: priceUnit,
  hours: z.number().nullable().describe("Hourly work: hours agreed"),
  total: money.nullable().describe("What the buyer pays in all; null for hourly work without known hours"),
  ask_price: money,
  saved_vs_ask: z.number().describe("Asking price minus agreed price, per price_unit"),
  price_check: z.object({
    verdict: z.enum(["typical", "below_typical", "above_typical", "far_below", "far_above"])
      .describe("far_below on an item: warn the buyer to meet in public and pay only on handover"),
    typical_low: money,
    typical_high: money,
    source: z.enum(["reference", "trades"]),
  }).nullable().describe("The agreed price against what similar offers usually go for; null when unknown"),
  currency: z.string(),
  status: z.enum(["proposed", "confirmed", "declined", "replaced", "expired", "withdrawn"])
    .describe("replaced = the buyer chose another option; expired = nobody answered in time; withdrawn = a post was taken down"),
  buyer_confirmed: z.boolean(),
  seller_confirmed: z.boolean(),
  waiting_for: z.array(party).describe("Who still has to say yes"),
  waiting_for_you: z.boolean(),
  meetup: z.object({
    place: z.string().nullable().describe("The suggested hand-off place: the Amazon Hub point when there is one, else the area"),
    availability: z.string().nullable(),
    hub_point: hubPoint.nullable().describe("Items, both sides in the same area: that area's Amazon Hub Locker or Counter, the suggested hand-off place"),
    point: z.object({ point_id: z.string(), name: z.string(), area: z.string(), demo: z.literal(true) }).merge(arrivalOut).nullable()
      .describe("The PairUp Point the two chose, with each side's Ring-confirmed arrival"),
  }).describe("Where and when: the meet-up for an item; for a service, where the job is (drop-off for errands) and when"),
  handoff: z.enum(["meetup", "delivery"]).nullable().describe("Items: how it changes hands; the buyer switches it with choose_handoff. null for services"),
  delivery: z.object({
    selected: z.boolean().describe("true: this deal goes by Amazon Hub delivery; false: available, the buyer can choose it"),
    provider: z.string().describe("Amazon Shipping"),
    drop_off: hubPoint.describe("Where the seller drops the item off: a Hub Counter or Locker in their area"),
    pick_up: hubPoint.describe("Where the buyer collects it with a pickup code: a Hub Locker in their area"),
    fee: money.describe("Delivery fee the buyer pays on top of the price; included in total when selected"),
    eta: z.string(),
    max_weight_lb: z.number(),
    reference: z.string().nullable().describe("Shipment reference once both sides confirmed"),
    demo: z.boolean().describe("true: demo rates and locations"),
  }).nullable().describe("Items: Amazon Hub delivery between the two areas; neither side's address is shared. null when unavailable"),
  pickup: z.string().nullable().describe("Errands: where to collect from"),
  needed_by: z.string().nullable().describe("Services: when the job is due or starts"),
  scheduling: z.object({
    status: z.enum(["verified", "needs_confirmation", "conflict", "not_applicable"])
      .describe("verified = full work window fits the provider's stated availability; needs_confirmation = a person must check the time"),
    starts_at: z.string().nullable(),
    ends_at: z.string().nullable(),
    time_zone: z.string(),
    provider_availability: z.string().nullable(),
  }).nullable().describe("Services: availability check, never a claim that a job was completed"),
  on_hold_until: z.string().nullable().describe("While proposed: when the offer expires if nobody answers"),
  created_at: z.string(),
  updated_at: z.string(),
});

export const reportOut = z.object({
  report_id: z.string(),
  reason: z.enum(REPORT_REASONS),
  deal_id: z.string().nullable(),
  post_id: z.string().nullable(),
  status: z.enum(["received", "already_reported"]).describe("already_reported = this user already has an open report about the same person"),
  released_deal_id: z.string().nullable().describe("A proposed deal between the two, cancelled by the report"),
}).describe("Never says who else reported the person or whether they are under review");

export const ratingOut = z.object({
  deal_id: z.string(),
  stars: z.number().int().min(1).max(5),
  rated_role: z.enum(["buyer", "seller"]).describe("The role of the person rated: the other side of the deal"),
});

const marketOutputs = {
  post_offer: {
    offer: offerOut,
    deal: dealOut.nullable().describe("Opened when someone was already waiting"),
    waiting_requests: z.number().int().describe("Open requests this offer satisfies"),
    trade_in: tradeInOut.nullable().describe("Set when nobody is asking for this item yet and the category may qualify for Amazon Trade-In"),
    say,
  },
  post_request: {
    request: requestOut,
    deal: dealOut.nullable().describe("The best offer, already settled; null while the request waits"),
    alternatives: z.array(matchOut).describe("Other options, best first (3–5 for a carousel)"),
    fallback: fallbackOut.nullable().describe("Items with no deal: the Amazon option; null otherwise"),
    say,
  },
  find_matches: {
    request_id: z.string(),
    matches: z.array(matchOut),
    say,
  },
  negotiate: {
    deal: dealOut.nullable().describe("null when no price fits both limits"),
    say,
  },
  confirm_deal: { deal: dealOut, say },
  choose_handoff: { deal: dealOut, say },
  decline_deal: {
    deal_id: z.string(),
    status: z.literal("declined"),
    next_deal: dealOut.nullable().describe("The user's next best offer, if any"),
    say,
  },
  get_deal_status: {
    deals: z.array(dealOut),
    waiting_for_you: z.number().int(),
    say,
  },
  list_my_posts: {
    offers: z.array(offerOut),
    requests: z.array(requestOut),
    say,
  },
  withdraw_post: {
    post_id: z.string(),
    kind: z.enum(["offer", "request"]),
    status: z.enum(["withdrawn", "cancelled"]),
    released_deal_id: z.string().nullable().describe("The proposed deal this post was holding, now released"),
    say,
  },
  report_user: { report: reportOut, say },
  rate_deal: { rating: ratingOut, say },
  list_meetup_points: { points: z.array(pointOut), say },
  choose_meetup_point: { deal_id: z.string(), point: pointOut, say },
  check_in_at_point: {
    deal_id: z.string(),
    point: pointOut,
    arrival: arrivalOut,
    ring: z.object({
      device: z.boolean().describe("The point has a Ring device"),
      checked: z.boolean().describe("Ring Event History was read for this check-in"),
      error: z.string().nullable().describe("Why Ring couldn't be read; the signed webhook still confirms arrivals"),
    }),
    say,
  },
  delete_my_data: {
    deleted: z.literal(true),
    posts_taken_down: z.number().int().describe("Live offers and requests withdrawn first"),
    released_deals: z.number().int().describe("Deals on hold that were released; the other person is paired again"),
    posts_deleted: z.number().int().describe("Posts that never reached a deal, deleted"),
    posts_anonymised: z.number().int().describe("Posts kept for a past deal, moved to an anonymous 'Former member'"),
    deals_kept_anonymised: z.number().int().describe("Past deals the other person still sees, without the user's name"),
    events_deleted: z.number().int().describe("Activity-log entries about the user and their posts"),
    learning_rows_deleted: z.number().int().describe("Pairing-model training rows from the user's deals"),
    tokens_revoked: z.number().int().describe("Sign-in tokens deleted; the user is signed out everywhere"),
    say,
  },
};

export const suggestionOut = z.object({
  suggestion_id: z.string(),
  from: z.enum(["routine", "bee", "watch", "phone"]).describe("routine = learned from the user's own past requests"),
  reason: z.string().describe("Why it is suggested, e.g. 'From your Bee: \"…\"' or 'You've asked for this 6 times, usually on weekdays around 12:15pm.'"),
  heard: z.string().nullable().describe("The user's own words or to-do that led here (device suggestions)"),
  request: z.object({
    need: z.string(),
    kind,
    price_unit: priceUnit,
    max_price: money.nullable().describe("The user's own usual budget (private to them); null: ask before accepting"),
    hours: z.number().nullable(),
    pickup: z.string().nullable(),
    location: z.string().nullable(),
    schedule: z.string().nullable(),
    needed_by: z.string().nullable(),
  }).describe("The request accept_suggestion posts"),
  confidence: z.number().nullable().describe("Routines: 0-1, how regular the routine is"),
  say,
});

const routineOut = z.object({
  routine_id: z.string(),
  need: z.string(),
  kind,
  when: z.string().describe("e.g. 'on weekdays around 12:15pm'"),
  usual_budget: money.describe("Median of the user's own budgets for it (private to them)"),
  price_unit: priceUnit,
  pickup: z.string().nullable(),
  location: z.string().nullable(),
  times: z.number().int().describe("How often the user asked for it in the last 90 days"),
  next_at: z.string().describe("ISO 8601: when it is next due"),
  confidence: z.number(),
  paused: z.boolean().describe("Dismissed repeatedly: not suggested until accepted again"),
});

export const outputs = {
  ...marketOutputs,
  add_context: {
    signal_id: z.string(),
    suggestion: suggestionOut.nullable().describe("When the signal names a need"),
    duplicate: z.boolean().describe("The same external_id was sent before; nothing new was recorded"),
    say,
  },
  get_suggestions: { suggestions: z.array(suggestionOut), say },
  accept_suggestion: { suggestion_id: z.string(), ...marketOutputs.post_request },
  dismiss_suggestion: { suggestion_id: z.string(), forgotten: z.boolean(), say },
  get_my_routines: {
    time_zone: z.string(),
    routines: z.array(routineOut),
    devices: z.array(z.object({ source: z.string(), last_seen: z.string(), signals: z.number().int() }))
      .describe("Devices that have sent context, and when"),
    say,
  },
};
