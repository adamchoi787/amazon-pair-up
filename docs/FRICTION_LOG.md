# Friction log

Submissions with friction logs can earn **up to a 10% judging bonus**. Add an entry
whenever something with an Amazon/AWS tool, API, SDK or doc is slower or more
confusing than expected. Write it at the time it happens; you won't remember it on Thursday.

## Template

### <short title>
- **Who / when:**
- **Tool / API / SDK:** (Alexa+, MCP, Bee CLI, Bedrock, AgentCore, …)
- **Task attempted:**
- **Steps taken:**
- **Expected:**
- **Actual:**
- **Severity:** critical / major / minor
- **Workaround:**
- **Suggestion:** (concrete and actionable)

---

## Entries

<!-- newest first -->

### AgentCore TypeScript quick start does not compile against the current Strands SDK
- **Who / when:** Tony + Claude, Tue Oct 20, 10:55 HKT
- **Tool / API / SDK:** `bedrock-agentcore` 0.4.6 (TypeScript), `@strands-agents/sdk` 1.21.0
- **Task attempted:** Host our Strands agent on AgentCore Runtime, starting from the quick start in the `bedrock-agentcore` README.
- **Steps taken:** Copied the streaming handler: `for await (const event of agent.stream(prompt)) if (event.type === 'modelContentBlockDeltaEvent' && event.delta?.type === 'textDelta') …`; ran `tsc`.
- **Expected:** The quick start compiles with the Strands version its peer dependency allows (`>=1.5.0`).
- **Actual:** `TS2367: This comparison appears to be unintentional`. In Strands 1.21, `agent.stream()` yields `modelStreamUpdateEvent` wrappers, and the text delta sits in `event.event`. In plain JavaScript the README code runs but never yields any text, so the agent looks silent.
- **Severity:** minor
- **Workaround:** `if (event.type === "modelStreamUpdateEvent" && event.event.type === "modelContentBlockDeltaEvent" && event.event.delta.type === "textDelta") yield event.event.delta.text`.
- **Suggestion:** Update the README example (and samples) to the current event shape, or export a helper such as `textDeltas(agent.stream(...))`; pin the peer range to the versions the README is tested against.

### AgentCore Runtime app: local calls fail with 406 and 400 before reaching the handler
- **Who / when:** Tony + Claude, Tue Oct 20, 10:58 HKT
- **Tool / API / SDK:** `bedrock-agentcore` 0.4.6, `BedrockAgentCoreApp` (TypeScript)
- **Task attempted:** Test our agent's `/invocations` locally before deploying, with curl.
- **Steps taken:** `curl -X POST localhost:8080/invocations -H "Content-Type: application/json" -d '{"prompt":"any news?"}'`.
- **Expected:** The handler runs, as with a hosted runtime call.
- **Actual:** First `406` ("Streaming response requires Accept: text/event-stream header"), then `400` ("Missing sessionId. Provide via x-amzn-bedrock-agentcore-runtime-session-id header or request body"). Neither header is mentioned in the package README, which has no local invocation example.
- **Severity:** minor
- **Workaround:** Send `Accept: text/event-stream` and `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` on local calls (see `agents/agentcore/README.md`).
- **Suggestion:** Add a "call it locally" curl line to the quick start, and generate a session id for local calls when none is given (with a warning) instead of rejecting them.

### DLM description pattern only checked at stack creation
- **Who / when:** Tony + Claude, Tue Oct 20, 08:57 HKT
- **Tool / API / SDK:** CloudFormation, Data Lifecycle Manager (`AWS::DLM::LifecyclePolicy`)
- **Task attempted:** First create of our stack (EC2, IAM, CloudFront, a daily EBS snapshot policy).
- **Steps taken:** `aws cloudformation deploy --template-file deploy/aws/amazonpairup.yaml`.
- **Expected:** An invalid property value to be reported before any resource is created.
- **Actual:** The changeset was created without complaint; the DLM handler then returned `The following parameter(s) are invalid: Description {PairUp daily EBS snapshots, kept for 7 days}`. The comma is the problem (the pattern allows only letters, digits, spaces, `_` and `-`), but the message does not say which character or which pattern. The whole stack rolled back to `ROLLBACK_COMPLETE`, which cannot be updated, so it had to be deleted before trying again.
- **Severity:** minor
- **Workaround:** Removed the comma, deleted the rolled-back stack, deployed again.
- **Suggestion:** Enforce the documented pattern in the resource schema so changeset creation (and `cfn-lint`) rejects it, and include the allowed pattern in the DLM error message.

### AWS CLI arguments rewritten by Git Bash on Windows
- **Who / when:** Tony + Claude, Mon Oct 19, 21:00 HKT
- **Tool / API / SDK:** AWS CLI v2 (Windows), Systems Manager Parameter Store, S3
- **Task attempted:** Run our bash deploy script (`deploy/aws/deploy.sh`) from Git Bash on Windows 10.
- **Steps taken:** `aws ssm get-parameter --name /amazonpairup/origin-secret`, and `aws ssm send-command --parameters file:///tmp/...`.
- **Expected:** The same behaviour as on macOS and Linux.
- **Actual:** Git Bash (MSYS) turns any argument that looks like a POSIX path into a Windows path before calling `aws.exe`, so the parameter name became `C:/Program Files/Git/amazonpairup/origin-secret` and the `/tmp/...` paths in `file://` arguments are paths `aws.exe` cannot open. Nothing in the CLI output says the argument was changed before it arrived.
- **Severity:** minor
- **Workaround:** `export MSYS_NO_PATHCONV=1` in the script, and pass temp files through `cygpath -w`.
- **Suggestion:** Add a "Git Bash / MSYS" note to the AWS CLI Windows install and Parameter Store pages, since Parameter Store names are the most common argument that starts with `/`. A CLI warning when a `--name` value looks like an MSYS-rewritten path (`C:/Program Files/Git/...`) would save the debugging.

### ADBT-1 — Builder Tools CLI hides required platform and project context
- **Who / when:** Codex, October 20, 2026 HKT; observed in this checkout.
- **Tool / API / SDK:** Amazon Devices Builder Tools MCP 1.0.17.
- **Task attempted:** Search Ring webhook verification and Alexa+ MCP onboarding documentation.
- **Steps taken:** Installed the official npm package into `.data/builder-tools`; ran `exec --list`; attempted `exec search_documentation --args` with a query, then with a string platform; connected over MCP to inspect input schemas and retried with `target_platform: {device_os:["vega_os","fire_os"]}`.
- **Expected:** The listed search command explains its complete arguments and first-call prerequisites.
- **Actual:** The first two calls failed schema validation. The schema-correct call then returned `PROJECT_CONTEXT_REQUIRED`. After `set_project_context({config:{}})`, both searches returned relevant official Ring and Alexa+ pages. Logs: `codex-builder-search.log` (ignored).
- **Severity:** minor.
- **Workaround:** Inspect MCP `tools/list`, set project context explicitly, then search with the platform object.
- **Suggestion:** Add a complete schema-valid search example to `--help` and report the context prerequisite before argument retries. Support `--schema <tool>` for CLI users.

### MCP-1 — SDK accepts legacy batches on a current-spec endpoint
- **Who / when:** Codex, October 20, 2026 HKT; SDK source audit and HTTP tests.
- **Tool / API / SDK:** MCP TypeScript SDK 1.32.1, Streamable HTTP 2025-11-25.
- **Task attempted:** Enforce one JSON-RPC message per POST for the current transport spec.
- **Steps taken:** Read the spec and installed transport handler; sent empty, singleton and two-message arrays in `test/transport.test.ts`.
- **Expected:** A current-spec endpoint rejects batches consistently.
- **Actual:** The SDK retains older batch handling. PairUp needed an application guard to return 400/-32600; all three array tests now pass.
- **Severity:** minor.
- **Workaround:** Reject arrays before passing a request to the transport.
- **Suggestion:** Offer a negotiated-version strict mode and a current-spec batch-rejection example.

### APPS-1 — Embedded view initialization needs a host failure path
- **Who / when:** PairUp host implementation, reviewed by Codex October 20, 2026 HKT.
- **Tool / API / SDK:** MCP Apps / ext-apps 1.7.5.
- **Task attempted:** Keep a failed embedded view from leaving an indefinite loading skeleton.
- **Steps taken:** Traced bridge initialization, zero-height frame creation, size reporting, connection errors and text fallback in `src/web/host.ts` and `src/web/main.ts`.
- **Expected:** The host can bound initialization and offer an accessible recovery action.
- **Actual:** PairUp supplies an eight-second timer, closes the failed bridge, removes the frame/skeleton and points the user to Deals or spoken status. This is an integration concern found in code review; no SDK outage rate was measured.
- **Severity:** minor (host integration effort).
- **Workaround:** A host-owned timeout and cleanup path.
- **Suggestion:** Document the failure path in the official basic host or expose a configurable initialization helper. Draft: [upstream/mcp-apps-init-timeout.md](upstream/mcp-apps-init-timeout.md).

### RING-1 — Presence demo spans Playground, Event History and webhooks
- **Who / when:** Ring handoff research, reviewed with starter/API/UX docs by Codex October 20, 2026 HKT.
- **Tool / API / SDK:** Ring Partner API, Playground, ring-api-helloworld.
- **Task attempted:** Rehearse two arrivals without a physical doorbell.
- **Steps taken:** Compared the starter device, event and webhook routes with the API reference; exercised PairUp's signed webhook simulator locally.
- **Expected:** One simulator workflow demonstrates the same event-to-arrival path used by the application.
- **Actual:** The starter's event endpoint uses its local webhook store. PairUp reads Ring Event History and accepts HMAC webhooks; its own webhook sender provides a labelled local rehearsal. Fresh Playground/device footage remains to be collected by Tony.
- **Severity:** minor (multiple demo setup steps).
- **Workaround:** Keep official Playground/device evidence separate from the local simulated webhook, and label each in the recording.
- **Suggestion:** Add a documented Playground presence-event/webhook test workflow with the expected Event History payload and signature setup.

### BEE-1 — Reproducible bridge tests and device provenance are separate steps
- **Who / when:** Codex, October 20, 2026 HKT; current CLI/Skill docs and local replay.
- **Tool / API / SDK:** Bee CLI, developer API, official Bee Skill/MCP.
- **Task attempted:** Use an exam-related need to prepare a calculator request.
- **Steps taken:** Checked `stream --json --types` and all subscribed event names against the CLI README; read the official Skill; replayed the checked-in fixture into a fresh local server.
- **Expected:** Summary and todo events produce private suggestions; unrelated context creates no request.
- **Actual:** Calculator and paper snippets produced suggestions. Raw utterances are excluded. Local fixture coverage is reproducible; actual Bee-device or Bee-on-Watch data still needs a capture during recording.
- **Severity:** minor (rehearsal/provenance documentation effort).
- **Workaround:** Label replay data; pair the official Bee Skill with PairUp's Skill; use a real Bee data source in the submitted demo.
- **Suggestion:** Publish a small versioned stream-fixture set and an end-to-end tutorial showing a device event, CLI JSON and a consent-based downstream action.

### Coverage of remaining used tools

These are explicit review records, including successful tasks. **None** means no failure was observed; it is not a claim of bonus-worthy friction. Historical cloud onboarding observations remain attributed to Tony/Claude above. The future-use and onboarding answers for every integration are in [PRODUCT_FEEDBACK.md](PRODUCT_FEEDBACK.md).

| Tool | Task and steps | Expected → actual | Severity | Workaround | Actionable suggestion |
|---|---|---|---|---|---|
| Agent Skills format | Parse YAML, inspect names/keys/references and compare current tools | Valid portable skill → spec test passes; corrected stale repository URLs | None | Current repo links and schema tests | Add a discovery/distribution example to the format guide |
| Bedrock Titan embeddings / Nova Converse | Review runtime calls and run local fallback; prepare evidence collector | Identify a real call → configured mode alone also covers fallback, so added actual `inference` reporting | Minor (application observability) | `npm run evidence` requires a successful real Bedrock result | Expose clear model/fallback provenance in starter examples |
| Strands SDK | Compile MCP-connected agent and run four scripted conversations | Same consent rules across hosts → all four pass | Minor historical streaming example issue above | Read wrapped stream events | Compile published quick starts against each supported peer version |
| AgentCore Runtime | Compile runtime package and review invocation contract | Local streaming handler reachable → historical 406/400 entry above; current tests pass | Minor, historical | Send documented headers | Include a complete local invocation command |
| CloudFormation / DLM | Review deployment and historical stack creation record | Valid snapshot description → punctuation caused rollback in prior run | Minor, historical | DLM-safe description | Validate the property pattern at changeset creation |
| AWS CLI / SSM / Parameter Store / S3 | Review deploy script and historical Windows deployment | Preserve names and temp-file paths → MSYS rewrote both in prior run | Minor, historical | `MSYS_NO_PATHCONV=1` and Windows file paths | Add a Windows Git Bash recipe for SSM deployment |
| EC2 Graviton / IAM / ECR | Review role-based ARM64 service/runtime definitions | Builds and least-scope credentials described in deployment code → local package checks pass; live proof remains pending | None observed locally | Use the documented deploy/evidence workflow | Provide one ARM64 MCP + AgentCore deployment reference |
| CloudFront | Review origin verification and health/build identity | Public release can be identified → read-only checker compares versions, commit and fingerprint | None observed locally | Deploy submitted commit and rerun checker | Include release identity checks in sample hosting guides |
| CloudWatch / SNS / encrypted EBS snapshots | Inspect metrics, alarms and recovery definitions | Operations hooks in code → definitions present; cloud delivery/recovery not exercised in this audit | None observed locally | Follow deployment and recovery runbook | Show a combined request/tool trace and recovery rehearsal in the sample |
| Login with Amazon / OAuth | Run auth tests and review client registration/sign-in flow | Caller identity stays scoped → local tests pass; live LWA profile sign-in requires Tony's account | None observed locally | Rehearse a fresh judge sign-in after deployment | Include a hosted MCP + public PKCE-client walkthrough |
| PGlite / PostgreSQL / pgvector | Run market transactions and privacy/schedule tests | Persistent relational/vector behavior → suite passes locally | None | In-memory DB for tests | Add a small pgvector transaction test fixture |
| Express / Zod / TypeScript / esbuild / Node.js | Install, typecheck, bundle and run transport tests | Validated HTTP and reproducible browser assets → checks pass locally | None | Current locked dependencies | Keep shared source/bundle consistency checks in templates |
| pairing-core / Rust / WebAssembly | Exercise price settlement through existing market invariant tests | Fixed cents rule and private views → tests pass | None | Vendored prebuilt module; separate upstream ownership | Retain cross-runtime test vectors with every release |
