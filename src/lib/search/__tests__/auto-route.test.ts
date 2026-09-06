import assert from "node:assert/strict";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import { isFileHit } from "../../repo/types.ts";
import { routeSearchAnswer, silentCardReason } from "../answer-route.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

const chunks = buildChunks(NORTHSTAR);
const retryHits = retrieve("Why does that retry three times?", chunks).filter(isFileHit);
const cardHits = retrieve("Do we store card numbers in the export?", chunks);

function ask(text: string | null) {
  return async () => ({ text });
}

test("hits plus grounded success become a cited docs card", async () => {
  const body = retryHits.findIndex((hit) => /Attempts are capped at three/.test(hit.text));
  assert.ok(body >= 0);
  const routed = await routeSearchAnswer("Why does that retry three times?", retryHits, 0, {
    pack: NORTHSTAR,
    ask: ask(
      `Attempts are capped at three because a fourth attempt duplicates the settlement file. [${body + 1}]`,
    ),
    generalAsk: ask("This general answer must not be used."),
  });
  assert.equal(routed.consumeQuota, true);
  assert.equal(routed.card.answerMode, "docs");
  assert.ok(routed.card.say);
  assert.ok(routed.card.citations.length >= 1);
});

test("grounded null falls through to a generated card", async () => {
  const routed = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: ask("INSUFFICIENT"),
    generalAsk: ask("Tokyo weather is set by a nearby high-pressure system."),
  });
  assert.equal(routed.consumeQuota, true);
  assert.equal(routed.card.answerMode, "generated");
  assert.equal(routed.card.citations.length, 0);
  assert.match(routed.card.say ?? "", /Tokyo/);
});

test("both LLM paths null stay silent with the hit-aware reason", async () => {
  const none = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: ask(null),
    generalAsk: ask(null),
  });
  assert.equal(none.consumeQuota, false);
  assert.equal(none.card.say, null);
  assert.equal(none.card.reason, "No matching material");
  assert.equal(silentCardReason(0), "No matching material");

  const uncovered = await routeSearchAnswer("Do we store card numbers in the export?", cardHits, 0, {
    pack: NORTHSTAR,
    ask: ask("INSUFFICIENT"),
    generalAsk: ask(null),
  });
  assert.equal(uncovered.consumeQuota, false);
  if (uncovered.card.say) {
    assert.equal(uncovered.card.answerMode, "docs");
  } else {
    assert.equal(uncovered.card.reason, silentCardReason(cardHits.length));
    if (cardHits.length > 0) assert.equal(uncovered.card.reason, "Your material doesn't cover this");
  }
});

test("failed LLM answers do not consume quota; success does", async () => {
  const failed = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: ask(null),
    generalAsk: ask(null),
  });
  assert.equal(failed.consumeQuota, false);

  const generated = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: ask(null),
    generalAsk: ask("Bring a jacket. Tokyo looks cool today."),
  });
  assert.equal(generated.consumeQuota, true);
  assert.equal(generated.card.answerMode, "generated");
});
