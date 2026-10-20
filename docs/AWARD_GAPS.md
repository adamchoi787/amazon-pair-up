# Award readiness — PairUp 0.8.0

Updated October 20, 2026 HKT. [Verified rules](HACKATHON_RULES.md) · [submission answers](SUBMISSION.md) · [resource audit](RESOURCE_AUDIT.md).

Release `v0.8.0` is pushed and deployed at commit `6895b521f50453819a9ba55b5c1f73914f6f17f9`. The public version, commit, readiness and UI fingerprint checks pass; GitHub CI passes. Live AWS collection is recorded in [EVIDENCE.md](EVIDENCE.md). This document and the evidence report can advance in documentation-only commits after the deployed release tag.

Alexa+ leads the submission. Enter Ring with official simulator/device footage. Bee is implemented and replay-tested, and its track entry needs real Bee-recorded data: Tony currently has no source, and the public-source search found no verified eligible dataset ([options](BEE_DATA_SOURCES.md)). Enter AWS Builder and Open Source together; one track prize and one mini-challenge prize can be awarded per project. Fire TV is outside scope.

| Entry / judging criterion | Repo evidence prepared | Remaining external evidence / action |
|---|---|---|
| Technical implementation | Typed MCP tools, 2025-11-25 HTTP checks, OAuth, sessions/recovery, consent, transactions, private views, deterministic pricing, scheduling; pushed/deployed 0.8.0 and green CI | Show the deployed workflow and cards clearly in the final video |
| Design | Shared token system, contrast tests, app/cards/dashboard/watch, two-device page, phone/light/dark review, visible arrival guidance | Record the final app in the public English video |
| Potential impact | Specific UW item/errand/job scenarios, sourced research and explicit pilot plan | Add real pilot results if collected; pilot statistics are optional evidence and stay absent until measured |
| Quality of idea | Standing two-sided needs, shared product/service contract, open fixed price rule, contextual preparation, Ring arrival and demo Hub alternatives | Explain the coherent evolution and show a complete deal first |
| Alexa+ | Runtime MCP and Agent Skill, simulated browser voice host and portable MCP Apps card | Show working tools/cards in the integrated video; label the web experience as simulated Alexa+ |
| Ring | Partner API calls, signed webhook, request-id dedupe, arrival state, watch/card UI and tests | Production has no Ring token, point/device mapping or HMAC key. Provision the official simulator/device configuration and capture both arrivals; persist those settings through deployment. Local ring:simulate proves local behavior only |
| Bee | Verified CLI flags, official Skill recipe, bridge and need-to-request consent flow | Real Bee-device / Bee-on-Watch source and useful action in the video; unresolved after online source search |
| AWS Builder | Live Titan embeddings, Nova intent/tool-use checks; deployed web release, Strands/AgentCore and inference-aware collector; see EVIDENCE.md | Include the recorded AWS integrations and actual runtime results in the submission feedback/video |
| Open Source | Separate public MIT pairing-core, verified contributor rairurairu and hackathon-period contribution URLs in SUBMISSION.md | Paste prepared fields; publish optional upstream drafts if desired |
| Product feedback | Every used integration has use, worked/needs-work, onboarding and future-use answers in PRODUCT_FEEDBACK.md | Tony reviews historical experience and pastes the full answer |
| Friction bonus / feature requests | Full-field entries plus coverage matrix; concrete feature requests and priorities | Include both optional answers in Devpost |
| Submission logistics | Correct deadline, integrated 2:55 shot list, source URLs, code history and judge checklist | Public video URL, teammate invitations, eligibility/rights confirmations, Devpost submit; keep judge access through Nov 20 PST |

## Pre-video order

1. Follow [RECORDING_CHECKLIST.md](RECORDING_CHECKLIST.md) against deployed `v0.8.0`; rehearse judge sign-in in a fresh browser.
2. Collect the real Ring evidence. Resolve Bee sourcing if entering that track; the local fixture stays labelled demo data.
3. Use [EVIDENCE.md](EVIDENCE.md); recollect against any subsequent application release.
4. Record the one integrated video in DEMO_SCRIPT.md. Paste SUBMISSION.md, PRODUCT_FEEDBACK.md, FRICTION_LOG.md and FEATURE_REQUESTS.md into the matching form fields.

## Remaining product and operational gaps

- **Voice response quality (observed live):** the AgentCore evidence prompt produced `<thinking>` text without a separate spoken final answer. The current stream forwards every text delta, and the collector accepts any nonempty text. Filter reasoning, verify a useful final reply and a read-only MCP action live, and strengthen collector assertions before filming. The AgentCore MCP client also still advertises applicationVersion `0.7.0`; align it with package `0.8.0` in the next code release.
- **Login with Amazon:** its client ID and secret are absent in production. Judge demo sign-in is the deployed path; configure and rehearse LWA before claiming that account-linking path is live.
- **Alert delivery:** the four CloudWatch alarms report OK and fresh release logs reach CloudWatch, but the SNS topic has zero subscribers. Configure an alert recipient if claiming working email alerts.
- **Live integrations:** Hub locations, delivery quotes and reference retail prices remain labelled demo data; no actual carrier booking or Hub partnership is established. These are product maturity gaps, rather than requirements for the chosen Alexa+ entry.
- **Impact evidence:** the UW pilot has not run. Measured task success, time saved, user feedback and a hosted latency sample would strengthen the equally weighted impact and technical criteria. The existing learning results remain simulated.
- **Submission:** record and publish one English video under three minutes, demonstrate each entered track, paste full feedback and contribution fields, review eligibility/rights and team invitations, and submit by **October 24, 03:00 HKT** (target October 23, 21:00 HKT). Keep judge access free through **November 21, 04:00 HKT**.

The remaining award gates are the integrated video, official Ring evidence, Bee provenance if entering Bee, and the completed submission. Optional upstream issue/patch publication can strengthen Open Source; the separate public MIT pairing-core contribution already supplies its prepared entry.
