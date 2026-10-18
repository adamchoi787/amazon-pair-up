import assert from "node:assert/strict";
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
