# Devpost "Additional info" answers

Copy each box into the field with the same name. The fields marked done were filled on October 21.

| Field | Answer |
|---|---|
| Upload a File (optional) | Skip, or upload `research/PairUp-Business-Case.pdf` |
| Submitter Type | Team if a teammate is listed on Manage team, otherwise Individual |
| Organization Name | `N/A` (done) |
| Country of Residence | Hong Kong (done) |
| Canada province | `N/A` (done) |
| Primary Track(s) | Alexa+ only (done) |
| Code repository URL | `https://github.com/rairurairu/amazon-pair-up` |
| New or existing before August 31, 2026 | New (done) |
| Existing-project explanation | Leave blank |
| AWS Builder Mini Challenge | Yes |
| Open Source Mini Challenge | Yes |
| Open Source: Contribution URL | `https://github.com/rairurairu/pairing-core/commits/main` (done) |
| Open Source: Project Repository URL | `https://github.com/rairurairu/pairing-core` |
| Open Source: GitHub Username | `rairurairu` (done) |
| Friction Log (URL field) | `https://github.com/rairurairu/amazon-pair-up/blob/main/docs/FRICTION_LOG.md` |
| Project Testing Link | `https://d3cxpkmhl89rw9.cloudfront.net/app/` |

---

## AWS Builder: Which AWS services did you incorporate and how?

```text
PairUp runs on AWS end to end. Every integration below is in the public repo (MIT) and documented in README.md, docs/EVIDENCE.md and docs/PRODUCT_FEEDBACK.md.

1. Amazon Bedrock - Nova Lite (Converse API): reads each spoken request, extracts intent (item, errand or job; budget; time; place) and selects the MCP tool to call. Output is schema-validated, and a server-side guard means no deal is confirmed without the person's explicit yes. Code: src/ai/bedrock.ts, src/agent/bedrock.ts. Live check (Oct 20): intent extraction 1.3 s, budget 18 parsed correctly, tool selection returned post_offer.

2. Amazon Bedrock - Titan Text Embeddings V2: 1024-dimension embeddings for every offer, request and reference price, stored in PostgreSQL with pgvector. Hybrid matching combines vector similarity with full-text search after hard constraints (kind, condition, quantity, currency, availability). Live check: 1024 dimensions returned.

3. Strands Agents SDK: a separate MCP-connected agent (agents/agentcore/) uses the same PairUp tools. Its hooks require the user's yes before any confirmation and add idempotency keys to every write. Four scripted conversations pass.

4. Amazon Bedrock AgentCore Runtime: the Strands agent is packaged for ARM64 and deployed to AgentCore Runtime. Version 2 reached READY and a real hosted invocation passed on Oct 20 (4/4 AgentCore tests).

5. Amazon CloudFront + Amazon EC2 (Graviton, ARM64): public HTTPS for the web app and the MCP endpoint (https://d3cxpkmhl89rw9.cloudfront.net/mcp), with an origin secret so only CloudFront reaches the instance, and IAM role credentials for Bedrock (no keys on disk).

6. AWS Systems Manager, Parameter Store and Amazon S3: scripted deployment through SSM send-command, secrets in Parameter Store, release artifacts in S3. npm run check:release proves the public endpoint runs the exact submitted commit (9/9 checks).

7. Amazon CloudWatch, Amazon SNS and encrypted Amazon EBS snapshots (Data Lifecycle Manager): request and tool-call metrics, log shipping, four alarms (all OK), and daily encrypted snapshots for recovery. Infrastructure is defined in CloudFormation (deploy/aws/amazonpairup.yaml).

Why it matters: Bedrock handles understanding people, while matching, pricing, scheduling and consent stay in deterministic code. That makes every deal both conversational and auditable.
```

## Open Source: description of what you did, how it works, and why it matters

```text
What we did: we created pairing-core, a new MIT-licensed open-source project, during the hackathon (repo created October 20, 2026). It is a dependency-free Rust library that settles a price between two people's private limits, compiled to a ~1 KB WebAssembly module for JavaScript. It ships with exhaustive invariant tests, shared JavaScript test vectors, an MCP server example, a walk-away example and CI (MSRV check, WASM rebuild, JS vectors). Key commits: "Settle at the ask or the buyer's offer, so a deal can't reveal the minimum" and "Add an MCP server example, a walk-away example, and full CI".

How it works: each person delegates a limit once. The seller sets an ask and a private minimum; the buyer sets a maximum. settle() returns Deal { price = min(ask, buyer_max) } when that reaches the seller's minimum, otherwise NoDeal, which carries no data at all. All amounts are integer cents, so the same inputs always give the same price on every runtime. The seller's minimum only decides whether a deal happens and never shows through the price, and an optional floor (the best price this buyer already walked away from) stops a buyer from stepping their budget down to discover the minimum.

Why it matters: voice assistants and AI agents are starting to buy and sell for people. Agents haggling turn by turn cost model calls and time, are hard to audit, and can be swayed (a "desperate" AI negotiator gains about 20%, Bianchi et al., ICML 2024). pairing-core replaces haggling with one auditable rule that keeps both private limits private. Any agent host can reuse it: PairUp, our Alexa+ MCP marketplace (https://github.com/rairurairu/amazon-pair-up), calls it for every deal.
```

## [Optional] Feature Requests

```text
1. Ring Playground - a presence/webhook test sender with an HMAC signing example and a matching Event History record. Why: developers could rehearse a complete arrival flow (doorbell press -> webhook -> Event History) without a physical doorbell; today it takes three separate setups. Priority: Important

2. MCP Apps (ext-apps) - a configurable host initialization timeout, cleanup and an accessible fallback in the official host sample. Why: a failed embedded view can otherwise leave an Alexa+ card in a loading state forever; every host has to write its own recovery. Priority: Important

3. Bee CLI / Bee Skill - versioned JSON stream fixtures and an end-to-end tutorial from a device event to a consent-based downstream action. Why: makes education and productivity workflows reproducible in tests while keeping real device provenance clear. Priority: Important

4. Amazon Devices Builder Tools - "exec --schema <tool>", a complete schema-valid search example in --help, and the project-context prerequisite reported up front. Why: removes several avoidable retries on the very first documentation search. Priority: Important

5. Bedrock AgentCore Runtime / Strands Agents - a compile-tested streaming quick start for the current Strands event shape, plus a one-line local invocation command (Accept and session-id headers). Why: gets developers from install to visible agent text without debugging wrappers and headers. Priority: Important

6. Amazon Bedrock starters - telemetry that separates real model success, offline fallback and deterministic tool-result replies. Why: reliable deployment evidence and production diagnostics. Priority: Important

7. CloudFormation / Data Lifecycle Manager - validate the description pattern at changeset time and show the allowed pattern in the error. Why: avoids a full stack rollback (and manual delete) over one comma. Priority: Nice-to-have

8. AWS CLI docs - a Windows Git Bash recipe for SSM and Parameter Store (MSYS path conversion and temp files). Why: makes deployment scripts portable across macOS, Linux and Windows. Priority: Nice-to-have
```

## Product feedback (if the form has a box for it)

```text
Product feedback for every tool we used: what we used it for / what worked / what needs work / onboarding / build again?

MCP TypeScript SDK - Streamable HTTP tools, sessions, elicitation, OAuth. Worked: typed schemas; in-memory and HTTP clients share one test suite. Needs work: a strict current-spec mode (2025-11-25 still accepts legacy JSON-RPC batches). Onboarding: initialize, tools/list, SSE, DELETE and Origin checks passed quickly. Again: yes, one contract serves Alexa+ and every other agent.

MCP Apps (ext-apps) - embedded deal cards. Worked: sandboxed views with structured data and auto-resize. Needs work: documented initialization timeout and cleanup. Onboarding: the official App Skill plus a local card walkthrough. Again: yes, one approval card for many hosts.

Agent Skills - PairUp instructions for any agent. Worked: a small Markdown package teaches consent, private limits and retries. Needs work: clearer distribution and discovery conventions. Again: yes.

Amazon Devices Builder Tools MCP 1.0.17 - documentation search. Worked: returned the right Ring and Alexa+ pages. Needs work: the CLI hides the search schema and the project-context prerequisite. Again: yes.

Ring Partner API and webhooks - arrival confirmation at PairUp Points. Worked: JSON:API Event History and HMAC webhooks map cleanly to presence records. Needs work: one recipe covering pagination, token expiry and throttling together. Onboarding: protocol, signature, dedupe and stale-event tests pass. Again: yes, a concrete arrival signal.

Ring Playground, ring-api-helloworld and Ring UX guide. Worked: easy device discovery; plain-language state patterns we applied to our point panel. Needs work: a unified presence-event and webhook simulation. Again: yes.

Bee CLI, developer API, Bee Skill and MCP - context to prepared requests. Worked: documented event shapes match our bridge. Needs work: published stream fixtures and a consent-based action example. Again: yes, it connects education context to a useful action.

Amazon Bedrock Titan Text Embeddings V2 - retrieval. Worked: one adapter feeds hybrid pgvector search; live call returned 1024 dimensions in 1.5 s. Needs work: per-model quota and region guidance. Again: yes.

Amazon Bedrock Nova Lite (Converse) - intent and tool selection. Worked: structured tool calls fit our server-side consent checks; live intent and tool-use checks passed. Needs work: fallback provenance in starter examples. Again: yes.

Strands Agents SDK - an independent MCP agent. Worked: tool discovery and hooks reuse our marketplace rules; four scripted conversations pass. Needs work: the published streaming example uses an outdated event shape. Again: yes.

Amazon Bedrock AgentCore Runtime - hosting that agent. Worked: validated requests and real hosted streaming; version 2 READY and a live invocation passed. Needs work: the README should show the local Accept and session-id headers. Again: yes.

AWS hosting (CloudFormation, EC2 Graviton, CloudFront, SSM, Parameter Store, S3, CloudWatch, SNS, EBS/DLM). Worked: repeatable stacks, role credentials, origin protection, alarms and snapshots; v0.8.0 deployed with 4 alarms OK. Needs work: DLM validation at changeset time; Windows Git Bash notes for the CLI. Again: yes.

Login with Amazon - identity for MCP OAuth 2.1. Worked: PKCE, rotating tokens and subject-bound sessions, all tested. Needs work: a complete multi-client MCP walkthrough. Again: yes.
```

---

## Testing instructions or credentials the judges need

```text
Live app: https://d3cxpkmhl89rw9.cloudfront.net/app/ (works in Chrome, Edge or Safari; the mic button uses the browser's speech recognition, and typing works everywhere).

Sign in: click "Sign in", then use "Demo sign-in for judges". Pick any name and any passcode; the first sign-in creates that account, and the same pair brings you back to your posts and deals. No shared credentials are needed.

Try a complete deal (2 minutes). Use two windows so you play both sides, for example a normal window and a private/incognito window:
1. Window A, sign in as "Sam": say or type "Sell my TI-84 for $20. I'll take anything above $15." The listing card shows your $15 minimum as private.
2. Window B, sign in as "Mei": "I need a graphing calculator in good condition near UW campus today, max $18." PairUp proposes the TI-84 at $18 with a campus meeting point. Press "Confirm $18".
3. Window A: open Deals. The deal is confirmed at $18 and the $15 minimum was never shown.

More to try:
- Errands: "Find someone to pick up my lunch from the HUB to McCarty Hall by 12:30, $5"
- Jobs: "Get me a helper for the event on Saturday 2-6pm, $10 an hour" (shows the $40 total and the date in Pacific time)
- A Ring PairUp Point: on a deal card choose "Meet at a PairUp Point"

Connect your own MCP client: https://d3cxpkmhl89rw9.cloudfront.net/mcp (MCP 2025-11-25, Streamable HTTP, OAuth 2.1 with discovery).

Run it locally with no database or AWS account (2 minutes): git clone https://github.com/rairurairu/amazon-pair-up, then cd amazon-pair-up, npm install, npm start, and open http://127.0.0.1:3000/app/. Tests: npm test.

Demo data: the seed market, reference prices and Amazon Hub / PairUp Point locations are labelled demo data. Ring arrivals in the demo come from simulated Ring events. The hosted app stays available through November 20, 2026.
```

## Feedback Question 1: Which developer tools, APIs, and SDKs did you use and for what?

```text
Alexa+ / MCP
- MCP TypeScript SDK (@modelcontextprotocol/sdk): our self-hosted PairUp MCP server (spec 2025-11-25, Streamable HTTP) with typed tools such as post_offer, post_request, find_matches, confirm_deal, check_in_at_point and get_suggestions, plus sessions, elicitation and OAuth 2.1.
- MCP Apps (@modelcontextprotocol/ext-apps): the deal cards Alexa+ and other hosts render (price, place, time, whose yes is next).
- Agent Skills format: skills/pairup/SKILL.md teaches any agent PairUp's consent rules, private limits and retries.
- Amazon Devices Builder Tools MCP: searching the official Alexa+ and Ring documentation while building.
- Login with Amazon: identity behind the server's OAuth 2.1 sign-in.

Ring
- Ring Partner API (Event History, devices) and Ring webhooks (HMAC-signed): confirming that both people arrived at a PairUp Point, a hand-off spot watched by one Ring doorbell.
- Ring Playground, ring-api-helloworld and the Ring UX guide: reference, simulation and the arrival-state design.

Bee
- Bee CLI, developer API, Bee Skill and MCP: turning a captured need ("need a graphing calculator before the exam") into a prepared request that waits for approval.

AWS
- Amazon Bedrock Nova Lite (Converse API): intent extraction and tool selection.
- Amazon Bedrock Titan Text Embeddings V2: 1024-d vectors for hybrid matching with pgvector.
- Strands Agents SDK: a second, independent agent that uses the same MCP tools.
- Amazon Bedrock AgentCore Runtime: hosting that agent (ARM64).
- CloudFormation, EC2 Graviton, CloudFront, Systems Manager, Parameter Store, S3, CloudWatch, SNS, EBS snapshots (DLM): production hosting, deployment, secrets, monitoring and recovery.

Other: PostgreSQL + pgvector (PGlite locally), Node.js, TypeScript, Express, Zod, esbuild, and pairing-core (our own Rust/WebAssembly price library, MIT).
```

## Feedback Question 2: For each tool, what worked well?

```text
- MCP TypeScript SDK: typed Zod schemas and the in-memory client let one test suite cover every tool; Streamable HTTP sessions, SSE and Origin checks worked as specified.
- MCP Apps: sandboxed views with structured data and auto-resize rendered our cards cleanly; one card works in our web host and any MCP Apps host.
- Agent Skills: a single small Markdown file was enough to teach agents the consent and private-limit rules; validation was simple.
- Amazon Devices Builder Tools: once called correctly, search returned exactly the right Ring and Alexa+ pages.
- Login with Amazon: PKCE, rotating tokens and subject-bound sessions fit MCP OAuth 2.1 cleanly and were easy to test.
- Ring Partner API and webhooks: JSON:API Event History and raw-body HMAC signatures map directly to presence records; verification was straightforward.
- Ring UX guide: its plain-language states and accessibility patterns shaped our arrival panel ("on the way", "checked in", "Both here").
- Bee CLI / Skill: documented event shapes matched our bridge exactly; the Skill maps commands to concrete needs.
- Bedrock Titan V2: one adapter, reliable 1024-d vectors (about 1.5 s live), good semantic matches for hard-to-describe posts.
- Bedrock Nova Lite (Converse): structured tool calls integrate cleanly with server-side checks; budget and intent extraction were accurate in our live checks.
- Strands Agents: tool discovery over MCP and hooks let the second agent reuse our marketplace rules with little code.
- AgentCore Runtime: validated requests, managed sessions and real hosted streaming; deployment to a READY version was smooth.
- AWS hosting: CloudFormation made the stack repeatable; Graviton, CloudFront origin protection, IAM roles, SSM deployment and CloudWatch alarms all worked reliably.
```

## Feedback Question 3: For each tool, what needs work?

```text
- MCP TypeScript SDK: a 2025-11-25 endpoint still accepts legacy JSON-RPC batches; we added our own guard (400 / -32600). A strict mode tied to the negotiated version would help.
- MCP Apps: no built-in initialization timeout or cleanup; a failed view can stay in a loading state, so every host writes its own timeout and fallback (ours is 8 seconds).
- Agent Skills: distribution and discovery conventions are unclear.
- Amazon Devices Builder Tools: "exec --list" hides the search schema and the PROJECT_CONTEXT_REQUIRED prerequisite; our first two calls failed validation. Needs "exec --schema" and a full example in --help.
- Ring: no single simulator workflow covers Event History and webhooks; the Playground has no webhook sender with an HMAC key, so a full arrival test needs three setups. One recipe for pagination, token expiry and throttling together would help.
- Bee: no published stream fixtures or end-to-end consent example, so tests need hand-made data.
- Bedrock: starters don't distinguish real model success from offline fallback; per-model quota and region guidance is thin.
- Strands Agents: the published streaming example uses an older event shape; with SDK 1.21 it fails to compile (TS2367) and in JavaScript yields no text.
- AgentCore Runtime: local calls fail with 406 (missing Accept: text/event-stream) and 400 (missing session id); neither header is in the README.
- CloudFormation / DLM: an invalid description character is caught only after resources are created, rolling the whole stack back to ROLLBACK_COMPLETE; the error doesn't name the pattern.
- AWS CLI on Windows: Git Bash silently rewrites "/amazonpairup/..." parameter names and /tmp paths; needs a documented recipe.
Full entries with steps, severity, workaround and suggestion: https://github.com/rairurairu/amazon-pair-up/blob/main/docs/FRICTION_LOG.md
```

## Feedback Question 4: For each tool, how was your onboarding experience?

```text
- MCP TypeScript SDK: fast to a working server with tools/list over Streamable HTTP; transport conformance tests took longer.
- MCP Apps: good with the official App Skill; the first card rendered the same day, with extra work for host failure handling.
- Agent Skills: very fast; a validated skill in minutes.
- Amazon Devices Builder Tools: npm install and the stdio MCP connection worked first time; the first useful search needed schema inspection and an explicit empty project context.
- Login with Amazon: a clear OAuth model; registering the security profile and return URL is the main manual step.
- Ring Partner API: a clear reference and starter app made device discovery quick. Rehearsing a full arrival without a doorbell took longest, because Playground, Event History and webhooks are set up separately.
- Bee: the CLI README and Skill made the event format clear quickly; reaching a useful action without fixture data took extra effort.
- Bedrock Titan and Nova: quick once model access was enabled in the region; the first embedding and first tool call came the same day.
- Strands Agents: quick to a working MCP-connected agent; the streaming quick start needed a fix for the current event shape.
- AgentCore Runtime: deployment was smooth; local testing needed two undocumented headers.
- AWS hosting: CloudFormation, EC2 and CloudFront were straightforward; one DLM validation rollback and Windows Git Bash path issues cost time, both now handled in our scripts.
```

## Feedback Question 5: Would you build with these devices and services again?

```text
Yes. MCP gave us one server that works for Alexa+, a browser host, a Strands agent on AgentCore and any other MCP client, which is the right foundation for an assistant that acts for people. Bedrock let us use models for understanding while keeping prices, schedules and consent in deterministic code. Ring turned a real C2C problem, a safe hand-off between strangers, into a privacy-preserving signal (event type and time only), and Bee showed how context can prepare a request before someone asks. Every fix we want is small and specific (see our feature requests), and we plan to take PairUp to an observed pilot with University of Washington students on this same stack.
```

## Eligibility checkboxes

Tick these yourself only if each is true for you and every teammate: age of majority, eligible jurisdiction, and not employees or agents of the sponsors.

## Which AI tools have you leveraged while working on this project?

```text
- Claude Code (Anthropic Claude models): pair-programming across the codebase, tests, design system, documentation, research and the submission materials.
- OpenAI Codex: code and documentation audits, release checks and parts of the Ring, Bee and transport work (attributed in the friction log and git history).
- Amazon Bedrock (Nova Lite, Titan Text Embeddings V2) and a Strands agent on AgentCore: AI inside the product itself, for intent extraction, tool selection and semantic matching.
- Video production: Microsoft Edge neural text-to-speech voices for narration and faster-whisper (local Whisper) to check the narration; the music is synthesized by our own code from a public-domain score.
```
