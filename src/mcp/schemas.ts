import { z } from "zod";
import { CONDITIONS } from "../ai/index.js";
import { KINDS } from "../market/types.js";

// Output schemas for every tool. They mirror src/market/views.ts exactly, so
// clients (and Alexa+) can rely on structuredContent. test/schema.test.ts
// checks real tool results against them.

const condition = z.enum(CONDITIONS);
const kind = z.enum(KINDS).describe("'item' (a thing) or 'service' (someone does a task)");
const priceUnit = z.enum(["each", "job", "hour"]).describe("each = an item; job = flat fee per task; hour = hourly rate");
const money = z.number().nonnegative();
const say = z.string().describe("One short sentence to speak back to the user");

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
  status: z.enum(["active", "pending", "sold", "withdrawn"])
    .describe("pending = held by a proposed deal; sold = item sold (a service offer stays active after each job)"),
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
  source: z.enum(["voice", "bee_context"]),
  category: z.string().nullable(),
  min_condition: condition.nullable().describe("Items only"),
  quantity: z.number().int(),
  price_unit: priceUnit,
  hours: z.number().nullable().describe("Hourly work: expected length"),
  pickup: z.string().nullable().describe("Errands: where to collect from"),
  schedule: z.string().nullable().describe("Services: when, as said"),
  currency: z.string(),
  needed_by: z.string().nullable().describe("ISO 8601: an item's deadline or a job's start; the request stops pairing after it"),
  location: z.string().nullable(),
  status: z.enum(["open", "matched", "fulfilled", "cancelled"]).describe("matched = held by a proposed deal"),
  your_max_price: money.optional().describe("Only for the owner: their private budget"),
});

const party = z.enum(["buyer", "seller"]);

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
  currency: z.string(),
  status: z.enum(["proposed", "confirmed", "declined", "replaced", "expired", "withdrawn"])
    .describe("replaced = the buyer chose another option; expired = nobody answered in time; withdrawn = a post was taken down"),
  buyer_confirmed: z.boolean(),
  seller_confirmed: z.boolean(),
  waiting_for: z.array(party).describe("Who still has to say yes"),
  waiting_for_you: z.boolean(),
  meetup: z.object({ place: z.string().nullable(), availability: z.string().nullable() })
    .describe("Where and when: the meet-up for an item; for a service, where the job is (drop-off for errands) and when"),
  pickup: z.string().nullable().describe("Errands: where to collect from"),
  needed_by: z.string().nullable().describe("Services: when the job is due or starts"),
  on_hold_until: z.string().nullable().describe("While proposed: when the offer expires if nobody answers"),
  created_at: z.string(),
  updated_at: z.string(),
});

export const outputs = {
  post_offer: {
    offer: offerOut,
    deal: dealOut.nullable().describe("Opened when someone was already waiting"),
    waiting_requests: z.number().int().describe("Open requests this offer satisfies"),
    say,
  },
  post_request: {
    request: requestOut,
    deal: dealOut.nullable().describe("The best offer, already negotiated; null while the request waits"),
    alternatives: z.array(matchOut).describe("Other options, best first (3–5 for a carousel)"),
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
};
