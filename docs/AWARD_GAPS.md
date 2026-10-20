# Award gap analysis (2026-10-19)

Sources: the Devpost overview, Official Rules, Resources, Updates, FAQs and
Discussions (organizer answers by Emerson Sklar), and the Alexa+ MCP Toolkit
docs and design guide. Team: you + Claude. Deadline Fri Oct 23 12:00 PDT
(Sat 03:00 HKT); our target is Fri 21:00 HKT.

## What we can win

A project wins at most **one track prize and one mini-challenge prize**, and
can be entered in several of each.

| Prize | Value | Our entry |
|---|---|---|
| Alexa+ 1st / 2nd / 3rd | $25k + $15k credits / $15k + $5k / $4k + $1k | Primary track |
| AWS Builder | $5k + $5k credits | Enter |
| Open Source | $5k + $5k credits | Enter (needs a separate repo or contribution) |
| Bee 1st / 2nd | $12k / $8k | Second track only with a real Bee device |

Judging: stage 1 is pass/fail on rules and required tech. Stage 2 scores four
**equally weighted** criteria; ties go to **Tech Implementation** first. The
friction log adds up to **10%** to the final score. Judges may score from the
text, images and video alone, so the video and description carry most of the weight.

## Facts that change the plan

1. **Real Alexa+ is out of reach.** The MCP Toolkit, `alexa-ai` CLI and web
   simulator are partner-only (FAQ; forum 45262, 45256, 45397). ALEXA_SETUP.md
   Step 0 cannot succeed. The accepted path is **a web page that is a real MCP
   client** (initialize, tools/list, tools/call over Streamable HTTP).
2. **Polish wins.** "A polished demo with a nice UI that could reasonably work
   through an Echo device will likely score higher than plain text calls in the
   Claude MCP inspector" (forum, Questions about the rules). Alexa+ is
   "voice-first, multimodal"; users expect rich visuals on screen devices (45397).
3. **The hosted endpoint must stay live through Nov 20** (forum 45411 and the
   production-live thread). The FAQ says a local repo is enough; we follow the
   stricter answer. Lambda is the organizer-suggested cheap host. A judge must
   be able to try it without pasting their own tokens.
4. **Open Source needs a separate project or contribution.** The primary repo
   does not count (forum, Ramy Magdy thread). Multiple GitHub accounts are fine.
5. **Agent Skills count in the open SKILL.md format** (forum, Questions about the rules).
6. **Creative signals named in the rules** for Alexa+: agentic workflows across
   services, state across sessions, purchasing capabilities, cards/carousels,
   **MCP Apps**, Agent Skills. For AWS Builder: **Bedrock + AgentCore + Strands**,
   agent orchestration, Claude/Kiro in the dev workflow (Claude Code on Bedrock
   counts, forum 45321). For Open Source: a meaningful feature with tests, a fix
   that unblocks others, or a new integration pattern.
7. **Alexa+ renders MCP Apps.** A tool result with `_meta.ui.resourceUri:
   "ui://…"` is drawn inline in the conversation; without it Alexa uses its
   native "hydrated" view. The design guide's patterns are List, Carousel (3–5
   items, first item within 500 ms), Card (with call-to-action buttons) and Map.
   It also asks for rich confirmation data so Alexa can send a notification and
   answer recall questions ("when is my meet-up?"), and for schemas that declare
   only what the server honours.
8. **Bedrock on new accounts can have zero quota** (forum 45416). Test Bedrock
   on our account early.

## Where we stand

| Requirement | Status | Gap |
|---|---|---|
| MCP server, spec 2025-11-25, Streamable HTTP, SDK called in code | ✅ on `main` | — |
| Surface judges can see | ✅ web app at `/app/`: MCP host, MCP Apps cards, voice, Bedrock/offline agent | Deploy it |
| Hosted endpoint live to Nov 20 | ✅ live since Oct 20: https://d3cxpkmhl89rw9.cloudfront.net/app/ (CloudFront + EC2, us-east-1) | Run the TI-84 demo there daily |
| Pairing engine, one-turn deals, output schemas | ✅ on `main` | — |
| OAuth, Origin check, container, add-on assets | ✅ on `main` | — |
| AWS Builder "documented integrations" | ✅ Bedrock live in production (Titan Text Embeddings V2; Nova Lite for intent and agent). Strands Agents + AgentCore Runtime agent built and tested (Oct 20). CloudWatch logs, metrics and alarms in the stack. AWS section drafted in SUBMISSION.md | Run `agents/agentcore/deploy.sh` and `deploy/aws/deploy.sh` (ships the CloudWatch changes) with your credentials |
| Agent Skill (SKILL.md) | ✅ `skills/amazonpairup/SKILL.md`, served at `/skills/amazonpairup/SKILL.md` (Oct 20) | — |
| Agent friendliness | ✅ server card, llms.txt, MCP prompts, `idempotency_key` on writes, request ids (Oct 20) | — |
| Seed market 150+ | ✅ 162 posts from 22 people, 30 services (Oct 20) | — |
| Open Source entry | ⚠️ `pairing-core` built and used by the server (separate local repo, next to this one) | Create the public GitHub repo and push before submitting |
| Friction log | ⚠️ 4 entries (AWS CLI under Git Bash, DLM validation, two AgentCore SDK entries) | Keep recording as they happen |
| Product feedback per tool | ⚠️ Drafts for MCP SDK, Bedrock, Strands, AgentCore, AWS hosting in SUBMISSION.md | Check them against your own experience and edit |
| Video under 3 min | ❌ | Record Thu |
| Bee | ❌ no device known | Roadmap line unless you have a device |

## Gaps by judging criterion

**Tech Implementation** (tie-breaker)
- Done: `outputSchema` and full annotations on every tool; every declared input
  honoured (`needed_by` stops pairing, `availability` reaches the deal); deal
  results carry counterpart, meet-up place and time, savings and who still has to
  say yes; relevance gate (TI-84 0.96 vs non-graphing Casio 0.60); one hold per
  post, claimed atomically; decline re-pairs both sides.
- Done: MCP Apps view `ui://amazonpairup/market.html` on every UI tool (definition and result `_meta`), rendered by the web app; confirm guard on the agent.
- Done for production use: offers expire after `DEAL_HOLD_HOURS` and both posts
  re-pair (also on a background timer); users list and withdraw their posts;
  one offer below the asking price per buyer and listing (budgets can't be
  stepped toward the seller's minimum); per-user posting limits and per-caller HTTP
  rate limits; bounded inputs; token-protected dashboard; field-by-field
  validation of Bedrock output with a local fallback; unexpected errors still
  return a spoken sentence; CI on every push.

**Design**
- The two-sided flow on screen: two simulated devices (seller and buyer) side by
  side, live pairing, a confirm button on the card, a spoken reply.
- Voice in and out (Web Speech API), with typing as a fallback.
- Seller gets told when a buyer is paired; status and recall work by voice.

**Potential Impact**
- One market for things and services (Oct 20): errands and delivery ("find
  someone to pick up my lunch", fee to the person who walks) and one-time jobs
  ("a helper for Saturday 2-6pm, $10 an hour") run on the same pairing,
  private-limit negotiation and two-sided yes. This widens the market from
  occasional resale to daily needs, which is the strongest growth story.
- A specific first audience (HKUST campus), why voice removes the friction, and
  how it grows (neighbourhoods, then any Alexa+ household).
- Real evidence: a short classmate poll or interviews. Use only real numbers.
- Trust and safety story: private limits, public meet-up spots, deal records,
  both sides confirm, and a price check that questions a $1 iPhone before it is
  posted and warns the buyer if it is confirmed anyway (Oct 20).

**Quality of the Idea**
- No agent haggling: one deterministic rule settles every deal inside private
  limits, and the seller's minimum never shows through the price (Oct 20). Buy
  requests wait across sessions until a seller appears, which matches the rules'
  "agentic workflow" and "state across sessions" examples.
- A market that learns: a ranking model trained nightly on which deals closed,
  promoted only when it ranks recent outcomes better, with a 10% live control
  and automatic rollback (Oct 20). `npm run simulate` shows it day by day.
- An Agent Skill (SKILL.md) that teaches any agent host how to use AmazonPairUp.
- MCP Apps as above.

## Redesign: where the pairing idea needs it

Each change makes the C2C pairing idea stronger on a judging criterion.
Everything else stays as it is.

### 1. Symmetric pairing engine (Idea, Tech)
Listings and buy requests are both standing posts. Whenever either side
posts, the engine pairs it with the best counterpart and opens a negotiation.
Posts that find no match wait, and get paired when a counterpart arrives in a
later session. Today pairing starts only from the buyer, with a seller-side
patch on a branch; one engine replaces both paths.

### 2. Negotiation core in Rust, published as the Open Source entry (Tech, Open Source)
The private-limit negotiation and the redaction rules move into a Rust crate
(`pairing-core`): deterministic settlement inside both limits, multi-quantity,
and property tests showing that no output reveals a counterparty's limit. It
compiles to WebAssembly, and the TypeScript server calls it. The crate lives in
its own MIT repo, which makes it a separate, tested project that our primary
entry uses. The MCP server stays in TypeScript, the reference SDK for
2025-11-25 and MCP Apps.

### 3. Fewer voice turns (Design)
A buyer's request returns a proposed deal in the same turn: post → pair →
negotiate → "Got a TI-84 for $17, confirm?". `find_matches` and `negotiate`
remain available for browsing ("show me other options"). The seller hears about
the pairing through the result data Alexa uses for notifications, and confirms
by voice when `auto_accept` is off.

### 4. MCP Apps cards (Design, Idea, Tech)
`ui://` resources render a pairing card (item, agreed price, savings, meet-up,
Confirm and Decline buttons) and a carousel of 3–5 alternatives. Hosts without
MCP Apps get the same data through `structuredContent`.

### 5. Honest, rich schemas (Tech)
`outputSchema` on every tool. Every declared input is honoured: `needed_by`
filters by deadline, and unused fields are removed. Results carry what Alexa
needs for notifications and recall questions: counterpart display name, place,
time, deal ID, savings.

### 6. Demo surface (Design, stage 1)
A web page that is a real MCP client over Streamable HTTP: two Echo Show–sized
devices (seller and buyer) side by side, voice in and out, and MCP Apps
rendering. A Bedrock agent built on the Strands SDK drives the conversation,
with a scripted mode for running without AWS.

### 7. AWS pipeline (AWS Builder)
Bedrock (Titan embeddings, intent extraction, the Strands agent), the MCP
server on AgentCore Runtime or Lambda, kept live through Nov 20, and Claude
Code on Bedrock documented as the development workflow if we use it.

## Plan

| Day (HKT) | Claude | You |
|---|---|---|
| **Mon 19** | ✅ Merge branches; pairing engine; one-turn buyer flow; honest, rich schemas | Confirm Bedrock access and quotas in your AWS account; note any friction |
| **Tue 20** | ✅ `pairing-core` Rust crate + WASM, wired into the server; web app and MCP Apps cards | Start a classmate poll |
| **Wed 21** | Two-device demo page with the Strands agent; deploy to AWS (Lambda or AgentCore Runtime); Agent Skill; CI; seed data 150+ | Deployment credentials; friction entries |
| **Thu 22** | Fixes; README, description, AWS section and feedback drafts; video script | **Record the video** (feature freeze 12:00) |
| **Fri 23** | Final checks of the deployed URL | Upload the video; fill in the Devpost form; submit by 21:00 |

Human-only steps: AWS account and Bedrock access, the Devpost form, the
video recording and voice-over, GitHub repo visibility, and any Bee device.

## Lifestyle implementation (local)

| Capability | State | Human step |
|---|---|---|
| Bee context and replay | Implemented; demo data labelled | Validate a real Bee device before choosing its track |
| Watch and Siri Shortcut | Browser view, device management and guide implemented | Test the Shortcut on a paired Watch |
| Routine suggestions | For you, acceptance, dismissal and forget implemented | Record the demo |
