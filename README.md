# PairUp — a voice-first C2C marketplace for Alexa+

> People who have something, people who can do something, and people who need
> either just say so. Alexa+ pairs each buyer with a seller, settles the price
> by a fixed rule inside limits each side set privately, and asks both for a
> final "yes".

**Track:** Alexa+ (self-hosted MCP server, spec 2025-11-25, Streamable HTTP)
**Mini challenges:** Open Source ([pairing-core](https://github.com/rairurairu/pairing-core)), AWS Builder (Amazon Bedrock, a Strands Agents agent on Bedrock AgentCore Runtime, CloudFront + EC2 + CloudWatch)
**Bee:** need snippets become suggestions; the included replay uses labelled demo data.
**Try it:** https://d3cxpkmhl89rw9.cloudfront.net/app/ · MCP endpoint `https://d3cxpkmhl89rw9.cloudfront.net/mcp` (OAuth 2.1)

**Launch market:** the University of Washington campus in Seattle (U District,
Capitol Hill, Fremont, Ballard, Northgate), US dollars, Pacific time.

**Release 0.7.0:** every helper is checked against the requested work window,
bookings never overlap, and each post carries its own time zone. The web app
plays the Alexa+ conversation in any browser. `npm run check:release` confirms
that the hosted endpoint runs this exact commit. [Validation](docs/VALIDATION.md)
lists every check; [the campus pilot plan](docs/USER_VALIDATION.md) is the next step.

## The idea in one minute

Getting something from another person today means photos, forms, haggling in
chat and arranging a meet-up. Getting a small job done means a platform that
adds its own fees on top. That effort and cost decide what happens: a spare
calculator rarely finds the neighbor who needs it, and nobody pays a delivery
app to carry a $5 lunch two buildings over.

PairUp pairs buyers and sellers directly and does the work in between,
for things and for services. Both sides post what they have, what they can do,
or what they need:

- **Things:** "Alexa, sell my TI-84 for $20. I'll take anything above $15." · "Alexa, I need a graphing calculator today, max $18." → "Found it: TI-84 Plus graphing calculator for $18, $2 below asking. Meet-up: UW campus. Should I confirm it?"
- **Errands and delivery:** "Alexa, find someone to pick up my lunch from the HUB to McCarty Hall by 12:30, $5." → a student already doing lunch runs on campus takes it for $4, and the fee goes to the person who walks.
- **One-time jobs:** "Alexa, get me a helper for the event on Saturday 2-6pm, budget $10 an hour." → "Found someone: Priya can do it for $10 an hour, $40 for 4 hours."

Neither side ever sees the other's limit. Our MCP server understands both
requests, pairs each request with the best-fitting offer of the same kind,
settles the price and records the deal; Alexa+ is the voice and the agent; each
person just says yes or no.

## How a price is set: no haggling

Agents don't bargain with each other here. Turn-by-turn haggling costs model
calls and seconds on every deal, and a model can be talked into revealing a
limit. One deterministic rule settles every deal instead, in
[pairing-core](https://github.com/rairurairu/pairing-core) (Rust compiled to WebAssembly):

- **The asking price is public.** A budget at or above it pays the ask.
- **A budget below it is the buyer's offer**, and the seller's private minimum
  decides whether it is accepted, like "best offer" with automatic acceptance.
- **The seller's minimum stays secret.** It never moves the price, so a deal
  shows only that the minimum was at most the price. A buyer who walks away
  from an offer never gets that listing cheaper later, so declining and asking
  again lower can't find the minimum.
- **One offer below the asking price per buyer and listing.** After a no, the
  asking price stands for that buyer ("The seller can't go that low. It's $20.
  Want it at that price?"), so stepping a budget up from below can't find the
  minimum either. Every other buyer still gets their own first offer.
- **The buyer's budget stays secret whenever it covers the ask.** A lower budget
  is the buyer's offer, so the seller sees it as the price.

**Price check.** A price far from what similar things go for gets a "did you
mean…?" before it is posted: a $1 iPhone, a minimum misheard as $1, a budget
heard as $180 for an $18 calculator. The typical range comes from reference
prices (curated demo estimates in this prototype), or from the market's own confirmed
trades. Those trades are counted so that staged ones barely move the range: one
vote per seller, at least three independent sellers and buyers, accounts older
than a week, a median-based range. A buyer who is offered something far below
the usual price hears a safety note. The check never sets or blocks a price;
it only asks.

## Getting better every day

Every proposed deal records what the engine saw (relevance, same area,
urgency, delivery offered, pre-approved seller, condition margin, price against
the typical range, each side's track record), and its outcome is the label.
Each night ([learning.ts](src/market/learning.ts)) a small logistic model is
trained on older outcomes and judged on the newest ones. It replaces the
current ranking only if it ranks them better. 10% of requests always keep the
hand-tuned ranking as a live control, and the model rolls back automatically
if its mutual-confirmation rate falls behind. The model only reorders candidates that
already pass every hard constraint, and prices stay with the fixed rule. The
dashboard shows daily mutual confirmation and both arms. The learning label
is mutual confirmation: both people said yes.

`npm run simulate` runs the real engine on simulated buyers who prefer nearby,
delivered and pre-approved offers; the engine is never told. Over 12 simulated
days the learned ranking closed 77% of its proposals against 59% for the
control, and it named delivery and same area as the main drivers. The simulated
buyers make this a test of the learning loop itself; the campus pilot measures real people.

## A helper must fit the time

Service requests accept natural schedules such as `Saturday 2-6pm`, or exact
`starts_at` / `ends_at` timestamps with offsets. Each post has an IANA `time_zone`
(default `America/Los_Angeles`), independent of the server's clock. The whole work
window must fit the provider's stated availability; a Sunday-only helper is not
proposed for a Monday job. Checks apply to both posting directions and direct
alternative selection. Timed reservations cannot overlap across a provider's
different offers, including when requests arrive concurrently.

The deterministic parser supports weekday names/ranges, weekdays/weekends,
explicit clock ranges, overnight windows and semicolon-separated shifts. Vague
phrases such as `evenings`, missing duration or unsupported exceptions stay
**tentative** and require the provider's explicit yes, even on an auto-accept
offer. Deadline-only errands cannot prove how long the work takes. Ambiguous DST
times require an explicit offset. See [the scheduling contract](docs/TOOL_CONTRACT.md#service-scheduling).

## Knows what you need

PairUp learns regular requests from your own history and offers them shortly before they are due. Bee to-dos, need snippets and phone arrival signals can suggest an errand or item. The For you dock above the composer shows one suggestion at a time, with Find it (Ask now when the budget is known), Not now or Forget. The Devices panel connects a watch, Bee or phone; /watch/ provides a compact voice view. See [Apple Watch](docs/APPLE_WATCH.md) and [Bee](docs/BEE.md). `npm run seed -- --lifestyle` adds three weeks of labelled demo lunch runs (the HUB → McCarty Hall, about $4, around 12:15) for `u_tony`.

Lifestyle code: src/market/lifestyle.ts and context.ts; device tokens: src/auth/devices.ts and src/http/devices.ts; voice loop: src/agent/runner.ts; browser: src/web/watch.ts and lifestyle-ui.ts; Bee bridge: scripts/bee-bridge.ts.

## Run it (2 minutes, no database or AWS needed)

```bash
npm install
npm run reset        # create tables + load seed listings
npm start            # web app on http://127.0.0.1:3000/, MCP server at /mcp, operations dashboard at /dashboard/
npm run smoke        # (second terminal) plays the TI-84 demo over real MCP
npm run check:release # read-only comparison of the running release and this checkout
npm test             # unit + end-to-end tests (in-memory Postgres + pgvector)
npm run simulate     # the learning loop on a simulated market, day by day
cd agents/agentcore && npm install && npm test   # the Strands agent against a real server
```

Local dev uses **PGlite** — real Postgres + **pgvector** embedded in Node,
stored in `.data/`. Set `DATABASE_URL` to switch to a hosted Postgres.
`AI_MODE=mock` (default) works offline; `AI_MODE=bedrock` uses Amazon Bedrock.
See [.env.example](.env.example).

## The web app

`/app/` is a complete PairUp client for phones, laptops and smart displays:
talk or type, see each offer as a card, and confirm or decline with a tap.
It works the way Alexa+ works with an MCP server:

- **It is an MCP host.** The browser runs a real MCP client: `tools/list` to
  discover tools, `tools/call` over Streamable HTTP with the signed-in user's
  token, `resources/read` for the view.
- **It renders MCP Apps.** Every result names the `ui://pairup/market.html`
  view; the app draws it in a sandboxed iframe through the MCP Apps bridge, and the
  card's Confirm / Decline / "Get this one" buttons call tools through the host.
- **The reasoning step runs on the server** (`/api/agent`): Amazon Bedrock tool use
  when `AI_MODE=bedrock` and a model is set, otherwise an offline planner that
  covers the whole voice flow. Either way a deal is only confirmed after the
  user's explicit yes.
- **Sign-in** is OAuth 2.1 with PKCE as a public client (`AUTH_MODE=oauth`) with
  Login with Amazon. Local development and the labelled judge demo use a name and
  a passcode that the first sign-in with that name sets.
- **Offers that arrive while you're away** show up as a badge and a card, and are
  read out when voice is on.

Voice uses the browser's speech recognition and synthesis (Chrome, Edge, Safari);
typing works everywhere.

## Architecture

```mermaid
flowchart TB
  U[People who need, have or can do something] -- voice --> A[Alexa+<br/>interface + agent]
  A -- "MCP tools (Streamable HTTP)" --> S
  subgraph S["PairUp MCP server"]
    I[Intent extraction<br/>Bedrock LLM] --> P[Pairing engine<br/>runs on every post, both sides]
    P --> H[Hybrid search<br/>pgvector + full-text, relevance gate]
    P --> N[Settlement: pairing-core<br/>Rust → WebAssembly, private limits]
    P --> C[Price check<br/>reference prices + robust trade history]
    L[Learning loop<br/>ranks by what closes, guarded rollout] -.-> P
    N --> D[Proposed deal<br/>both sides confirm]
  end
  S --> DB[(Postgres + pgvector<br/>users · offers · requests · deals · events)]
  B[Bee context] -. intent enrichment .-> I
```

| Layer | Role |
|---|---|
| Alexa+ | Interface and agent: conversation, confirmation |
| MCP server (this repo) | Pairing intelligence: posts, matching, settlement, price checks, learning, deals |
| Bee | Ambient context → proactive buy requests |

## MCP tools

| Tool | What it does |
|---|---|
| `post_offer` | Offer an item to sell or a service you can do (per job or per hour): public price, **private minimum**, area. Pairs with a waiting request in the same call |
| `post_request` | Ask for an item or for help (pickup, drop-off, time, hours) + **private budget**. Pairs with the best offer and settles the price in the same call; returns alternatives |
| `find_matches` | More options for a request |
| `negotiate` | Take a different option instead; replaces the current deal |
| `confirm_deal` / `decline_deal` | Each side's yes or no; a no re-pairs both posts |
| `get_deal_status` | Deals and jobs waiting for your yes first, with counterpart, place and time |
| `list_my_posts` / `withdraw_post` | Your offers and requests; take one down, releasing any deal it held |
| `rate_deal` | 1 to 5 stars for the other side of a confirmed deal, once per side; feeds the track records the ranking learns from |
| `report_user` | Report the other side of a deal or the owner of an offer; the two are never paired again, and enough reports put someone under review |
| `get_suggestions` / `accept_suggestion` / `dismiss_suggestion` | Private suggestions; accept after yes, skip for now or forget a routine |
| `add_context` / `get_my_routines` | Bring a need snippet from Bee or a device; explain what was learned from your own history |
| `delete_my_data` | Erase data after explicit confirmation, releasing holds and anonymizing retained counterpart deal records |

Weapons, drugs, alcohol and tobacco, prescription medicine, recalled and
counterfeit goods, fake documents, cheating, adult services, live animals and
illegal services can't be posted, as items or as services: a keyword policy plus
an embedding match against [data/policy.json](data/policy.json) refuses them
before anything is stored, with a spoken `say` and an error `code`.

Every tool declares an output schema and annotations, and every write takes an
optional `idempotency_key` so a retried call never posts or confirms twice. Deals nobody answers expire (by the request's deadline at the latest)
and both posts are paired again; per-user posting limits and per-caller rate limits
protect the market. Pairing rules, schemas, limits and privacy rules:
[docs/TOOL_CONTRACT.md](docs/TOOL_CONTRACT.md).

## Built for agents

Any MCP host or agent framework can find PairUp, learn it and use it safely
without a human wiring it up:

| | |
|---|---|
| **Connect without setup** | Claude, ChatGPT, Cursor or a Strands agent connects to the hosted `/mcp` on its own: a Client ID Metadata Document (MCP 2025-11-25) or dynamic registration (RFC 7591), then a consent screen naming the client and Login with Amazon. Tokens refresh with rotation and revoke at `/oauth/revoke` (RFC 7009). [docs/TOOL_CONTRACT.md](docs/TOOL_CONTRACT.md#connecting-a-client) |
| **Agent Skill** | [skills/pairup/SKILL.md](skills/pairup/SKILL.md), in the open SKILL.md format and served at `/skills/pairup/SKILL.md`: which tool for which sentence, how to read a deal, the rules, error codes, a worked example |
| **Server card** | `/.well-known/mcp/server-card.json`: endpoint, auth, instructions, and every tool, prompt and view with schemas, read from the live server |
| **llms.txt** | `/llms.txt`: the same in Markdown, with the rules an agent must follow |
| **Prompts** | `sell_something`, `find_something`, `whats_new` show up as starters in Claude, VS Code and the MCP Inspector |
| **Safe retries** | `idempotency_key` on every write; a retry returns the first result |
| **Speakable errors** | Every result and error has a `say` sentence; errors an agent can act on carry a `code` |
| **Strands + AgentCore** | [agents/agentcore](agents/agentcore): a Strands Agents voice agent on Amazon Bedrock AgentCore Runtime whose only tools are this server's, with a code-level guard that blocks `confirm_deal` until the user says yes |

## Deployment and operational support

- **AWS:** CloudFront (HTTPS, HTTP/3, security headers) → EC2 Graviton with an IAM
  role (no access keys), encrypted EBS with daily snapshots, auto-recovery, deploys
  through Systems Manager with atomic release switching. [docs/DEPLOY.md](docs/DEPLOY.md)
- **Observability:** JSON logs in CloudWatch with a request id per call (`X-Request-Id`),
  CloudWatch metrics for MCP latency, tool failures and 5xx, alarms with email alerts,
  Embedded Metric Format for per-tool latency.
- **Reliability:** `/ready` checks the database before traffic switches; graceful
  shutdown drains calls in flight; holds expire and re-pair on a timer; Bedrock
  intent/agent failures fall back to local parsing and the offline planner.
- **Safety:** OAuth 2.1 with PKCE, Login with Amazon as the identity provider,
  token revocation, SSRF-guarded client metadata fetches, Origin validation, CDN-only origin, per-caller rate
  limits, per-user posting limits, bounded inputs, private limits redacted in one
  place and leak-tested.
- **Trust and safety:** a prohibited and restricted items and services policy
  checked before every post, reports with a review queue on the dashboard, and
  ratings that feed each person's track record.
- **Speed:** `npm run bench` measures real MCP tool latency and throughput. See the measured local sample below.
  Historical 0.6.0 benchmark before the scheduling changes (2026-10-20, Windows, Node v24.14.1, mock AI, PGlite, real HTTP MCP, 2 workers × 5 rounds, fresh users, 40 calls, zero errors): post_offer p50/p95/p99 42/331/331 ms; post_request 84/126/126 ms; find_matches 20/68/68 ms; confirm_deal 27/36/36 ms. Throughput 25.7 calls/s. This small local sample includes cold calls; measure Bedrock and the deployed network separately with `npm run bench`.
- **Tests:** unit and integration checks over MCP/HTTP, OAuth, schemas, privacy,
  idempotency, schedule compatibility, overlapping bookings and concurrent approvals;
  plus scripted Strands conversations against a real server. CI runs on every push.

## Repo map

```
src/
  index.ts               entry point
  app.ts                 HTTP: /mcp (Streamable HTTP), /api/agent, /api/me, /health, /api/dashboard, /api/review, OAuth routes
  auth/oauth.ts          OAuth 2.1 account linking (PKCE, protected-resource metadata)
  mcp/server.ts          MCP tool definitions
  mcp/schemas.ts         output schemas for every tool
  mcp/prompts.ts         MCP prompts (sell_something, find_something, whats_new)
  mcp/discovery.ts       server card and llms.txt, read from the live tool list
  mcp/apps.ts            the MCP Apps view (ui://pairup/market.html)
  agent/                 the web app's assistant step: Bedrock tool use, offline planner, confirm guard
  market/pairing.ts      pairing engine: pair on every post, atomic holds, release and re-pair
  market/scheduling.ts   deterministic availability, time zones and overlapping work windows
  market/matching.ts     hybrid pgvector + full-text search in both directions
  market/negotiation.ts  price settlement via pairing-core (Rust → WebAssembly)
  market/pricing.ts      price check: reference prices, robust trade-history range
  market/learning.ts     learning to pair better: features, model, guarded rollout
  market/policy.ts       what may be posted: keyword rules + embedding match (data/policy.json)
  market/trust.ts        reports, review status and the review queue
  market/amazon.ts       hand-offs to Amazon: search fallback, Trade-In, Hub meet-up points
  market/service.ts      business operations behind each tool
  market/views.ts        the only place rows become output (privacy redaction)
  market/idempotency.ts  retry-safe writes (idempotency_key)
  http/log.ts            JSON logs, CloudWatch Embedded Metric Format, request ids
  ai/                    mock + Bedrock embeddings and intent extraction
  db/                    PGlite / Postgres client, schema, seeding
src/web/                 the web app: OAuth PKCE sign-in, MCP client, MCP Apps host, voice
src/apps/                the MCP Apps view (deal card, options, deals, posts)
public/app/              web app shell + built bundle (npm run build:web)
public/mcp-apps/         built single-file MCP Apps view
public/dashboard/        operations dashboard
data/policy.json         prohibited and restricted items and services
data/seed-listings.json  seed market: 162 posts from 22 people, items and services; demo Amazon Hub points per area
data/trade-in-categories.json  categories Amazon Trade-In takes
skills/pairup/     the Agent Skill (SKILL.md)
agents/agentcore/        Strands Agents voice agent for Amazon Bedrock AgentCore Runtime
scripts/                 seed, smoke test, latency benchmark (bench.ts), add-on assets
docs/                    contract, design system, award plan, Alexa+ setup, deploy, demo script, submission, friction log
vendor/pairing-core/     prebuilt module from https://github.com/rairurairu/pairing-core (refresh: node scripts/sync-pairing-core.mjs)
Dockerfile, deploy/      container image, AWS CloudFormation + deploy scripts, Lightsail config
```

## Plan

See [docs/AWARD_GAPS.md](docs/AWARD_GAPS.md) for the award analysis and the day-by-day plan.

## License

MIT — see [LICENSE](LICENSE).
