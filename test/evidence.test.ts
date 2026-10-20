import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { handleAgentTurn } from "../src/agent/index.js";
import { config } from "../src/config.js";
import type { Deps } from "../src/market/service.js";

test("evidence distinguishes a real Bedrock response from its offline fallback", async () => {
  const request = { messages: [{ role: "user", content: [{ text: "What can you do?" }] }] };
  const cfg = { ...config, aiMode: "bedrock" as const, agentModelId: "test-model" };
  const send = mock.method(BedrockRuntimeClient.prototype, "send", async () => { throw Error("test outage"); });
  try {
    assert.equal((await handleAgentTurn({} as Deps, cfg, request)).inference, "offline");
    send.mock.mockImplementation(async () => ({ output: { message: { role: "assistant", content: [{ text: "Hello" }] } }, stopReason: "end_turn" }));
    assert.equal((await handleAgentTurn({} as Deps, cfg, request)).inference, "bedrock");
  } finally { send.mock.restore(); }
});
