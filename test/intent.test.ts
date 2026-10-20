import assert from "node:assert/strict";
import { contradictsNeed } from "../src/market/matching.js";
import { test } from "node:test";
import { mockEmbed, mockExtractIntent } from "../src/ai/mock.js";

const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

test("extracts budget, deadline and clean need", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  const i = mockExtractIntent("Alexa, I need a graphing calculator today, maximum $18", now);
  assert.equal(i.max_price, 18);
  assert.equal(i.need, "graphing calculator");
  assert.equal(i.category, "calculator");
  assert.ok(i.needed_by);
});

test("mock embeddings: related items closer than unrelated", () => {
  const q = mockEmbed("graphing calculator", 512);
  const ti = mockEmbed("TI-84 Plus graphing calculator", 512);
  const mat = mockEmbed("Yoga mat purple", 512);
  assert.ok(cos(q, ti) > cos(q, mat) + 0.2);
});

test("reads a request for help: errand route, fee, deadline", () => {
  const now = new Date(2026, 9, 20, 10, 0); // Tue 20 Oct, 10:00 local
  const i = mockExtractIntent("find some one to pick up my lunch from the HUB to McCarty Hall by 12:30, $5", now);
  assert.equal(i.kind, "service");
  assert.equal(i.price_unit, "job");
  assert.equal(i.need, "pick up my lunch");
  assert.equal(i.category, "delivery");
  assert.equal(i.max_price, 5);
  assert.equal(i.pickup, "the HUB");
  assert.equal(i.location, "McCarty Hall");
  assert.equal(i.schedule, "by 12:30");
  assert.equal(new Date(i.needed_by!).getTime(), new Date(2026, 9, 20, 12, 30).getTime());
});

test("reads hourly work: rate, day, time window and hours", () => {
  const now = new Date(2026, 9, 20, 10, 0);
  const i = mockExtractIntent("get me a guy to help with the event on Saturday 2-6pm, budget $10/hr", now);
  assert.equal(i.kind, "service");
  assert.equal(i.price_unit, "hour");
  assert.equal(i.need, "help with the event");
  assert.equal(i.max_price, 10);
  assert.equal(i.hours, 4);
  assert.equal(i.schedule, "Saturday 2-6pm");
  assert.equal(new Date(i.needed_by!).getTime(), new Date(2026, 9, 24, 14, 0).getTime());
  assert.equal(mockExtractIntent("tutor me in calculus tomorrow, $15 an hour for 2 hours", now).hours, 2);
});

test("explicit feature disclaimers are excluded even when embeddings share the same words", () => {
  assert.equal(contradictsNeed("graphing calculator", "Scientific calculator. Not graphing."), true);
  assert.equal(contradictsNeed("graphing calculator", "Non-graphing calculator"), true);
  assert.equal(contradictsNeed("non-graphing calculator", "Scientific calculator. Not graphing."), false);
  assert.equal(contradictsNeed("graphing calculator", "TI-84 graphing calculator, no box"), false);
  assert.equal(contradictsNeed("used calculator", "TI-84, not used much"), false);
  assert.equal(contradictsNeed("calculator with case", "Works great, no case scratches"), false);
});

test("items stay items", () => {
  const i = mockExtractIntent("looking for 3 packs of tissues on campus, under 5 dollars");
  assert.equal(i.kind, undefined);
  assert.equal(i.quantity, 3);
  assert.equal(i.pickup, undefined);
});
