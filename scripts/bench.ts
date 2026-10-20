// Latency benchmark over real MCP (Streamable HTTP), as many clients at once.
// Each worker plays one round after another: a seller lists an item, a buyer
// asks for it (post_request pairs and settles in the same call), the buyer asks
// for more options (find_matches) and says yes (confirm_deal). Every round uses
// fresh users, so posting limits and per-caller rate limits don't skew it.
//
// Usage: npm start (in another terminal), then
//   npm run bench [-- --url http://host/mcp --concurrency 10 --rounds 10]
// Prints p50/p95/p99 per tool and calls per second. It writes to the market it
// targets: point it at a local or staging server, not at production.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:3000/mcp" },
    concurrency: { type: "string", short: "c", default: "10" },
    rounds: { type: "string", short: "n", default: "10" },
  },
});
const url = new URL(values.url!);
const concurrency = Number(values.concurrency);
const rounds = Number(values.rounds);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100 || !Number.isInteger(rounds) || rounds < 1 || rounds > 10000) throw new Error("Use concurrency 1–100 and rounds 1–10000.");
const apiKey = process.env.MCP_API_KEY;
const run = randomUUID().slice(0, 8);

const MEASURED = ["post_request", "find_matches", "confirm_deal"] as const;
const samples = new Map<string, number[]>();
const errors = new Map<string, number>();
let calls = 0;

async function connectAs(userId: string) {
  const headers: Record<string, string> = { "X-User-Id": userId };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const client = new Client({ name: `bench-${userId}`, version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
  return client;
}

/** One timed tool call. Errors are counted, not thrown, so one slow call can't stop the run. */
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const start = performance.now();
  try {
    const res = await client.callTool({ name, arguments: { ...args, ...(name === "find_matches" ? {} : { idempotency_key: randomUUID() }) } });
    const ms = performance.now() - start;
    calls++;
    if (res.isError) {
      errors.set(name, (errors.get(name) ?? 0) + 1);
      return null;
    }
    samples.set(name, [...(samples.get(name) ?? []), ms]);
    return res.structuredContent as Record<string, any>;
  } catch {
    calls++;
    errors.set(name, (errors.get(name) ?? 0) + 1);
    return null;
  }
}

async function worker(w: number) {
  for (let r = 0; r < rounds; r++) {
    const tag = `${run}-${w}-${r}`;
    const seller = await connectAs(`bench-s-${tag}`);
    const buyer = await connectAs(`bench-b-${tag}`);
    // A made-up item per round, so each buyer is paired with its own seller.
    const item = `Bench widget ${tag}`;
    await call(seller, "post_offer", { title: item, category: "bench", ask_price: 20, min_price: 15, location: "HKUST campus", confirm_price: true });
    const req = await call(buyer, "post_request", { need: item, max_price: 18, location: "HKUST campus", confirm_price: true });
    if (req) await call(buyer, "find_matches", { request_id: req.request.request_id });
    if (req?.deal) await call(buyer, "confirm_deal", { deal_id: req.deal.deal_id });
    await Promise.all([seller.close(), buyer.close()]);
  }
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

console.log(`Benchmarking ${url} with ${concurrency} concurrent clients × ${rounds} rounds…`);
const start = performance.now();
await Promise.all(Array.from({ length: concurrency }, (_, w) => worker(w)));
const seconds = (performance.now() - start) / 1000;

const rows = ["post_offer", ...MEASURED].map((tool) => {
  const xs = [...(samples.get(tool) ?? [])].sort((a, b) => a - b);
  const ms = (p: number) => (xs.length ? pct(xs, p).toFixed(0) : "-");
  return { tool, ok: xs.length, errors: errors.get(tool) ?? 0, p50: ms(50), p95: ms(95), p99: ms(99) };
});
console.log(`\n${"tool".padEnd(14)}${"ok".padStart(6)}${"errors".padStart(8)}${"p50 ms".padStart(9)}${"p95 ms".padStart(9)}${"p99 ms".padStart(9)}`);
for (const r of rows) {
  console.log(`${r.tool.padEnd(14)}${String(r.ok).padStart(6)}${String(r.errors).padStart(8)}${r.p50.padStart(9)}${r.p95.padStart(9)}${r.p99.padStart(9)}`);
}
console.log(`\n${calls} calls in ${seconds.toFixed(1)} s: ${(calls / seconds).toFixed(1)} calls/s`);
if ([...errors.values()].some((n) => n > 0)) process.exitCode = 1;
