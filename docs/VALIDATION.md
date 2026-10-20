# PairUp 0.7.0 validation

October 20, 2026. Windows, Node.js v24.14.1, local checkout (not yet committed or deployed).

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | Passed: server and browser sources |
| `npm test` | 146 passed, 0 failed |
| AgentCore `npm test` | 4 passed, 0 failed (scripted models over real local MCP) |
| `npm run build:web`, twice | Bundles and `build-info.json` byte-identical |
| `npm run smoke` against a fresh Seattle market | Passed: TI-84 sale at the HUB Hub Counter, rating, prohibited-post refusal, lunch run from the HUB to McCarty Hall, two-party booking |
| `npm run bee:bridge -- --replay` | Calculator summary → graphing calculator; to-do → printer paper; e-mail task and hiking chat → nothing |
| `npm run seed -- --lifestyle` after `npm run reset` | 15 closed lunch runs added; market stays at 162 posts |
| Browser walkthrough (desktop, 800 × 757) | For you strip with Bee suggestions; routine "weekdays around 12:15pm, about $4"; event booking card: $10/hr, $40 for 4 hours, Sat Oct 24 2:00–6:00 PM America/Los_Angeles, fits stated availability |
| `bash -n deploy/aws/deploy.sh`, `git diff --check` | Passed |
| Hosted `check:release` (earlier today) | Public endpoint reports 0.5.0; deploy pending |

## What the tests cover

Scheduling: a Sunday-only provider is never proposed for a Monday job, in either posting direction or through `negotiate`; filtering runs before result limits; full-duration coverage, split shifts, overnight windows, explicit time zones, DST ambiguity and transitions, invalid dates and inconsistent durations. Concurrent requests cannot reserve overlapping timed jobs across one provider's offers, back-to-back jobs are allowed, and concurrent buyer and seller confirmations keep both yeses. Tentative times need the provider's explicit yes, also for deals approved automatically by an earlier release.

Requests: item deadlines come only from a day, a date or "by" a clear time ("around 20 bucks" and "at 7-Eleven" leave the request open). Seller disclaimers such as "Not graphing" exclude an offer, and wear notes such as "not used much" keep it. A conditional yes counts as a new constraint. The first device's time zone is kept for the user's routines.

Privacy: private limits never appear in the other side's output; the check matches prices rather than any digits in ids or timestamps.

## Still to run on the deployed release

A live Bedrock request, Login with Amazon sign-in, an AgentCore invocation if shown, the Siri Shortcut on a paired Apple Watch, and live Bee data for the Bee track. The seed market, Bee replay, Hub locations and reference prices are demo data.
