import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { requireExplicitYes } from "../src/agent/index.js";
import { planOffline } from "../src/agent/offline.js";
import type { AgentMessage, Block } from "../src/agent/types.js";
import { createMockAi } from "../src/ai/mock.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, type Db } from "../src/db/client.js";

// The web app's assistant: the offline planner's understanding of speech, the
// confirm guard, and whole spoken conversations run the way the web app runs
// them (agent step over HTTP → MCP tool calls → results back to the agent).

const user = (text: string): AgentMessage => ({ role: "user", content: [{ text }] });
const toolUse = (step: ReturnType<typeof planOffline>) => {
  const b = step.content.find((x): x is Extract<Block, { toolUse: unknown }> => "toolUse" in x);
  return b?.toolUse;
};

test("understands selling, with a private minimum, place and condition", () => {
  const use = toolUse(planOffline([user("Sell my TI-84 graphing calculator for $20 on HKUST campus, like new. I'll take anything above $15.")]));
  assert.deepEqual(use && { name: use.name, input: use.input }, {
    name: "create_listing",
    input: { title: "TI-84 graphing calculator", ask_price: 20, min_price: 15, location: "HKUST campus", condition: "like_new" },
  });
});

test("asks for a missing price and uses the answer", () => {
  const ask = planOffline([user("I want to sell my desk lamp")]);
  assert.equal(ask.stop, "end_turn");
  const question = (ask.content[0] as { text: string }).text;
  assert.equal(question, 'How much do you want for "desk lamp"?');
  const use = toolUse(planOffline([user("I want to sell my desk lamp"), { role: "assistant", content: [{ text: question }] }, user("8 dollars")]));
  assert.equal(use?.name, "create_listing");
  assert.deepEqual(use?.input, { title: "Desk lamp", ask_price: 8 });
});

test("passes buy requests through in the user's own words", () => {
  const use = toolUse(planOffline([user("I need a graphing calculator today, maximum $18")]));
  assert.deepEqual(use && { name: use.name, input: use.input }, { name: "create_buy_intent", input: { raw_request: "I need a graphing calculator today, maximum $18" } });
});

test("yes confirms the offer waiting for the user; no declines it", () => {
  const history: AgentMessage[] = [
    user("I need a lamp, max $10"),
    { role: "assistant", content: [{ toolUse: { toolUseId: "t1", name: "create_buy_intent", input: { raw_request: "I need a lamp, max $10" } } }] },
    { role: "user", content: [{ toolResult: { toolUseId: "t1", status: "success", content: [{ json: {
      intent: { intent_id: "int_1" }, deal: { deal_id: "deal_9", status: "proposed", waiting_for_you: true }, say: "Found it…",
    } }] } }] },
    { role: "assistant", content: [{ text: "Found it…" }] },
  ];
  assert.deepEqual(toolUse(planOffline([...history, user("Yes, confirm it")]))?.input, { deal_id: "deal_9" });
  assert.equal(toolUse(planOffline([...history, user("Yes, confirm it")]))?.name, "confirm_deal");
  assert.equal(toolUse(planOffline([...history, user("No thanks")]))?.name, "decline_deal");
  assert.deepEqual(toolUse(planOffline([...history, user("Show me other options")]))?.input, { intent_id: "int_1", limit: 4 });
  assert.equal(toolUse(planOffline([user("yes")]))?.name, "get_deal_status", "a yes with nothing pending checks the inbox");
});

test("after a tool runs, the reply is the tool's spoken sentence", () => {
  const step = planOffline([
    user("any news?"),
    { role: "assistant", content: [{ toolUse: { toolUseId: "t2", name: "get_deal_status", input: {} } }] },
    { role: "user", content: [{ toolResult: { toolUseId: "t2", content: [{ json: { deals: [], say: "You don't have any deals yet." } }] } }] },
  ]);
  assert.deepEqual(step, { content: [{ text: "You don't have any deals yet." }], stop: "end_turn" });
});

test("take it down: lists the user's posts, then withdraws the one they named", () => {
  const first = planOffline([user("Take down my umbrella listing")]);
  assert.equal(toolUse(first)?.name, "list_my_posts");
  const next = planOffline([
    user("Take down my umbrella listing"),
    { role: "assistant", content: first.content },
    { role: "user", content: [{ toolResult: { toolUseId: toolUse(first)!.toolUseId, content: [{ json: {
      listings: [{ listing_id: "lst_a", title: "Compact travel umbrella", status: "active" }, { listing_id: "lst_b", title: "Desk lamp", status: "active" }],
      requests: [], say: "You have two items for sale.",
    } }] } }] },
  ]);
  assert.deepEqual(toolUse(next)?.input, { post_id: "lst_a" });
});

test("a deal is never confirmed without the user's explicit yes", () => {
  const confirm: Block[] = [{ toolUse: { toolUseId: "x", name: "confirm_deal", input: { deal_id: "d" } } }];
  assert.deepEqual(requireExplicitYes(confirm, "yes please"), confirm);
  for (const said of ["what does it cost?", "no, don't", "maybe later", "yes, wait, no"]) {
    assert.deepEqual(requireExplicitYes(confirm, said), [{ text: "Just to be sure: should I confirm it?" }], said);
  }
});

// ---------- whole conversations over HTTP ----------

let db: Db;
let server: Server;
let base: string;

before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: 128 }, { inMemory: true });
  const cfg = { ...config, host: "127.0.0.1", authMode: "none" as const, aiMode: "mock" as const, mcpApiKey: "", allowedOrigins: [] };
  const app = createApp({ db, ai: createMockAi(128), cfg: { matchThreshold: 0.35 } }, cfg);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
after(async () => {
  server.close();
  await db.close();
});

/** A signed-in web app session: the same loop as src/web/main.ts. */
async function session(userId: string) {
  const headers = { "X-User-Id": userId, Origin: base };
  const client = new Client({ name: "web-test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  const { tools } = await client.listTools();
  const messages: AgentMessage[] = [];
  const cards: { tool: string; view: string; data: Record<string, unknown> }[] = [];
  return {
    cards,
    tools,
    async say(text: string) {
      messages.push(user(text));
      for (let step = 0; step < 6; step++) {
        const res = await fetch(`${base}/api/agent`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });
        assert.equal(res.status, 200);
        const turn = await res.json();
        assert.equal(turn.mode, "offline");
        messages.push(turn.message);
        const uses = turn.message.content.filter((b: Block) => "toolUse" in b).map((b: Extract<Block, { toolUse: unknown }>) => b.toolUse);
        if (turn.stop === "end_turn") return turn.message.content.map((b: { text?: string }) => b.text ?? "").join(" ");
        const results: Block[] = [];
        for (const use of uses) {
          const r = (await client.callTool({ name: use.name, arguments: use.input })) as CallToolResult;
          const view = (r._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri;
          if (view) cards.push({ tool: use.name, view, data: r.structuredContent as Record<string, unknown> });
          results.push({ toolResult: { toolUseId: use.toolUseId, status: r.isError ? "error" : "success", content: [{ json: (r.structuredContent ?? JSON.parse((r.content as { text: string }[])[0].text)) as Record<string, unknown> }] } });
        }
        messages.push({ role: "user", content: results });
      }
      throw new Error("too many steps");
    },
    close: () => client.close(),
  };
}

test("a spoken sale and purchase, end to end through the web app's loop", async () => {
  const seller = await session("u_mei");
  const buyer = await session("u_ken");

  const listed = await seller.say("Sell my TI-84 graphing calculator for $20 on HKUST campus. I'll take anything above $15.");
  assert.match(listed, /Listed TI-84 graphing calculator for \$20/);

  const offer = await buyer.say("I need a graphing calculator today, maximum $18");
  assert.equal(offer, "Found it: TI-84 graphing calculator for $17, $3 below asking. Meet-up: HKUST campus. Should I confirm it?");
  const card = buyer.cards.at(-1)!;
  assert.equal(card.view, "ui://amazonpairup/market.html", "the result names its MCP Apps view");
  assert.equal((card.data.deal as { price: number }).price, 17);

  assert.equal(await buyer.say("what does it cost?"), "Say things like: sell my TI-84 for 20 dollars, I'll take anything above 15. Or: I need a graphing calculator, maximum 18 dollars.".replace("Say", "You can say"));
  const done = await buyer.say("Yes, confirm it");
  assert.match(done, /^Done! TI-84 graphing calculator for \$17 with u_mei\. Meet-up: HKUST campus\.$/);
  assert.match(await seller.say("Any news on my deals?"), /confirmed with u_ken/);

  for (const s of [seller, buyer]) await s.close();
});

test("a buyer who forgets the budget is asked, and the answer completes the request", async () => {
  const buyer = await session("u_ana");
  assert.match(await buyer.say("I need an umbrella"), /most you'd pay/);
  assert.match(await buyer.say("12 dollars"), /^Got it: umbrella, up to \$12\./);
  await buyer.close();
});

test("tools declare the AmazonPairUp MCP Apps view, and the view is served", async () => {
  const s = await session("u_viewer");
  const withUi = s.tools.filter((t) => (t._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri === "ui://amazonpairup/market.html");
  assert.deepEqual(withUi.map((t) => t.name).sort(), ["confirm_deal", "create_buy_intent", "create_listing", "decline_deal", "find_matches", "get_deal_status", "list_my_posts", "negotiate"]);
  const client = new Client({ name: "res", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { "X-User-Id": "u_viewer" } } }));
  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((r) => [r.uri, r.mimeType]), [["ui://amazonpairup/market.html", "text/html;profile=mcp-app"]]);
  const { contents } = await client.readResource({ uri: "ui://amazonpairup/market.html" });
  assert.match((contents[0] as { text: string }).text, /^<!doctype html>.*<script type="module">/s);
  for (const c of [client, s]) await c.close();
});

test("the agent endpoint needs a signed-in user and a well-formed conversation", async () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/agent`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ messages: [user("hi")] })).status, 401);
  assert.equal((await post({ messages: [] }, { "X-User-Id": "u_x" })).status, 400);
  assert.equal((await post({ messages: [{ role: "assistant", content: [{ text: "hi" }] }] }, { "X-User-Id": "u_x" })).status, 400);
  assert.equal((await post({ messages: [user("hi")] }, { "X-User-Id": "u_x", Origin: "https://evil.example" })).status, 403);
  const ok = await post({ messages: [user("hi")] }, { "X-User-Id": "u_x" });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).stop, "end_turn");
});

test("the web app is served at /app/ and the root sends people there", async () => {
  const root = await fetch(`${base}/`, { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/app/");
  const page = await fetch(`${base}/app/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<script type="module" src="\/app\/app.js">/);
  assert.equal((await fetch(`${base}/app/app.js`)).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/app-config`)).json(), { auth: "none" });
});
