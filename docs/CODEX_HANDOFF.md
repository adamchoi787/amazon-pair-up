# Handoff to Codex (2026-10-20, HKT afternoon)

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
