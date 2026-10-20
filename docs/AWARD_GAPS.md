# Award readiness

Updated October 20, 2026. Rules: https://amazonappdev2026.devpost.com/rules

Judging weighs four criteria equally: technical implementation, design, potential impact and quality of the idea.

## Where we stand

| Criterion / entry | What we have | To finish |
|---|---|---|
| Technical implementation | MCP server with schemas, MCP Apps views, OAuth 2.1, transactions, availability and overlap checks, privacy leak tests, CI | Deploy 0.7.0 and pass `npm run check:release`; record a live Bedrock request |
| Design | Voice or typed conversation, cards with price, total, time and missing approval, a watch view | Watch two or three new people use it and fix what confuses them |
| Potential impact | US-first launch on the UW campus in Seattle; items, errands and one-time jobs in one flow; sourced pain points, market size, per-deal savings and a campus model in [research/IMPACT.md](../research/IMPACT.md) | Run the UW pilot ([USER_VALIDATION.md](USER_VALIDATION.md)) and add its numbers to IMPACT.md |
| Quality of idea | Standing requests, matching from either side, an open-source price rule, learned routines | A focused video that shows one complete exchange first |
| Alexa+ | MCP server plus a web host that plays the Alexa+ conversation | Public sub-three-minute video and the Devpost form |
| AWS Builder | Bedrock embeddings and Nova Lite, Strands agent for AgentCore Runtime, CloudFront + EC2 + CloudWatch | Screenshots or logs from the live services |
| Open Source | pairing-core (MIT, Rust/WASM, test vectors) used for every settlement | Contributor username and contribution URL in the form |
| Bee | Bridge (CLI stream, API poll, replay) and suggestion flow | Live data recorded through a Bee device or an Apple Watch running Bee software (the replay file and the iOS Shortcut path are demo aids) |
| Ring | PairUp Points: Ring Partner API client (devices, Event History), HMAC-verified webhook, three MCP tools, card panel, tests | A Ring Playground token and footage of a confirmed hand-off; check the rules on entering a second primary track |
| Friction bonus | Concrete SDK and deployment entries in [FRICTION_LOG.md](FRICTION_LOG.md) | Review and paste into the form |

## What 0.7.0 adds

- Availability checked in both pairing directions, before result limits and before a direct choice is reserved.
- Exact `starts_at` / `ends_at` with offsets and an IANA time zone on every post, defaulting to Pacific time.
- One provider's timed bookings never overlap, also under concurrent requests. Simultaneous confirmations keep both yeses.
- Tentative times need the provider's explicit yes, also on auto-accept offers.
- Cards show total cost, date and time zone, the provider's hours and the missing approval.
- A conditional yes ("yes if…") is treated as a new constraint.
- `/health` and `/build-info.json` identify the running commit and browser build.

## Highest-value remaining work

1. Deploy the submitted commit, pass the release check and rehearse a fresh judge sign-in.
2. Record [DEMO_SCRIPT.md](DEMO_SCRIPT.md).
3. Run the short UW pilot and add the real results.
4. Review [SUBMISSION.md](SUBMISSION.md) against the live app; add the product feedback and contribution details.
5. Keep the endpoint up through judging.

A reliable core flow and a clear video beat extra integrations.
