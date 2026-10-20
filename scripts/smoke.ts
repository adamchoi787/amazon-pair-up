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
  await client.listTools(); // lets the SDK validate every result against its outputSchema
  return client;
}

async function call(client: Client, who: string, name: string, args: Record<string, unknown>, hidden: string[] = []) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text: string }[])[0].text;
  const body = JSON.parse(text);
  console.log(`\n${who} → ${name}\n  Alexa: "${body.say}"`);
  if (res.isError) throw new Error(body.say);
  for (const field of hidden) if (text.includes(field)) throw new Error(`PRIVACY LEAK: ${who} saw ${field}`);
  return body;
}

const seller = await connectAs("demo_seller");
const buyer = await connectAs("demo_buyer");
const { tools } = await buyer.listTools();
console.log(`Connected. Protocol OK. Tools: ${tools.map((t) => t.name).join(", ")}`);

// "Alexa, sell my TI-84 for $20. I'll accept anything above $15."
const { offer } = await call(seller, "Seller", "post_offer", {
  title: "TI-84 Plus graphing calculator",
  description: "Works perfectly, new batteries.",
  category: "calculator",
  condition: "good",
  ask_price: 20,
  min_price: 15,
  location: "HKUST campus",
  availability: "weekdays after 5pm",
});

// "Alexa, I need a graphing calculator today, maximum $18." (The buyer is on campus too.)
const { deal, alternatives } = await call(buyer, "Buyer", "post_request", {
  raw_request: "I need a graphing calculator today, maximum $18",
  location: "HKUST campus",
}, ["min_price"]);
if (!deal || deal.offer_id !== offer.offer_id) throw new Error("Expected the TI-84 to be paired in one turn");
if (!deal.meetup.hub_point) throw new Error("Expected an Amazon Hub point as the campus meet-up");
for (const m of alternatives) console.log(`   other option: ${m.title}, ask ${m.ask_price} (score ${m.score})`);

// Buyer: "Yes."
await call(buyer, "Buyer", "confirm_deal", { deal_id: deal.deal_id }, ["min_price"]);
// Seller: "Did anyone buy my calculator?"
await call(seller, "Seller", "get_deal_status", {}, ["max_price"]);

// The same market pairs services. "I can do lunch runs around campus, $4 a run, at least $3."
const runner = await connectAs("demo_runner");
const hungry = await connectAs("demo_hungry");
const { offer: runs } = await call(runner, "Runner", "post_offer", {
  kind: "service",
  title: "Lunch runs around campus",
  description: "I'll pick up food from any campus canteen and bring it to your hall.",
  category: "delivery",
  price_unit: "job",
  ask_price: 4,
  min_price: 3,
  location: "HKUST campus",
  availability: "weekdays 11am-2pm",
});
// "Find someone to pick up my lunch from LG7 canteen to Hall 5 by 12:30, $5."
const lunch = await call(hungry, "Requester", "post_request", {
  raw_request: "find someone to pick up my lunch from LG7 canteen to Hall 5 by 12:30, $5",
}, ["min_price"]);
if (!lunch.deal || lunch.deal.offer_id !== runs.offer_id) throw new Error("Expected the lunch run to be paired in one turn");
await call(hungry, "Requester", "confirm_deal", { deal_id: lunch.deal.deal_id }, ["min_price"]);
// Runner: "Any jobs for me?" then "Yes."
await call(runner, "Runner", "get_deal_status", {}, ["max_price"]);
await call(runner, "Runner", "confirm_deal", { deal_id: lunch.deal.deal_id }, ["max_price"]);
await runner.close();
await hungry.close();

await seller.close();
await buyer.close();
console.log("\nSmoke test passed.");
