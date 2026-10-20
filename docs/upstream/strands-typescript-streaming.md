# Draft issue: AgentCore streaming quick start uses the inner Strands event shape

Destination: [bedrock-agentcore-sdk-typescript issues](https://github.com/aws/bedrock-agentcore-sdk-typescript/issues).
Status: **draft; Tony publishes**. The affected example lives in the AgentCore README and consumes Strands events.

## Ready-to-paste body

With `bedrock-agentcore@0.4.6` and `@strands-agents/sdk@1.21.0`, the README's `agent.stream(request.prompt)` example compares the outer event's type to `modelContentBlockDeltaEvent`. TypeScript reports TS2367; JavaScript misses the text deltas. The text event is nested inside a `modelStreamUpdateEvent` wrapper.

Reproduce: install those versions, copy the README quick start into TypeScript, and run `tsc --noEmit`. Expected: the published quick start compiles and emits text. Actual: the type comparison fails. PairUp's working consumer checks `event.type`, then `event.event.type` and `event.event.delta.type` before yielding `event.event.delta.text`.

Please update the example and add a compile check against the supported peer range. A small candidate fix is attached in `agentcore-streaming.patch`; verify against current upstream before applying. This unblocks developers trying the current TypeScript runtime and avoids a silent empty response in JavaScript.

Source evidence: the installed 0.4.6 README, lines 65–67, and `agents/agentcore/src/agent.ts`. Historical reproduction: FRICTION_LOG.md, Strands/AgentCore stream entry.
