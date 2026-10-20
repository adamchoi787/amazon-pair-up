# PairUp 0.8.0 validation

October 20, 2026 HKT. Windows, Node.js v24.14.1. Code release: `21fd4eb`, merged locally into main. Deployment and real device evidence are recorded separately below.

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

- The public endpoint was checked read-only during preparation. It reports **0.7.0**, a different asset fingerprint, Bedrock configuration and OAuth. Deploy 0.8.0 and run the checker with the full submitted revision.
- Run the actual Bedrock evidence request and optional AgentCore cloud invocation after deployment. See [EVIDENCE.md](EVIDENCE.md). Configured Bedrock mode alone does not prove inference succeeded.
- Rehearse real Login with Amazon / judge-demo sign-in and record official Ring Playground or device interaction.
- Tony confirmed no real Bee source. The public-source search found no verified eligible recording corpus; see [BEE_DATA_SOURCES.md](BEE_DATA_SOURCES.md). Enter Bee after obtaining valid provenance or an organizer-approved alternative.
- Record and submit the integrated public English video under three minutes, fill the feedback/contribution fields and keep judge access available through the judging period. Any pilot numbers must come from an actual observed pilot.
