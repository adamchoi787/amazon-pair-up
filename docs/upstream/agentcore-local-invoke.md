# Draft issue: document the local streaming invocation headers

Destination: [bedrock-agentcore-sdk-typescript issues](https://github.com/aws/bedrock-agentcore-sdk-typescript/issues).
Status: **draft; Tony publishes**.

## Ready-to-paste body

The `bedrock-agentcore@0.4.6` README shows how to start `BedrockAgentCoreApp`, but a minimal JSON POST to `/invocations` first fails with 406, then with 400 after adding Accept. Our local test needed both streaming Accept and a session id before it reached the handler.

Steps: start the README app; POST `{"prompt":"hello"}` with Content-Type application/json; retry with Accept text/event-stream. Expected: an example explains the local runtime contract. Actual: the session-header requirement appears only after the second error.

Please put a complete local curl example directly after `app.run()`, including Content-Type, Accept, and `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`. `agentcore-local-invoke.patch` is a small documentation candidate. The session id in it exceeds the hosted runtime's 32-character minimum. The request may invoke Bedrock and incur model charges.

Historical reproduction: FRICTION_LOG.md, local invocation entry. PairUp's own corrected command is in `agents/agentcore/README.md`.
