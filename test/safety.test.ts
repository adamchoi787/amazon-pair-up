import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMockAi } from "../src/ai/mock.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb } from "../src/db/client.js";
import { loadTracks } from "../src/market/learning.js";
import { keywordHit } from "../src/market/policy.js";
import { dashboard, type Deps, type MarketSettings } from "../src/market/service.js";
import { createMcpServer } from "../src/mcp/server.js";

// Trust and safety: what may be posted, reports, ratings and review. Each test
// gets its own in-memory market, over a real MCP client.

const DIM = 64;

async function market(cfg: Partial<MarketSettings> = {}) {
  const db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
  const deps: Deps = { db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.35, ...cfg } };
  const clients: Client[] = [];
  const as = async (userId: string) => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(deps, { userId }).connect(a);
    const client = new Client({ name: "safety-test", version: "0" });
    await client.connect(b);
    await client.listTools(); // the SDK then checks every result against its outputSchema
    clients.push(client);
    return async (name: string, args: Record<string, unknown>) => {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as { text: string }[])[0].text;
      return { ...JSON.parse(text), _raw: text, _isError: !!res.isError };
    };
  };
  const close = async () => {
    for (const c of clients) await c.close();
    await db.close();
  };
  return { db, deps, as, close };
}

const count = async (db: Deps["db"], sql: string, params: unknown[] = []) =>
  (await db.query<{ n: number }>(sql, params)).rows[0].n;

test("keyword rules catch each prohibited category and leave everyday posts alone", () => {
  const blocked: [string, string][] = [
    ["Glock 19 handgun, barely used", "weapons"],
    ["box of 9mm ammo", "weapons"],
    ["need someone to pick up some w33d for me", "drugs"],
    ["c.o.c.a.i.n.e", "drugs"],
    ["leftover Adderall before finals", "prescription_medicine"],
    ["can someone buy me a bottle of vodka", "alcohol"],
    ["disposable vapes, 10 pack", "tobacco"],
    ["recalled baby car seat", "recalled"],
    ["fake Rolex, looks real", "counterfeit"],
    ["cracked Photoshop licence", "counterfeit"],
    ["novelty ID card", "documents"],
    ["selling my Netflix account", "documents"],
    ["write my essay for me, 2000 words", "academic_dishonesty"],
    ["take my online exam for me", "academic_dishonesty"],
    ["massage with a happy ending", "adult_services"],
    ["puppies for sale", "animals"],
    ["selling my hamster", "animals"],
    ["ivory carving", "animals"],
    ["hack into my ex's instagram", "illegal_services"],
    ["buy Instagram followers", "illegal_services"],
  ];
  for (const [text, category] of blocked) assert.equal(keywordHit(text)?.category, category, text);

  const allowed = [
    "Glue gun for crafts", "Nerf gun with darts", "Water pistol", "Cat sitting, per visit", "Dog walking around campus",
    "Hamster cage with wheel", "Kitten heels, size 38", "Wine glasses, set of 4", "Beer pong table", "Alcohol wipes, 3 packs",
    "Grab me a coke from the canteen", "Weed the garden for me", "Redmi Note 7 phone", "Prescription swim goggles",
    "Pharmacy run: over-the-counter items only", "Python tutoring, homework help", "Proofreading, up to 2000 words",
    "Laptop setup and malware removal", "Bullet journal, unused", "Ginger tea", "School spirit hoodie", "Fish tank 20L",
    "TI-83 Plus graphing calculator, cracked screen",
  ];
  for (const text of allowed) assert.equal(keywordHit(text), null, text);

  // Every seed post passes.
  const seed = JSON.parse(readFileSync("data/seed-listings.json", "utf8")) as { listings: { title: string; description?: string; category?: string }[] };
  for (const l of seed.listings) {
    const text = [l.title, l.description, l.category].filter(Boolean).join(". ");
    assert.equal(keywordHit(text), null, text);
  }
});

test("a prohibited offer or request is refused before anything is stored, with a code an agent can act on", async () => {
  const m = await market();
  const seller = await m.as("u_glock");
  const gun = await seller("post_offer", { title: "Glock 19 handgun", category: "sports", ask_price: 300 });
  assert.equal(gun._isError, true);
  assert.equal(gun.code, "prohibited_item");
  assert.equal(gun.category, "weapons");
  assert.equal(gun.matched_by, "keyword");
  assert.equal(gun.say, "I can't post that. PairUp doesn't allow weapons, ammunition and explosives.");
  assert.equal(await count(m.db, `SELECT count(*)::int AS n FROM listings`), 0, "nothing listed");

  // A request is checked before its budget is even asked for.
  const buyer = await m.as("u_thirsty");
  const vodka = await buyer("post_request", { raw_request: "can someone buy me a bottle of vodka from the store" });
  assert.equal(vodka.code, "restricted_item");
  assert.equal(vodka.category, "alcohol");
  assert.match(vodka.say, /doesn't allow alcohol, since selling it needs an age check and a licence\.$/);
  assert.equal(await count(m.db, `SELECT count(*)::int AS n FROM buy_intents`), 0, "nothing requested");

  // Wording the keywords miss is caught by meaning.
  const escort = await buyer("post_request", { need: "escort for tonight", max_price: 200 });
  assert.equal(escort.code, "prohibited_item");
  assert.equal(escort.category, "adult_services");
  assert.equal(escort.matched_by, "meaning");

  // Services are checked the same way, and an allowed one still posts.
  const runner = await m.as("u_runner");
  const essay = await runner("post_offer", { kind: "service", title: "I'll write your essay for you", ask_price: 50 });
  assert.equal(essay.category, "academic_dishonesty");
  const ok = await runner("post_offer", { kind: "service", title: "Grocery runs from Hang Hau", category: "delivery", ask_price: 5 });
  assert.equal(ok._isError, false);

  assert.equal(await count(m.db, `SELECT count(*)::int AS n FROM events WHERE kind = 'post_blocked'`), 4, "every refusal is on the audit trail");
  await m.close();
});

test("refused posts count toward the hourly limit, so rewording again and again runs out", async () => {
  const m = await market({ postsPerHour: 2 });
  const user = await m.as("u_persistent");
  for (const title of ["vodka", "v0dka bottle"]) assert.equal((await user("post_offer", { title, ask_price: 20 })).code, "restricted_item");
  const third = await user("post_offer", { title: "Desk lamp", category: "furniture", ask_price: 8 });
  assert.equal(third._isError, true);
  assert.match(third.say, /posted a lot in the last hour/);
  await m.close();
});

/** A confirmed deal between a seller and a buyer over a pair of earbuds. */
async function closedDeal(m: Awaited<ReturnType<typeof market>>, sellerId: string, buyerId: string) {
  const seller = await m.as(sellerId);
  const buyer = await m.as(buyerId);
  await seller("post_offer", { title: "Wired earbuds with mic", category: "headphones", ask_price: 8, min_price: 6 });
  const req = await buyer("post_request", { need: "earbuds", max_price: 8 });
  assert.ok(req.deal, "paired");
  return { seller, buyer, deal: req.deal };
}

test("each side rates a confirmed deal once, and ratings move the track record the ranking uses", async () => {
  const m = await market();
  const { seller, buyer, deal } = await closedDeal(m, "u_sony", "u_listener");

  const early = await buyer("rate_deal", { deal_id: deal.deal_id, stars: 5 });
  assert.equal(early.code, "not_confirmed", "only a confirmed deal can be rated");
  await buyer("confirm_deal", { deal_id: deal.deal_id });
  const before = (await loadTracks(m.db, ["u_sony"], ["u_listener"])).seller.get("u_sony")!;

  const rated = await buyer("rate_deal", { deal_id: deal.deal_id, stars: 5 });
  assert.deepEqual(rated.rating, { deal_id: deal.deal_id, stars: 5, rated_role: "seller" });
  assert.equal(rated.say, "Thanks! I've given u_sony five stars.");
  assert.equal((await buyer("rate_deal", { deal_id: deal.deal_id, stars: 1 })).code, "already_rated", "once per side");

  const low = await seller("rate_deal", { deal_id: deal.deal_id, stars: 1 });
  assert.equal(low.rating.rated_role, "buyer");
  assert.match(low.say, /one star\. If something went wrong, I can report it for review\.$/);
  assert.ok(!low._raw.includes('"stars":5'), "the other side's rating of you stays private");

  const outsider = await m.as("u_nosy");
  assert.equal((await outsider("rate_deal", { deal_id: deal.deal_id, stars: 3 }))._isError, true);

  // One closed deal is (1 + 1) / (1 + 2); five stars add another success, one star a failure.
  const tracks = await loadTracks(m.db, ["u_sony"], ["u_listener"]);
  assert.equal(before, 2 / 3);
  assert.equal(tracks.seller.get("u_sony"), 3 / 4);
  assert.equal(tracks.buyer.get("u_listener"), 2 / 4);
  await m.close();
});

test("a report cancels the open deal, and the reporter and the reported person are never paired again", async () => {
  const m = await market();
  const shady = await m.as("u_shady");
  const fair = await m.as("u_fair");
  const buyer = await m.as("u_wary");
  const { offer: shadyOffer } = await shady("post_offer", { title: "Folding umbrella", category: "umbrella", ask_price: 10 });
  const req = await buyer("post_request", { need: "umbrella", max_price: 12 });
  assert.equal(req.deal.offer_id, shadyOffer.offer_id);
  const { offer: fairOffer } = await fair("post_offer", { title: "Compact umbrella", category: "umbrella", ask_price: 11 });

  const report = await buyer("report_user", { deal_id: req.deal.deal_id, reason: "scam", details: "Asked me to pay up front." });
  assert.equal(report.report.status, "received");
  assert.equal(report.report.released_deal_id, req.deal.deal_id);
  assert.equal(report.say, "Thanks for telling me. I've passed this on for review, and I won't pair you with them again. I've also cancelled the deal you had with them.");
  assert.ok(!report._raw.includes("u_shady"), "the reporter never sees the other person's account id");

  const status = await buyer("get_deal_status", {});
  const next = status.deals.find((d: { status: string }) => d.status === "proposed");
  assert.equal(next?.offer_id, fairOffer.offer_id, "the request is paired with someone else right away");

  // A later request from the reporter never lands on the reported person's post, and neither do the options.
  await buyer("decline_deal", { deal_id: next.deal_id });
  const again = await buyer("post_request", { need: "rain umbrella", max_price: 15 });
  assert.equal(again.deal?.offer_id, fairOffer.offer_id);
  assert.ok(!again.alternatives.some((o: { offer_id: string }) => o.offer_id === shadyOffer.offer_id));

  const twice = await buyer("report_user", { post_id: shadyOffer.offer_id, reason: "other" });
  assert.equal(twice.report.status, "already_reported");
  assert.equal(twice.report.report_id, report.report.report_id);
  assert.equal((await shady("report_user", { post_id: shadyOffer.offer_id, reason: "other" }))._isError, true, "nobody reports themselves");
  assert.equal((await fair("report_user", { reason: "scam" }))._isError, true, "a report needs a deal or a post");
  await m.close();
});

test("reports from enough different people put someone under review until a reviewer decides", async () => {
  const m = await market({ reportThreshold: 2 });
  const shady = await m.as("u_flaky");
  const { offer } = await shady("post_offer", { title: "USB-C laptop charger", category: "charger", ask_price: 15 });
  const waiting = await m.as("u_innocent");
  const held = await waiting("post_request", { need: "laptop charger", max_price: 20 });
  assert.equal(held.deal.offer_id, offer.offer_id);

  const first = await m.as("u_reporter1");
  await first("report_user", { post_id: offer.offer_id, reason: "no_show" });
  assert.equal(await count(m.db, `SELECT count(*)::int AS n FROM users WHERE id = 'u_flaky' AND review_status = 'active'`), 1, "one report isn't enough");

  // A reporter under review doesn't count; a second active reporter does.
  await m.db.query(`INSERT INTO users (id, display_name, review_status) VALUES ('u_banned', 'u_banned', 'suspended')`);
  const banned = await m.as("u_banned");
  await banned("report_user", { post_id: offer.offer_id, reason: "scam" });
  assert.equal(await count(m.db, `SELECT count(*)::int AS n FROM users WHERE id = 'u_flaky' AND review_status = 'active'`), 1);
  const second = await m.as("u_reporter2");
  const r2 = await second("report_user", { post_id: offer.offer_id, reason: "scam" });
  assert.equal(r2.report.status, "received");
  assert.ok(!/review_status|under_review|reporters/.test(r2._raw), "a reporter never learns how many others reported");

  // Under review: open deals released, no pairing, no posting.
  const deal = (await m.db.query<{ status: string }>(`SELECT status FROM deals WHERE id = $1`, [held.deal.deal_id])).rows[0];
  assert.equal(deal.status, "withdrawn");
  const blocked = await shady("post_offer", { title: "HDMI cable", category: "charger", ask_price: 5 });
  assert.equal(blocked.code, "account_under_review");
  const newcomer = await m.as("u_newcomer");
  const fresh = await newcomer("post_request", { need: "USB-C charger", max_price: 20 });
  assert.equal(fresh.deal, null, "their offer isn't paired");
  assert.ok(!fresh.alternatives.some((o: { offer_id: string }) => o.offer_id === offer.offer_id), "nor shown");

  const queue = (await dashboard(m.db)).review_queue;
  const entry = queue.find((q) => q.user_id === "u_flaky");
  assert.equal(entry?.review_status, "under_review");
  assert.equal(entry?.reporters, 3);
  assert.deepEqual([...entry!.reasons].sort(), ["no_show", "scam"]);
  assert.equal(queue[0].user_id, "u_flaky", "people under review come first");

  // The reviewer reinstates them over HTTP: their offer is paired again with the waiting buyers.
  const app = createApp(m.deps, { ...config, host: "127.0.0.1", authMode: "none", dashboardToken: "", mcpApiKey: "", allowedOrigins: [] });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const addr = server.address();
  const url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/review`;
  const post = (body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post({ user_id: "u_flaky", decision: "pardon" })).status, 400);
  assert.equal((await post({ user_id: "u_nobody", decision: "reinstate" })).status, 404);
  const ok = await post({ user_id: "u_flaky", decision: "reinstate" });
  assert.deepEqual(await ok.json(), { user_id: "u_flaky", review_status: "active" });
  server.close();

  const paired = (await m.db.query<{ buyer_id: string }>(
    `SELECT i.buyer_id FROM deals d JOIN buy_intents i ON i.id = d.buy_intent_id WHERE d.listing_id = $1 AND d.status = 'proposed'`,
    [offer.offer_id],
  )).rows;
  assert.equal(paired.length, 1, "back on the market and paired");
  assert.ok(!["u_reporter1", "u_reporter2"].includes(paired[0].buyer_id));
  assert.equal(await count(m.db, `SELECT count(*)::int AS n FROM reports WHERE reported_id = 'u_flaky' AND status = 'open'`), 0, "reports dismissed");
  await m.close();
});
