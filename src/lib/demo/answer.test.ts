import assert from "node:assert/strict";
import { test } from "node:test";

import { demoAnswer, DEMO_QUESTIONS } from "./answer.ts";

test("the public demo answers a chip from the payments pack", () => {
  const card = demoAnswer(DEMO_QUESTIONS[2]);
  assert.ok(card.say);
  assert.match(card.say, /three/i);
  assert.ok(card.citations.length > 0);
  assert.ok(card.citations.some((cite) => "path" in cite && /retry/i.test(cite.path)));
});

test("the public demo stays silent on a question the pack does not cover", () => {
  const card = demoAnswer("What is our parental leave policy?");
  assert.equal(card.say, null);
});
