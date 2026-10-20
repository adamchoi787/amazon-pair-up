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
- **Actual:** The changeset was created without complaint; the DLM handler then returned `The following parameter(s) are invalid: Description {AmazonPairUp daily EBS snapshots, kept for 7 days}`. The comma is the problem (the pattern allows only letters, digits, spaces, `_` and `-`), but the message does not say which character or which pattern. The whole stack rolled back to `ROLLBACK_COMPLETE`, which cannot be updated, so it had to be deleted before trying again.
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
