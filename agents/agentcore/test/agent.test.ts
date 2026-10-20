import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Model, type Message } from "@strands-agents/sdk";
import type { ModelStreamEvent } from "@strands-agents/sdk";
import { createMockAi } from "../../../src/ai/mock.js";
import { createApp } from "../../../src/app.js";
import { config } from "../../../src/config.js";
import { openDb, type Db } from "../../../src/db/client.js";
import { postOffer, ensureUser } from "../../../src/market/service.js";
import { addContext } from "../../../src/market/context.js";
import { createPairUpAgent, isExplicitYes } from "../src/agent.js";

// The Strands agent against a real PairUp server (in-memory Postgres,
// Streamable HTTP on a local port). A scripted model stands in for Bedrock, so
// the test checks what runs outside the model: tools come from MCP, writes get
// an idempotency_key, and confirm_deal is blocked until the user says yes.

type Step = { tool: string; input: Record<string, unknown> } | { text: string };

test("conditional or questioning approval cannot authorize an agent action", () => {
  for (const text of ["Yes if it's under $10", "Sure but only after 6pm", "Yes, can you check first?", "yes?"]) assert.equal(isExplicitYes(text), false, text);
  assert.equal(isExplicitYes("Yes, confirm it please"), true);
});

/** Plays one scripted step per user turn, then speaks the last tool result's 'say'. */
class ScriptedModel extends Model {
  constructor(private readonly script: Step[]) {
    super();
  }
  updateConfig() {}
  getConfig() {
    return { modelId: "scripted" };
  }
  async *stream(messages: Message[]): AsyncIterable<ModelStreamEvent> {
    const last = messages[messages.length - 1];
    const result = last.content.find((b) => b.type === "toolResultBlock");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if (result) {
      const text = JSON.stringify(result);
      const say = /\\"say\\":\\"([^"\\]*)/.exec(text)?.[1] ?? /"say":"([^"]*)/.exec(text)?.[1] ?? "Done.";
      yield* this.text(say);
      yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
      return;
    }
    const step = this.script.shift();
    if (!step) throw new Error("script ran out");
    if ("text" in step) {
      yield* this.text(step.text);
      yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
      return;
    }
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: step.tool, toolUseId: `t${this.script.length}` } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(step.input) } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
  }
  private *text(text: string): Generator<ModelStreamEvent> {
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text } };
    yield { type: "modelContentBlockStopEvent" };
  }
}

const DIM = 64;
let db: Db;
let server: Server;
let mcpUrl: string;

before(async () => {
  process.chdir(fileURLToPath(new URL("../../..", import.meta.url))); // the server reads data/ and public/ from the repo root
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
  const deps = { db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.35 } };
  await postOffer(deps, {
    user_id: "u_mei", title: "TI-84 Plus graphing calculator", category: "calculator", ask_price: 20, min_price: 15, location: "UW campus",
  });
  const app = createApp(deps, { ...config, host: "127.0.0.1", mcpApiKey: "", authMode: "none" });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  mcpUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/mcp`;
});
after(async () => {
  server?.close();
  await db?.close();
});

test("a Strands agent posts, waits for a yes, then confirms, over MCP", async () => {
  const model = new ScriptedModel([
    { tool: "post_request", input: { raw_request: "I need a graphing calculator today, maximum $18" } },
    { tool: "confirm_deal", input: { deal_id: "PLACEHOLDER" } },
    { tool: "confirm_deal", input: { deal_id: "PLACEHOLDER" } },
  ]);
  const pairup = createPairUpAgent({ mcpUrl, userId: "u_buyer", modelId: "scripted", region: "us-east-1", model });

  const offer = await pairup.ask("I need a graphing calculator today, maximum $18");
  assert.match(offer, /TI-84/, `the agent read the offer: ${offer}`);
  const { rows } = await db.query<{ id: string }>(`SELECT d.id FROM deals d JOIN buy_intents i ON i.id = d.buy_intent_id WHERE i.buyer_id = 'u_buyer'`);
  assert.equal(rows.length, 1, "one deal proposed");
  const keys = await db.query<{ tool: string }>(`SELECT tool FROM idempotent_calls WHERE user_id = 'u_buyer'`);
  assert.deepEqual(keys.rows.map((r) => r.tool), ["post_request"], "the write carried an idempotency_key");

  // The model jumps ahead to confirm_deal on a non-answer: the hook cancels it.
  (model as unknown as { script: Step[] }).script[0] = { tool: "confirm_deal", input: { deal_id: rows[0].id } };
  (model as unknown as { script: Step[] }).script[1] = { tool: "confirm_deal", input: { deal_id: rows[0].id } };
  await pairup.ask("hmm, let me think about it");
  const held = await db.query<{ buyer_confirmed: boolean }>(`SELECT buyer_confirmed FROM deals WHERE id = $1`, [rows[0].id]);
  assert.equal(held.rows[0].buyer_confirmed, false, "no confirmation without a yes");

  await pairup.ask("yes, confirm it");
  const done = await db.query<{ status: string }>(`SELECT status FROM deals WHERE id = $1`, [rows[0].id]);
  assert.equal(done.rows[0].status, "confirmed", "confirmed after the explicit yes");
  await pairup.close();
});

test('a Strands agent waits for approval before accepting a suggestion', async()=>{
  const deps={db,ai:createMockAi(DIM),cfg:{matchThreshold:0.35}};
  const context=await addContext(deps,'u_suggestion_guard',{source:'bee',kind:'todo',text:'Need printer paper'});
  const input={suggestion_id:context.suggestion!.suggestion_id,max_price:5};
  const model=new ScriptedModel([{tool:'accept_suggestion',input},{tool:'accept_suggestion',input}]);
  const pairup=createPairUpAgent({mcpUrl,userId:'u_suggestion_guard',modelId:'scripted',region:'us-east-1',model});
  try{
    await pairup.ask('Let me think');
    assert.equal((await db.query("SELECT id FROM buy_intents WHERE buyer_id='u_suggestion_guard'")).rows.length,0);
    await pairup.ask('yes');
    assert.equal((await db.query("SELECT id FROM buy_intents WHERE buyer_id='u_suggestion_guard'")).rows.length,1);
  }finally{await pairup.close();}
});

test('a Strands agent waits for approval before deleting data', async()=>{
  await ensureUser(db,'u_delete_guard');
  const model=new ScriptedModel([{tool:'delete_my_data',input:{confirm:true}},{tool:'delete_my_data',input:{confirm:true}}]);
  const pairup=createPairUpAgent({mcpUrl,userId:'u_delete_guard',modelId:'scripted',region:'us-east-1',model});
  try{
    await pairup.ask('What do you know about me?');
    assert.equal((await db.query("SELECT id FROM users WHERE id='u_delete_guard'")).rows.length,1);
    await pairup.ask('yes');
    assert.equal((await db.query("SELECT id FROM users WHERE id='u_delete_guard'")).rows.length,0);
  }finally{await pairup.close();}
});
