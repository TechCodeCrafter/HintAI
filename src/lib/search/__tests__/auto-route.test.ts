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

test("grounded null with hits calls synthesizeAnswer and returns a synthesized card", async () => {
  const policies: Array<string | undefined> = [];
  const routed = await routeSearchAnswer("Who is a full stack developer?", retryHits, 0, {
    pack: NORTHSTAR,
    ask: async (payload) => {
      policies.push(payload.policy);
      if (payload.policy === "synthesize") {
        return { text: "A full-stack developer works across the client and the server." };
      }
      return { text: "INSUFFICIENT" };
    },
    generalAsk: async () => {
      throw new Error("generateGeneralAnswer must not run when synthesize succeeds");
    },
  });
  assert.ok(policies.includes("synthesize"));
  assert.equal(routed.consumeQuota, true);
  assert.equal(routed.card.answerMode, "synthesized");
  assert.match(routed.card.say ?? "", /full-stack/i);
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

test("INSUFFICIENT across tiers stays silent with the hit-aware reason", async () => {
  const none = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: ask("INSUFFICIENT"),
    generalAsk: ask("INSUFFICIENT"),
  });
  assert.equal(none.consumeQuota, false);
  assert.equal(none.card.say, null);
  assert.equal(none.card.reason, "No matching material");
  assert.equal(silentCardReason(0), "No matching material");

  const uncovered = await routeSearchAnswer("Do we store card numbers in the export?", cardHits, 0, {
    pack: NORTHSTAR,
    ask: ask("INSUFFICIENT"),
    generalAsk: ask("INSUFFICIENT"),
  });
  assert.equal(uncovered.consumeQuota, false);
  if (uncovered.card.say) {
    assert.equal(uncovered.card.answerMode, "docs");
  } else {
    assert.equal(uncovered.card.reason, "Your material doesn't cover this");
  }
});

test("an API error is not disguised as missing material", async () => {
  const broken = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: async () => ({ text: null, reason: "Add API key" }),
    generalAsk: async () => ({ text: null, reason: "Add API key" }),
  });
  assert.equal(broken.consumeQuota, false);
  assert.equal(broken.card.say, null);
  assert.equal(broken.card.reason, "Couldn't generate an answer: Add API key");
  assert.equal(silentCardReason(3, "Add API key"), "Couldn't generate an answer: Add API key");
  assert.match(silentCardReason(0, `${"x".repeat(200)}`), /^Couldn't generate an answer: x{120}$/);
});

test("a timeout does not spend two more model calls", async () => {
  let asks = 0;
  const routed = await routeSearchAnswer("What is the weather in Tokyo?", retryHits, 0, {
    pack: NORTHSTAR,
    ask: async () => {
      asks += 1;
      return { text: null, reason: "timeout" };
    },
    generalAsk: async () => {
      throw new Error("generalAsk must not run after a timeout");
    },
  });
  assert.equal(asks, 1);
  assert.equal(routed.consumeQuota, false);
  assert.equal(routed.card.say, null);
  assert.equal(routed.card.reason, "Couldn't generate an answer: timeout");
});

test("the first error across tiers is the one the silent card shows", async () => {
  assert.ok(cardHits.length > 0);
  const routed = await routeSearchAnswer("Do we store card numbers in the export?", cardHits, 0, {
    pack: NORTHSTAR,
    ask: async (payload) => {
      if (payload.policy === "extract") return { text: null, reason: "timeout" };
      return { text: "INSUFFICIENT" };
    },
    generalAsk: async () => ({ text: null, reason: "Add API key" }),
  });
  assert.equal(routed.consumeQuota, false);
  assert.equal(routed.card.say, null);
  assert.equal(routed.card.reason, "Couldn't generate an answer: timeout");
});

test("failed LLM answers do not consume quota; success does", async () => {
  const failed = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: ask(null),
    generalAsk: ask(null),
  });
  assert.equal(failed.consumeQuota, false);
  assert.equal(failed.card.reason, "Couldn't generate an answer: empty");

  const generated = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: ask(null),
    generalAsk: ask("Bring a jacket. Tokyo looks cool today."),
  });
  assert.equal(generated.consumeQuota, true);
  assert.equal(generated.card.answerMode, "generated");
});
