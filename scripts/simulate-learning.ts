// A simulated market, run through the real engine, to show the learning loop
// at work: the share of deals that close rises once a ranking learned from
// outcomes takes over. In-memory database, offline embeddings, no AWS.
//
// The simulated people are an assumption, stated here so the result is read
// for what it is: buyers are likelier to say yes to an offer nearby, one that
// is delivered, and one the seller already pre-approved. The engine is not
// told any of this; it only sees which deals closed.
//
// Usage: npm run simulate [-- --days 10]
import { createMockAi } from "../src/ai/mock.js";
import { openDb } from "../src/db/client.js";
import { champion, DEFAULT_LEARN_POLICY, DEFAULT_LEARNING, learn, learningReport } from "../src/market/learning.js";
import { confirmDeal, declineDeal, postOffer, postRequest, withdrawPost, type Deps } from "../src/market/service.js";
import type { DealView } from "../src/market/views.js";

const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 12;
const DIM = 256;

// Seeded randomness, so every run of the simulation tells the same story.
let seed = 20261020;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)];

/** The simulated buyers' preferences: hidden from the engine. */
const HOME = "HKUST campus";
function buyerSaysYes(offer: { nearby: boolean; delivered: boolean; preApproved: boolean }) {
  const z = -1.6 + 1.8 * +offer.nearby + 1.5 * +offer.delivered + 0.6 * +offer.preApproved;
  return random() < 1 / (1 + Math.exp(-z));
}

const GOODS = [
  { need: "desk lamp", titles: ["Desk lamp", "LED desk lamp", "Desk lamp, warm light", "Adjustable desk lamp"], ask: [8, 12] },
  { need: "umbrella", titles: ["Folding umbrella", "Compact umbrella", "Large umbrella", "Travel umbrella"], ask: [5, 9] },
  { need: "electric kettle", titles: ["Electric kettle", "Electric kettle 1.7L", "Fast electric kettle", "Steel electric kettle"], ask: [9, 14] },
  { need: "rice cooker", titles: ["Rice cooker", "Small rice cooker", "Rice cooker 1L", "Rice cooker, 3 cups"], ask: [12, 20] },
  { need: "desk fan", titles: ["Desk fan", "Quiet desk fan", "USB desk fan", "Small desk fan"], ask: [8, 15] },
  { need: "yoga mat", titles: ["Yoga mat", "Thick yoga mat", "Yoga mat with strap", "Non-slip yoga mat"], ask: [6, 12] },
];
const OFFERS_PER_GOOD = 8;
const BUYERS_PER_GOOD = 4;

const db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
const deps: Deps = { db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.35, postsPerHour: 1e6, maxOpenRequests: 1e6 } };

console.log(`Simulated market, ${days} days. Buyers prefer nearby, delivered and pre-approved offers; the engine isn't told.\n`);
console.log("day  requests  closed on 1st offer  all proposals closed  ranking in use");
let uid = 0;
for (let day = 1; day <= days; day++) {
  const traits = new Map<string, { nearby: boolean; delivered: boolean; preApproved: boolean }>();
  const offers: string[] = [];
  for (const g of GOODS) {
    for (let k = 0; k < OFFERS_PER_GOOD; k++) {
      const t = { nearby: random() < 0.5, delivered: random() < 0.4, preApproved: random() < 0.6 };
      const o = await postOffer(deps, {
        user_id: `seller_${++uid}`, title: pick(g.titles), category: g.need.split(" ").at(-1),
        description: t.delivered ? "I can deliver it to your hall." : "Pick it up from me.",
        ask_price: g.ask[0] + Math.floor(random() * (g.ask[1] - g.ask[0] + 1)),
        location: t.nearby ? HOME : pick(["Sai Kung", "Mong Kok", "Tseung Kwan O"]),
        auto_accept: t.preApproved,
      });
      traits.set(o.offer.offer_id, t);
      offers.push(o.offer.offer_id);
    }
  }

  let requests = 0, firstClosed = 0, proposals = 0, closed = 0;
  const model = await champion(db);
  for (const g of GOODS) {
    for (let k = 0; k < BUYERS_PER_GOOD; k++) {
      const buyer = `buyer_${++uid}`;
      const req = await postRequest(deps, { user_id: buyer, need: g.need, max_price: g.ask[1] + 2, location: HOME });
      requests++;
      let deal: DealView | null = req.deal;
      for (let tries = 0; deal && tries < 3; tries++) {
        proposals++;
        const seller = (await db.query<{ seller_id: string }>(`SELECT seller_id FROM listings WHERE id = $1`, [deal.offer_id])).rows[0].seller_id;
        if (buyerSaysYes(traits.get(deal.offer_id)!)) {
          await confirmDeal(deps, buyer, deal.deal_id);
          if (!deal.seller_confirmed) await confirmDeal(deps, seller, deal.deal_id);
          closed++;
          if (tries === 0) firstClosed++;
          break;
        }
        deal = (await declineDeal(deps, buyer, deal.deal_id)).next_deal;
      }
      if (deal == null) await withdrawPost(deps, buyer, req.request.request_id).catch(() => {});
    }
  }
  // Clear the day's leftovers so days don't mix.
  await db.query(`UPDATE listings SET status = 'withdrawn' WHERE id = ANY($1::text[]) AND status IN ('active', 'pending')`, [offers]);
  await db.query(`UPDATE deals SET status = 'withdrawn' WHERE status = 'proposed'`);
  await db.query(`UPDATE buy_intents SET status = 'cancelled' WHERE status IN ('open', 'matched')`);

  const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}%`.padStart(4);
  console.log(
    `${String(day).padStart(3)}  ${String(requests).padStart(8)}  ${pct(firstClosed, requests).padStart(19)}  ${pct(closed, proposals).padStart(20)}  ` +
      (model ? `learned v${model.version} (${Math.round(100 * DEFAULT_LEARNING.holdout)}% of requests stay on the control)` : "hand-tuned"),
  );

  // Overnight: learn from today's outcomes, keep the result only if it ranks better.
  const r = await learn(db, { ...DEFAULT_LEARN_POLICY, minOutcomes: 60 });
  if (r.action === "promoted") console.log(`     overnight: model v${r.version} promoted (AUC ${r.current_auc.toFixed(2)} → ${r.candidate_auc.toFixed(2)})`);
  if (r.action === "rolled_back") console.log(`     overnight: model v${r.version} rolled back`);
}

const report = await learningReport(db);
const fmt = (a?: { n: number; rate: number }) => (a ? `${Math.round(a.rate * 100)}% of ${a.n}` : "n/a");
console.log(`\nLive comparison, all proposals: learned ranking ${fmt(report.arms.model)}, control ${fmt(report.arms.control)}.`);
if (report.model) {
  console.log("What closes deals in this market, as learned:");
  for (const d of report.model.drivers.slice(0, 5)) console.log(`  ${d.feature.padEnd(18)} ${d.weight > 0 ? "+" : ""}${d.weight.toFixed(2)}`);
}
await db.close();
