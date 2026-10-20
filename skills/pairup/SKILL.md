---
name: pairup
description: Buy, sell or get small jobs done between people through the PairUp MCP server. Use when the user wants to sell an item, offer a service (errands, deliveries, event help, tutoring), find an item, get someone to do a task, or check on their deals and meet-ups, rate a deal or report someone. Covers posting, reading a proposed deal, confirming only on an explicit yes, private price limits, price checks, what can't be posted, ratings, reports and retries.
license: MIT
metadata:
  version: "0.8.0"
  mcp-endpoint: https://d3cxpkmhl89rw9.cloudfront.net/mcp
  server-card: https://d3cxpkmhl89rw9.cloudfront.net/.well-known/mcp/server-card.json
---

# PairUp

PairUp pairs people directly. Someone who needs a thing or a task done is
paired with someone who has it or can do it. The server picks the pair,
settles the price by a fixed rule inside limits each side keeps private, and
records each side's yes. Your job as the agent is to turn what the user says
into one tool call, read back the result, and ask for a yes.

## Connect

- MCP endpoint: `https://d3cxpkmhl89rw9.cloudfront.net/mcp`, Streamable HTTP, protocol `2025-11-25`. Calls can be stateless; initialize for subscriptions.
- Sign-in: OAuth 2.1 with PKCE. Discovery at `/.well-known/oauth-protected-resource`.
  No pre-registration: use a Client ID Metadata Document (your `client_id` is the
  https URL of your client metadata JSON) or register at `/oauth/register`
  (RFC 7591, public client). The user approves your client by name and signs in
  with Login with Amazon. Revoke tokens at `/oauth/revoke` when the user signs out.
  The user comes from the token; leave `user_id` out.
- Locally (`npm start`): `http://127.0.0.1:3000/mcp` with an `X-User-Id` header.

## The six rules

1. **Confirm only on an explicit yes.** Call `confirm_deal` only when the user's
   latest words are a yes to the deal you just read out. Anything else: ask.
2. **Respect private limits.** Never disclose or guess another person's limit.
   A budget below the public ask becomes the buyer's visible offer; a budget
   covering the ask stays private. The seller's minimum does not set the price.
3. **No haggling.** The server sets every price. Never offer, counter or
   suggest a price on anyone's behalf.
4. **Speak the `say` field.** Every result and every error has one sentence
   written for speech. Use it as your reply unless you need to add a question.
5. **Retry with the same key.** Send a fresh `idempotency_key` (a UUID) with
   every write tool; if a call times out, send it again with the same key. The
   first result comes back and nothing is posted twice.
6. **No workarounds.** Weapons, drugs, alcohol, tobacco, prescription medicine,
   recalled or counterfeit goods, fake documents, cheating, adult services, live
   animals and illegal services can't be posted. When a post is refused, speak
   its `say`; never reword the post to get it through.

## Which tool

For services preserve the stated `availability` and `schedule`. The default
time zone is `America/Los_Angeles`; use another IANA `time_zone` only when specified.
Exact appointments may use `starts_at` / `ends_at` with UTC offsets. Read
`deal.scheduling`: `verified` means the full work window fits stated availability;
`needs_confirmation` means the provider must check it. Never call a tentative
time verified. “Yes if…” and “sure but…” add constraints; they are not approval.
Confirmation records agreement, not payment, handover or completed work.

| The user says | Call |
|---|---|
| "Sell my TI-84 for $20, I'll take $15" | `post_offer` with `title`, `ask_price: 20`, `min_price: 15` |
| "I can do lunch runs on campus for $5" | `post_offer` with `kind: "service"`, `ask_price: 5`, `location` |
| "Event help, $12 an hour" | `post_offer` with `kind: "service"`, `price_unit: "hour"`, `ask_price: 12` |
| "I need a graphing calculator today, max $18" | `post_request` with `raw_request` = their words (add fields you clearly heard) |
| "Pick up my lunch from the HUB to McCarty Hall by 12:30, $5" | `post_request` with `raw_request`; the server reads kind, pickup and time |
| "Yes" / "Confirm it" (right after you read a deal) | `confirm_deal` with that `deal_id` |
| "Where can we meet safely?" / "Meet at a PairUp Point" | `list_meetup_points`, then `choose_meetup_point` with the `deal_id` (and the `point_id` they picked) |
| "I'm here" (at the point, confirmed deal) | `check_in_at_point` with that `deal_id` |
| "Can they send it?" / "Deliver it to me" (item deal) | `choose_handoff` with `method: "delivery"`, then read the fee and the pickup locker; `"meetup"` switches back |
| "No" / "Not that one" | `decline_deal`; the result includes the next best offer when there is one |
| "Show me other options" | `find_matches` with the `request_id` |
| "Get the second one" | `negotiate` with `request_id` and that option's `offer_id` |
| "Any news?" / "When is my meet-up?" | `get_deal_status` |
| "What am I selling?" | `list_my_posts` |
| "Take down my calculator" | `list_my_posts`, confirm which one, then `withdraw_post` |
| "It went great" (after a confirmed deal) | `rate_deal` with that `deal_id` and `stars` 1-5 |
| "The seller never showed up" / "This is a scam" | Confirm, then `report_user` with the `deal_id` (or the offer's `post_id`) and a `reason` |

`post_offer` and `post_request` pair and settle in the same call. When the
result has a `deal`, read it out and ask "Should I confirm it?". When `deal` is
null the post waits on the market and is paired as soon as a counterpart
arrives; say so and stop.

## When nobody nearby can help

The market covers what Amazon doesn't (a used item under $20, an errand, an
hour of help) and hands off to Amazon when it can't help. The post keeps
waiting either way, so offer these as an option and never as a replacement:

- `post_request` for an item with no deal returns `fallback`: `amazon_url`
  (an amazon.com search), `new_price` (demo estimate for a new item, or null) and a `say`
  ("Nobody nearby has one yet. New on Amazon it's about $110."). Open the link
  only if the user asks for it.
- `post_offer` for an item nobody is asking for yet, in a category Amazon
  Trade-In takes (candidate electronics and game consoles), returns `trade_in` with
  the Amazon Trade-In `url`.
- When both sides are in the same area, `deal.meetup.place` is that area's
  Amazon Hub Locker or Counter (`meetup.hub_point`): a public, watched place
  to hand over the item. Read it as the meet-up.

## PairUp Points (Ring)

A PairUp Point is an unstaffed hand-off spot watched by one Ring doorbell.
Offer one when the user wants a safe place to meet a stranger.

- `list_meetup_points` lists the points (optionally by `area`); read the
  name and hours. Points marked `demo: true` are demo locations.
- `choose_meetup_point` sets the point for a proposed or confirmed deal.
  Without `point_id` it picks the point in both people's area. The point
  becomes `deal.meetup.place`.
- `check_in_at_point` is the "I'm here" step on a confirmed deal. Ask the
  user to press the doorbell first. Ring confirms the arrival when the
  device recorded a press or a person within ten minutes.
- `deal.meetup.point.status` reads `chosen`, `one_here` or `both_here`;
  `you` and `them` read `not_here`, `checked_in` or `confirmed`. Read
  "You're both here" when it is `both_here`.

PairUp keeps only the Ring event type and time, for 24 hours, and never video.

## Reading a deal

A deal has `price`, `ask_price` and `saved_vs_ask`, `counterpart`,
`meetup.place` and `meetup.availability` (with `meetup.hub_point` when it is an Amazon Hub point and `meetup.point` when it is a PairUp Point), `pickup` and `needed_by` for errands,
`on_hold_until`, and `waiting_for` (who still has to say yes; `waiting_for_you`
is true when it is the user). Hourly work also has `hours` and `total`.
`price_check` compares the price with the usual range. A deal is closed when
its `status` is `confirmed`.

Good: "Found it: TI-84 Plus for $18, $2 below asking, meet-up at UW campus. Should I confirm it?"

## Errors you can act on

- `code: "confirm_price"`: the price is far from what similar things go for.
  The `say` already asks the user. On a yes, call the same tool again with the
  same arguments plus `confirm_price: true`; if they give another number, call
  again with that number.
- No deal after `negotiate`, with `say` naming the asking price ("It's $20.
  Want it at that price?"): a buyer gets one offer below the asking price per
  offer. On a yes, call `negotiate` again with `max_price` set to that asking price.
- `code: "prohibited_item"` or `"restricted_item"`: the market doesn't allow
  that item or service (`category` says which). Speak `say` and stop; don't
  retry with other words.
- `code: "account_under_review"` or `"account_suspended"`: other people reported
  this user and a reviewer is looking at it. Speak `say`; nothing else can be done here.
- `code: "not_confirmed"` or `"already_rated"` from `rate_deal`: a deal can be
  rated once both sides confirmed it, once per side.
- `code: "idempotency_conflict"`: you reused a key for a different action. Use a new key.
- `code: "in_progress"`: the first copy of this call is still running. Wait a moment and retry with the same key.
- Any other error: speak its `say`. It is written for the user.

## Ratings and reports

After a deal is confirmed, you may ask "How did it go, out of five?" and call
`rate_deal`. Ratings stay private and help the market pair people who follow
through. When the user says they were scammed, someone didn't show up, the item
wasn't as described, or they felt unsafe, confirm and call `report_user` with
the matching `reason`. The two are never paired again and any open deal
between them is cancelled. For `unsafe`, the `say` starts by pointing the user
to emergency services: always read it in full.

## Example

```
User: I need a graphing calculator for my exam tomorrow, max 18 dollars.
Agent → post_request { raw_request: "I need a graphing calculator for my exam tomorrow, max 18 dollars", idempotency_key: "7f9c…" }
Server ← { say: "Found it: TI-84 Plus graphing calculator for $18, $2 below asking. Meet-up: UW campus. Should I confirm it?", deal: { deal_id: "d_1a2b", … } }
Agent: Found it: TI-84 Plus graphing calculator for $18, $2 below asking. Meet-up: UW campus. Should I confirm it?
User: Yes.
Agent → confirm_deal { deal_id: "d_1a2b", idempotency_key: "c41e…" }
Server ← { say: "Done! TI-84 Plus graphing calculator for $18 with Mei. Meet-up: UW campus, weekdays after 5pm.", … }
Agent: Done! TI-84 Plus graphing calculator for $18 with Mei. Meet-up: UW campus, weekdays after 5pm.
```

Full contract, schemas and privacy rules: [TOOL_CONTRACT.md](https://github.com/rairurairu/amazon-pair-up/blob/main/docs/TOOL_CONTRACT.md).

## Live resources, confirmations and deletion

An initialized session returns Mcp-Session-Id. Keep it on subsequent calls and
open GET /mcp for SSE notifications. Subscribe to deals://me and posts://me
with resources/subscribe; on notifications/resources/updated, read the URI.
Resources contain only the signed-in user's view. resources/unsubscribe stops
updates and DELETE /mcp closes the session. An expired session returns 404;
initialize again. Calls without a session id continue to work.

Clients declaring form elicitation receive elicitation/create for unusual
prices and deal confirmation. Declining or cancelling leaves the action
unconfirmed. Clients without elicitation use the tool's spoken confirmation flow.

`delete_my_data` asks for confirmation; pass confirm: true only after the user's
explicit yes. It withdraws live posts, releases holds, erases the account, tokens,
history and learning rows, and anonymizes past deals needed by the counterpart.

## Lifestyle suggestions and devices

| Tool | Use and result |
|---|---|
| `get_suggestions` | On sign-in, on arrival, or when asked what the user needs. Returns private suggestions from their own history or context. |
| `accept_suggestion` | After explicit yes; pass suggestion_id and max_price if a budget is missing. Returns a posted request and any proposed deal. |
| `dismiss_suggestion` | Not now skips this occurrence. forget: true stops the routine; device snippets are removed on dismissal. |
| `add_context` | source bee/watch/phone, kind todo/conversation/journal/fact/location/note, need text or place, optional stable external_id, observed_at and time_zone. Returns a suggestion when relevant. |
| `get_my_routines` | Explain the learned need, usual budget, time, route and contributing devices. |

Request source can be voice, bee_context, device_context or routine. Suggestions
are private to their owner and need explicit acceptance before posting. Repeated
dismissals pause a routine; forget stops it. Budgets are learned from that user's
own requests. When the budget is unknown, ask before accepting.

The signed-in web session creates, lists and revokes devices with POST/GET
/api/devices and DELETE /api/devices/:id. Create with kind watch/bee/phone and an
optional label. Up to ten active tokens; the raw apd_ token is shown once and
stored only as a hash. Device tokens authorize POST /api/voice (text,
time_zone, optional conversation_id → say) and POST /api/context (a signal or
{signals:[…]} → suggestions and say). A device token cannot manage devices.
Voice history lasts ten minutes; context need snippets expire after thirty days.

For an agent holding Bee MCP data: read the user's todos or daily summary, call
add_context for a need clause with source bee and a stable external_id, then
get_suggestions. Ask for a budget if needed and wait for yes before accepting.
See [Bee guide](https://github.com/rairurairu/amazon-pair-up/blob/main/docs/BEE.md) and [Apple Watch guide](https://github.com/rairurairu/amazon-pair-up/blob/main/docs/APPLE_WATCH.md).

Retail reference amounts are hand-set demo estimates and are labelled in spoken results and cards. Amazon search links let the user check current prices. Trade-In links ask the user to check eligibility for their model and country.

## Use with Bee

Pair this skill with the official [Bee Skill](https://github.com/bee-computer/bee-skill)
or Bee MCP (`bee mcp`). Discover the installed Bee tools, read the user's own
to-dos or daily context, and forward only a relevant need clause through
`add_context` with `source: "bee"` and a stable `external_id`. Then call
`get_suggestions`. A TI-84 needed before an exam is an education workflow:
read the prepared request, ask for a budget when needed, and wait for yes before
`accept_suggestion`. Raw conversations and other people's utterances stay in Bee.
