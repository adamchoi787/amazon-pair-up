import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createMockAi } from "../src/ai/mock.js";
import { openDb, type Db } from "../src/db/client.js";
import { acceptSuggestion, addContext, dismissSuggestion, getMyRoutines, getSuggestions, looksLikeNeed } from "../src/market/context.js";
import { localTime, nextOccurrence } from "../src/market/lifestyle.js";
import { postOffer, postRequest, type Deps } from "../src/market/service.js";

// Routines learned from a user's own past requests, and needs picked up by
// Bee or a watch, become suggestions that wait for a yes.

const DIM = 256;
const TZ = "Asia/Hong_Kong";
let db: Db;
let deps: Deps;

/** A local Hong Kong time, as an instant. */
const hk = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);

/** Post a request as if it were made at `at`, then close it so it doesn't hold the market. */
async function pastRequest(user: string, at: Date, input: Partial<Parameters<typeof postRequest>[1]>) {
  const r = await postRequest(deps, { user_id: user, ...input });
  await db.query(`UPDATE buy_intents SET created_at = $2, status = 'fulfilled' WHERE id = $1`, [r.request.request_id, at.toISOString()]);
  return r;
}

before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: DIM }, { inMemory: true });
  deps = { db, ai: createMockAi(DIM), cfg: { matchThreshold: 0.35 } };
  // Three weeks of lunch runs, Tuesdays and Thursdays around 12:10, and one stray request.
  const days = ["2026-09-29", "2026-10-01", "2026-10-06", "2026-10-08", "2026-10-13", "2026-10-15"];
  for (const [i, d] of days.entries()) {
    await pastRequest("tony", hk(d, ["12:05", "12:15", "12:10", "12:20", "12:10", "12:00"][i]), {
      need: "pick up my lunch", kind: "service", price_unit: "job", max_price: [4, 4, 5, 4, 4, 4][i], pickup: "LG7 canteen", location: "Hall 5",
    });
  }
  await pastRequest("tony", hk("2026-10-02", "20:00"), { need: "yoga mat", max_price: 8 });
  await pastRequest("mei", hk("2026-10-01", "10:00"), { need: "graphing calculator", max_price: 18 });
  // Offers come after the history, so past requests hold none of them.
  await postOffer(deps, { user_id: "runner", kind: "service", title: "Lunch runs around campus", category: "delivery", ask_price: 4, min_price: 3, location: "HKUST campus" });
  await postOffer(deps, { user_id: "seller", title: "TI-84 Plus graphing calculator", category: "calculator", ask_price: 20, min_price: 15 });
});
after(async () => db.close());

test("a routine is learned from the user's own requests: days, time, usual budget and place", async () => {
  const mine = await getMyRoutines(deps, "tony", hk("2026-10-19", "09:00"));
  assert.equal(mine.routines.length, 1, "the stray yoga mat is not a routine");
  const r = mine.routines[0];
  assert.equal(r.need, "pick up my lunch");
  assert.equal(r.when, "on Tuesdays and Thursdays around 12:10pm");
  assert.equal(r.usual_budget, 4);
  assert.equal(r.pickup, "LG7 canteen");
  assert.equal(r.location, "Hall 5");
  assert.equal(r.times, 6);
  assert.equal(localTime(new Date(r.next_at), TZ).date, "2026-10-20", "next due on Tuesday");
  assert.match(mine.say, /one routine: pick up my lunch/);
});

test("a routine is suggested shortly before it is due, and not at other times", async () => {
  const early = await getSuggestions(deps, "tony", hk("2026-10-20", "09:00"));
  assert.equal(early.suggestions.length, 0, "too early on Tuesday");
  const wednesday = await getSuggestions(deps, "tony", hk("2026-10-21", "11:50"));
  assert.equal(wednesday.suggestions.length, 0, "not a lunch-run day");

  const due = await getSuggestions(deps, "tony", hk("2026-10-20", "11:45"));
  assert.equal(due.suggestions.length, 1);
  const s = due.suggestions[0];
  assert.equal(s.from, "routine");
  assert.deepEqual([s.request.max_price, s.request.pickup, s.request.location], [4, "LG7 canteen", "Hall 5"]);
  assert.match(s.say, /your usual: pick up my lunch from LG7 canteen to Hall 5, about \$4 a job/);
});

test("accepting a routine suggestion posts and pairs the request; it isn't suggested again that day", async () => {
  const now = hk("2026-10-20", "11:45");
  const s = (await getSuggestions(deps, "tony", now)).suggestions[0];
  const r = await acceptSuggestion(deps, "tony", s.suggestion_id, undefined, now);
  assert.equal(r.request.source, "routine");
  assert.equal(r.request.your_max_price, 4);
  assert.ok(r.deal, "paired with the lunch runner in the same call");
  assert.equal((await getSuggestions(deps, "tony", now)).suggestions.length, 0);
});

test("forget stops a routine from being suggested", async () => {
  const thursday = hk("2026-10-22", "11:50");
  const s = (await getSuggestions(deps, "tony", thursday)).suggestions[0];
  assert.ok(s, "due again on Thursday");
  const d = await dismissSuggestion(deps, "tony", s.suggestion_id, true, thursday);
  assert.equal(d.forgotten, true);
  assert.equal((await getMyRoutines(deps, "tony", thursday)).routines.length, 0, "forgotten routines are gone");
});

test("a Bee to-do that names a need becomes a suggestion with the usual budget; other snippets are not kept", async () => {
  const chat = await addContext(deps, "mei", { source: "bee", kind: "conversation", text: "Talked about the weekend hiking trip with Sam" });
  assert.equal(chat.suggestion, null);
  const kept = await db.query<{ text: string | null }>(`SELECT text FROM context_signals WHERE id = $1`, [chat.signal_id]);
  assert.equal(kept.rows[0].text, null, "no need, nothing kept");

  const todo = await addContext(deps, "mei", { source: "bee", kind: "todo", text: "Need a graphing calculator before the exam", external_id: "bee-todo-1" });
  assert.ok(todo.suggestion);
  assert.equal(todo.suggestion.request.max_price, 18, "the user's usual budget for it");
  assert.match(todo.suggestion.say, /Your Bee picked up: "Need a graphing calculator before the exam"\. Want me to find a graphing calculator for up to \$18\?/);

  const again = await addContext(deps, "mei", { source: "bee", kind: "todo", text: "Need a graphing calculator before the exam", external_id: "bee-todo-1" });
  assert.equal(again.duplicate, true, "a resend is ignored");

  const list = await getSuggestions(deps, "mei");
  assert.equal(list.suggestions.length, 1);
  const r = await acceptSuggestion(deps, "mei", list.suggestions[0].suggestion_id);
  assert.equal(r.request.source, "bee_context");
  assert.equal(r.deal?.title, "TI-84 Plus graphing calculator");
  assert.equal((await getSuggestions(deps, "mei")).suggestions.length, 0, "accepted, so no longer suggested");
});

test("a watch location sets where a need is; a need without a usual budget asks for one", async () => {
  await addContext(deps, "ken", { source: "watch", kind: "location", place: "Hall 5" });
  const s = await addContext(deps, "ken", { source: "watch", kind: "note", text: "I need someone to pick up my parcel from the mail room" });
  assert.ok(s.suggestion);
  assert.equal(s.suggestion.request.location, "Hall 5");
  assert.equal(s.suggestion.request.max_price, null);
  assert.match(s.suggestion.say, /Tell me the most you'd pay/);
  await assert.rejects(acceptSuggestion(deps, "ken", s.suggestion.suggestion_id), /most you'd pay/);
  const r = await acceptSuggestion(deps, "ken", s.suggestion.suggestion_id, 5);
  assert.equal(r.request.source, "device_context");
});

test("need cues", () => {
  for (const t of ["We ran out of printer paper", "my charger broke", "need someone to help moving boxes on Saturday", "buy tissues"]) {
    assert.ok(looksLikeNeed(t), t);
  }
  for (const t of ["Lunch with Sam was fun", "already bought the charger", "Meeting notes: Q3 plan"]) assert.ok(!looksLikeNeed(t), t);
});

test("next occurrence uses the user's own time zone", () => {
  const at = nextOccurrence([2, 4], 12 * 60 + 10, TZ, hk("2026-10-20", "13:00"));
  assert.equal(at.toISOString(), hk("2026-10-22", "12:10").toISOString());
});
