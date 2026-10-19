import { z } from "zod";
import { CONDITIONS } from "../ai/index.js";

// Output schemas for every tool. They mirror src/market/views.ts exactly, so
// clients (and Alexa+) can rely on structuredContent. test/schema.test.ts
// checks real tool results against them.

const condition = z.enum(CONDITIONS);
const money = z.number().nonnegative();
const say = z.string().describe("One short sentence to speak back to the user");

export const listingOut = z.object({
  listing_id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  condition,
  quantity: z.number().int(),
  currency: z.string(),
  ask_price: money.describe("Public asking price"),
  location: z.string().nullable().describe("Meet-up area"),
  availability: z.string().nullable().describe("When the seller can meet"),
  status: z.enum(["active", "pending", "sold", "withdrawn"]).describe("pending = held by a proposed deal"),
  your_min_price: money.optional().describe("Only for the seller: their private minimum"),
  auto_accept: z.boolean().optional().describe("Only for the seller"),
});

export const matchOut = listingOut.extend({
  within_budget_at_ask: z.boolean().describe("The asking price is already within the buyer's budget"),
  score: z.number().describe("Ranking score, higher is better"),
});

export const intentOut = z.object({
  intent_id: z.string(),
  need: z.string(),
  source: z.enum(["voice", "bee_context"]),
  category: z.string().nullable(),
  min_condition: condition,
  quantity: z.number().int(),
  currency: z.string(),
  needed_by: z.string().nullable().describe("ISO 8601 deadline; the request stops pairing after it"),
  location: z.string().nullable(),
  status: z.enum(["open", "matched", "fulfilled", "cancelled"]).describe("matched = held by a proposed deal"),
  your_max_price: money.optional().describe("Only for the buyer: their private budget"),
});

const party = z.enum(["buyer", "seller"]);

export const dealOut = z.object({
  deal_id: z.string(),
  listing_id: z.string(),
  title: z.string(),
  condition,
  your_role: z.enum(["buyer", "seller", "observer"]),
  counterpart: z.string().nullable().describe("Display name of the other person"),
  price: money.describe("Agreed price, inside both private limits"),
  ask_price: money,
  saved_vs_ask: z.number().describe("Asking price minus agreed price"),
  currency: z.string(),
  status: z.enum(["proposed", "confirmed", "declined", "replaced", "expired", "withdrawn"])
    .describe("replaced = the buyer chose another option; expired = nobody answered in time; withdrawn = a post was taken down"),
  buyer_confirmed: z.boolean(),
  seller_confirmed: z.boolean(),
  waiting_for: z.array(party).describe("Who still has to say yes"),
  waiting_for_you: z.boolean(),
  meetup: z.object({ place: z.string().nullable(), availability: z.string().nullable() }),
  on_hold_until: z.string().nullable().describe("While proposed: when the offer expires if nobody answers"),
  created_at: z.string(),
  updated_at: z.string(),
});

export const outputs = {
  create_listing: {
    listing: listingOut,
    deal: dealOut.nullable().describe("Opened when a buyer was already waiting"),
    waiting_buyers: z.number().int().describe("Buyers whose request this item satisfies"),
    say,
  },
  create_buy_intent: {
    intent: intentOut,
    deal: dealOut.nullable().describe("The best seller, already negotiated; null while the request waits"),
    alternatives: z.array(matchOut).describe("Other options, best first (3–5 for a carousel)"),
    say,
  },
  find_matches: {
    intent_id: z.string(),
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
    listings: z.array(listingOut),
    requests: z.array(intentOut),
    say,
  },
  withdraw_post: {
    post_id: z.string(),
    kind: z.enum(["listing", "request"]),
    status: z.enum(["withdrawn", "cancelled"]),
    released_deal_id: z.string().nullable().describe("The proposed deal this post was holding, now released"),
    say,
  },
};
