# Devpost form: Project Story page

Paste each block into the matching field. Prepared October 21, 2026. "About the project" is grouped for fast screening. A quick map comes first, then four parts: the project story, the judging criteria, the tracks and mini challenges, then feedback and the friction log.

---

## About the project

Paste everything between the two lines below.

---

**PairUp is a C2C marketplace for Alexa+.** You say what you need, have or can do, and PairUp finds your pair. It handles things, errands and one-time jobs, starting on the University of Washington campus in Seattle. One open rule sets every price, and every deal ends with a yes from both people.

- **Track:** Alexa+
- **Mini challenges:** AWS Builder · Open Source
- **Demo video (2:51):** https://youtu.be/Q_CK5EL0stY
- **Live app:** https://d3cxpkmhl89rw9.cloudfront.net/app/ · **MCP endpoint:** `https://d3cxpkmhl89rw9.cloudfront.net/mcp`
- **Code (MIT):** https://github.com/rairurairu/amazon-pair-up · **Open-source contribution (MIT):** https://github.com/rairurairu/pairing-core

## Quick map for judges

| Requirement or criterion | Our answer in one line | Section |
|---|---|---|
| Text description: what it does and how it works | Two spoken sentences make a complete, consent-based deal for things, errands or jobs | Part 1 |
| **Tech Implementation** | MCP 2025-11-25 server + Agent Skill, Bedrock, Rust/WASM pricing, 175/175 tests, live on AWS | Part 2 |
| **Design** | One complete voice flow from sentence to Ring-confirmed hand-off; one design system on every surface | Part 2 |
| **Potential Impact** | 52,316 UW students, sellers keep 100%, about $1.9M a year modeled, pilot and business model ready | Part 2 |
| **Quality of the Idea** | Alexa+ as a two-sided marketplace where agents talk and an open rule sets the price | Part 2 |
| **Alexa+ track:** MCP server (2025-11-25, Streamable HTTP) or Agent Skill, in action | Both, shown working in the video through a simulated Alexa+ voice host (source in repo) | Part 3 |
| Ring integration (part of the Alexa+ hand-off) | Ring Partner API Event History + signed webhooks confirm both arrivals at a PairUp Point | Part 3 |
| **AWS Builder:** documented AWS integrations | Bedrock Nova + Titan, Strands, AgentCore, CloudFront, EC2 Graviton, CloudWatch and more | Part 3 |
| **Open Source:** contribution URL, repo URL, username, description | pairing-core (MIT), commits linked, user rairurairu | Part 3 |
| Public repo with license, source, assets and run instructions | amazon-pair-up, MIT, README run steps | Part 3 |
| Demo video under 3 minutes, public, English | 2:51 on YouTube, original music | Links above |
| Work done during the submission window | The repository starts October 18, 2026 | Part 3 |
| Product feedback on every tool, including AWS | 13 tools: use, what worked, what needs work, onboarding, would we use it again | Part 4 |
| Feature requests (optional) | 8 requests with why and urgency | Part 4 |
| Friction log (optional, up to 10% bonus) | 9 entries in the full requested format | Part 4 |

---

# Part 1 · The project

## Inspiration

It's 11:47 PM at UW. A student's stats exam is at 9 AM and they need a graphing calculator. One sits unused in a drawer in the next dorm. Finding each other today takes a listing, a group-chat thread, a round of haggling and a meet-up to arrange, so it usually doesn't happen. Small errands work the same way. Carrying a $5 lunch from the HUB to McCarty Hall is a two-minute walk, and arranging it takes longer than doing it.

The idea started as "Carousell for agents": your assistant should find what you need from another person and settle the deal for you. Building it taught us that a buyer's standing need is as valuable as a seller's listing, and that the same mechanism works for what people can *do* as well as what they own. "I need a calculator tonight" is something you say, so Alexa+ is the natural home, and an MCP server lets Alexa+ act on it.

Our three goals: **faster and cheaper to buy what you need, make personal business great, and C2C ready for the age of agents.**

## What it does

**A complete deal in two sentences.**
- Sam: *"Sell my TI-84 for $20. I'll take anything above $15."* His $15 minimum stays private and works as his standing yes.
- Mei: *"I need a graphing calculator in good condition near UW campus today, max $18."*
- PairUp proposes the TI-84 at **$18**, names a campus meeting point, holds the item and asks Mei for a yes. She says yes, Sam is notified, and they pay each other at the hand-off.

**One open rule sets every price.** Each side names a limit and the buyer's budget becomes the offer. The deal settles at $$\min(\text{ask},\ \text{buyer max})$$ whenever that reaches the seller's private minimum. Nobody needs to know the market price, and nobody haggles.

**It books people, too.**
- *"Find someone to pick up my lunch from the HUB to McCarty Hall by 12:30, $5"* reaches Priya, who already does lunch runs for $4.
- *"Get me a helper for the event on Saturday 2–6 PM, $10 an hour"* shows the rate, the $40 total, the date in Pacific time and whose yes is still needed.
- The whole work window has to fit the helper's stated hours, and a person's bookings never overlap. Open-ended hours are marked tentative for the helper to approve.

**Ring PairUp Points make the hand-off safe.** Both people meet at an unstaffed spot by the HUB, watched by one Ring doorbell. When Ring confirms both arrivals, the card, the watch and both voices say *"Both here. Go ahead with the hand-off."*

**It prepares requests before you ask.** After three weeks of weekday lunch runs, PairUp offers the next one shortly before noon. A Bee note about tomorrow's exam becomes a ready request on your phone or watch. Every suggestion waits for your yes.

**Full lifecycle.** People can recall deals, choose another option, decline, withdraw a post, rate the other side, report a problem or erase their data. A request nobody can fill goes to Amazon search or Trade-In.

**Built for what is hard to price,** such as a hand-built loft ladder, help carrying a keyboard piano up three floors, or a fix for a wobbly drawer. A request with no match stays open and pairs the moment the right person posts.

## How we built it

```
Alexa+ / any MCP client ──► PairUp MCP server (2025-11-25, Streamable HTTP, OAuth 2.1)
                              ├─ Amazon Bedrock: Nova Lite (intent, tools) · Titan V2 (embeddings)
                              ├─ Matching: hard constraints → pgvector + PostgreSQL full-text
                              ├─ Pricing: pairing-core (Rust → WebAssembly, integer cents)
                              ├─ State: PostgreSQL transactions · schedule grammar with IANA zones
                              ├─ Ring: Partner API Event History + HMAC-signed webhooks
                              └─ MCP Apps cards ──► rendered in the host
Strands agent on Bedrock AgentCore Runtime ──► same MCP tools
Hosting: CloudFront → EC2 Graviton · SSM · Parameter Store · CloudWatch · EBS snapshots
```

- **Models understand, code decides.** Bedrock reads what people mean. Matching, pricing, schedules and consent are deterministic code.
- **One server, every agent.** The web app is a full MCP host that plays the Alexa+ conversation by voice in any browser. A separate Strands agent on AgentCore uses the same tools, and any MCP client can connect.
- **Release identity.** `npm run check:release` proves the public endpoint runs the submitted commit.

## Challenges we ran into

- **Agents are easy to sway.** An AI negotiator that acts desperate gains about 20% (Bianchi et al., ICML 2024). We moved every price decision out of the model and into a fixed, open rule.
- **Time is hard.** "Saturday 2–6" has to mean Pacific time, fit the helper's whole stated window and never overlap another booking. We wrote a deterministic schedule grammar with per-post IANA zones.
- **Consent across agents.** Alexa+, the web host and the Strands agent all reach the same tools. The server enforces both people's explicit yes, whichever agent is calling.
- **Privacy at a doorbell.** Arrival confirmation uses the event type and time only, for 24 hours, with no video or snapshots.
- **New specs.** MCP 2025-11-25 sessions, version negotiation and MCP Apps were new to us. We wrote transport conformance tests and logged each rough edge (Part 4).

## Accomplishments that we're proud of

- A complete, consent-based deal from two spoken sentences, live on AWS.
- One contract for things, errands and jobs: the same tools, cards and yes.
- An open-source price rule that any agent host can audit and reuse.
- One design system across the app, MCP Apps cards, the watch view and the live dashboard, in light and dark.
- A 2:51 launch film built from real app frames, with original music.

## What we learned

- MCP is the right seam for Alexa+. One server serves Alexa+, a browser host, a Strands agent and any other MCP client.
- Models should understand people, and code should make the decisions. The split made PairUp easier to trust and to test.
- A standing request is as powerful as a listing. Matching on every post from either side makes C2C feel instant.
- Physical hand-offs are where C2C wins or loses, and that is where Ring fits.

## What's next for PairUp

- An observed UW pilot that measures task success, time saved and points of confusion.
- Online payment held until the hand-off is confirmed (Stripe Connect or Amazon Pay).
- The Amazon Hub locator and live retail reference prices in place of the labelled demo lists.
- Live Bee device data in the context flow, then more Seattle campuses and neighborhoods.

---

# Part 2 · Judging criteria

## Tech Implementation
*How well is the project built, and how effectively does it use the required tech?*

- **Required tech in action:** a self-hosted MCP server on spec **2025-11-25** over **Streamable HTTP**, plus an **Agent Skill**, both shown working in the video.
- **Built to production standard:** OAuth 2.1 sign-in, typed tool schemas, sessions and recovery, and server-enforced consent. PostgreSQL transactions make holds and simultaneous confirmations safe.
- **Hybrid matching:** hard constraints (kind, condition, quantity, currency, availability), then **pgvector** semantic search with **Titan** embeddings, combined with PostgreSQL full-text search.
- **Deterministic decisions:** prices from pairing-core (Rust → WebAssembly, integer cents). Schedules use a deterministic grammar with an IANA time zone per post.
- **Proven:** 175/175 tests (matching, pricing, privacy, scheduling, OAuth, MCP transport conformance, scripted agent conversations) plus 4/4 AgentCore tests. CI is green, and `npm run check:release` proves the public endpoint runs the submitted commit (9/9 checks).

## Design
*Does the project deliver a complete, coherent product experience? Is the interaction model intuitive for the target platform?*

- **Built for voice:** one spoken sentence posts a need, an offer or a skill. Requests stay open, so nobody has to check back.
- **Complete:** the flow runs from the first sentence through matching, consent and a confirmed hand-off at a Ring PairUp Point.
- **Every card answers the same four questions:** the price, the place, the time and whose yes comes next. The same MCP Apps card renders in any MCP host.
- **One design system** across the app, the cards, the watch view and the live dashboard. It has light and dark themes, contrast tests, 44 px touch targets and reduced motion.
- **People stay in control:** agents prepare and propose, and people decide. Private limits are never shown to the other side.

## Potential Impact
*Does the project make a credible, specific case for solving customer needs? Could it serve an audience beyond the hackathon?*

- **A specific audience:** UW Seattle's 52,316 students buying, selling and booking help on campus. With 10% using it twice a month at $15, that is about **$1.9 million a year** in exchanges between students.
- **Cheaper for buyers, better for sellers:** sellers keep **100%** of the agreed price; resale sites keep 13–20%. A lunch run costs the counter price plus the $4 offered, and the student who walks keeps the $4.
- **Personal business for everyone:** 72.9 million Americans already earn independently (MBO Partners 2025). On PairUp, a business opens with one sentence.
- **Beyond the hackathon:** an observed UW pilot comes next, then more campuses and neighborhoods. The business model keeps the full price with the seller and earns from services around the deal: protected payment, agent access tiers, community licenses and Amazon referrals.
- **A wider market:** the average US household holds $3,000–4,000 of resellable items (eBay Recommerce Report 2026). Sources are in `research/`.

## Quality of the Idea
*Is this a creative use of the required tools? Does the team understand the developer ecosystem and the end-user needs in its track?*

- **Alexa+ as a two-sided marketplace.** Standing needs and offers pair automatically from either side, for things and for services.
- **Agents talk, code sets the price.** An AI negotiator that acts desperate gains about 20% (Bianchi et al., ICML 2024). PairUp's open rule gives every agent the same price for the same limits, which makes it a fair meeting place for the personal agents to come.
- **Ring solves a real C2C problem,** a safe hand-off between strangers, with privacy built in.
- **Ecosystem fluency:** MCP connects Alexa+ and any agent, Bedrock handles understanding, AgentCore hosts the agent, and open source makes the price rule auditable.

---

# Part 3 · Track, integrations and mini challenges

## Alexa+ track (primary)

- **MCP server:** spec 2025-11-25, Streamable HTTP, at `/mcp` (`src/mcp/`). It has typed tools (`post_offer`, `post_request`, `find_matches`, `confirm_deal`, `choose_meetup_point`, `check_in_at_point`, `get_suggestions`, `delete_my_data` and more), MCP Apps cards, a server card and `llms.txt`.
- **Agent Skill:** `skills/pairup/` teaches any agent the consent rules, private limits and retries.
- **Shown in action:** the web app is a full MCP host. It discovers the tools, calls them as the signed-in user, renders the MCP Apps cards and plays the Alexa+ conversation by voice in any browser. The source of this simulated Alexa+ experience is in the repo (`src/web/`).
- **Any agent can connect** through OAuth 2.1, with no custom wiring.

## Ring integration: safe hand-offs for Alexa+ deals

- **Ring Partner API:** `src/ring/client.ts` reads a PairUp Point's devices and paginated Event History, and handles throttling and retry-after.
- **Ring webhooks:** `src/ring/webhook.ts` verifies HMAC-SHA256 signatures and dedupes by request id.
- **Arrival logic:** `src/market/points.ts` counts a doorbell press or person event within ten minutes as an arrival. When both people are confirmed, the card, watch and voice say "Both here." Tests are in `test/points.test.ts`.
- **Privacy:** PairUp keeps only the event type and time, for 24 hours, and never requests video or snapshots.
- **In the video:** simulated Ring doorbell events confirm both arrivals at a PairUp Point.

## AWS Builder mini challenge

| AWS service | How PairUp uses it |
|---|---|
| Amazon Bedrock: Nova Lite (Converse) | Intent extraction and tool selection, with validated output and explicit-approval guards |
| Amazon Bedrock: Titan Text Embeddings V2 | 1024-d vectors for offers, requests and reference prices in pgvector |
| Strands Agents | A separate MCP-connected agent whose hooks require the user's yes and add idempotency keys |
| Bedrock AgentCore Runtime | ARM64 package and deployment for that agent; hosted invocation recorded |
| CloudFront + EC2 Graviton | HTTPS app and MCP hosting with origin protection and IAM role credentials |
| Systems Manager, Parameter Store, S3 | Deployment, secret retrieval and release artifacts |
| CloudWatch, SNS, encrypted EBS snapshots | Request and tool metrics, alarms, logs and daily recovery snapshots |

Live results (October 20): Titan returned 1024 dimensions, Nova selected `post_offer`, and the AgentCore invocation passed. Details are in `docs/EVIDENCE.md`.

## Open Source mini challenge

- **Contribution:** [pairing-core](https://github.com/rairurairu/pairing-core), a new MIT-licensed project created during the hackathon. Contribution commits: [MCP example and CI](https://github.com/rairurairu/pairing-core/commit/135fe20c444e707e39cb4b8d497be623238be948), [private-minimum settlement](https://github.com/rairurairu/pairing-core/commit/c07c0b10082c393a7f88f1f5be25a2225cf6122a).
- **Repo:** https://github.com/rairurairu/amazon-pair-up · **GitHub username:** rairurairu
- **What it is:** a dependency-free Rust library that settles a deal between two private limits, compiled to WebAssembly. It ships invariant tests, shared JavaScript test vectors and an MCP example.
- **How it works:** the buyer's maximum is the offer. If it reaches the seller's private minimum, the price is the lower of the ask and the offer, in integer cents. The same inputs always give the same price.
- **Why it matters:** any agent host can settle deals with an auditable rule that agents can't talk their way around. PairUp calls it for every deal.

## Built during the hackathon

The repository history starts October 18, 2026, inside the submission window. Key milestones:
- October 18: first Alexa+ marketplace MCP server.
- October 19: symmetric pairing from either side, the shared price rule and the browser MCP host.
- October 20: services (errands and jobs), Amazon search and Trade-In, Bee context and learned routines, scheduling, Ring PairUp Points, the shared design system and release v0.8.0 on AWS.

Commit hashes for each milestone are in `docs/SUBMISSION.md`.

---

# Part 4 · Product feedback, feature requests and friction log

## Product feedback

| Tool and what we used it for | What worked well | What needs work | Onboarding | Build with it again? |
|---|---|---|---|---|
| **MCP TypeScript SDK:** HTTP tools, sessions, elicitation, OAuth | Typed schemas; in-memory and HTTP clients share tests | Strict current-spec batch handling | Initialize, tools/list, SSE and Origin tests pass | Yes: one contract across agents |
| **MCP Apps:** embedded deal cards | Sandboxed views and auto-resize render cleanly | Initialization timeout and cleanup guidance | Official App Skill plus a local card walkthrough | Yes: one card for many hosts |
| **Agent Skills:** PairUp instructions | A small Markdown package teaches consent and limits | Clearer distribution and discovery conventions | Spec validation passes | Yes: portable agent guidance |
| **Amazon Devices Builder Tools:** doc search | Returned the right Ring and Alexa+ pages | Hidden schema and context prerequisite | Worked after inspecting the schema | Yes |
| **Ring Partner API and webhooks:** arrivals | JSON:API and HMAC map cleanly to presence | One recipe covering pagination, token expiry and throttling | Protocol and signature tests pass | Yes: a concrete arrival signal |
| **Ring Playground and UX guide** | Easy device discovery; plain-language state patterns | A unified presence and webhook simulation | Applied the UX guide's states and accessibility | Yes |
| **Bee CLI, API, Skill and MCP:** context | Documented event shapes match our bridge | Stream fixtures and a consent example | CLI README checked; replay passes | Yes: education context to action |
| **Bedrock Titan V2:** retrieval | One adapter feeds hybrid search | Per-model quota and region guidance | Live: 1024-d in 1.5 s | Yes |
| **Bedrock Nova Lite (Converse):** intent and tools | Structured tool calls fit server-side consent | Fallback provenance in starters | Live intent and tool-use checks pass | Yes |
| **Strands Agents:** independent MCP agent | Tool discovery and hooks reuse our rules | Stream example needs updating | Four scripted conversations pass | Yes |
| **Bedrock AgentCore Runtime:** hosted agent | Validated requests and real hosted streaming | Local headers in the README | Version 2 READY; live invocation passed | Yes |
| **CloudFormation, EC2 Graviton, CloudFront, SSM, CloudWatch, EBS:** hosting | Repeatable stacks, role credentials, origin protection, alarms | DLM validation, Windows CLI notes | Deployed v0.8.0; 4 alarms OK | Yes |
| **Login with Amazon:** identity for MCP OAuth | PKCE and rotating tokens are well specified | A full multi-client MCP walkthrough | OAuth tests pass | Yes |

## Feature requests

| Tool | Request | Why it matters | Urgency |
|---|---|---|---|
| Ring Playground | A presence and webhook test sender with an HMAC example and a matching Event History record | Rehearse a full arrival flow without a doorbell | Important |
| Bee CLI / Skill | Versioned JSON stream fixtures and a consent-based action tutorial | Reproducible education workflows with clear provenance | Important |
| MCP Apps | Configurable initialization timeout, cleanup and an accessible fallback | Cards never hang in a loading state | Important |
| Builder Tools | `exec --schema`, full search arguments and context setup in help | Removes avoidable onboarding retries | Important |
| AgentCore / Strands | A compile-tested streaming quick start and a local invocation command | From install to visible text without debugging | Important |
| Bedrock | Starter telemetry that separates model success, offline fallback and tool replies | Reliable deployment evidence and diagnostics | Important |
| CloudFormation / DLM | Validate description characters at changeset time | Avoids a full rollback over punctuation | Nice-to-have |
| AWS CLI | A Windows Git Bash recipe for SSM | Portable deployment instructions | Nice-to-have |

## Friction log

Every entry follows the requested format: task, steps, expected vs. actual, severity, workaround and suggestion.

### 1. AgentCore TypeScript quick start does not compile against the current Strands SDK
- **Tool:** `bedrock-agentcore` 0.4.6, `@strands-agents/sdk` 1.21.0
- **Task:** Host our Strands agent on AgentCore Runtime from the README quick start.
- **Steps:** Copied the streaming handler, which checks `event.type === 'modelContentBlockDeltaEvent'`, and ran `tsc`.
- **Expected:** The quick start compiles with the Strands versions its peer range allows (`>=1.5.0`).
- **Actual:** `TS2367`. Strands 1.21 wraps deltas in `modelStreamUpdateEvent`, so in plain JavaScript the README code runs but yields no text, and the agent looks silent.
- **Severity:** minor
- **Workaround:** Read the text from `event.event.delta` inside `modelStreamUpdateEvent`.
- **Suggestion:** Update the README to the current event shape, or export a `textDeltas()` helper, and pin the peer range to tested versions.

### 2. AgentCore Runtime local calls fail with 406 and 400 before reaching the handler
- **Tool:** `bedrock-agentcore` 0.4.6, `BedrockAgentCoreApp`
- **Task:** Test `/invocations` locally before deploying.
- **Steps:** `curl -X POST localhost:8080/invocations -H "Content-Type: application/json" -d '{"prompt":"any news?"}'`
- **Expected:** The handler runs, as with a hosted call.
- **Actual:** First a `406` (needs `Accept: text/event-stream`), then a `400` (missing session id). The README mentions neither header.
- **Severity:** minor
- **Workaround:** Send both headers (documented in `agents/agentcore/README.md`).
- **Suggestion:** Add a local curl line to the quick start, and generate a session id for local calls with a warning.

### 3. Data Lifecycle Manager description pattern is only checked at stack creation
- **Tool:** CloudFormation, `AWS::DLM::LifecyclePolicy`
- **Task:** First create of our stack (EC2, IAM, CloudFront, daily EBS snapshots).
- **Steps:** `aws cloudformation deploy --template-file deploy/aws/amazonpairup.yaml`
- **Expected:** An invalid property value is reported before any resource is created.
- **Actual:** The changeset passed. The DLM handler then rejected a comma in the description without naming the character or the pattern. The stack rolled back to `ROLLBACK_COMPLETE` and had to be deleted.
- **Severity:** minor
- **Workaround:** Removed the comma, deleted the stack and deployed again.
- **Suggestion:** Enforce the pattern in the resource schema so changesets and `cfn-lint` catch it, and include the allowed pattern in the error.

### 4. AWS CLI arguments rewritten by Git Bash on Windows
- **Tool:** AWS CLI v2 (Windows), Systems Manager Parameter Store, S3
- **Task:** Run our bash deploy script from Git Bash on Windows 10.
- **Steps:** `aws ssm get-parameter --name /amazonpairup/origin-secret` and `send-command --parameters file:///tmp/...`
- **Expected:** The same behavior as on macOS and Linux.
- **Actual:** MSYS rewrote `/amazonpairup/...` into `C:/Program Files/Git/amazonpairup/...` and broke the `/tmp` paths. Nothing in the CLI output shows the rewrite.
- **Severity:** minor
- **Workaround:** `export MSYS_NO_PATHCONV=1` and `cygpath -w` for temp files.
- **Suggestion:** Add a Git Bash note to the CLI Windows and Parameter Store pages, and warn when a `--name` value looks like an MSYS-rewritten path.

### 5. Amazon Devices Builder Tools CLI hides required arguments and project context
- **Tool:** Amazon Devices Builder Tools MCP 1.0.17
- **Task:** Search the Ring webhook and Alexa+ MCP onboarding docs.
- **Steps:** `exec --list`, then `exec search_documentation` with a query, then with a platform string, then with the schema's platform object.
- **Expected:** The listed command explains its full arguments and first-call prerequisites.
- **Actual:** Two schema failures, then `PROJECT_CONTEXT_REQUIRED`. After `set_project_context({config:{}})`, the search returned the right Ring and Alexa+ pages.
- **Severity:** minor
- **Workaround:** Inspect `tools/list` over MCP, set the context, then search.
- **Suggestion:** Add a schema-valid example to `--help`, report the context prerequisite first, and support `exec --schema <tool>`.

### 6. MCP TypeScript SDK accepts legacy batches on a 2025-11-25 endpoint
- **Tool:** MCP TypeScript SDK 1.32.1, Streamable HTTP 2025-11-25
- **Task:** Enforce one JSON-RPC message per POST, as the current spec requires.
- **Steps:** Sent empty, single-item and two-message arrays in `test/transport.test.ts`.
- **Expected:** A current-spec endpoint rejects batches consistently.
- **Actual:** The SDK keeps the older batch handling.
- **Severity:** minor
- **Workaround:** An application guard returns 400 / -32600 before the transport. All three tests pass.
- **Suggestion:** A strict mode tied to the negotiated protocol version, with a batch-rejection example.

### 7. MCP Apps host initialization needs a failure path
- **Tool:** MCP Apps (`ext-apps` 1.7.5)
- **Task:** Keep a failed embedded card from showing a loading skeleton forever.
- **Steps:** Traced bridge initialization, frame sizing, connection errors and the text fallback in `src/web/host.ts`.
- **Expected:** The host can bound initialization and offer an accessible recovery.
- **Actual:** No built-in timeout or cleanup, so the host has to supply its own.
- **Severity:** minor
- **Workaround:** An 8-second timer that closes the bridge, removes the frame and points the user to Deals or spoken status.
- **Suggestion:** A configurable initialization helper or a documented failure path in the basic host sample.

### 8. Ring presence testing spans the Playground, Event History and webhooks
- **Tool:** Ring Partner API, Ring Playground, `ring-api-helloworld`
- **Task:** Rehearse two arrivals without a physical doorbell.
- **Steps:** Compared the starter's device, event and webhook routes with the API reference, then ran PairUp's signed webhook simulator.
- **Expected:** One simulator workflow exercises the same event-to-arrival path the app uses.
- **Actual:** The starter's event endpoint reads its own local webhook store. The Playground has no webhook sender with an HMAC key, so a full arrival test needs three separate setups.
- **Severity:** minor
- **Workaround:** A labelled local signed-webhook sender beside the Event History reader.
- **Suggestion:** A Playground presence-event and webhook test sender with a matching Event History record and HMAC example.

### 9. Bee bridge testing and device provenance are separate steps
- **Tool:** Bee CLI, Bee developer API, Bee Skill / MCP
- **Task:** Turn an exam-related need into a prepared calculator request.
- **Steps:** Checked `stream --json --types` and every event name against the CLI README, read the Skill, and replayed a fixture into a fresh server.
- **Expected:** Summary and to-do events produce private suggestions, and unrelated context creates no request.
- **Actual:** It works as expected. There are no official stream fixtures, so tests need hand-made data.
- **Severity:** minor
- **Workaround:** A labelled local fixture.
- **Suggestion:** Publish versioned stream fixtures and an end-to-end tutorial from a device event to a consent-based action.

---

## Built with

Enter these one at a time (25 tags):

```
typescript
node.js
express
model-context-protocol
mcp-apps
alexa+
agent-skills
amazon-bedrock
amazon-nova
amazon-titan
strands-agents
amazon-bedrock-agentcore
amazon-ec2
aws-graviton
amazon-cloudfront
amazon-cloudwatch
aws-systems-manager
postgresql
pgvector
rust
webassembly
ring-partner-api
bee
login-with-amazon
python
```

## "Try it out" links

Add each with **Add another link**:

```
https://d3cxpkmhl89rw9.cloudfront.net/app/
https://github.com/rairurairu/amazon-pair-up
https://github.com/rairurairu/pairing-core
```

## Image gallery

Upload `docs/submission/gallery/1.png` to `9.png` in order (1500×1000, 3:2). Captions:

1. Say it once, PairUp finds your pair
2. A complete deal in two sentences
3. An open rule sets every price
4. Errands and jobs, scheduled right
5. Safe hand-offs with Ring
6. Requests ready before you ask
7. MCP server for Alexa+ on AWS
8. Live board of every deal
9. Impact and what comes next

Sources: `slides.html` (render with `render-slides.sh`).

## Video demo link

```
https://youtu.be/Q_CK5EL0stY
```
