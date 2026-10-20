# PairUp 0.6.0 local validation

October 20, 2026, Windows, Node.js 24.14.1. All six handoff branches are merged
into `main`. Work stayed local; no push, deployment or AWS calls were performed.

| Check | Result |
|---|---|
| Root `npm ci` | Passed; audit reported zero vulnerabilities |
| `npm run typecheck` | Passed for server and browser sources |
| `npm test` | 130 passed, zero failures |
| `npm run build:web` | Web, MCP Apps and watch bundles rebuilt; reproducibility checked after commit |
| Local server plus smoke | TI-84 purchase, ratings, prohibited-post refusal, lunch-run booking passed |
| AgentCore `npm ci`, typecheck, tests | Passed; three scripted Strands conversations over real MCP |
| Shell syntax | `bash -n` passed for AWS deploy, install, teardown and AgentCore deploy scripts |
| Bee replay | Calculator and printer-paper suggestions; email task and hiking chat produce none |
| Lifestyle seed | Fifteen labelled, closed requests; idempotent; weekday lunch suggestion before noon |
| Reset | Scratch database checked for removal of device, context, auth, report and rating data |

The test command runs one file at a time to bound PGlite memory use. Tests cover
private-limit redaction, schemas, OAuth/client registration/revocation, policy and
moderation, subscriptions in memory and over HTTP SSE, cross-user session rejection,
elicitation acceptance/decline/host failure, data erasure across all merged tables,
device tokens, routine feedback and the offline assistant's approval guards.

Browser walkthrough on a scratch market:

- Sign-in, For you strip and Devices panel render.
- `/watch/` shares sign-in and fits a 410 × 502 desktop watch frame.
- A printer-paper suggestion accepts a budget, pairs the A4 paper listing, and
  records confirmation only after a second Yes.
- “What do you know about me?” renders the weekday lunch routine, $4 budget,
  LG7 canteen → Hall 5 route and Forget button in an MCP Apps card.
- “Anything I need?” renders a Bee suggestion with budget and action controls.
- A $1 iPhone offer asks for price confirmation before posting.

Local benchmark on the merged server: mock AI, PGlite, real HTTP MCP,
two workers × five rounds, fresh users, 40 tool calls, zero errors:

| Tool | p50 | p95 | p99 |
|---|---:|---:|---:|
| post_offer | 42 ms | 331 ms | 331 ms |
| post_request | 84 ms | 126 ms | 126 ms |
| find_matches | 20 ms | 68 ms | 68 ms |
| confirm_deal | 27 ms | 36 ms | 36 ms |

Throughput was 25.7 calls/s. This small sample includes cold calls; deployed
network and Bedrock performance require a separate measurement.

Live Login with Amazon, Bedrock/AgentCore deployment, physical Bee and Apple Watch
remain human validation steps. The Bee replay, seed people, Hub locations and
retail price references are labelled demo data. Search and Trade-In use links;
live retail-price and Hub-locator APIs are not connected. CI was not triggered.
