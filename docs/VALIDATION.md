# PairUp 0.8.0 validation

October 20, 2026 HKT. Windows, Node.js v24.14.1. Original local code validation: `21fd4eb`. Pushed and deployed release: `v0.8.0`, commit `6895b521f50453819a9ba55b5c1f73914f6f17f9`. Later documentation-only commits record the evidence without changing the release tag.

## Live release follow-up

The user authorized push, deployment and real AWS evidence collection on October 20, overriding the earlier handoff's local-preparation boundary.

| Check | Result |
|---|---|
| Release publication | `main` and annotated tag `v0.8.0` pushed; public GitHub repo has MIT license |
| GitHub CI for `6895b52` | [Passed](https://github.com/rairurairu/amazon-pair-up/actions/runs/39441306891): root tests, clean Linux installs/typechecks, browser bundle comparison and AgentCore checks |
| Local verification repeated | Server/browser and AgentCore typechecks pass; browser build matches committed assets; root **175/175** and AgentCore **4/4** tests pass |
| Recovery snapshot | EBS snapshot `snap-090f26166800f4a41` completed before deployment; daily DLM policy remains enabled |
| Web deployment | SSM release `20261020144053-6895b52`; CloudFormation reported no infrastructure changes |
| Public release verification | Version 0.8.0, full revision, UI fingerprint, asset manifest, app shell, database readiness, Bedrock mode and OAuth all pass |
| Live Bedrock preflight | Titan Text Embeddings V2: **1024 dimensions**; Nova Lite extracted calculator intent with budget 18 and selected `post_offer` in the tool-use probe; the returned write was not executed |
| AgentCore deployment | Runtime `amazonpairup_agent-DsoU3B38yY`, **version 2 READY**; ARM64 image tag `20261020144137`, ECR digest `sha256:bcc5e49b1f34ebe34dfc75753455e737fbd106b7b75b7be873249b7eed479e6c` |
| Live authenticated inference | Collector **passed**: hosted Bedrock and actual AgentCore stream. AgentCore returned reasoning text without a separate spoken answer for this prompt; response quality remains a gap. See [EVIDENCE.md](EVIDENCE.md) |
| Judge authentication | Fresh isolated judge-demo OAuth authorization-code flow with S256 PKCE passed. Evidence credentials revoked after collection. Browser UI rehearsal remains separate |
| Observability | App and CloudWatch agent active; fresh deployment log records confirmed in CloudWatch; four alarms OK. SNS topic has **zero subscribers** |
| Production integration configuration | Login with Amazon client ID/secret and Ring access token/point-device mapping/HMAC key are absent. Judge demo sign-in is enabled |

Local command logs are ignored `codex-live-*.log` files. Public runtime evidence is committed in EVIDENCE.md. No post or deal was created by the AWS probes.

## Checks completed

| Check | Result |
|---|---|
| Root `npm ci` | Passed with the committed lockfile; pairing-core metadata matches vendored 0.2.0 |
| Root `npm run typecheck` | Passed for server and browser sources |
| Root `npm test` after clean install | **175 passed, 0 failed**, 180.9 seconds; `codex-release-tests.log` |
| AgentCore `npm ci`, `npm run typecheck`, `npm test` | Passed; **4 passed, 0 failed**, scripted models over real local MCP; no AWS calls |
| `npm run build:web` and repeat-byte comparison | Passed; generated token CSS, app, MCP card, watch and manifest are byte-identical on repeat build |
| Committed `public/` vs current generated assets | `git diff --exit-code -- public` passed after the release commit |
| `npm run smoke` behavior on final 0.8.0 source | Passed in an isolated loopback server, ephemeral port, seeded in-memory market and mock AI; child runs `scripts/smoke.ts`; server closes after the check |
| Local `check:release` | Passed: product, 0.8.0 version, UI fingerprint, app shell, readiness, mock/offline and local auth mode; no deployed-commit assertion was made in this fixture |
| Agent Skill standard and current tool coverage | Two Node tests pass; the skill-creator `quick_validate.py` also reports `Skill is valid!` using UTF-8 mode |
| Headless MCP Inspector | `tools/list` over local HTTP succeeds; **0 schema portability errors, 168 portability warnings across 18 tools**; this is an interoperability probe rather than full certification |
| Bee fixture replay | Calculator summary and printer-paper todo produce private suggestions; unrelated email/hiking context posts no request; raw utterances are excluded |
| Evidence collector negative check | Mock server reports `inference: offline`; dated collector output is marked incomplete and exits 1. A unit test also covers successful-model vs fallback provenance |
| Upstream patch candidates | Both AgentCore README patches pass `git apply --check` against the shipped 0.4.6 README |
| Deployment script syntax | `bash -n` passes for AWS deploy, AgentCore deploy and invocation scripts |
| Markdown references / whitespace | Local README/docs/Skill links resolve; `git diff --check` passes |
| Ownership boundaries | No content changes to `vendor/pairing-core` or `src/market/negotiation.ts` compared with starting main `b429158` |

UI fingerprint: `adde8b08f8c53f919314a712bef0e5c8ba27f8cb246cb93e9d2d00560d61fcef`.

The first Windows clean-install attempt encountered a lingering esbuild executable lock; stopping only workspace-owned esbuild processes allowed `npm ci` to complete. One manifest-write attempt encountered a transient file lock; subsequent normal and repeat builds passed. Root and AgentCore installs share imports, so the AgentCore typecheck was repeated after the root install and passed.

The persistent preview launch at the end was rejected by automatic approval review without a specific reason. The final smoke/readiness checks instead used a disposable in-memory fixture and closed its listener afterward. Earlier browser screenshots are local files under `.data/screenshots/`; no persistent preview is left running by this preparation.

## Browser walkthrough

| Surface / scenario | Observed result |
|---|---|
| Two-device calculator exchange | Separate Sam/Mei identities. Specifying good condition selects Sam's TI-84 at $18 rather than the cracked seed calculator. Buyer confirms; seller receives agreed-deal news |
| Ring card in app, 390 × 844, light and dark | Point name, checked-in state, waiting guidance and two text-labelled confirmed chips fit; scrolling remains available for a long card |
| Signed local Ring event | Both people said I'm here; `ring:simulate` returned HTTP 200 with `confirmed: 2`; refreshed card showed Both here and both Ring-confirmed labels |
| Voice Ring flow | Fixed invisible backspace characters in phrase boundaries; ASCII/curly apostrophe arrival phrases and point requests now reach the correct tools; browser flow verified |
| Watch, desktop frame and 390 × 844 | Shows the same Both here result and point name; the watch screen uses its dark palette. The pending-arrival action is implemented; that action was exercised through the app rather than the watch preview |
| Delivery card, 390 × 844, light and dark | $4 paper switches to a $3.99 demo delivery quote; total/Confirm become $7.99; drop-off, pickup and demo label remain visible; Meet up instead is available |
| Browser session loss | HTTP integration test drops sessions, reinitializes and completes one write once; resource reads also recover |

These were local mock-market and signed local-simulator checks. They establish UI and application behavior; official Ring simulator/device footage remains a submission requirement.

## External evidence still needed

- Public 0.8.0 deployment and live AWS evidence are recorded above and in [EVIDENCE.md](EVIDENCE.md). Recollect if the application release changes.
- Rehearse judge-demo sign-in in a fresh browser. Configure Login with Amazon before claiming that path is live. Supply the missing Ring settings and record official Ring Playground or device interaction.
- Tony confirmed no real Bee source. The public-source search found no verified eligible recording corpus; see [BEE_DATA_SOURCES.md](BEE_DATA_SOURCES.md). Enter Bee after obtaining valid provenance or an organizer-approved alternative.
- Record and submit the integrated public English video under three minutes, fill the feedback/contribution fields and keep judge access available through the judging period. Any pilot numbers must come from an actual observed pilot.
