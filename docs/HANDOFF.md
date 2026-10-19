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

Open http://127.0.0.1:3000/ to watch the dashboard update while smoke runs.

## Who does what

| You | Claude |
|---|---|
| AWS account, Bedrock model access and quotas | Server, pairing engine, schemas, tests |
| Deployment credentials (never in git) | Demo web client and MCP Apps cards |
| Classmate poll or interviews (real answers only) | Rust `pairing-core` crate (Open Source entry) |
| Video recording and voice-over | Deployment config, CI, docs |
| Devpost form, repo visibility, final submit | Drafts of description, feedback and friction entries for you to check |
| A Bee device, if available | |

## Daily check (22:00 HKT)

What's merged · what's blocked · does the TI-84 demo still run on the deployed server?
