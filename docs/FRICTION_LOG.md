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
