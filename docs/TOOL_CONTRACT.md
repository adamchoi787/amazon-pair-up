# Tool contract

Endpoint: `POST /mcp`, Streamable HTTP, stateless, MCP protocol `2025-11-25`.
Identity and auth depend on `AUTH_MODE`:
- `oauth` (Alexa+): every call carries the linked account's `Authorization: Bearer <token>`. The user is taken **only** from the token, and `user_id` arguments are ignored. No token or a bad token returns 401 with `WWW-Authenticate: Bearer resource_metadata=...`.
- `none` (local dev and tests): `X-User-Id` header or a `user_id` argument. `MCP_API_KEY` adds an optional shared Bearer secret.

Every successful result is JSON (as text **and** `structuredContent`) with a `say` field: one sentence Alexa can speak as is.
Every tool declares an `outputSchema` ([src/mcp/schemas.ts](../src/mcp/schemas.ts)) and annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`).
Errors come back as `isError: true` with `{ "say": "..." }`: a sentence the user can act on, or a short apology when something unexpected failed (details go to the server log).
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
server pairs it with the best counterpart a deal is possible with, negotiates a
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
- **Price:** the midpoint of the overlap between the seller's minimum and the
  lower of the asking price and the buyer's budget, rounded to $0.50 when that
  midpoint is below $10 and to $1 from $10 up, in integer cents. Settlement runs
  in pairing-core, a Rust library compiled to WebAssembly
  ([negotiation.ts](../src/market/negotiation.ts), `vendor/pairing-core`); raising
  any limit never lowers the price. For hourly work the rate is negotiated and
  `total` is the rate times `hours`.
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
  The posting limits also stop a buyer from narrowing a seller's minimum by
  trying many budgets.
- **Closing:** a deal is `confirmed` once both sides have said yes. `auto_accept`
  pre-confirms the seller; it defaults to on for items and off for services, so
  a provider says yes to each job. An item becomes `sold`; a service offer stays
  `active` and is paired with the next waiting request. The request becomes
  `fulfilled`.

## Privacy rules

| Field | Visible to |
|---|---|
| offer `ask_price` | everyone |
| offer `min_price` | its owner only, as `your_min_price` |
| request `max_price` | its owner only, as `your_max_price` |
| agreed deal `price` and `total` | both parties |
| counterpart display name, place, pickup, time, and the task for a service | both parties of a deal |
| negotiation failure | nobody gets numbers ("can't meet your budget") |

All output goes through [views.ts](../src/market/views.ts); the tests fail on any leak.

## Tools

### `post_offer`
`title`*, `ask_price`*, `kind` (`item|service`, default `item`), `price_unit` (services: `job|hour`, default `job`), `min_price` (default `ask_price`), `description`, `category`, `auto_accept` (default true for items, false for services), `condition` (items: `new|like_new|good|fair|for_parts`, default `good`), `quantity` (items), `location`, `availability`
→ `{ offer, deal | null, waiting_requests, say }`. `deal` is opened when someone was already waiting; `waiting_requests` counts the requests this offer satisfies.

### `post_request`
`need` and/or `raw_request`*, `max_price` (required unless stated in `raw_request`; per hour for hourly work), `kind`, `price_unit`, `hours`, `pickup`, `location`, `schedule`, `needed_by` (ISO 8601, in the future: an item's deadline or a job's start), `min_condition` (items), `quantity` (items), `source` (`voice|bee_context`)
→ `{ request, deal | null, alternatives: [offer + within_budget_at_ask + score] (up to 4), say }`. Structured args win; `raw_request` is parsed to fill the gaps, including kind, unit, hours, pickup, place and time ("find someone to pick up my lunch from LG7 canteen to Hall 5 by 12:30, $5").

### `find_matches`
`request_id`*, `limit` (1–10, default 3)
→ `{ request_id, matches, say }`. The offer currently proposed to the request is not repeated.

### `negotiate`
`request_id`*, `offer_id`*
→ `{ deal | null, say }`. Replaces the request's current deal. `deal: null` when no price fits both limits.

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
`deal_id`, `offer_id`, `request_id`, `kind`, `title` (the offer), `task` (services: what was asked for), `condition` (items), `your_role` (`buyer|seller`), `counterpart`, `price`, `price_unit` (`each|job|hour`), `hours`, `total`, `ask_price`, `saved_vs_ask`, `currency`, `status` (`proposed|confirmed|declined|replaced|expired|withdrawn`), `buyer_confirmed`, `seller_confirmed`, `waiting_for` (`["buyer"|"seller"]`), `waiting_for_you`, `meetup: { place, availability }` (for a service: where the job is and when), `pickup` (errands), `needed_by` (services), `on_hold_until` (while proposed), `created_at`, `updated_at`.

## MCP Apps view

Every tool except `withdraw_post` declares `_meta.ui.resourceUri = "ui://amazonpairup/market.html"`
in its definition (MCP Apps spec) and repeats it in each result's `_meta` (Alexa+
client lifecycle). `resources/read` returns one self-contained HTML document
(`text/html;profile=mcp-app`) that picks its layout from the result:

| Result | Layout |
|---|---|
| `deal` / `next_deal`, or a new `offer` / `request` | Deal card: price (per job or per hour, with the total), savings, counterpart, meet-up or pickup → drop-off and time, hold time; Confirm / Decline (Take the job / Pass for a provider) while it waits for the user; alternatives as a carousel |
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
  → post_request            Alexa: "Found it: TI-84 Plus graphing calculator for $17, $3 below asking.
                                    Meet-up: HKUST campus. Should I confirm it?"
buyer:  "Yes."  → confirm_deal   Alexa: "Done! … Meet-up: HKUST campus, weekdays after 5pm."
seller: "Did anyone buy my calculator?" → get_deal_status
```

```
runner: "I can do lunch runs around campus for $4 a run, at least $3."
  → post_offer (service)    Alexa: "You're on the market: Lunch runs around campus, $4 a job. …"
hungry: "Find someone to pick up my lunch from LG7 canteen to Hall 5 by 12:30, $5."
  → post_request            Alexa: "Found someone: Ken can do it for $3.50, $0.50 below their rate.
                                    From LG7 canteen to Hall 5, by 12:30. Should I confirm? Ken gives the final yes."
hungry: "Yes."  → confirm_deal   Alexa: "Confirmed on your side. I'll let you know when Ken says yes."
runner: "Any jobs for me?" → get_deal_status   "One deal is waiting for your yes. Pick up my lunch for Mei, $3.50 …"
runner: "Yes."  → confirm_deal   Alexa: "Booked! Lunch runs around campus with Mei, $3.50. From LG7 canteen to Hall 5, by 12:30."
```

Hourly work reads the same way: "Get me a helper for the event on Saturday
2-6pm, budget $10/hr" pairs with a helper asking $11 with a $9 minimum at
$9.50 an hour, $38 for 4 hours.

When the requester posts first, the order flips: the request waits, and the
offer's `post_offer` opens the deal ("A buyer was already looking for one…", or
"New job from Mei: … Want it?"). The requester hears about it through
`get_deal_status`.
