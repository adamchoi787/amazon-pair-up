# Tool contract

Endpoint: `POST /mcp`, Streamable HTTP, stateless, MCP protocol `2025-11-25`.
Identity and auth depend on `AUTH_MODE`:
- `oauth` (Alexa+): every call carries the linked account's `Authorization: Bearer <token>`. The user is taken **only** from the token, and `user_id` arguments are ignored. No token or a bad token returns 401 with `WWW-Authenticate: Bearer resource_metadata=...`.
- `none` (local dev and tests): `X-User-Id` header or a `user_id` argument. `MCP_API_KEY` adds an optional shared Bearer secret.

Every successful result is JSON (as text **and** `structuredContent`) with a `say` field: one sentence Alexa can speak as is.
Every tool declares an `outputSchema` ([src/mcp/schemas.ts](../src/mcp/schemas.ts)) and annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`).
Errors come back as `isError: true` with `{ "say": "..." }`: a sentence the user can act on, or a short apology when something unexpected failed (details go to the server log).
Inputs are bounded (text lengths, prices up to 100,000, quantities up to 1,000).

## How pairing works

Listings and buy requests are both standing posts. Whenever either side posts,
the server pairs it with the best counterpart a deal is possible with,
negotiates a price inside both private limits, and opens a **proposed** deal in
the same call. A post with no counterpart waits and is paired when one arrives.

- **Relevance gate:** two posts count as a match only when their relevance
  (semantic + keyword, 0..1) reaches `MATCH_THRESHOLD`. Price fit and meet-up
  area then rank the relevant ones. Ties go to the earlier post.
- **One hold at a time:** a listing (`pending`) and a request (`matched`) are each
  held by at most one proposed deal. Both are claimed in one SQL statement, so
  concurrent posts can never double-book an item.
- **Price:** the midpoint of the overlap between the seller's minimum and the
  lower of the asking price and the buyer's budget, rounded to $0.50 when that
  midpoint is below $10 and to $1 from $10 up, in integer cents. Settlement runs
  in pairing-core, a Rust library compiled to WebAssembly
  ([negotiation.ts](../src/market/negotiation.ts), `vendor/pairing-core`); raising
  any limit never lowers the price.
- **No:** `decline_deal` releases both posts and re-pairs each with its next best
  counterpart. A declined pair is never proposed again.
- **Switching:** `negotiate` on another listing replaces the request's offer
  (old deal `replaced`); the released item is offered to other waiting buyers.
- **Holds expire:** an offer nobody answers within `DEAL_HOLD_HOURS` (default 24)
  expires; both posts go back on the market and are paired again. An expired
  pair, like a declined one, is not proposed again. Every deal shows `on_hold_until`.
- **Deadlines:** a request whose `needed_by` has passed stops pairing.
- **Withdrawing:** a listing taken down or a request cancelled releases the deal it
  held, and the other person is paired again.
- **Limits:** `POSTS_PER_HOUR` per user (default 30), `MAX_OPEN_REQUESTS` (default
  10), and `MCP_CALLS_PER_MINUTE` per caller (default 120, HTTP 429 beyond it).
  The posting limits also stop a buyer from narrowing a seller's minimum by
  trying many budgets.
- **Closing:** a deal is `confirmed` once both sides have said yes (`auto_accept`
  pre-confirms the seller). The listing becomes `sold`, the request `fulfilled`.

## Privacy rules

| Field | Visible to |
|---|---|
| listing `ask_price` | everyone |
| listing `min_price` | seller only, as `your_min_price` |
| request `max_price` | buyer only, as `your_max_price` |
| agreed deal `price` | both parties |
| counterpart display name, meet-up place and availability | both parties of a deal |
| negotiation failure | nobody gets numbers ("can't meet your budget") |

All output goes through [views.ts](../src/market/views.ts); the tests fail on any leak.

## Tools

### `create_listing`
`title`*, `ask_price`*, `min_price` (default `ask_price`), `description`, `category`, `condition` (`new|like_new|good|fair|for_parts`, default `good`), `quantity`, `auto_accept` (default true), `location`, `availability`
→ `{ listing, deal | null, waiting_buyers, say }`. `deal` is opened when a buyer was already waiting; `waiting_buyers` counts the requests this item satisfies.

### `create_buy_intent`
`need` and/or `raw_request`*, `max_price` (required unless stated in `raw_request`), `min_condition`, `quantity`, `needed_by` (ISO 8601, must be in the future), `location`, `source` (`voice|bee_context`)
→ `{ intent, deal | null, alternatives: [listing + within_budget_at_ask + score] (up to 4), say }`. Structured args win; `raw_request` is parsed to fill the gaps.

### `find_matches`
`intent_id`*, `limit` (1–10, default 3)
→ `{ intent_id, matches, say }`. The item currently offered to the request is not repeated.

### `negotiate`
`intent_id`*, `listing_id`*
→ `{ deal | null, say }`. Replaces the request's current offer. `deal: null` when no price fits both limits.

### `confirm_deal`
`deal_id`*. Call **only after the user explicitly says yes.**
→ `{ deal, say }`.

### `decline_deal`
`deal_id`*
→ `{ deal_id, status: "declined", next_deal | null, say }`. `next_deal` is the user's next best offer.

### `get_deal_status`
`deal_id` (optional)
→ `{ deals, waiting_for_you, say }`. Deals waiting for the user's yes come first.

### `list_my_posts`
→ `{ listings, requests, say }`. The user's own posts, newest first (up to 20 each), with their status.

### `withdraw_post`
`post_id`* (a `lst_…` listing or `int_…` request id)
→ `{ post_id, kind: "listing"|"request", status: "withdrawn"|"cancelled", released_deal_id | null, say }`.

### Deal object
`deal_id`, `listing_id`, `title`, `condition`, `your_role` (`buyer|seller`), `counterpart`, `price`, `ask_price`, `saved_vs_ask`, `currency`, `status` (`proposed|confirmed|declined|replaced|expired|withdrawn`), `buyer_confirmed`, `seller_confirmed`, `waiting_for` (`["buyer"|"seller"]`), `waiting_for_you`, `meetup: { place, availability }`, `on_hold_until` (while proposed), `created_at`, `updated_at`.

## MCP Apps view

Every tool except `withdraw_post` declares `_meta.ui.resourceUri = "ui://amazonpairup/market.html"`
in its definition (MCP Apps spec) and repeats it in each result's `_meta` (Alexa+
client lifecycle). `resources/read` returns one self-contained HTML document
(`text/html;profile=mcp-app`) that picks its layout from the result:

| Result | Layout |
|---|---|
| `deal` / `next_deal`, or a new `listing` / `intent` | Deal card: price, savings, counterpart, meet-up, hold time; Confirm / Decline while it waits for the user; alternatives as a carousel |
| `matches` | Options carousel with "Get this one" (`negotiate`) |
| `deals` | The user's deals, those waiting for their yes first |
| `listings` / `requests` | The user's posts with "Take down" (`withdraw_post`) |

Inline lists show at most five items. Buttons call tools through the host.

## Web app endpoints

| Endpoint | Purpose |
|---|---|
| `GET /app/` | The web app (an MCP host); `/` redirects here |
| `GET /api/app-config` | How to sign in: `{ auth: "none" }` or the OAuth public client (`amazonpairup-web`, PKCE, redirect `<PUBLIC_BASE_URL>/app/`) |
| `GET /api/me` | The signed-in user's id and display name |
| `POST /api/agent` | One assistant step. Body `{ messages }` in the Bedrock Converse shape; returns `{ message, stop, mode }` (`stop` is `tool_use` or `end_turn`). The app runs requested tools over `/mcp` itself and sends the results back. A `confirm_deal` call is only returned after the user's explicit yes. |

Same identity, Origin and rate-limit rules as `/mcp`; same-origin browser calls are allowed.

## Conversation flow

```
seller: "Sell my TI-84 for $20, I'll take anything above $15."
  → create_listing            Alexa: "Listed … I'll pair you with a buyer as soon as one asks."
buyer:  "I need a graphing calculator today, max $18."
  → create_buy_intent         Alexa: "Found it: TI-84 Plus graphing calculator for $17, $3 below asking.
                                      Meet-up: HKUST campus. Should I confirm it?"
buyer:  "Yes."  → confirm_deal   Alexa: "Done! … Meet-up: HKUST campus, weekdays after 5pm."
seller: "Did anyone buy my calculator?" → get_deal_status
```

When the buyer posts first, the order flips: the request waits, and the
seller's `create_listing` opens the deal ("A buyer was already looking for one…").
The buyer hears about it through `get_deal_status`.
