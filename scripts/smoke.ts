// End-to-end demo scenario over real Streamable HTTP, as an MCP client.
// Usage: npm start (in another terminal), then: npm run smoke [-- http://host/mcp]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.argv[2] ?? "http://127.0.0.1:3000/mcp");
const apiKey = process.env.MCP_API_KEY;

async function connectAs(userId: string) {
  const headers: Record<string, string> = { "X-User-Id": userId };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const client = new Client({ name: `smoke-${userId}`, version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
  return client;
}

async function call(client: Client, who: string, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const body = JSON.parse((res.content as { text: string }[])[0].text);
  console.log(`\n${who} → ${name}\n  Alexa: "${body.say}"`);
  if (res.isError) throw new Error(body.say);
  return body;
}

const seller = await connectAs("demo_seller");
const buyer = await connectAs("demo_buyer");

const { tools } = await buyer.listTools();
console.log(`Connected. Protocol OK. Tools: ${tools.map((t) => t.name).join(", ")}`);

// "Alexa, sell my TI-84 for $20. I'll accept anything above $15."
const { listing } = await call(seller, "Seller", "create_listing", {
  title: "TI-84 Plus graphing calculator",
  description: "Works perfectly, new batteries.",
  category: "calculator",
  condition: "good",
  ask_price: 20,
  min_price: 15,
  location: "HKUST campus",
});

// "Alexa, I need a graphing calculator today, maximum $18."
const { intent } = await call(buyer, "Buyer", "create_buy_intent", {
  raw_request: "I need a graphing calculator today, maximum $18",
});
const { matches } = await call(buyer, "Buyer", "find_matches", { intent_id: intent.intent_id });
for (const m of matches) console.log(`   • ${m.title} — ask ${m.ask_price} (score ${m.score})`);

const pick = matches.find((m: { listing_id: string }) => m.listing_id === listing.listing_id) ?? matches[0];
const { deal } = await call(buyer, "Buyer", "negotiate", { intent_id: intent.intent_id, listing_id: pick.listing_id });
if ("your_min_price" in pick || JSON.stringify(deal).includes("min_price")) throw new Error("PRIVACY LEAK");

// Buyer: "Yes."
await call(buyer, "Buyer", "confirm_deal", { deal_id: deal.deal_id });
await call(seller, "Seller", "get_deal_status", {});

await seller.close();
await buyer.close();
console.log("\nSmoke test passed.");
