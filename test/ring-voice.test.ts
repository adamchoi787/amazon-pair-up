import assert from "node:assert/strict";
import { test } from "node:test";
import { planOffline } from "../src/agent/offline.js";

test("spoken Ring arrivals and meet-up requests call the actual point tools", () => {
  for (const text of ["I'm here", "I’m here", "I am here", "I've arrived", "I’ve arrived", "I'm at the PairUp Point"]) {
    const step = planOffline([{ role: "user", content: [{ text }] }]);
    assert.ok(step.content.some((b) => "toolUse" in b && b.toolUse.name === "check_in_at_point"), text);
  }
  for (const text of ["Meet at a PairUp Point", "Find somewhere safe", "Meet-up point please"]) {
    const step = planOffline([{ role: "user", content: [{ text }] }]);
    assert.ok(step.content.some((b) => "toolUse" in b && b.toolUse.name === "choose_meetup_point"), text);
  }
});
