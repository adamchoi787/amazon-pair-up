# PairUp 0.6.0 — local release handoff (October 20, 2026 HKT)

All six Claude workstreams are merged into main. Authentication and revocation,
trust policy/reports/ratings, live MCP resources and confirmations, data erasure,
Amazon search/Trade-In options, Bee context, routines, device management and the
watch preview are integrated. The product, client ids, view URI and Agent Skill
are renamed PairUp. Your original documentation edits are preserved.

Validation: see [VALIDATION.md](VALIDATION.md). The watch browser preview and Bee
replay are local demonstrations; physical Bee/Watch and live Login with Amazon
still need your accounts and hardware. Demo Hub locations are labelled in the
spoken result, and reference retail prices are curated estimates. No live
retail-price or Hub-locator API is connected.

For your later deployment, use both LWA_CLIENT_ID and LWA_CLIENT_SECRET from a
Login with Amazon security profile, with return URL
<PUBLIC_BASE_URL>/oauth/amazon/callback. DEMO_MODE=true enables the labelled judge
sign-in; DEMO_LOGIN_PASSCODE adds an optional shared access code. The deploy script
stores supplied sign-in secrets in SSM and uses demo mode when LWA is absent.
AWS stack names, paths, metric namespaces and AgentCore resource names are kept.

Commands for you to run with your credentials when ready:

```bash
AWS_PROFILE=amazonpairup AWS_REGION=us-east-1 deploy/aws/deploy.sh
AWS_PROFILE=amazonpairup AWS_REGION=us-east-1 agents/agentcore/deploy.sh
```

To rehearse locally, use a scratch PGLITE_DIR, AI_MODE=mock and AUTH_MODE=none.
Run npm run seed -- --lifestyle, npm start, then the Bee replay as documented in
[BEE.md](BEE.md). Sign in as Tony locally. The lunch suggestion is due on weekdays
from 10:45 to 12:45 HKT; get_my_routines explains it at any time. See
[APPLE_WATCH.md](APPLE_WATCH.md) for the Siri Shortcut and /watch/ preview.

Remaining human steps: deploy, validate live identity and hardware, record the
video, decide Bee-track eligibility, enter real poll results and submit Devpost.
All work in this session stayed local; nothing was pushed or deployed.

---

# Working guide

**Deadline:** Fri Oct 23, 12:00pm PDT = **Sat Oct 24, 3:00am HKT**.
**Our target:** submitted by **Fri Oct 23, 9:00pm HKT**. The last hours are buffer.
**Plan and award analysis:** [AWARD_GAPS.md](AWARD_GAPS.md).

## Ground rules

1. `main` always runs: `npm run typecheck`, `npm test` and `npm run smoke` pass.
2. Private limits stay on the server. All output goes through `src/market/views.ts`; the tests check for leaks.
3. Tool changes update `src/mcp/server.ts`, `src/mcp/schemas.ts` and [TOOL_CONTRACT.md](TOOL_CONTRACT.md) together.
4. Write in [FRICTION_LOG.md](FRICTION_LOG.md) **as it happens** (up to +10% of the judging score). Real entries only.
5. Keep third-party brands out of the video and UI.

## Setup (5 min)

```bash
git clone <repo-url> && cd voice-market-mcp
npm install
npm run reset && npm test
npm start            # leave running
npm run smoke        # in a second terminal → "Smoke test passed."
```

Open http://127.0.0.1:3000/ for the web app, and http://127.0.0.1:3000/dashboard/ to watch posts and deals update while smoke runs.

## Who does what

| You | Claude |
|---|---|
| AWS account, Bedrock model access and quotas | Server, pairing engine, schemas, tests |
| Deployment credentials (never in git) | Web app and MCP Apps view |
| Classmate poll or interviews (real answers only) | Rust `pairing-core` crate (Open Source entry) |
| Video recording and voice-over | Deployment config, CI, docs |
| Devpost form, repo visibility, final submit | Drafts of description, feedback and friction entries for you to check |
| A Bee device, if available | |

## Daily check (22:00 HKT)

What's merged · what's blocked · does the TI-84 demo still run on the deployed server?
