# Tool contract

Endpoint: `POST /mcp`, Streamable HTTP, stateless, MCP protocol `2025-11-25`.
Identity and auth depend on `AUTH_MODE`:
- `oauth` (Alexa+): every call carries the linked account's `Authorization: Bearer <token>`. The user is taken **only** from the token, and `user_id` arguments are ignored. No token or a bad token returns 401 with `WWW-Authenticate: Bearer resource_metadata=...`.
- `none` (local dev and tests): `X-User-Id` header or a `user_id` argument. `MCP_API_KEY` adds an optional shared Bearer secret.

Every successful result is JSON (as text **and** `structuredContent`) with a `say` field: one sentence Alexa can speak as is.
Every tool declares an `outputSchema` ([src/mcp/schemas.ts](../src/mcp/schemas.ts)) and annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`).
Errors come back as `isError: true` with `{ "say": "..." }`: a sentence the user can act on, or a short apology when something unexpected failed (details go to the server log). An error an agent can act on also carries a `code`: `confirm_price` (see [Price check](#price-check)), `idempotency_conflict` or `in_progress` (see [Retries](#retries-idempotency_key)).
Inputs are bounded (text lengths, prices up to 100,000, quantities up to 1,000, hours up to 336).

## One market for things and services

Every post is an **offer** (what someone has or can do) or a **request** (what
someone needs), and each has a `kind`:

| Kind | Examples | Price unit | Where and when |
|---|---|---|---|
| `item` | a TI-84, a pack of tissues | `each` | meet-up area of the seller |
| `service` | a lunch run, an errand, event help, tutoring, moving help | `job` (flat fee) or `hour` (rate) | where the requester needs it (drop-off for errands), with an optional `pickup`, `schedule` and `hours` |

Offers and requests pair only with the same kind and price unit, so a lunch
request never lands on a lunch box, and an hourly request never lands on a
flat-fee crew. The person who pays is the `buyer` and the person who sells the
item or does the job is the `seller`.

## How pairing works

Offers and requests are both standing posts. Whenever either side posts, the
server pairs it with the best counterpart a deal is possible with, settles a
price inside both private limits, and opens a **proposed** deal in the same
call. A post with no counterpart waits and is paired when one arrives.

- **Relevance gate:** two posts count as a match only when their relevance
  (semantic + keyword, 0..1) reaches `MATCH_THRESHOLD`. Price fit and area then
  rank the relevant ones. Ties go to the earlier post.
- **Hard constraints:** same kind and price unit, enough quantity and the wanted
  condition (items), a price both limits allow, the request's deadline still ahead,
  and the pair not declined or left to expire before.
- **One hold at a time:** an offer (`pending`) and a request (`matched`) are each
  held by at most one proposed deal. Both are claimed in one SQL statement, so
  concurrent posts can never double-book an item or a runner.
- **Price:** one fixed rule, no haggling. The price is the asking price, or the
  buyer's budget when that is lower, and the deal exists when that price is at
  least the seller's minimum. So the seller's minimum never moves the price, and
  a budget at or above the ask never does either. A buyer who walked away from
  a price for a listing (declined, let it expire, switched or withdrew) is never
  offered that listing lower, by any later request. A buyer gets one offer
  below the asking price per listing: once a budget below the ask fails (a
  `negotiate` that returns no deal, or a new request that can't afford a
  relevant offer), that buyer gets the listing only at the asking price, so
  rising budgets can't climb to the seller's minimum. Settlement runs in
  pairing-core, a Rust library compiled to WebAssembly
  ([negotiation.ts](../src/market/negotiation.ts), `vendor/pairing-core`), in
  integer cents. For hourly work the rule applies to the rate and `total` is the
  rate times `hours`.
- **Ranking:** the hand-tuned score above, or a model learned from which deals
  closed (see [Learning](#learning-to-pair-better)). Either way it only orders
  candidates that pass every hard constraint.
- **No:** `decline_deal` releases both posts and re-pairs each with its next best
  counterpart. A declined pair is never proposed again.
- **Switching:** `negotiate` on another offer replaces the request's deal
  (old deal `replaced`); the released offer goes to other waiting requests.
- **Holds expire:** an offer nobody answers expires after `DEAL_HOLD_HOURS`
  (default 24), or at the request's `needed_by` when that comes first, so a lunch
  offer never outlives lunch. Both posts go back on the market and are paired
  again. An expired pair, like a declined one, is not proposed again. Every deal
  shows `on_hold_until`.
- **Deadlines:** a request whose `needed_by` has passed stops pairing.
- **Withdrawing:** an offer taken down or a request cancelled releases the deal it
  held, and the other person is paired again.
- **Limits:** `POSTS_PER_HOUR` per user (default 30), `MAX_OPEN_REQUESTS` (default
  10), and `MCP_CALLS_PER_MINUTE` per caller (default 120, HTTP 429 beyond it).
  They also slow down anyone trying many budgets.
- **Closing:** a deal is `confirmed` once both sides have said yes. `auto_accept`
  pre-confirms the seller; it defaults to on for items and off for services, so
  a provider says yes to each job. An item becomes `sold`; a service offer stays
  `active` and is paired with the next waiting request. The request becomes
  `fulfilled`.

## Retries: `idempotency_key`

Voice hosts and agents retry when a response is slow or lost. Every tool that
changes the market (`post_offer`, `post_request`, `negotiate`, `confirm_deal`,
`decline_deal`, `withdraw_post`) takes an optional `idempotency_key` (8–64
characters of `A-Z a-z 0-9 . _ : -`, e.g. a UUID):

- The first call with a key runs and its result is stored for 24 hours.
- A retry with the same key and the same arguments returns that result
  unchanged; nothing is posted, paired or confirmed twice.
- The same key with different arguments returns error `idempotency_conflict`.
- A retry that arrives while the first call is still running returns error
  `in_progress`; retry again with the same key.
- Errors are not stored, so after a `confirm_price` error the same key can be
  sent again with `confirm_price: true`.

Keys are scoped to the user, so two users can never collide.

## Prompts

Hosts that list MCP prompts (Claude, VS Code, the MCP Inspector) show three
starters: `sell_something` (`what`, `price`, optional private `lowest`),
`find_something` (`need`, private `budget`) and `whats_new`.

## Discovery

| URL | What it is |
|---|---|
| `/.well-known/mcp/server-card.json` | Server card: name, version, protocol, `/mcp` endpoint, authentication, instructions, and every tool (with input and output schemas), prompt and view, read from the live server |
| `/llms.txt` | The same in Markdown for agents that read the web, with the rules an agent must follow |
| `/skills/amazonpairup/SKILL.md` | The Agent Skill ([skills/amazonpairup/SKILL.md](../skills/amazonpairup/SKILL.md)) |
| `/.well-known/oauth-protected-resource` | OAuth 2.1 metadata (RFC 9728), with `AUTH_MODE=oauth` |
| `/health`, `/ready` | Liveness, and readiness including the database |

Every response carries `X-Request-Id` (the caller's own, when it sends a valid
one), and every log line for that request has the same id.

## Price check

Before an offer or a request is posted, its price is compared with the typical
range for similar posts ([pricing.ts](../src/market/pricing.ts)). The range comes
from reference prices (`data/reference-prices.json`; a product catalog in
production), matched by meaning within the same kind and price unit and adjusted
for condition, or else from this market's confirmed trades of similar posts.
Trades count only between different accounts older than a week, never the
poster's own, with one vote per seller, at least three sellers and three buyers,
and a median-based range, so staged trades barely move it.

| Price | Far when | Then |
|---|---|---|
| `ask_price` | below half the range's low, or above twice its high | error `confirm_price` |
| `min_price` | below half the range's low | error `confirm_price` |
| `max_price` | above twice the high for a new one | error `confirm_price` |
| a `max_price` far below | | the request is posted; `say` adds that it may take a while |

The `confirm_price` error has `say` ("Items like this usually sell for $220 to
$380, and you're asking $1. Is $1 right? …"), `field`, `price`, `verdict`,
`typical_low`, `typical_high` and `source`. Read `say`; on a yes, call the same
tool again with `confirm_price: true`; on a different number, call it with that
number. A confirmed far price is stored as `price_flag`, and a buyer offered a
deal far below the usual price hears a safety note (meet in public, pay on
handover). The check never sets, blocks or settles a price. Thresholds:
`PRICE_FAR_BELOW`, `PRICE_FAR_ABOVE`, `PRICE_REFERENCE_MATCH`, `PRICE_TRADE_MATCH`.

## Hand-offs to Amazon

The local market covers what Amazon retail doesn't (a used item under $20, an
errand, an hour of help). When it can't help, the result points to Amazon, and
the post keeps waiting on the market either way. All three rules are
deterministic ([amazon.ts](../src/market/amazon.ts)).

| When | Result field | What it carries |
|---|---|---|
| `post_request` for an item ends without a deal | `fallback` | `reason` (`no_seller`, or `over_budget` when offers exist but none fits the budget), `new_price` (typical price new on Amazon.com, from `new_price` in `data/reference-prices.json`; `null` when no reference matches), `currency: "USD"`, `amazon_url` (`https://www.amazon.com/s?k=<need>`), `still_waiting: true`, `say` ("Nobody nearby has one yet. New on Amazon it's about $110.") |
| `post_offer` for an item nobody is asking for, in a Trade-In category | `trade_in` | `category` (`electronics`, `books` or `game_consoles`, matched by whole words of the category and title; list in `data/trade-in-categories.json`), `url: "https://www.amazon.com/tradein"`, `say` |
| a deal for an item where both sides are in the same area | `deal.meetup.hub_point` | That area's Amazon Hub Locker or Counter (`name`, `type` (`locker` or `counter`), `area`, `demo`); `meetup.place` names it as the suggested hand-off place |

A side's area is the post's `location`, else the person's home area. Services
get none of these: an errand happens where the requester needs it. When
`new_price` is known and nothing at all is nearby, `say` ends with "If you
can't wait, it's about $110 new on Amazon." The Hub points in
`data/seed-listings.json` (`areas`) are made-up demo data and come back with
`demo: true`; production reads them from the Amazon Hub locator.

## Learning to pair better

Every deal the engine proposes records its features
([learning.ts](../src/market/learning.ts)): relevance, price fit, discount,
budget headroom (internal only), same area, condition margin, a pre-approved
seller, urgency, availability given, delivery offered, price against the typical
range, both sides' track records, and item or service. Confirmed is a success;
declined or expired is a failure.

Every `LEARN_INTERVAL_HOURS` (default 24; also `npm run learn`), once
`LEARN_MIN_OUTCOMES` outcomes exist:

1. **Rollback first.** If the live completion rate of the model arm trails the
   control arm by more than 5 points (30+ outcomes each, last 14 days), the
   model is retired and the hand-tuned ranking returns.
2. **Train** an L2-regularised logistic regression on the older 75% of
   outcomes. Training is deterministic: the same outcomes give the same model.
3. **Judge** it on the newest 25% by AUC against the ranking in use, and promote
   it only with a gain of at least 0.01.

10% of posts, chosen by a hash of the post id, always use the hand-tuned
ranking as a live control. The model reorders candidates only; it never changes
which candidates are allowed, and it never touches a price. The dashboard shows
the daily completion rate, both arms and the model's main drivers.

## Privacy rules

| Field | Visible to |
|---|---|
| offer `ask_price` | everyone |
| offer `min_price` | its owner only, as `your_min_price` |
| request `max_price` | its owner only, as `your_max_price` |
| agreed deal `price` and `total` | both parties |
| counterpart display name, place, pickup, time, and the task for a service | both parties of a deal |
| no price inside both limits | nobody gets numbers ("can't meet your budget") |
| typical price range (`typical_price`, `price_check`) | everyone: it describes similar posts, never a person's limit |

All output goes through [views.ts](../src/market/views.ts); the tests fail on any leak.

## Tools

### `post_offer`
`title`*, `ask_price`*, `kind` (`item|service`, default `item`), `price_unit` (services: `job|hour`, default `job`), `min_price` (default `ask_price`), `description`, `category`, `auto_accept` (default true for items, false for services), `condition` (items: `new|like_new|good|fair|for_parts`, default `good`), `quantity` (items), `location`, `availability`, `confirm_price` (only after a `confirm_price` error)
→ `{ offer, deal | null, waiting_requests, trade_in | null, say }`. The offer carries `typical_price: { low, high, source } | null`. `deal` is opened when someone was already waiting; `waiting_requests` counts the requests this offer satisfies. `trade_in`: see [Hand-offs to Amazon](#hand-offs-to-amazon).

### `post_request`
`need` and/or `raw_request`*, `max_price` (required unless stated in `raw_request`; per hour for hourly work), `kind`, `price_unit`, `hours`, `pickup`, `location`, `schedule`, `needed_by` (ISO 8601, in the future: an item's deadline or a job's start), `min_condition` (items), `quantity` (items), `source` (`voice|bee_context`), `confirm_price` (only after a `confirm_price` error)
→ `{ request, deal | null, alternatives: [offer + within_budget_at_ask + score] (up to 4), fallback | null, say }`. With no deal, `alternatives` and `say` also name the closest offers the budget can't reach, at their asking price, and an item request gets a `fallback` (see [Hand-offs to Amazon](#hand-offs-to-amazon)). Structured args win; `raw_request` is parsed to fill the gaps, including kind, unit, hours, pickup, place and time ("find someone to pick up my lunch from LG7 canteen to Hall 5 by 12:30, $5").

### `find_matches`
`request_id`*, `limit` (1–10, default 3)
→ `{ request_id, matches, say }`. The offer currently proposed to the request is not repeated.

### `negotiate`
`request_id`*, `offer_id`*, `max_price` (raises the request's budget first; only upward)
→ `{ deal | null, say }`. Settles that offer by the same rule and replaces the request's current deal. `deal: null` when no price fits both limits; `say` then names the public asking price ("The seller can't go that low. It's $20. Want it at that price?"), and on a yes the agent calls again with `max_price` set to it.

### `confirm_deal`
`deal_id`*. Call **only after the user explicitly says yes.**
→ `{ deal, say }`.

### `decline_deal`
`deal_id`*
→ `{ deal_id, status: "declined", next_deal | null, say }`. `next_deal` is the user's next best offer, or for a provider the next job.

### `get_deal_status`
`deal_id` (optional)
→ `{ deals, waiting_for_you, say }`. Deals and jobs waiting for the user's yes come first.

### `list_my_posts`
→ `{ offers, requests, say }`. The user's own posts, newest first (up to 20 each), with their status.

### `withdraw_post`
`post_id`* (an `offer_id` or `request_id`)
→ `{ post_id, kind: "offer"|"request", status: "withdrawn"|"cancelled", released_deal_id | null, say }`.

### Deal object
`deal_id`, `offer_id`, `request_id`, `kind`, `title` (the offer), `task` (services: what was asked for), `condition` (items), `your_role` (`buyer|seller`), `counterpart`, `price`, `price_unit` (`each|job|hour`), `hours`, `total`, `ask_price`, `saved_vs_ask`, `price_check` (`{ verdict: typical|below_typical|above_typical|far_below|far_above, typical_low, typical_high, source } | null`), `currency`, `status` (`proposed|confirmed|declined|replaced|expired|withdrawn`), `buyer_confirmed`, `seller_confirmed`, `waiting_for` (`["buyer"|"seller"]`), `waiting_for_you`, `meetup: { place, availability, hub_point | null }` (for a service: where the job is and when; for an item in one area: the Amazon Hub point), `pickup` (errands), `needed_by` (services), `on_hold_until` (while proposed), `created_at`, `updated_at`.

## MCP Apps view

Every tool except `withdraw_post` declares `_meta.ui.resourceUri = "ui://amazonpairup/market.html"`
in its definition (MCP Apps spec) and repeats it in each result's `_meta` (Alexa+
client lifecycle). `resources/read` returns one self-contained HTML document
(`text/html;profile=mcp-app`) that picks its layout from the result:

| Result | Layout |
|---|---|
| `deal` / `next_deal`, or a new `offer` / `request` | Deal card: price (per job or per hour, with the total), savings, counterpart, meet-up or pickup → drop-off and time, hold time; Confirm / Decline (Take the job / Pass for a provider) while it waits for the user; alternatives as a carousel |
| `fallback` / `trade_in` on a waiting post | A secondary button: "New on Amazon · about $110" (the amazon.com search) or "Amazon Trade-In", opened through the host |
| `matches` | Options carousel with "Get this one" / "Book this one" (`negotiate`) |
| `deals` | The user's deals and jobs, those waiting for their yes first |
| `offers` / `requests` | The user's posts with "Take down" (`withdraw_post`) |

Inline lists show at most five items. Buttons call tools through the host.

## Web app endpoints

| Endpoint | Purpose |
|---|---|
| `GET /app/` | The web app (an MCP host); `/` redirects here |
| `GET /api/app-config` | How to sign in: `{ auth: "none" }` or the OAuth public client (`amazonpairup-web`, PKCE, redirect `<PUBLIC_BASE_URL>/app/`) |
| `GET /api/me` | The signed-in user's id and display name |
| `POST /api/agent` | One assistant step. Body `{ messages }` in the Bedrock Converse shape; returns `{ message, stop, mode }` (`stop` is `tool_use` or `end_turn`). The app runs requested tools over `/mcp` itself and sends the results back. A `confirm_deal` call is only returned after the user's explicit yes. |

Same identity, Origin and rate-limit rules as `/mcp`; same-origin browser calls are allowed.

## Conversation flows

```
seller: "Sell my TI-84 for $20, I'll take anything above $15."
  → post_offer              Alexa: "Listed … I'll pair you with a buyer as soon as one asks."
buyer:  "I need a graphing calculator today, max $18."
  → post_request            Alexa: "Found it: TI-84 Plus graphing calculator for $18, $2 below asking.
                                    Meet-up: HKUST campus. Should I confirm it?"
buyer:  "Yes."  → confirm_deal   Alexa: "Done! … Meet-up: HKUST campus, weekdays after 5pm."
seller: "Did anyone buy my calculator?" → get_deal_status
```

```
runner: "I can do lunch runs around campus for $4 a run, at least $3."
  → post_offer (service)    Alexa: "You're on the market: Lunch runs around campus, $4 a job. …"
hungry: "Find someone to pick up my lunch from LG7 canteen to Hall 5 by 12:30, $5."
  → post_request            Alexa: "Found someone: Ken can do it for $4.
                                    From LG7 canteen to Hall 5, by 12:30. Should I confirm? Ken gives the final yes."
hungry: "Yes."  → confirm_deal   Alexa: "Confirmed on your side. I'll let you know when Ken says yes."
runner: "Any jobs for me?" → get_deal_status   "One deal is waiting for your yes. Pick up my lunch for Mei, $4 …"
runner: "Yes."  → confirm_deal   Alexa: "Booked! Lunch runs around campus with Mei, $4. From LG7 canteen to Hall 5, by 12:30."
```

Hourly work reads the same way: "Get me a helper for the event on Saturday
2-6pm, budget $10/hr" pairs with a helper asking $11 with a $9 minimum: the
$10 budget is the offer, so $10 an hour, $40 for 4 hours.

When the requester posts first, the order flips: the request waits, and the
offer's `post_offer` opens the deal ("A buyer was already looking for one…", or
"New job from Mei: … Want it?"). The requester hears about it through
`get_deal_status`.
