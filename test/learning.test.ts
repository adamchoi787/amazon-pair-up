import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";
import {
  armFor, auc, champion, FEATURES, fit, learn, learningReport, predict, DEFAULT_LEARN_POLICY, type Features,
} from "../src/market/learning.js";
import { confirmDeal, declineDeal, postOffer, postRequest, type Deps } from "../src/market/service.js";

// Learning to pair better: deterministic training, guarded promotion, rollback.

const blank = (over: Partial<Features> = {}): Features =>
  ({ ...Object.fromEntries(FEATURES.map((k) => [k, 0])), ...over }) as Features;

test("training is deterministic and learns the direction of a real effect", () => {
  const examples = Array.from({ length: 200 }, (_, n) => {
    const delivery = n % 2;
    const relevance = (n % 7) / 7;
    return { features: blank({ offers_delivery: delivery, relevance }), closed: delivery === 1 && n % 5 !== 0, baseline: relevance };
  });
  const a = fit(examples);
  assert.deepEqual(a, fit(examples), "same outcomes, same model");
  assert.ok(a.weights.offers_delivery > 1, `delivery should matter: ${a.weights.offers_delivery}`);
  assert.ok(Math.abs(a.weights.relevance) < a.weights.offers_delivery, "noise matters less than the real effect");
  assert.ok(predict(a, blank({ offers_delivery: 1 })) > predict(a, blank({ offers_delivery: 0 })));
});

test("AUC ranks closed above unclosed, with ties counted fairly", () => {
  assert.equal(auc([0.9, 0.8, 0.2, 0.1], [true, true, false, false]), 1);
  assert.equal(auc([0.1, 0.2, 0.8, 0.9], [true, true, false, false]), 0);
  assert.equal(auc([0.5, 0.5, 0.5, 0.5], [true, false, true, false]), 0.5);
});

test("arms are fixed per post: the same post always gets the same ranking", () => {
  const m = { version: 1, bias: 0, weights: blank() };
  assert.equal(armFor("req_any", null), "control", "no model yet: everyone gets the hand-tuned ranking");
  const arms = Array.from({ length: 2000 }, (_, n) => armFor(`req_${n}`, m));
  assert.deepEqual(arms, Array.from({ length: 2000 }, (_, n) => armFor(`req_${n}`, m)));
  const control = arms.filter((a) => a === "control").length / arms.length;
  assert.ok(control > 0.07 && control < 0.13, `about 10% control, got ${control}`);
});

// ---------- the whole loop on a live market ----------

const DIM = 256;
let db: Db;
let deps: Deps;

before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
  deps = { db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.35, postsPerHour: 1000, maxOpenRequests: 1000 } };
});
after(async () => db.close());

/**
 * One round: two lamps on offer, one of them delivered. Buyers here only say
 * yes to delivery (a stand-in for whatever really drives a market), and the
 * hand-tuned ranking can't see it.
 */
async function round(n: number) {
  const plain = await postOffer(deps, { user_id: `plain_${n}`, title: "Desk lamp", category: "lamp", ask_price: 10 });
  const delivered = await postOffer(deps, {
    user_id: `deliver_${n}`, title: "Desk lamp", description: "I can deliver it to your hall.", category: "lamp", ask_price: 10,
  });
  const req = await postRequest(deps, { user_id: `buyer_${n}`, need: "desk lamp", max_price: 12 });
  const first = req.deal!;
  const firstWasDelivered = first.offer_id === delivered.offer.offer_id;
  if (firstWasDelivered) {
    await confirmDeal(deps, `buyer_${n}`, first.deal_id);
  } else {
    const no = await declineDeal(deps, `buyer_${n}`, first.deal_id);
    assert.equal(no.next_deal?.offer_id, delivered.offer.offer_id, "the next best is the delivered lamp");
    await confirmDeal(deps, `buyer_${n}`, no.next_deal!.deal_id);
  }
  // Take the other lamp off the market so rounds don't mix.
  await db.query(`UPDATE listings SET status = 'withdrawn' WHERE id = ANY($1::text[]) AND status = 'active'`, [[plain.offer.offer_id, delivered.offer.offer_id]]);
  return { firstWasDelivered, requestId: req.request.request_id };
}

test("a model that ranks real outcomes better is promoted, and then pairs better", async () => {
  const early = [];
  for (let n = 0; n < 30; n++) early.push(await round(n));
  assert.ok(early.every((r) => !r.firstWasDelivered), "the hand-tuned ranking keeps proposing the plain lamp first");

  assert.deepEqual(await learn(db, { ...DEFAULT_LEARN_POLICY, minOutcomes: 200 }), { action: "waiting", outcomes: 60 });
  const result = await learn(db, { ...DEFAULT_LEARN_POLICY, minOutcomes: 40 });
  assert.equal(result.action, "promoted");
  assert.ok(result.action === "promoted" && result.candidate_auc > result.current_auc);
  const model = (await champion(db))!;
  assert.ok(model.weights.offers_delivery > 0, "it learned what buyers here respond to");

  // From now on, posts in the model arm get the delivered lamp first; the control arm keeps the old order.
  let modelRounds = 0;
  for (let n = 30; n < 50; n++) {
    const r = await round(n);
    const arm = armFor(r.requestId, model);
    if (arm === "model") {
      modelRounds++;
      assert.equal(r.firstWasDelivered, true, "model arm: the pairing that closes comes first");
    } else {
      assert.equal(r.firstWasDelivered, false, "control arm: unchanged");
    }
  }
  assert.ok(modelRounds > 10);

  const report = await learningReport(db);
  assert.equal(report.model?.version, model.version);
  assert.equal(report.model?.drivers[0].feature, "offers_delivery", "the biggest driver is named");
  assert.ok((report.arms.model?.rate ?? 0) > (report.arms.control?.rate ?? 1), "live: the model arm closes more first offers");
});

test("a model whose live completion rate trails the control is rolled back", async () => {
  const current = (await champion(db))!;
  // Pretend the live comparison went badly: closed deals counted for the control, failed ones for the model.
  await db.query(`UPDATE pairing_features pf SET arm = CASE WHEN d.status = 'confirmed' THEN 'control' ELSE 'model' END
                  FROM deals d WHERE d.id = pf.deal_id`);
  const r = await learn(db, { ...DEFAULT_LEARN_POLICY, minPerArm: 10 });
  assert.equal(r.action, "rolled_back");
  assert.equal(await champion(db), null, "back to the hand-tuned ranking");
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM ranking_models WHERE version = $1`, [current.version]);
  assert.equal(rows[0].status, "rolled_back");
});
