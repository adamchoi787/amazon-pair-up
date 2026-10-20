# Tool contract

Endpoint: `POST /mcp`, Streamable HTTP, stateless, MCP protocol `2025-11-25`.
Identity and auth depend on `AUTH_MODE`:
- `oauth` (Alexa+ and any MCP client): every call carries the linked account's `Authorization: Bearer <token>`. The user is taken **only** from the token, and `user_id` arguments are ignored. No token or a bad token returns 401 with `WWW-Authenticate: Bearer resource_metadata=...`. See [Connecting a client](#connecting-a-client).
- `none` (local dev and tests): `X-User-Id` header or a `user_id` argument. `MCP_API_KEY` adds an optional shared Bearer secret.

Every successful result is JSON (as text **and** `structuredContent`) with a `say` field: one sentence Alexa can speak as is.
Every tool declares an `outputSchema` ([src/mcp/schemas.ts](../src/mcp/schemas.ts)) and annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`).
Errors come back as `isError: true` with `{ "say": "..." }`: a sentence the user can act on, or a short apology when something unexpected failed (details go to the server log). An error an agent can act on also carries a `code`: `confirm_price` (see [Price check](#price-check)), `idempotency_conflict` or `in_progress` (see [Retries](#retries-idempotency_key)), `prohibited_item` or `restricted_item` (see [What can be posted](#what-can-be-posted)), `account_under_review` or `account_suspended` (see [Reports and review](#reports-and-review)), `not_confirmed` or `already_rated` (see [`rate_deal`](#rate_deal)).
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
- **Hard constraints:** same kind, currency and price unit, enough quantity and the wanted
  condition (items), a price both limits allow, the request's deadline still ahead,
  the pair not declined or left to expire before, both people in good standing,
  and neither having reported the other. Service availability and known overlapping
  timed bookings are checked as described in [Service scheduling](#service-scheduling).
- **One hold at a time:** an offer (`pending`) and a request (`matched`) are each
  held by at most one proposed deal. Transactions and row locks protect the
  reservation, including overlapping timed jobs across one provider's offers.
  Work without a known duration is scheduled by the provider when they approve it.
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
  ([negotiation.ts](../src/market/negotiation.ts), [pairing-core](https://github.com/rairurairu/pairing-core)), in
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
`decline_deal`, `withdraw_post`, `report_user`, `rate_deal`) takes an optional `idempotency_key` (8–64
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
| `/skills/pairup/SKILL.md` | The Agent Skill ([skills/pairup/SKILL.md](../skills/pairup/SKILL.md)) |
| `/.well-known/oauth-protected-resource` | OAuth 2.1 protected resource metadata (RFC 9728), with `AUTH_MODE=oauth` |
| `/.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414), with `AUTH_MODE=oauth` |
| `/health`, `/ready` | Liveness, and readiness including the database |

Every response carries `X-Request-Id` (the caller's own, when it sends a valid
one), and every log line for that request has the same id.

## Connecting a client

Any MCP client that follows the MCP 2025-11-25 authorization spec connects to
the hosted `/mcp` on its own. The first call gets a 401 pointing at the
protected resource metadata; from there:

| Step | Endpoint | Rules |
|---|---|---|
| Identify the client | Client ID Metadata Document (preferred) | `client_id` is an https URL with a path that serves the client's metadata as JSON. The server fetches it (5 s timeout, 5 KB cap, public addresses only, cached per `Cache-Control`), checks that its `client_id` equals the URL, and allows only its `redirect_uris`. Public clients only (`token_endpoint_auth_method: none`). Advertised as `client_id_metadata_document_supported: true`. |
| | `POST /oauth/register` (RFC 7591, fallback) | JSON with `redirect_uris` (1 to 10, https or `http://127.0.0.1` / `[::1]` / `localhost`) and optional `client_name`. Every client is registered as public (`token_endpoint_auth_method: none`, PKCE). Limited to `DCR_PER_HOUR` per address. |
| Authorize | `GET /oauth/authorize` | `response_type=code`, PKCE `S256`, `scope=marketplace`, optional `resource=<base>/mcp`. Redirect URIs match exactly; a loopback redirect may use any port. A third-party client gets a consent screen naming it, its publisher (the client_id's host) or "not verified" for a self-registered name, and where the user goes back to. The redirect carries `code`, `state` and `iss`. |
| Sign in | Login with Amazon | The user signs in with their Amazon account; the user id is its `user_id`. Local development and the labelled judge demo (`DEMO_MODE=true`) also offer a name + passcode sign-in in which the first sign-in with a name sets its passcode. |
| Tokens | `POST /oauth/token` | `authorization_code` and `refresh_token`. Access tokens last an hour; each refresh returns a new refresh token and revokes the old one. |
| Sign out | `POST /oauth/revoke` (RFC 7009) | `token` (+ optional `token_type_hint`), with the same client authentication as the token endpoint. Revoking an access token ends that token; revoking a refresh token ends every token from that sign-in. Always 200 for a token the client holds or an unknown one. |

Built-in clients: the web app (`pairup-web`, public, redirect
`<PUBLIC_BASE_URL>/app/`) and Alexa+ account linking (confidential, from
`OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` / `OAUTH_REDIRECT_URIS`).

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

## What can be posted

Every offer and request, item or service, is checked against the marketplace
policy ([data/policy.json](../data/policy.json), [policy.ts](../src/market/policy.ts))
before anything is stored, modelled on Amazon's restricted-products policy for
a person-to-person market:

| Category | Severity | Code |
|---|---|---|
| Weapons, ammunition and explosives | prohibited | `prohibited_item` |
| Illegal drugs and drug paraphernalia | prohibited | `prohibited_item` |
| Prescription medicines | restricted | `restricted_item` |
| Alcohol | restricted | `restricted_item` |
| Tobacco and vaping products | restricted | `restricted_item` |
| Recalled products | prohibited | `prohibited_item` |
| Counterfeit, pirated and fake goods | prohibited | `prohibited_item` |
| Fake documents, IDs and accounts | prohibited | `prohibited_item` |
| Cheating services (essays, exams) | prohibited | `prohibited_item` |
| Adult and sexual services | prohibited | `prohibited_item` |
| Live animals and wildlife products | restricted | `restricted_item` |
| Illegal and harmful services | prohibited | `prohibited_item` |

Restricted means selling it needs a license, an age check, a prescription or a
breeder, which people trading directly can't provide, so it isn't allowed here
either. The check is deterministic:

1. **Keywords:** whole-word rules per category, after removing that category's
   allowed phrases (a glue gun, cat sitting, wine glasses, kitten heels). The
   text is also checked with common character swaps undone (`w33d`, `c.o.c.a.i.n.e`).
2. **Meaning:** the post's embedding against example phrases per category; a
   cosine similarity of at least `POLICY_MEANING_MATCH` (default 0.8) counts.

A refused post returns `isError: true` with `say` ("I can't post that.
PairUp doesn't allow alcohol, since selling it needs an age check and a
license."), `code`, `category`, `label`, `severity` and `matched_by`
(`keyword|meaning`). A request is checked before its budget is asked for. Speak
`say`; never reword the post to get around the rule. Refused posts count toward
`POSTS_PER_HOUR` and appear on the dashboard's review queue.

## Reports and review

`report_user` reports the other side of a deal, or the owner of a post the user
was shown ([trust.ts](../src/market/trust.ts)):

- The reporter and the reported person are never paired again, either way, and
  any deal still proposed between them is cancelled (both sides are re-paired
  with others).
- One open report per reporter and reported person. Reports from accounts under
  review or suspended don't count.
- When `REPORT_THRESHOLD` (default 3) different people have open reports about
  someone, they go **under review**: their proposed deals are released and the
  other side re-paired, their posts stop pairing and showing as options, and
  `post_offer`, `post_request` and `negotiate` return `account_under_review`.
- A reviewer decides on the dashboard (`POST /api/review` with
  `{ user_id, decision: "reinstate" | "suspend" }`, same access as
  `/api/dashboard`). Reinstating dismisses the open reports and pairs their posts
  again; suspending upholds the reports and keeps them off the market
  (`account_suspended`).
- A reporter never learns who else reported the person, how many did, or
  whether they are under review.

Ratings (`rate_deal`) are private to the market: the other person never sees
them. They feed each person's track record (see below).
## Hand-offs to Amazon

The local market covers what Amazon retail doesn't (a used item under $20, an
errand, an hour of help). When it can't help, the result points to Amazon, and
the post keeps waiting on the market either way. All three rules are
deterministic ([amazon.ts](../src/market/amazon.ts)).

| When | Result field | What it carries |
|---|---|---|
| `post_request` for an item ends without a deal | `fallback` | `reason` (`no_seller`, or `over_budget` when offers exist but none fits the budget), `new_price` (curated demo estimate for a new item on Amazon.com, from `new_price` in `data/reference-prices.json`; `null` when no reference matches), `currency: "USD"`, `amazon_url` (`https://www.amazon.com/s?k=<need>`), `still_waiting: true`, `say` ("Nobody nearby has one yet. New on Amazon it's about $110.") |
| `post_offer` for an item nobody is asking for, in a Trade-In category | `trade_in` | `category` (`electronics` or `game_consoles`, matched by whole words of the category and title; list in `data/trade-in-categories.json`), `url: "https://www.amazon.com/tradein"`, `say` |
| a deal for an item where both sides are in the same area | `deal.meetup.hub_point` | That area's Amazon Hub Locker or Counter (`name`, `type` (`locker` or `counter`), `area`, `demo`); `meetup.place` names it as the suggested hand-off place |

A side's area is the post's `location`, else the person's home area. Services
get none of these: an errand happens where the requester needs it. When
`new_price` is known and nothing at all is nearby, `say` ends with "If you
can't wait, it's about $110 new on Amazon." The Hub points in
`data/seed-listings.json` (`areas`) are made-up demo data and come back with
`demo: true`; replace them with verified meeting points before using real locations.

## PairUp Points (Ring)

A PairUp Point is a small unstaffed hand-off spot watched by one Ring doorbell
or camera ([points.ts](../src/market/points.ts), points in
`data/pairup-points.json`, demo locations returned with `demo: true`).

| Tool | Does |
|---|---|
| `list_meetup_points` (read) | `{ area? }` → `points[]`: `point_id`, `name`, `area`, `hours`, `ring_device` (a Ring device confirms arrivals), `demo` |
| `choose_meetup_point` (write, MCP Apps view) | `{ deal_id?, point_id? }` on a proposed or confirmed deal; without `point_id`, the point in both people's area, else in either. Sets `deal.meetup.place` and starts the arrivals over. Error codes `no_open_deal`, `unknown_point`, `no_point_nearby` |
| `check_in_at_point` (write, MCP Apps view) | `{ deal_id? }` on a confirmed deal at a point ("I'm here"). Records the arrival, reads the point device's Ring Event History, returns `arrival` and `ring` (`device`, `checked`, `error`). Error codes `no_meetup`, `deal_not_confirmed` |

An arrival is `confirmed` when the point's Ring device recorded a presence event
within ten minutes of the check-in: a doorbell press (`button_press`, history
`ding`) or a person (`motion_detected` with `sub_type` `human` or `motion`,
history `motion`). Vehicles and packages never count. With `RING_SANDBOX=true`
the Ring Playground's simulated live views (`on_demand`) count too. When both
arrivals are confirmed, `deal.meetup.point.status` is `both_here` and both
people hear it through `deals://me`.

`deal.meetup.point`: `point_id`, `name`, `area`, `demo`, `status`
(`chosen` | `one_here` | `both_here`), `you` and `them` (`not_here` |
`checked_in` | `confirmed`), `both_here_at`.

PairUp reaches Ring from the server in two ways: `GET /v1/devices` and
`GET /v1/history/devices/{id}/events` on `https://api.amazonvision.com` with
`RING_ACCESS_TOKEN` (a Playground token lasts 30 minutes), and Ring webhooks at
`POST /api/ring/webhook` (on when `RING_HMAC_KEY` is set; `X-Signature:
sha256=<HMAC-SHA256 of the raw body>` is checked before the body is used).
`RING_POINT_DEVICES=pt_uw_hub=<device id>` links points to devices;
`npm run ring:probe` lists them. PairUp stores only the event id, type and time
of presence events from point devices, for 24 hours, and check-ins for 30 days.
It requests no video, snapshots or audio.

## Learning to pair better

Every deal the engine proposes records its features
([learning.ts](../src/market/learning.ts)): relevance, price fit, discount,
budget headroom (internal only), same area, condition margin, a pre-approved
seller, urgency, availability given, delivery offered, price against the typical
range, both sides' track records, and item or service. A track record is
`(closed + 1) / (outcomes + 2)` over the person's past deals in that role,
where each rating they received also counts as an outcome worth
`(stars - 1) / 4`: five stars is another closed deal, one star a failed one. Confirmed is a success;
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
| a report, and the stars a user gave | its author only; reviewers see reports on the dashboard |
| who reported someone, how many did, review status | reviewers only |

All output goes through [views.ts](../src/market/views.ts); the tests fail on any leak.

## Tools

### `post_offer`
`title`*, `ask_price`*, `kind` (`item|service`, default `item`), `price_unit` (services: `job|hour`, default `job`), `min_price` (default `ask_price`), `description`, `category`, `auto_accept` (default true for items, false for services), `condition` (items: `new|like_new|good|fair|for_parts`, default `good`), `quantity` (items), `location`, `availability`, `confirm_price` (only after a `confirm_price` error)
→ `{ offer, deal | null, waiting_requests, trade_in | null, say }`. The offer carries `typical_price: { low, high, source } | null`. `deal` is opened when someone was already waiting; `waiting_requests` counts the requests this offer satisfies. `trade_in`: see [Hand-offs to Amazon](#hand-offs-to-amazon).

### `post_request`
`need` and/or `raw_request`*, `max_price` (required unless stated in `raw_request`; per hour for hourly work), `kind`, `price_unit`, `hours`, `pickup`, `location`, `schedule`, `needed_by` (ISO 8601, in the future: an item's deadline or a job's start), `min_condition` (items), `quantity` (items), `source` (`voice|bee_context|device_context|routine`), `confirm_price` (only after a `confirm_price` error)
→ `{ request, deal | null, alternatives: [offer + within_budget_at_ask + score] (up to 4), fallback | null, say }`. With no deal, `alternatives` and `say` also name the closest offers the budget can't reach, at their asking price, and an item request gets a `fallback` (see [Hand-offs to Amazon](#hand-offs-to-amazon)). The marketplace policy is checked before posting. Structured args win; `raw_request` is parsed to fill the gaps, including kind, unit, hours, pickup, place and time ("find someone to pick up my lunch from the HUB to McCarty Hall by 12:30, $5").

### `find_matches`
`request_id`*, `limit` (1–10, default 3)
→ `{ request_id, matches, say }`. The offer currently proposed to the request is not repeated.

### `negotiate`
`request_id`*, `offer_id`*, `max_price` (raises the request's budget first; only upward)
→ `{ deal | null, say }`. Settles that offer by the same rule and replaces the request's current deal. `deal: null` when no price fits both limits; `say` then names the public asking price ("The seller can't go that low. It's $20. Want it at that price?"), and on a yes the agent calls again with `max_price` set to it.

### `confirm_deal`
`deal_id`*. Call **only after the user explicitly says yes.**
→ `{ deal, say }`.

### `choose_handoff`
`deal_id`*, `method`* (`meetup` | `delivery`). Buyer only, item deals while proposed.
→ `{ deal, say }`. `delivery`: the seller drops the item at an Amazon Hub Counter in their area and the buyer collects it from a Hub Locker in theirs; no address is shared. The price stays as settled, `deal.total` adds the delivery fee, and the seller is asked to confirm again. Every item deal carries `handoff` and `delivery` (the quote, or null when either area has no Hub point); confirmed delivery deals get `delivery.reference`. `post_request` also takes `handoff`, and an item request that says "shipped" or "delivered" asks for delivery. Demo rates and locations; see [DELIVERY.md](DELIVERY.md).

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

### `report_user`
`reason`* (`prohibited_item|scam|no_show|not_as_described|unsafe|harassment|other`), `deal_id` (the deal with the person) or `post_id` (an offer the user was shown), `details` (up to 500 characters, read by reviewers only). Confirm with the user first.
→ `{ report: { report_id, reason, deal_id, post_id, status: "received"|"already_reported", released_deal_id | null }, say }`. See [Reports and review](#reports-and-review). For `unsafe`, `say` starts with "If you're in danger right now, call emergency services."

### `rate_deal`
`deal_id`*, `stars`* (integer 1–5). Only for a `confirmed` deal, once per side.
→ `{ rating: { deal_id, stars, rated_role: "buyer"|"seller" }, say }`. Errors: `not_confirmed` before both sides said yes, `already_rated` on a second rating. A rating of 1 or 2 ends `say` with an offer to report.

### Deal object
`deal_id`, `offer_id`, `request_id`, `kind`, `title` (the offer), `task` (services: what was asked for), `condition` (items), `your_role` (`buyer|seller`), `counterpart`, `price`, `price_unit` (`each|job|hour`), `hours`, `total`, `ask_price`, `saved_vs_ask`, `price_check` (`{ verdict: typical|below_typical|above_typical|far_below|far_above, typical_low, typical_high, source } | null`), `currency`, `status` (`proposed|confirmed|declined|replaced|expired|withdrawn`), `buyer_confirmed`, `seller_confirmed`, `waiting_for` (`["buyer"|"seller"]`), `waiting_for_you`, `meetup: { place, availability, hub_point | null }` (for a service: where the job is and when; for an item in one area: the Amazon Hub point), `pickup` (errands), `needed_by` (services), `on_hold_until` (while proposed), `created_at`, `updated_at`.

## MCP Apps view

Every tool except `withdraw_post`, `report_user` and `rate_deal` declares `_meta.ui.resourceUri = "ui://pairup/market.html"`
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
| `GET /api/app-config` | How to sign in: `{ auth: "none" }` or the OAuth public client (`pairup-web`, PKCE, redirect `<PUBLIC_BASE_URL>/app/`) |
| `GET /api/me` | The signed-in user's id and display name |
| `POST /api/agent` | One assistant step. Body `{ messages }` in the Bedrock Converse shape; returns `{ message, stop, mode }` (`stop` is `tool_use` or `end_turn`). The app runs requested tools over `/mcp` itself and sends the results back. A `confirm_deal` call is only returned after the user's explicit yes. |

Same identity, Origin and rate-limit rules as `/mcp`; same-origin browser calls are allowed.

Operations, open locally (`AUTH_MODE=none`) and otherwise only with `Authorization: Bearer <DASHBOARD_TOKEN>`:

| Endpoint | Purpose |
|---|---|
| `GET /api/dashboard` | Posts, deals, events, learning, and `review_queue`: people under review first, then anyone with open reports or refused posts, with reasons and average rating. No private limits. |
| `POST /api/review` | `{ user_id, decision: "reinstate" \| "suspend" }` → `{ user_id, review_status }` |

## Conversation flows

```
seller: "Sell my TI-84 for $20, I'll take anything above $15."
  → post_offer              Alexa: "Listed … I'll pair you with a buyer as soon as one asks."
buyer:  "I need a graphing calculator today, max $18."
  → post_request            Alexa: "Found it: TI-84 Plus graphing calculator for $18, $2 below asking.
                                    Meet-up: UW campus. Should I confirm it?"
buyer:  "Yes."  → confirm_deal   Alexa: "Done! … Meet-up: UW campus, weekdays after 5pm."
seller: "Did anyone buy my calculator?" → get_deal_status
```

```
runner: "I can do lunch runs around campus for $4 a run, at least $3."
  → post_offer (service)    Alexa: "You're on the market: Lunch runs around campus, $4 a job. …"
hungry: "Find someone to pick up my lunch from the HUB to McCarty Hall by 12:30, $5."
  → post_request            Alexa: "Found someone: Ken can do it for $4.
                                    From the HUB to McCarty Hall, by 12:30. Should I confirm? Ken gives the final yes."
hungry: "Yes."  → confirm_deal   Alexa: "Confirmed on your side. I'll let you know when Ken says yes."
runner: "Any jobs for me?" → get_deal_status   "One deal is waiting for your yes. Pick up my lunch for Mei, $4 …"
runner: "Yes."  → confirm_deal   Alexa: "Booked! Lunch runs around campus with Mei, $4. From the HUB to McCarty Hall, by 12:30."
```

Hourly work reads the same way: "Get me a helper for the event on Saturday
2-6pm, budget $10/hr" pairs with a helper asking $11 with a $9 minimum: the
$10 budget is the offer, so $10 an hour, $40 for 4 hours.

When the requester posts first, the order flips: the request waits, and the
offer's `post_offer` opens the deal ("A buyer was already looking for one…", or
"New job from Mei: … Want it?"). The requester hears about it through
`get_deal_status`.

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

delete_my_data asks for confirmation; pass confirm: true only after the user's
explicit yes. It withdraws live posts, releases holds, erases the account, tokens,
history and learning rows, and anonymizes past deals needed by the counterpart.

## Lifestyle suggestions and devices

| Tool | Use and result |
|---|---|
| get_suggestions | On sign-in, on arrival, or when asked what the user needs. Returns private suggestions from their own history or context. |
| accept_suggestion | After explicit yes; pass suggestion_id and max_price if a budget is missing. Returns a posted request and any proposed deal. |
| dismiss_suggestion | Not now skips this occurrence. forget: true stops the routine; device snippets are removed on dismissal. |
| add_context | source bee/watch/phone, kind todo/conversation/journal/fact/location/note, need text or place, optional stable external_id, observed_at and time_zone. Returns a suggestion when relevant. |
| get_my_routines | Explain the learned need, usual budget, time, route and contributing devices. |

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
See [BEE.md](BEE.md) and [APPLE_WATCH.md](APPLE_WATCH.md).

Retail reference amounts are hand-set demo estimates and are labelled in spoken results and cards. Amazon search links let the user check current prices. Trade-In links ask the user to check eligibility for their model and country.

## Service scheduling

Version 0.7.0 adds `time_zone` to offers and requests (IANA name, default
`America/Los_Angeles`) and optional `starts_at` / `ends_at` to `post_request`.
Exact timestamps require a UTC offset. An end requires a start, must follow it,
and must agree with `hours` when supplied. Request output includes the new fields.
Availability is decided by code from the stated hours.

The supported availability grammar is weekday names and ranges (`Mon-Fri`),
`weekdays`, `weekends`, `daily` / `any day`, clock ranges (`9am-5pm`, `09:00-17:00`),
overnight ranges and semicolon-separated shifts. A full job interval must be
covered without a gap. Requests can use an explicit date, today/tomorrow or a
weekday and a clock range. Bare clocks without am/pm, unsupported qualifiers and
missing duration give a tentative match. Ambiguous or nonexistent DST local
times require an explicit ISO offset.

A service deal adds `scheduling` with `status`, resolved `starts_at` / `ends_at`,
the provider's `time_zone` and original `provider_availability`. `verified`
means the full interval fits the stated availability. `needs_confirmation`
means the provider must explicitly approve it, even on an auto-accept offer.
A `by` deadline alone cannot prove the errand's duration. `conflict` prevents a
new proposal; a direct alternative selection returns `schedule_conflict`.

Availability filters run before candidate limits in both directions. Explicit
alternative selection must pass the same non-price eligibility constraints.
Existing proposed/confirmed timed jobs exclude overlapping work across all
of the provider's service offers. A transaction locks the provider before
checking reservations, so concurrent requests cannot reserve overlapping timed
jobs. Back-to-back intervals are allowed. Work without a known duration is
scheduled by the provider when they approve it.

Both sides' confirmations and the related post-state updates commit together.
Resource notifications are emitted after commit. A conditional yes ("yes if…")
is treated as a new constraint. `confirmed` and the request state `fulfilled`
mean **both people agreed**; payment and hand-off happen between them. The
dashboard's `completion_rate` measures mutual confirmation among resolved
proposals, and `learning.outcome` names that label.

`/health` now includes `product`, `revision` (from `RELEASE_REVISION`, null locally)
and `ui_fingerprint`. The committed `/build-info.json` contains a deterministic
fingerprint of the browser surfaces. `npm run check:release` reads these plus
readiness and the app shell, and returns a failing exit code for stale assets,
version or an explicitly expected revision. It is read-only: no sign-in and no
market writes.
## 0.8.0 interoperability notes

The HTTP transport enforces one JSON-RPC message per POST; legacy arrays receive
400/-32600. Session loss returns 404 and the browser reinitializes once while
preserving the original idempotency key. Fully parsed requests (`need`, `kind`,
`max_price`) use local extraction for remaining hints and skip a second model
extraction call. Explicit structured fields keep precedence.

Ring arrival evidence is HMAC-verified and deduplicated by event id and
`meta.request_id`. PairUp's local policy ignores webhook event timestamps older
than 30 minutes or more than one minute in the future; arrivals correlate to
presence within ten minutes. This corroborates a user's check-in. It performs
no identity verification. The client follows same-origin pagination, reports
long rate-limit waits and retries one short 429/5xx after its backoff.

`POST /api/agent` additionally returns `inference: bedrock | offline | tool_result`.
`mode` describes configuration; `inference` identifies the path actually used
for that response. The evidence collector requires `inference: bedrock`.
