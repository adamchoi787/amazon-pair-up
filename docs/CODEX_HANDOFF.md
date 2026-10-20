# Handoff to Codex, round 2 (2026-10-20, HKT evening)

> Release follow-up: Tony subsequently authorized push, deployment and live AWS checks. `v0.8.0` at `6895b52` is pushed and deployed; AgentCore version 2 is READY. See EVIDENCE.md for the passing provenance collector and its observed spoken-answer limitation, and AWARD_GAPS.md for remaining gates. The no-push/no-AWS instructions below describe the earlier preparation scope.

> Codex follow-up: local 0.8.0 preparation is documented in VALIDATION.md and RECORDING_CHECKLIST.md. The status table records each item. No push, deploy, upstream publication or AWS runtime call was performed. Tony confirmed no Bee data source; online source research found no verified eligible dataset, so that entry remains evidence-gated.

`main` is at `aa5ff24` (PairUp 0.7.0 + PairUp Points with Ring + Amazon Hub
delivery). Typecheck is clean and `npm test` passes 155/155. The job now: land
the unmerged work, close the repo gaps, and make use of the hackathon resources
we have not touched yet (list at
https://amazonappdev2026.devpost.com/resources). Deadline: **Fri Oct 23 12:00
PDT (Sat 03:00 HKT)**; our target is **Fri 21:00 HKT**.

The rules in round 1 below still hold (main always green, no limit leaks, tool
changes update server + schemas + TOOL_CONTRACT + SKILL together, prices by the
fixed rule only, plain positive docs, no push/deploy/AWS, never edit
`vendor/pairing-core` or `src/market/negotiation.ts`, real data only). Add one:
**the reliable core flow and a clear video come first**; add an integration only
when it shows up in the video or in a judged answer.

Work in priority order. Commit each item on its own branch, merge into `main`
when it passes, and tick it in the status table at the end.

## A. Repo gaps

1. **Merge the design pass** `claude/lucid-lichterman-f00e30` (`439d6e0`,
   worktree `.claude/worktrees/lucid-lichterman-f00e30`). It is committed but
   not on `main`: one token system (`src/design/tokens.json`,
   `public/design/tokens.css`, `src/design/icons.ts`), brand, motion, a calmer
   assistant, restyled app, dashboard, watch and MCP Apps card,
   `docs/DESIGN.md`, `test/design.test.ts`. It branched from 0.7.0, before Ring
   and delivery, so expect conflicts in `src/apps/view.ts`, `src/apps/view.css`,
   `src/web/main.ts`, `public/app/index.html`. Keep both sides: the PairUp Point
   panel, arrival chips, "I'm here" and the delivery toggle restyled with the
   new tokens. Rebuild bundles (`npm run build:web`), commit `public/`.
2. **Two-device demo page.** `claude/mystifying-kapitsa-908773` adds
   `public/app/demo.html` (buyer and seller side by side), which suits the video.
   The branch predates the rename and 0.7.0: port only `demo.html` and the
   small `src/web/*` pieces it needs, use the PairUp name, the UW seed users and
   the token CSS. Leave the rest of that branch.
3. **Superseded branches.** `claude/nifty-banach-fc4da0` (first Agent Skill)
   and `claude/unruffled-chaum-2f4a78` (idempotency, uncommitted) are covered on
   `main` (`skills/pairup/SKILL.md`, `src/market/idempotency.ts`). Diff each
   against `main`; port anything still missing (for example
   `test/agent-friendly.test.ts` in the unruffled-chaum worktree), then list them
   for Tony to remove. Leave the worktrees in place.
4. **Browser check** of the Ring and delivery UI (open item 1 in
   [RING_HANDOFF.md](RING_HANDOFF.md)): with `npm run ring:simulate`, walk
   "meet at a PairUp Point" → both "I'm here" → "Both here" on the card, the web
   app and the watch view, in light and dark, at phone width. Fix what reads
   badly on screen.
5. **Housekeeping.** `package-lock.json` has an uncommitted bump of
   `vendor/pairing-core` 0.1.0 → 0.2.0: confirm it matches
   `vendor/pairing-core/package.json` and commit it. Add `codex-*.log` to
   `.gitignore` (the logs in the repo root are untracked).
6. **Release check.** After all merges: the full check from round 1, bump
   `SERVER_INFO.version` and the SKILL `metadata.version` to `0.8.0`, update
   README test count and [VALIDATION.md](VALIDATION.md).

## B. Hackathon resources still to use

| # | Resource | Gap | What to do |
|---|---|---|---|
| B1 | **Agent Skills open standard** (Alexa+ track asks for it by name: apps.extensions.modelcontextprotocol.io/api/#build-with-agent-skills) | `skills/pairup/SKILL.md` was written by hand and never checked against the spec | Validate the skill against the Agent Skills spec (folder name = `name`, allowed frontmatter keys, description length, relative links resolve). Add a `test/skill.test.ts` that parses the frontmatter and enforces this. Serve the skill from the server too (e.g. `/.well-known/agent-skills/pairup/SKILL.md`, listed in the server card and `llms.txt`) if the spec defines a discovery path. Then use the MCP Apps Agent Skills from that page to audit `src/apps/view.ts` against MCP Apps (`ui/initialize`, host theme variables, display modes, size reporting) and fix what they flag. |
| B2 | **Streamable HTTP transport, spec 2025-11-25** (also named by the Alexa+ track) | Used, never audited clause by clause | Write `test/transport.test.ts` against the spec page: `Origin` validation (403 on a foreign origin), `MCP-Protocol-Version` header (400 on unsupported), `Accept` requirements, `Mcp-Session-Id` lifecycle for the subscription mode (404 on unknown session, `DELETE` ends it), `GET` SSE on stateful sessions and 405 on stateless, JSON-RPC batch handling. Fix any gap. Add a "Spec conformance" bullet list to README. If the official MCP conformance suite or MCP Inspector CLI runs headless, run it and save the output to `docs/VALIDATION.md`. |
| B3 | **Amazon Devices Builder Tools** (MCP server + Agent Skills; developer.amazon.com/docs/vega/0.24/mcp-server) | Not used | Install it in your own coding agent, use its documentation search on the Ring and Alexa questions in this repo, and record what it covers and where it helped or fell short. Add a row to the product feedback table in [SUBMISSION.md](SUBMISSION.md) and an entry to [FRICTION_LOG.md](FRICTION_LOG.md). Product feedback is a stated goal of the hackathon. |
| B4 | **ring-api-helloworld** (canonical Ring starter) | `src/ring/client.ts` was written from the API docs | Compare our client with the starter: base URL, auth headers, pagination, error and 429 / `Retry-After` handling, token expiry. Adopt what it does better and cover it in `test/points.test.ts`. Mention the starter in README's Ring section. |
| B5 | **Ring UX design guide** | Not applied | Read it and align the PairUp Point panel, notification wording and arrival states with its patterns. Note in `docs/DESIGN.md` which guidelines the panel follows. |
| B6 | **Ring API reference: webhooks, rate limits, testing** | Partly used | Check `src/ring/webhook.ts` against the reference (signature header, replay window, `meta.request_id` dedupe) and add a dedupe test if missing. |
| B7 | **bee-skill and bee-cli** (github.com/bee-computer) | Bridge calls `bee stream --json --types …` from docs; the official Bee Skill is unused | Check every CLI flag we call against the bee-cli README and fix mismatches. Add a "Use with Bee" section to `skills/pairup/SKILL.md` and [BEE.md](BEE.md) that pairs the official Bee Skill with ours: the agent reads Bee to-dos through Bee's skill or MCP, calls `add_context`, then `get_suggestions`. Frame the TI-84-before-the-exam story as education, one of Bee's priority use cases. |
| B8 | **Open Source mini challenge** | Only pairing-core is listed | Turn the entries in [FRICTION_LOG.md](FRICTION_LOG.md) into upstream contributions Tony can submit: for each SDK doc or example gap (Strands TS stream-event example, AgentCore local-invoke headers, MCP Apps init timeout), write the issue text and, where small, the patch, under `docs/upstream/<project>.md`. Tony opens them from his account; their URLs go in the Devpost form. |
| B9 | **AWS Builder** | Bedrock, AgentCore, Strands, CloudFront/EC2/CloudWatch are used; live evidence is missing | Add `npm run evidence` that, given a public URL, calls `/health`, `/build-info.json`, one Bedrock-backed request and (if configured) one AgentCore invocation, and writes a dated `docs/EVIDENCE.md` with the responses. Tony runs it after deploy. Leave Kiro and SageMaker out. |
| B10 | **Fire TV** | Not our track | No work. |
| B11 | Community forum, dev.to, YouTube, office hours, newsletter | Human channels | Draft one short dev.to post at `docs/posts/devto.md` ("Settling a deal between two private limits in an MCP server") for Tony to review and publish. Nothing else. |

## C. Rules resolved in this audit

The live rules, overview, FAQ and updates were accessible October 20. See [HACKATHON_RULES.md](HACKATHON_RULES.md), [AWARD_GAPS.md](AWARD_GAPS.md) and [SUBMISSION.md](SUBMISSION.md). Primary Track(s) permits the declared multi-track approach; Bee requires actual device-recorded data; the overview accepts a new additional open-source project. The original questions are retained below for context:

- Can one project enter Alexa+ and also Ring, or must the Ring work be framed
  inside the Alexa+ entry?
- Bee track: does it need live data from a Bee device?
- Open Source: does a contribution to our own new repo (pairing-core) count, or
  must it be a third-party project?

## D. Human-only (Tony)

Deploy (`deploy/aws/deploy.sh`, `agents/agentcore/deploy.sh`), Ring Playground
token and footage, Login with Amazon security profile, run `npm run evidence`,
open the upstream issues and PRs from B8, publish the dev.to post if wanted,
record the video, real pilot numbers only, Devpost form with per-tool feedback.

## Status

| Item | Status |
|---|---|
| A1 design pass merged | done — b2f7fa2 via codex/design-integration |
| A2 demo page | done — e4144a3, separate sessions and UW prompts |
| A3 superseded branches checked | done — BRANCH_AUDIT.md; missing parsed-request optimization ported |
| A4 Ring/delivery browser check | done locally — phone/light/dark card, arrivals and watch; see VALIDATION.md |
| A5 housekeeping | done — 08d2bc5; vendor package remains untouched |
| A6 release check 0.8.0 | done locally — 175 root + 4 AgentCore tests, clean installs, byte-exact builds, smoke/readiness and 0.8.0; hosted deploy/evidence remains Tony |
| B1 Agent Skills spec | done — YAML/live-tool tests and official MCP Apps Skill audit |
| B2 Streamable HTTP conformance | done — focused HTTP tests and headless Inspector; see RESOURCE_AUDIT.md |
| B3 Builder Tools feedback | done — 1.0.17 installed locally and searched over stdio MCP |
| B4–B6 Ring starter, UX guide, webhooks | done — comparison, retries/pagination, UI guidance and request-id dedupe |
| B7 Bee CLI and Skill | done locally — flags verified, official Skill recipe; real data sourcing unresolved (BEE_DATA_SOURCES.md) |
| B8 upstream contributions | drafts complete — three issue bodies and two apply-checked patches; Tony publishes if desired |
| B9 evidence script | collector complete — mock run rejected as evidence; actual cloud run pending Tony |
| B11 dev.to draft | done — docs/posts/devto.md, unpublished |

---

> Round 1, completed locally on October 20, 2026: all six branches merged into main and renamed PairUp 0.6.0. See [HANDOFF.md](HANDOFF.md) and [VALIDATION.md](VALIDATION.md). The original instructions below are retained as a record.

# Handoff to Codex, round 1 (2026-10-20, HKT afternoon)

Claude's session limit is close. Finish every open piece below, merge it all
into `main`, rename the product, and leave the repo ready to record the demo
video. Deadline: **Fri Oct 23 12:00 PDT (Sat 03:00 HKT)**; our own target is
**Fri 21:00 HKT**.

## Rules (read first)

1. `main` always runs: `npm run typecheck`, `npm test`, `npm run smoke` (with `npm start` in another terminal) and `cd agents/agentcore && npm test` pass. CI also runs `npm run build:web` and requires `public/app/app.js` and `public/mcp-apps/*` to match the sources byte for byte, so rebuild and commit the bundles after any change under `src/web` or `src/apps`.
2. Private limits (`min_price`, `max_price`) never reach the other side. All output goes through `src/market/views.ts`; the tests check for leaks.
3. A tool change updates `src/mcp/server.ts`, `src/mcp/schemas.ts`, `docs/TOOL_CONTRACT.md` and `skills/amazonpairup/SKILL.md` together.
4. Prices come from the fixed rule in pairing-core. No agent bargaining, no model-set prices. Learning only reorders candidates or suggests; nothing is posted or confirmed without the user's explicit yes.
5. Docs are plain and positive: say what something does. Don't write "X, not Y" contrasts or repeat caveats.
6. Commits end with `Co-Authored-By: Codex <noreply@openai.com>` (or your tool's line). Don't push, deploy, or touch AWS: Tony does that with his credentials.
7. Never edit `vendor/pairing-core` or `src/market/negotiation.ts`; another session owns pairing-core (github.com/rairurairu/pairing-core).
8. Real data only in docs: no invented user numbers or quotes. Demo data is labelled as demo data.

## Open work, one worktree each

All worktrees are under `D:\voice-market-mcp\.claude\worktrees\`. Several
sessions stopped with **uncommitted** changes: review, finish, test and commit
them on their own branch first.

| # | Worktree / branch | State | What's left |
|---|---|---|---|
| 1 | `mystifying-boyd-01d7da` → `claude/mystifying-boyd-01d7da` (`35f8565`) | **Done, committed.** Any MCP client can connect (Client ID Metadata Documents + dynamic client registration), Login with Amazon sign-in, token revocation. 97/97 tests passed. | Nothing. Read the commit message: with `AUTH_MODE=oauth` on a public host the server now refuses the old name-only sign-in, so the deploy needs LWA settings or the demo passcode. |
| 2 | `compassionate-mclean-5283ea` → `claude/compassionate-mclean-5283ea` | Branch = #1, plus **uncommitted** edits to `deploy/aws/*.sh`, `docs/ALEXA_SETUP.md`, `docs/DEPLOY.md` (deploy settings for #1: LWA client id/secret in SSM). | Finish and commit; check the scripts still parse (`bash -n`). |
| 3 | `busy-wiles-c5e9b7` → `claude/busy-wiles-c5e9b7` | **Uncommitted**, about 15 files. Trust and safety: banned items and services (keyword rules + embeddings against a list in `data/`, error `code` an agent can act on), `report_user`, `rate_deal` (ratings feed the track-record feature in `learning.ts`), reported users stop being paired until reviewed (dashboard queue). | Finish, add or finish tests (policy, e2e over MCP, leak test), commit. |
| 4 | `funny-albattani-389e0d` → `claude/funny-albattani-389e0d` | **Uncommitted.** Amazon fit: "new on Amazon it's about $X" fallback with an amazon.com search link when no seller fits (`new_price` in `data/reference-prices.json`), Trade-In hint on offers with no buyer, Amazon Hub Locker/Counter meet-up points in the seed areas (labelled demo data), a secondary button on the MCP Apps card. Also `scripts/bench.ts` (`npm run bench`, p50/p95/p99 per tool over real MCP) still to finish. | Finish, rebuild web bundles, tests, put local bench numbers in README "Production readiness", commit. |
| 5 | `quirky-davinci-51536b` → `claude/quirky-davinci-51536b` | **Uncommitted** (new `src/mcp/sessions.ts`, `src/mcp/subscriptions.ts`, `src/market/privacy.ts`). Agent push: `deals://me` / `posts://me` resources with `resources/subscribe` and `notifications/resources/updated` (a stateful session mode only for subscribers, GET SSE stream; stateless POST keeps working), elicitation for `confirm_price` and `confirm_deal` when the client declares it, and `delete_my_data` (needs `confirm: true`; retention in `public/privacy.html`). | Finish, tests with an in-memory client that subscribes and one that supports elicitation, server card / llms.txt list the capabilities, commit. |
| 6 | `lifestyle-bee-watch` → `claude/lifestyle-bee-watch` (`8ce80c8`) | **Server side done and committed; tests pass** (`test/lifestyle.test.ts`, `test/devices.test.ts`, full suite 99/99 at the first commit). See below. | The UI, demo seed and docs listed below. |

### #6 in detail: Bee, Apple Watch and lifestyle learning

Built and tested:
- `src/market/lifestyle.ts`: routines from a user's own past requests (embedding-similar, same kind and unit, at least 3 on different days, regular weekdays and time in the user's time zone). Each routine has a usual budget, pickup and place, a `when` sentence and the next due time. A routine dismissed twice in 14 days without an accept pauses; `forget` stops it.
- `src/market/context.ts`: context signals from Bee, a watch or a phone (`todo | conversation | journal | fact | location | note`). Only text that names a need is kept (30 days); the need clause is extracted, then the usual budget comes from similar past requests and the place from a recent location signal or the home area. Suggestions are posted only on `accept_suggestion`.
- MCP tools: `get_suggestions`, `accept_suggestion`, `dismiss_suggestion` (with `forget`), `add_context` (for agents that also hold Bee MCP data), `get_my_routines`. Request `source` now takes `voice | bee_context | device_context | routine`.
- `src/auth/devices.ts`, `src/http/devices.ts`: device tokens (`apd_…`, hashed, revocable, max 10). They reach only `POST /api/voice` (words in, a sentence out, runs the whole assistant loop server-side via `src/agent/runner.ts` with a 10-minute history so "yes" works on the next call) and `POST /api/context`. `GET/POST/DELETE /api/devices` work from a signed-in web session only.
- Offline planner: "anything I need?" → `get_suggestions`; "any news?" → deal status + suggestions; yes / a number / no / "forget it" after a suggestion; "what do you know about me?" → `get_my_routines`.
- `scripts/bee-bridge.ts` (`npm run bee:bridge`): live `bee stream --json`, `--poll` (Bee developer API, `BEE_API_TOKEN`, base `https://api.developer.bee.amazon.dev`, `/v1/todos`), `--replay data/bee-demo-events.jsonl` (labelled demo events in Bee's stream format). Utterances (other people's words) are never forwarded.

Still to do on this branch:
1. **Re-run the replay check.** Start a server on a spare port with a scratch `PGLITE_DIR` and `SEED_ON_START=true`, then `PAIRUP_URL=… PAIRUP_USER_ID=u_tony npm run bee:bridge -- --replay data/bee-demo-events.jsonl`. Expected: the calculator summary suggests "a graphing calculator", the to-do suggests "printer paper", the e-mail to-do and the hiking chat suggest nothing. Then `npm test`.
2. **Web app** (`src/web/main.ts`, `public/app/index.html`): a "For you" strip on load from `get_suggestions` with Yes / Not now / Forget buttons, and a "Devices" panel: create a watch or Bee token (shown once, with the `/api/voice` URL and copyable Shortcut steps), list and revoke devices.
3. **MCP Apps view** (`src/apps/view.ts`): render `get_suggestions` (cards with Yes → `accept_suggestion`, Not now → `dismiss_suggestion`), `accept_suggestion` (same as `post_request`) and `get_my_routines` (a list: need, when, usual budget, place, Forget). Rebuild bundles.
4. **Watch view** `/watch/` (new entry in `scripts/build-web.mjs`, reuse `src/web/auth.ts` and `src/web/mcp.ts`): a 410×502 round-rect screen showing the top suggestion or the deal waiting for a yes, big Yes / No buttons, a mic button (Web Speech) that sends words to `/api/voice`, and spoken replies. On a wide screen draw it inside a watch frame so it reads well in the video.
5. **Demo history**: `npm run seed -- --lifestyle` (or a flag in `scripts/seed.ts`) that backdates three weeks of weekday lunch-run requests (LG7 canteen → Hall 5, about $4, around 12:15) for the demo buyer, closed so they hold no offers, so `get_suggestions` offers the lunch run before noon. Label it demo data.
6. **Docs**:
   - new `docs/APPLE_WATCH.md`: build the Shortcut ("Dictate Text" → "Get Contents of URL" POST `/api/voice`, header `Authorization: Bearer apd_…`, JSON `{text, time_zone}` → "Get Dictionary Value" `say` → "Speak Text"; name it "PairUp" so "Hey Siri, PairUp" works on the watch), plus an iPhone automation "When I arrive at <place>" → POST `/api/context` `{kind: "location", place}` that shows the returned `say` as a notification.
   - new `docs/BEE.md`: the three bridge modes, and the agent pattern (an agent with Bee MCP `bee_list_todos` / `bee_get_today` plus our Agent Skill calls `add_context` then `get_suggestions`).
   - update `TOOL_CONTRACT.md` (5 tools, the two endpoints, device tokens, retention), `SKILL.md` (when to call `get_suggestions`; how to use Bee MCP with `add_context`), README ("Knows what you need" section, repo map, tests count), `public/privacy.html` (context kept 30 days, only need snippets, forget/revoke), `docs/DEMO_SCRIPT.md` (Bee and watch beat), `docs/SUBMISSION.md` (Bee track text and Bee product feedback), `docs/AWARD_GAPS.md` status table.

## Merge order (into `main`, after each branch passes on its own)

`main` has uncommitted edits to `README.md`, `docs/AWARD_GAPS.md`, `docs/SUBMISSION.md`, `docs/TOOL_CONTRACT.md` (Tony's; keep them). Commit or carry them before merging.

1. #1 mystifying-boyd, then #2 compassionate-mclean (auth and deploy)
2. #3 busy-wiles (trust and safety)
3. #5 quirky-davinci (agent push)
4. #4 funny-albattani (Amazon fit)
5. #6 lifestyle-bee-watch

Expect conflicts in `src/mcp/server.ts`, `src/mcp/schemas.ts`, `src/market/service.ts`, `src/app.ts`, `src/db/schema.ts`, `docs/TOOL_CONTRACT.md`, `skills/amazonpairup/SKILL.md`, `README.md` and the test that lists tools with MCP Apps views (`test/agent.test.ts`). Keep every side's additions. After each merge: typecheck, test, smoke, rebuild bundles.

## After the merges

1. **Rename AmazonPairUp → PairUp** everywhere (Tony decided; the old name uses Amazon's trademark): UI, `SERVER_INFO` (`name: "pairup"`, `title: "PairUp"`), the `ui://` view URI (`ui://pairup/market.html`), server instructions, Agent Skill folder `skills/pairup/`, docs, README, `package.json` name, client names, storage keys. Keep "for Alexa+" where it helps. Keep the AWS stack name, the CloudFront URL and the `deploy/` resource names as they are (renaming them would replace live resources). Bump `SERVER_INFO.version` to `0.6.0`.
2. Full check: `npm ci && npm run typecheck && npm test && npm run build:web && git diff --exit-code -- public`, `npm start` + `npm run smoke`, `cd agents/agentcore && npm ci && npm test`.
3. Walk the demo locally (`docs/DEMO_SCRIPT.md`): TI-84 sale and purchase, lunch run, price check, the Bee replay, the watch view, "what do you know about me?". Fix anything that reads badly on screen.
4. Update `docs/AWARD_GAPS.md` "Where we stand" and write a short note for Tony at the top of `docs/HANDOFF.md`: what changed, which env vars the deploy now needs (LWA, demo passcode), and the commands he runs (`deploy/aws/deploy.sh`, `agents/agentcore/deploy.sh`).

## For Tony (human-only)

Deploy with your AWS credentials · Login with Amazon security profile (client id/secret) · record the video · Devpost form · decide whether to enter the Bee track (it asks for a real Bee device; without one, Bee stays a roadmap line backed by the bridge and replay) · real poll numbers only.
