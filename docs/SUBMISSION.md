# PairUp submission package

Primary track: **Alexa+**. Mini challenges: **AWS Builder** and **Open Source**.
Deadline: October 23, 2026, 12:00 PDT.

## Description for Devpost

### Inspiration
A student at the University of Washington needs a graphing calculator for tomorrow's exam. Someone in the next dorm has one in a drawer. Finding each other today means a listing, a group-chat thread, a round of haggling and a meet-up to arrange. Small errands work the same way: carrying a $5 lunch from the HUB to McCarty Hall is a two-minute walk, and arranging it takes longer than doing it.

PairUp lets people just say what they need, what they have or what they can do. It starts on the UW campus in Seattle. Requests stay open, so the right person can turn up an hour or a day later.

Our three goals: **faster and cheaper to buy what you need, make personal business great, and C2C in the future.**

### What it does
A seller says, “Sell my TI-84 for $20. I'll take anything above $15.” A buyer says, “I need a graphing calculator today, max $18.” PairUp proposes the TI-84 at $18, names an Amazon Hub Counter on campus for the hand-off, and asks the buyer for a yes. The seller's minimum stays private and the buyer's budget becomes their offer.

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
- Add the contributing GitHub username and the hackathon-period commit or PR URL in the Devpost form.

## Product feedback notes (Tony: confirm against your own experience)

| Tool | What worked | Feedback | Onboarding and future use |
|---|---|---|---|
| MCP TypeScript SDK and MCP Apps | Tool schemas, in-memory transport tests and a portable sandboxed card | Hosts would benefit from a standard timeout path when an embedded view never initializes, and shared conventions for retry keys and discovery | Local setup is documented and tested; we keep building on the same contract |
| Amazon Bedrock | Embeddings and Converse tool use fit behind one AI interface | A local fallback covers intent and agent calls; embeddings need the service, so quota guidance per model would help | Offline mode lets contributors start without AWS |
| Strands Agents TypeScript | MCP discovery and before-tool hooks carry the same authorization rules | The stream-event example needed a wrapper-shape update (friction log) | The separate agent stays on Strands |
| AgentCore Runtime SDK | Runtime entry point and session/stream contract | Local invocation needed headers the README example omits (friction log) | Packaged and tested locally |
| AWS hosting tools | CloudFormation and SSM release scripts | Git Bash argument rewriting and DLM validation errors (friction log) | Deploys run from one script |
| Bee | The need-snippet interface and bridge (CLI stream, API poll, replay) | A replay format in the docs would make offline testing easier | The bridge is ready for live Bee data |

## Final submission checks

- [ ] Public repository with license and commit history.
- [ ] Current release deployed; `npm run check:release -- --url <public-origin> --revision <submitted-commit> --expect-ai bedrock --expect-auth oauth` passes.
- [ ] A real Bedrock request recorded (and an AgentCore invocation, if the video shows it).
- [ ] Judge sign-in rehearsed in a fresh browser session.
- [ ] Public English YouTube or Vimeo demo under three minutes.
- [ ] Description and per-tool feedback reviewed against your own experience.
- [ ] Open Source contribution URL, project URL and contributing username supplied.
- [ ] Friction entries included.
- [ ] Pilot results added if the UW pilot has run ([USER_VALIDATION.md](USER_VALIDATION.md)).
- [ ] Bee track entered only with real Bee-recorded data.
- [ ] Hosted endpoint kept available through judging; submitted before the deadline.
