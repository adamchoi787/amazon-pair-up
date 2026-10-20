# PairUp submission package

Lead track: **Alexa+**. Also enter **Ring**, and **Bee** when its real device-data recording is complete. Enter both **AWS Builder** and **Open Source** mini challenges. We declare multiple tracks for one coherent project; award limits remain one track prize and one mini-challenge prize. The rules explicitly request Primary Track(s): [verified requirements](HACKATHON_RULES.md).
Deadline: October 23, 2026, 12:00 PDT = October 24, 03:00 HKT.

## Description for Devpost

### Inspiration
The original idea was “Carousell for agents”: a personal agent should be able to find an item nearby and settle a deal. Building it turned that into a two-sided C2C system where a buyer's standing need is as useful as a seller's listing. The same mechanism then grew to support what people can do—lunch runs, errands and event help—and the practical hand-off, through demo Amazon Hub pickup/delivery choices and Ring-backed PairUp Points. Bee adds the moment before the request: noticing an exam-related need and preparing it for approval. The commit history below records that evolution.

A student at the University of Washington needs a graphing calculator for tomorrow's exam. Someone in the next dorm has one in a drawer. Finding each other today means a listing, a group-chat thread, a round of haggling and a meet-up to arrange. Small errands work the same way: carrying a $5 lunch from the HUB to McCarty Hall is a two-minute walk, and arranging it takes longer than doing it.

PairUp lets people just say what they need, what they have or what they can do. It starts on the UW campus in Seattle. Requests stay open, so the right person can turn up an hour or a day later.

Our three goals: **faster and cheaper to buy what you need, make personal business great, and C2C in the future.**

### What it does
A seller says, “Sell my TI-84 for $20. I'll take anything above $15.” A buyer says, “I need a graphing calculator in good condition near UW campus today, max $18.” PairUp proposes the TI-84 at $18, names a demo Amazon Hub Counter on campus for the hand-off, and asks the buyer for a yes. The seller's minimum stays private and the buyer's budget becomes their offer.

The same conversation books help. “Find someone to pick up my lunch from the HUB to McCarty Hall by 12:30, $5” reaches a student already doing lunch runs. “Get me a helper for the event on Saturday 2-6pm, $10 an hour” shows the rate, the $40 total, the date in Pacific time and whose yes is still needed. PairUp checks the whole work window against each helper's stated hours and keeps one person's bookings from overlapping. When a helper's hours are open-ended, the card marks the time as tentative and the helper approves it directly.

PairUp also learns your routines. After three weeks of weekday lunch runs, it offers the next one shortly before noon. A Bee to-do or an iPhone arrival at McCarty Hall can prepare a request too. Every suggestion waits for a yes.

People can recall their deals, choose another option, decline, withdraw a post, rate the other side, report a problem or erase their data. Payment happens directly between the two people at hand-off.

### How we built it
PairUp is a self-hosted MCP server (protocol 2025-11-25, Streamable HTTP). The web app is a full MCP host: it discovers the tools, calls them as the signed-in user, renders sandboxed MCP Apps cards and plays the Alexa+ conversation by voice in any browser. Any MCP client can connect through OAuth 2.1 with Login with Amazon.

Matching combines pgvector semantic search with PostgreSQL full-text search, after hard constraints on kind, condition, quantity, currency and availability. Prices come from [pairing-core](https://github.com/rairurairu/pairing-core), our Rust library compiled to WebAssembly, which settles every deal with one fixed rule in integer cents. Database transactions make holds and simultaneous confirmations safe. Availability uses a deterministic schedule grammar with an IANA time zone per post.

Amazon Bedrock runs Titan embeddings for retrieval and Nova Lite for intent extraction and tool use. A separate Strands agent uses the same MCP tools and is packaged for Bedrock AgentCore Runtime. The service runs on CloudFront, EC2 Graviton, Systems Manager, Parameter Store, encrypted EBS snapshots and CloudWatch. `npm run check:release` confirms that the public endpoint runs the submitted commit.

### What makes it different
Requests are standing posts, and matching runs whenever either side posts. Agents interpret and coordinate; code sets every price and checks every schedule. Each deal ends with an explicit yes from both people. The tool surface, Agent Skill, server card and llms.txt let any agent use PairUp safely without custom wiring.

### Impact
**Faster and cheaper to buy what you need.** Resale sites keep 13–20% of a sale, and delivery apps add markups and fees to a $5 errand. On PairUp, a $20 TI-84 sells for $18 the same day, and the seller keeps all $18. A lunch run costs the counter price plus the $4 the requester offered, and the student who walks keeps the $4.

**Make personal business great.** 72.9 million Americans already earn independently (MBO Partners 2025), and 30% of adults under 30 have done gig work (Pew). On PairUp, opening a small business takes one sentence. The seller sets the price, receives all of it, and builds a track record. Learned routines bring regular customers back.

**C2C in the future.** Personal agents will buy and sell for people. AI negotiators are easy to sway: one that acts desperate gains about 20% (Bianchi et al., ICML 2024). PairUp gives agents one place to meet, where any MCP agent connects, an open-source rule sets every price, and every deal ends with a human yes.

**Scale.** The average US household holds $3,000–4,000 of resellable items (eBay Recommerce Report 2026). US secondhand apparel alone is projected to reach $74 billion by 2029 (ThredUp). 80% of discarded furniture goes to landfill (EPA). Our model for UW Seattle (52,316 students, 10% using it twice a month at $15) gives about $1.9 million a year in exchanges between students. Sources, inputs and the research papers behind them: [research/](../research/README.md).

### Status
The test suite covers matching, pricing, privacy, scheduling, OAuth, MCP transport and scripted agent conversations. The seed market, reference prices and Hub locations are labelled demo data, and the learning experiment runs on a simulated market. Next is an observed pilot with UW students ([USER_VALIDATION.md](USER_VALIDATION.md)).

### What's next
Run the UW pilot, measure task success and points of confusion, then open the next Seattle campuses and neighborhoods. Connect the Amazon Hub locator and live retail prices in place of the demo lists.

### Built during the hackathon

The checked-in application history begins October 18, 2026, inside the August 31–October 23 submission window. All milestones below are in that history. “Carousell for agents” is the founder's description of the original idea; the commits establish the implementation changes.

| Milestone | Commit evidence |
|---|---|
| First Alexa+ marketplace MCP | `51ed52f` — October 18, initial VoiceMarket scaffold |
| Symmetric C2C pairing from either side | `d582278`, `9ce7f8e`, `8a41971` — October 19 |
| Auditable shared price rule and browser MCP host | `75a68f8`, `122a7d6` — October 19 |
| Services: errands, delivery and one-time jobs | `574726a` — October 20 |
| Amazon search, Trade-In and demo Hub meetup options | `29d19ff` — October 20 |
| Bee context, learned routines and watch flow | `fe8c3dc`, `8ce80c8`, `07048a1` — October 20 |
| Scheduling, US-first UW market and release identity | `ceaeadf` — October 20 |
| Ring PairUp Points and Hub delivery workflow | `abed8b3`, `81256df`, `df22de9` — October 20 |
| Shared design and two-device rehearsal | `b2f7fa2`, `e4144a3` — October 20 |

Project source: [rairurairu/amazon-pair-up](https://github.com/rairurairu/amazon-pair-up). The final local preparation commits must be pushed before submission. PairUp models Hub delivery with labelled demo rates, locations and references; live carrier booking is a future integration.

## Track declaration answer

Alexa+ is our primary story: an MCP server and Agent Skill make a complete, consent-based C2C workflow available to a voice assistant. Ring adds a concrete hand-off: a device or official simulator supplies presence events that corroborate each person's check-in. Bee adds an education and personal-productivity entry point: an exam-related need captured through a Bee device or Bee software on Apple Watch becomes a prepared request, then waits for the student's approval. These are connected stages of the same product. We enter the supported tracks together and accept the one-track-prize limit. Both mini challenges apply to the same submission. Fire TV is outside our implementation.

## Bee track text

An exam deadline can arrive before a student thinks to search a marketplace. PairUp consumes a need snippet from the student's Bee-recorded context through the CLI, API or an agent holding Bee's Skill/MCP. `add_context` and `get_suggestions` prepare a graphing-calculator request. The student supplies a budget when needed and explicitly accepts before anything is posted. The watch preview offers a compact approval surface. This serves Bee's education and productivity priorities. The final video must show the actual Bee/device-to-useful-action interaction; the synthetic fixture remains rehearsal evidence.

## Ring track text

**PairUp Point: safe hand-offs with one Ring doorbell and no staff.** Some people would rather not meet a stranger from the internet. On PairUp they pick a PairUp Point for their deal: a small unstaffed spot near the HUB on the UW campus, watched by one Ring doorbell. Each person presses the doorbell on arrival and tells PairUp “I'm here”. PairUp reads the point's Ring Event History through the Ring Partner API, accepts signed Ring webhooks, and confirms each arrival from a doorbell press or a person event within ten minutes. When Ring has confirmed both, the deal card and both voices say “Both here. Go ahead with the hand-off.” The rule is deterministic and privacy-first: PairUp keeps only the type and time of presence events, for 24 hours. Categories: access control and IoT. Code: `src/ring/`, `src/market/points.ts`, `test/points.test.ts`.

## AWS Builder answer

- **Bedrock Titan Text Embeddings V2:** offer, request and reference-price embeddings for semantic retrieval with pgvector.
- **Bedrock Nova Lite / Converse:** intent extraction and the web assistant's tool selection, with validated output, a deterministic offline mode and explicit-approval guards.
- **Strands Agents:** a separate MCP-connected agent whose hooks require the user's yes before confirmation and add retry keys to writes.
- **AgentCore Runtime:** ARM64 runtime package and deployment scripts for that agent.
- **CloudFront + EC2 Graviton:** HTTPS app and MCP hosting, IAM role credentials and CDN origin protection.
- **SSM + Parameter Store + S3:** deployment, secret retrieval and release artifacts.
- **CloudWatch + SNS + EBS snapshots:** request and tool metrics, alarms, log shipping and recovery.

## Open Source answer

- Project and contribution history: https://github.com/rairurairu/pairing-core
- License: MIT.
- Contribution: a dependency-free Rust price-settlement library with a small WebAssembly interface, invariant tests, shared JavaScript test vectors and an MCP example. PairUp calls it for every settlement.
- Why it's useful: any agent host can settle a deal between two private limits with an auditable rule and shared test vectors. The rule is automatic best-offer acceptance; the host enforces identity and one offer below the ask per buyer and listing.
- GitHub username: **rairurairu** (verified against the public commit author).
- Contribution URL: [MCP example, walk-away example and CI](https://github.com/rairurairu/pairing-core/commit/135fe20c444e707e39cb4b8d497be623238be948), October 20, 2026; also [private-minimum settlement change](https://github.com/rairurairu/pairing-core/commit/c07c0b10082c393a7f88f1f5be25a2225cf6122a).
- This is a separate additional open-source project created/updated during the window and integrated into the primary submission. The [overview](https://amazonappdev2026.devpost.com/#requirements) explicitly allows a new additional project. Optional third-party issue/patch drafts are under [upstream/](upstream/); add their URLs only after Tony publishes them.

## Product feedback, feature requests and friction logs

Use the complete per-tool answer in [PRODUCT_FEEDBACK.md](PRODUCT_FEEDBACK.md), including what each tool was used for, what worked, what needs work, onboarding and whether we would build with it again. Include [FRICTION_LOG.md](FRICTION_LOG.md) as the optional friction answer: every entry has task, steps, expected/actual, severity, workaround and suggestion. Submit [FEATURE_REQUESTS.md](FEATURE_REQUESTS.md) with why each request matters and its priority. [RESOURCE_AUDIT.md](RESOURCE_AUDIT.md) links the official sources and records this audit's evidence. Tony reviews historical first-person observations before pasting.

## Final submission checks

- [ ] Public repository with license and commit history.
- [ ] Current release deployed; `npm run check:release -- --url <public-origin> --revision <submitted-commit> --expect-ai bedrock --expect-auth oauth` passes.
- [ ] A real Bedrock request recorded (and an AgentCore invocation, if the video shows it).
- [ ] Judge sign-in rehearsed in a fresh browser session.
- [ ] Public English YouTube or Vimeo demo under three minutes.
- [ ] Description and per-tool feedback reviewed against your own experience.
- [x] Open Source contribution URL, project URL and contributing username prepared above.
- [ ] Friction entries included.
- [ ] Pilot results added if the UW pilot has run ([USER_VALIDATION.md](USER_VALIDATION.md)).
- [ ] Bee track entered only with live data recorded through a Bee device or an Apple Watch running Bee software (the replay file and the iOS Shortcut path are demo aids).
- [ ] Ring: the integrated video shows PairUp reading the Ring Playground (or a device) and confirming both arrivals; declare Ring alongside Alexa+ in Primary Track(s).
- [ ] Hosted endpoint kept available through judging; submitted before the deadline.
