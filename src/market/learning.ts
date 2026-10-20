import { createHash } from "node:crypto";
import type { Db } from "../db/client.js";
import { logEvent } from "./events.js";
import { num, type BuyIntentRow, type ListingRow } from "./types.js";
import { checkSchedule } from "./scheduling.js";

// Learning to pair better. Every proposed deal records the facts the engine
// saw when it chose that pairing; its outcome (both said yes, or someone said
// no or let it expire) is the label. A small logistic model learns which
// facts make a pairing close, and the engine uses it to order candidates.
//
// What it may and may not do:
//   - It only reorders candidates that already passed every hard constraint
//     (kind, unit, condition, quantity, deadline, a price inside both limits,
//     the relevance gate). It never pairs something irrelevant.
//   - It never touches a price: settlement stays the fixed rule in
//     pairing-core, so nobody pays more because a model thinks they would.
//   - Training is deterministic (fixed initialisation, full-batch gradient
//     descent), so the same outcomes always give the same model.
//   - A new model replaces the current one only if it ranks the newest
//     outcomes better. A fixed share of requests (chosen by a hash of the
//     post id) keeps the hand-tuned ranking as a live control, and the model
//     is rolled back if its completion rate falls behind that control.

/** Features in [0, 1]. Names are stable: models store their weights by name. */
export const FEATURES = [
  "relevance",          // semantic + keyword match
  "price_fit",          // 1 when the ask is within the budget
  "discount",           // how far below the ask the price settled
  "budget_headroom",    // how much of the budget is left (internal only, never shown)
  "same_area",          // the offer's area matches the request's place
  "condition_margin",   // items: how much better than the worst acceptable condition
  "pre_approved",       // the seller pre-approved the price: one yes fewer
  "urgent",             // the request is due within a day
  "has_availability",   // the offer says when they can meet or work
  "offers_delivery",    // the offer mentions delivering or dropping off
  "price_vs_typical",   // price against the typical range (0.5 = middle; 0.5 when unknown)
  "seller_track",       // the seller's past deals that closed and their ratings (smoothed)
  "buyer_track",        // the buyer's past deals that closed and their ratings (smoothed)
  "is_service",
] as const;
export type FeatureName = (typeof FEATURES)[number];
export type Features = Record<FeatureName, number>;

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const RANK: Record<string, number> = { for_parts: 0, fair: 1, good: 2, like_new: 3, new: 4 };
const DELIVERY = /\b(deliver(y|s|ed)?|drop(s|ped)?[ -]?off|bring (it|them)|can bring|ship(ping)?)\b/i;

export interface Candidate {
  listing: ListingRow & { relevance: number; price_fit: number; loc: number; score: number };
  intent: BuyIntentRow;
  price: number;
}

export interface Tracks {
  seller: Map<string, number>;
  buyer: Map<string, number>;
}

/**
 * Each person's track record as seller and as buyer: their past deals that
 * closed and the stars the other side gave them (rate_deal), in one smoothed
 * share. A closed deal counts 1 and a failed one 0; a rating counts
 * (stars - 1) / 4, so five stars is another success and one star a failure.
 */
export async function loadTracks(db: Db, sellerIds: string[], buyerIds: string[]): Promise<Tracks> {
  const rate = async (column: "l.seller_id" | "i.buyer_id", role: "seller" | "buyer", ids: string[]) => {
    if (!ids.length) return new Map<string, number>();
    const { rows } = await db.query<{ id: string; won: number; n: number }>(
      `SELECT ${column} AS id,
              count(*) FILTER (WHERE d.status = 'confirmed')::int AS won,
              count(*) FILTER (WHERE d.status IN ('confirmed', 'declined', 'expired'))::int AS n
       FROM deals d JOIN listings l ON l.id = d.listing_id JOIN buy_intents i ON i.id = d.buy_intent_id
       WHERE ${column} = ANY($1::text[]) GROUP BY ${column}`,
      [ids],
    );
    const stars = await db.query<{ id: string; score: number; n: number }>(
      `SELECT ratee_id AS id, sum((stars - 1) / 4.0)::float8 AS score, count(*)::int AS n
       FROM ratings WHERE ratee_role = $2 AND ratee_id = ANY($1::text[]) GROUP BY ratee_id`,
      [ids, role],
    );
    const evidence = new Map<string, { won: number; n: number }>();
    for (const r of rows) evidence.set(r.id, { won: Number(r.won), n: Number(r.n) });
    for (const r of stars.rows) {
      const e = evidence.get(r.id) ?? { won: 0, n: 0 };
      evidence.set(r.id, { won: e.won + Number(r.score), n: e.n + Number(r.n) });
    }
    // (won + 1) / (n + 2): a newcomer starts at 0.5 and moves with evidence.
    return new Map([...evidence].map(([id, e]) => [id, (e.won + 1) / (e.n + 2)]));
  };
  return { seller: await rate("l.seller_id", "seller", sellerIds), buyer: await rate("i.buyer_id", "buyer", buyerIds) };
}

export function featuresOf(c: Candidate, tracks: Tracks, now = new Date()): Features {
  const { listing: l, intent: i, price } = c;
  const ask = num(l.ask_price)!;
  const max = num(i.max_price)!;
  const item = l.kind === "item";
  const due = i.needed_by ? new Date(i.needed_by).getTime() - now.getTime() : null;
  const low = num(l.ref_low);
  const high = num(l.ref_high);
  let vsTypical = 0.5;
  if (low != null && high != null && high > low) vsTypical = clamp01(0.25 + (0.5 * (price - low)) / (high - low));
  return {
    relevance: clamp01(l.relevance),
    price_fit: clamp01(l.price_fit),
    discount: clamp01((ask - price) / ask),
    budget_headroom: clamp01((max - price) / max),
    same_area: l.loc ? 1 : 0,
    condition_margin: item ? clamp01(((RANK[l.condition] ?? 2) - (RANK[i.min_condition] ?? 0)) / 4) : 0,
    pre_approved: l.auto_accept && (item || checkSchedule(l, i).status === "verified") ? 1 : 0,
    urgent: due != null && due < 24 * 3600_000 ? 1 : 0,
    has_availability: l.availability ? 1 : 0,
    offers_delivery: DELIVERY.test(`${l.title} ${l.description}`) ? 1 : 0,
    price_vs_typical: vsTypical,
    seller_track: tracks.seller.get(l.seller_id) ?? 0.5,
    buyer_track: tracks.buyer.get(i.buyer_id) ?? 0.5,
    is_service: item ? 0 : 1,
  };
}

// ---------- the model ----------

export interface Model {
  version: number;
  bias: number;
  weights: Record<FeatureName, number>;
}

const vec = (f: Features) => FEATURES.map((k) => f[k] ?? 0);
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Probability that both sides say yes. */
export function predict(m: Pick<Model, "bias" | "weights">, f: Features) {
  return sigmoid(m.bias + FEATURES.reduce((s, k) => s + (m.weights[k] ?? 0) * (f[k] ?? 0), 0));
}

export interface Example { features: Features; closed: boolean; baseline: number }

/** L2-regularised logistic regression by full-batch gradient descent from zero: deterministic. */
export function fit(examples: Example[], opts = { epochs: 800, rate: 0.5, l2: 0.01 }) {
  const X = examples.map((e) => vec(e.features));
  const y = examples.map((e) => (e.closed ? 1 : 0));
  const w = new Array<number>(FEATURES.length).fill(0);
  let b = 0;
  const n = Math.max(1, X.length);
  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    const gw = new Array<number>(w.length).fill(0);
    let gb = 0;
    for (let r = 0; r < X.length; r++) {
      const err = sigmoid(b + X[r].reduce((s, x, j) => s + w[j] * x, 0)) - y[r];
      for (let j = 0; j < w.length; j++) gw[j] += err * X[r][j];
      gb += err;
    }
    for (let j = 0; j < w.length; j++) w[j] -= opts.rate * (gw[j] / n + opts.l2 * w[j]);
    b -= opts.rate * (gb / n);
  }
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  return { bias: round(b), weights: Object.fromEntries(FEATURES.map((k, j) => [k, round(w[j])])) as Record<FeatureName, number> };
}

/** Area under the ROC curve: how well a score ranks the pairings that closed above the ones that didn't. */
export function auc(scores: number[], closed: boolean[]) {
  const pos = closed.filter(Boolean).length;
  const neg = closed.length - pos;
  if (!pos || !neg) return 0.5;
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && order[j + 1][0] === order[k][0]) j++;
    const avg = (k + j) / 2 + 1; // ties share their average rank
    for (let t = k; t <= j; t++) if (closed[order[t][1]]) rankSum += avg;
    k = j + 1;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

// ---------- serving ----------

export type Arm = "model" | "control" | "browse";

export interface LearningSettings {
  /** Share of posts that keep the hand-tuned ranking, as a live control. */
  holdout: number;
}

export const DEFAULT_LEARNING: LearningSettings = { holdout: 0.1 };

/** Deterministic arm for the post that triggered a pairing: the same post always lands in the same arm. */
export function armFor(postId: string, champion: Model | null, s: LearningSettings = DEFAULT_LEARNING): Arm {
  if (!champion) return "control";
  const bucket = createHash("sha1").update(postId).digest().readUInt32BE(0) / 0x1_0000_0000;
  return bucket < s.holdout ? "control" : "model";
}

const championCache = new WeakMap<Db, { at: number; model: Model | null }>();

/** The model in use, cached for a minute. */
export async function champion(db: Db): Promise<Model | null> {
  const hit = championCache.get(db);
  if (hit && Date.now() - hit.at < 60_000) return hit.model;
  const { rows } = await db.query<{ version: number; bias: number; weights: Record<FeatureName, number> }>(
    `SELECT version, bias, weights FROM ranking_models WHERE status = 'champion' ORDER BY version DESC LIMIT 1`,
  );
  const model = rows[0] ? { version: Number(rows[0].version), bias: Number(rows[0].bias), weights: rows[0].weights } : null;
  championCache.set(db, { at: Date.now(), model });
  return model;
}

const forget = (db: Db) => championCache.delete(db);

/** Record what the engine saw when it proposed this deal, for learning later. */
export async function recordPairing(
  db: Db, dealId: string, f: Features, arm: Arm, model: Model | null, baseline: number,
) {
  await db.query(
    `INSERT INTO pairing_features (deal_id, arm, model_version, predicted, baseline, features)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (deal_id) DO NOTHING`,
    [dealId, arm, model?.version ?? null, model ? +predict(model, f).toFixed(4) : null, baseline, JSON.stringify(f)],
  );
}

// ---------- the learning job ----------

export interface LearnPolicy {
  /** Outcomes needed before any model is trained. */
  minOutcomes: number;
  /** Newest share of outcomes held out to compare models on. */
  evalShare: number;
  /** AUC a candidate must gain over the current ranking to replace it. */
  minGain: number;
  /** Outcomes per arm before the live control can trigger a rollback. */
  minPerArm: number;
  /** Completion-rate gap (model behind control) that rolls the model back. */
  rollbackGap: number;
}

export const DEFAULT_LEARN_POLICY: LearnPolicy = { minOutcomes: 60, evalShare: 0.25, minGain: 0.01, minPerArm: 30, rollbackGap: 0.05 };

const OUTCOME = `d.status IN ('confirmed', 'declined', 'expired')`;

async function outcomes(db: Db): Promise<(Example & { arm: Arm })[]> {
  const { rows } = await db.query<{ features: Features; status: string; baseline: number; arm: Arm }>(
    `SELECT pf.features, d.status, pf.baseline, pf.arm FROM pairing_features pf JOIN deals d ON d.id = pf.deal_id
     WHERE ${OUTCOME} ORDER BY d.created_at, d.id`,
  );
  return rows.map((r) => ({ features: r.features, closed: r.status === "confirmed", baseline: Number(r.baseline), arm: r.arm }));
}

/** Completion rate per arm over recent outcomes: the live comparison. */
export async function armStats(db: Db, days = 14) {
  const { rows } = await db.query<{ arm: Arm; n: number; closed: number }>(
    `SELECT pf.arm, count(*)::int AS n, count(*) FILTER (WHERE d.status = 'confirmed')::int AS closed
     FROM pairing_features pf JOIN deals d ON d.id = pf.deal_id
     WHERE ${OUTCOME} AND d.created_at > now() - make_interval(days => $1) GROUP BY pf.arm`,
    [days],
  );
  return Object.fromEntries(rows.map((r) => [r.arm, { n: Number(r.n), rate: Number(r.n) ? Number(r.closed) / Number(r.n) : 0 }])) as
    Partial<Record<Arm, { n: number; rate: number }>>;
}

export type LearnResult =
  | { action: "waiting"; outcomes: number }
  | { action: "rolled_back"; version: number; model_rate: number; control_rate: number }
  | { action: "promoted" | "kept"; version: number; candidate_auc: number; current_auc: number; outcomes: number };

/**
 * Train a candidate on older outcomes, compare it with the current ranking on
 * the newest ones, and promote it only if it ranks them better. Before that,
 * roll the current model back if its live completion rate trails the control.
 */
export async function learn(db: Db, policy: LearnPolicy = DEFAULT_LEARN_POLICY): Promise<LearnResult> {
  const current = await champion(db);
  if (current) {
    const arms = await armStats(db);
    const m = arms.model;
    const c = arms.control;
    if (m && c && m.n >= policy.minPerArm && c.n >= policy.minPerArm && m.rate < c.rate - policy.rollbackGap) {
      await db.query(`UPDATE ranking_models SET status = 'rolled_back' WHERE version = $1`, [current.version]);
      forget(db);
      await logEvent(db, "model_rolled_back", null, `model_${current.version}`, { model_rate: m.rate, control_rate: c.rate });
      return { action: "rolled_back", version: current.version, model_rate: m.rate, control_rate: c.rate };
    }
  }

  const data = await outcomes(db);
  if (data.length < policy.minOutcomes) return { action: "waiting", outcomes: data.length };
  const cut = Math.floor(data.length * (1 - policy.evalShare));
  const train = data.slice(0, cut);
  const test = data.slice(cut);
  const closed = test.map((e) => e.closed);

  const candidate = fit(train);
  const candidateAuc = auc(test.map((e) => predict(candidate, e.features)), closed);
  // The current ranking is the champion model, or the hand-tuned score when there is none.
  const currentAuc = auc(test.map((e) => (current ? predict(current, e.features) : e.baseline)), closed);
  const promote = candidateAuc >= currentAuc + policy.minGain;

  // Refit on everything before serving: the comparison decided, the extra data only sharpens it.
  const final = promote ? fit(data) : candidate;
  const { rows } = await db.query<{ version: number }>(
    `INSERT INTO ranking_models (bias, weights, metrics, status) VALUES ($1, $2, $3, $4) RETURNING version`,
    [final.bias, JSON.stringify(final.weights), JSON.stringify({ candidate_auc: candidateAuc, current_auc: currentAuc, outcomes: data.length, eval: test.length }),
      promote ? "champion" : "rejected"],
  );
  const version = Number(rows[0].version);
  if (promote) {
    await db.query(`UPDATE ranking_models SET status = 'retired' WHERE status = 'champion' AND version <> $1`, [version]);
    forget(db);
  }
  await logEvent(db, promote ? "model_promoted" : "model_rejected", null, `model_${version}`, {
    candidate_auc: +candidateAuc.toFixed(3), current_auc: +currentAuc.toFixed(3), outcomes: data.length,
  });
  return { action: promote ? "promoted" : "kept", version, candidate_auc: candidateAuc, current_auc: currentAuc, outcomes: data.length };
}

/** For the dashboard: daily completion rate, the live arms, and what the current model has learned. */
export async function learningReport(db: Db) {
  const [daily, model, arms] = await Promise.all([
    db.query<{ day: string; n: number; closed: number }>(
      `SELECT to_char(date_trunc('day', d.created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n,
              count(*) FILTER (WHERE d.status = 'confirmed')::int AS closed
       FROM deals d WHERE ${OUTCOME} GROUP BY 1 ORDER BY 1 DESC LIMIT 30`,
    ),
    db.query<{ version: number; weights: Record<FeatureName, number>; metrics: Record<string, number>; created_at: string }>(
      `SELECT version, weights, metrics, created_at FROM ranking_models WHERE status = 'champion' ORDER BY version DESC LIMIT 1`,
    ),
    armStats(db),
  ]);
  const m = model.rows[0];
  return {
    outcome: "mutual_confirmation" as const,
    outcome_description: "Both sides agreed to a deal. Payment, handover and job completion are not measured.",
    daily: daily.rows.map((r) => ({ day: r.day, outcomes: Number(r.n), completion_rate: Number(r.n) ? Number(r.closed) / Number(r.n) : 0 })).reverse(),
    arms,
    model: m && {
      version: Number(m.version),
      trained_at: m.created_at,
      metrics: m.metrics,
      // Largest effects first: what makes a pairing close, in this market.
      drivers: Object.entries(m.weights).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([feature, weight]) => ({ feature, weight })),
    },
  };
}

