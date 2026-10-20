# Award readiness — PairUp 0.8.0

Updated October 20, 2026 HKT. [Verified rules](HACKATHON_RULES.md) · [submission answers](SUBMISSION.md) · [resource audit](RESOURCE_AUDIT.md).

Alexa+ leads the submission. Enter Ring with official simulator/device footage. Bee is implemented and replay-tested, and its track entry needs real Bee-recorded data: Tony currently has no source, and the public-source search found no verified eligible dataset ([options](BEE_DATA_SOURCES.md)). Enter AWS Builder and Open Source together; one track prize and one mini-challenge prize can be awarded per project. Fire TV is outside scope.

| Entry / judging criterion | Repo evidence prepared | Remaining external evidence / action |
|---|---|---|
| Technical implementation | Typed MCP tools, 2025-11-25 HTTP checks, OAuth, sessions/recovery, consent, transactions, private views, deterministic pricing, scheduling and CI | Push/deploy submitted commit; live release and model checks |
| Design | Shared token system, contrast tests, app/cards/dashboard/watch, two-device page, phone/light/dark review, visible arrival guidance | Record the final app in the public English video |
| Potential impact | Specific UW item/errand/job scenarios, sourced research and explicit pilot plan | Add real pilot results if collected; pilot statistics are optional evidence and stay absent until measured |
| Quality of idea | Standing two-sided needs, shared product/service contract, open fixed price rule, contextual preparation, Ring arrival and demo Hub alternatives | Explain the coherent evolution and show a complete deal first |
| Alexa+ | Runtime MCP and Agent Skill, simulated browser voice host and portable MCP Apps card | Show working tools/cards in the integrated video; label the web experience as simulated Alexa+ |
| Ring | Partner API calls, signed webhook, request-id dedupe, arrival state, watch/card UI and tests | Fresh Playground token or actual device; show an official simulator/device interaction. Local ring:simulate proves local behavior only |
| Bee | Verified CLI flags, official Skill recipe, bridge and need-to-request consent flow | Real Bee-device / Bee-on-Watch source and useful action in the video; unresolved after online source search |
| AWS Builder | Bedrock Titan/Nova calls, Strands + AgentCore entrypoint, hosting/metrics definitions, inference-aware evidence collector | Tony deploys and runs evidence; capture AgentCore if claiming it ran in the cloud |
| Open Source | Separate public MIT pairing-core, verified contributor rairurairu and hackathon-period contribution URLs in SUBMISSION.md | Paste prepared fields; publish optional upstream drafts if desired |
| Product feedback | Every used integration has use, worked/needs-work, onboarding and future-use answers in PRODUCT_FEEDBACK.md | Tony reviews historical experience and pastes the full answer |
| Friction bonus / feature requests | Full-field entries plus coverage matrix; concrete feature requests and priorities | Include both optional answers in Devpost |
| Submission logistics | Correct deadline, integrated 2:55 shot list, source URLs, code history and judge checklist | Public video URL, teammate invitations, eligibility/rights confirmations, Devpost submit; keep judge access through Nov 20 PST |

## Pre-video order

1. Follow [RECORDING_CHECKLIST.md](RECORDING_CHECKLIST.md), deploy the submitted commit and verify a fresh judge sign-in.
2. Collect the real Ring evidence. Resolve Bee sourcing if entering that track; the local fixture stays labelled demo data.
3. Run `npm run evidence` against the public release and save the report.
4. Record the one integrated video in DEMO_SCRIPT.md. Paste SUBMISSION.md, PRODUCT_FEEDBACK.md, FRICTION_LOG.md and FEATURE_REQUESTS.md into the matching form fields.

Local preparation can close code and documentation gaps. Deployment, account access, actual device provenance and the submitted video remain explicit final gates.
