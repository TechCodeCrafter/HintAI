import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import type { RepoPack } from "../../repo/types.ts";
import { isFileHit } from "../../repo/types.ts";
import { routeSearchAnswer, silentCardReason } from "../answer-route.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const chunks = buildChunks(NORTHSTAR);
const retryHits = retrieve("Why does that retry three times?", chunks).filter(isFileHit);
const cardHits = retrieve("Do we store card numbers in the export?", chunks);

const uploadPack: RepoPack = {
  id: "upload-test",
  name: "upload-test",
  description: "upload routing fixture",
  files: [
    {
      path: "api/routers/uploads.py",
      language: "py",
      content: readFileSync(join(fixtureRoot, "uploads-router.py"), "utf8"),
    },
  ],
  commits: [],
};

/** Q14-style uncited synthesis from the upload-cluster demo battery. */
const UNCITED_UPLOAD_SYNTHESIS =
  "The upload is handled through the API endpoint where the frontend client interacts with the API Gateway. Specifically, the API checks the shared file registry by hash to determine if the content is a duplicate before processing the upload.";

function ask(text: string | null) {
  return async () => ({ text });
}

function uncitedSynthesisAsk(text: string = UNCITED_UPLOAD_SYNTHESIS) {
  return async (payload: { policy?: string }) => {
    if (payload.policy === "extract") return { text: "INSUFFICIENT" };
    if (payload.policy === "synthesize") return { text };
    return { text: "INSUFFICIENT" };
  };
}

test("hits plus grounded success become a cited docs card", async () => {
  const body = retryHits.findIndex((hit) => /Attempts are capped at three/.test(hit.text));
  assert.ok(body >= 0);
  const routed = await routeSearchAnswer("Why does that retry three times?", retryHits, 0, {
    pack: NORTHSTAR,
    ask: ask(
      `Attempts are capped at three because a fourth attempt duplicates the settlement file. [${body + 1}]`,
    ),
  });
  assert.equal(routed.consumeQuota, true);
  assert.equal(routed.card.answerMode, "docs");
  assert.ok(routed.card.say);
  assert.ok(routed.card.citations.length >= 1);
});

test("uncited synthesis ok is never spoken — localCard or silence only", async () => {
  const uploadChunks = buildChunks(uploadPack);
  const uploadHits = retrieve("Where are we actually doing the upload?", uploadChunks, 6);
  assert.ok(uploadHits.length > 0);

  const uploadRouted = await routeSearchAnswer(
    "Where are we actually doing the upload?",
    uploadHits,
    0,
    { pack: uploadPack, ask: uncitedSynthesisAsk() },
  );
  assert.notEqual(uploadRouted.card.say, UNCITED_UPLOAD_SYNTHESIS);
  assert.equal(uploadRouted.consumeQuota, false);
  if (uploadRouted.card.say) {
    assert.equal(uploadRouted.card.answerMode, "docs");
    assert.ok(uploadRouted.card.citations.some((c) => c.kind === "file" && c.path.includes("uploads.py")));
  }

  const devHits = retrieve("Who is a full stack developer?", chunks);
  const silentRouted = await routeSearchAnswer("Who is a full stack developer?", devHits, 0, {
    pack: NORTHSTAR,
    ask: uncitedSynthesisAsk(),
  });
  assert.notEqual(silentRouted.card.say, UNCITED_UPLOAD_SYNTHESIS);
  assert.equal(silentRouted.card.say, null);
  assert.equal(
    silentRouted.card.reason,
    devHits.length === 0 ? "No matching material" : "Your material doesn't cover this",
  );
});

test("uncited synthesis falls through to localCard when the pack can cite", async () => {
  const uploadChunks = buildChunks(uploadPack);
  const uploadHits = retrieve("How does document upload work?", uploadChunks, 6);
  assert.ok(uploadHits.length > 0);
  const routed = await routeSearchAnswer("How does document upload work?", uploadHits, 0, {
    pack: uploadPack,
    ask: uncitedSynthesisAsk("Document upload typically involves presigned URLs for S3."),
  });
  assert.equal(routed.consumeQuota, false);
  assert.equal(routed.card.answerMode, "docs");
  assert.ok(routed.card.say);
  assert.ok(routed.card.citations.some((c) => c.kind === "file" && c.path.includes("uploads.py")));
});

test("off-topic questions with irrelevant hits stay silent instead of speaking general knowledge", async () => {
  const devHits = retrieve("Who is a full stack developer?", chunks);
  const routed = await routeSearchAnswer("Who is a full stack developer?", devHits, 0, {
    pack: NORTHSTAR,
    ask: uncitedSynthesisAsk("A full-stack developer works across the client and the server."),
  });
  assert.equal(routed.consumeQuota, false);
  assert.equal(routed.card.say, null);
  assert.equal(
    routed.card.reason,
    devHits.length === 0 ? "No matching material" : "Your material doesn't cover this",
  );
});

test("off-topic questions with no hits stay silent", async () => {
  const routed = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: ask("INSUFFICIENT"),
  });
  assert.equal(routed.consumeQuota, false);
  assert.equal(routed.card.say, null);
  assert.equal(routed.card.reason, "No matching material");
});

test("INSUFFICIENT across tiers stays silent with the hit-aware reason", async () => {
  const none = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: ask("INSUFFICIENT"),
  });
  assert.equal(none.consumeQuota, false);
  assert.equal(none.card.say, null);
  assert.equal(none.card.reason, "No matching material");
  assert.equal(silentCardReason(0), "No matching material");

  const uncovered = await routeSearchAnswer("Do we store card numbers in the export?", cardHits, 0, {
    pack: NORTHSTAR,
    ask: ask("INSUFFICIENT"),
  });
  assert.equal(uncovered.consumeQuota, false);
  if (uncovered.card.say) {
    assert.equal(uncovered.card.answerMode, "docs");
  } else {
    assert.equal(uncovered.card.reason, "Your material doesn't cover this");
  }
});

test("an API error is not disguised as missing material", async () => {
  const broken = await routeSearchAnswer("What is the weather in Tokyo?", retryHits, 0, {
    pack: NORTHSTAR,
    ask: async () => ({ text: null, reason: "Add API key" }),
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
  });
  assert.equal(routed.consumeQuota, false);
  assert.equal(routed.card.say, null);
  assert.equal(routed.card.reason, "Couldn't generate an answer: timeout");
});

test("failed LLM answers do not consume quota", async () => {
  const failed = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: ask(null),
  });
  assert.equal(failed.consumeQuota, false);
  assert.equal(failed.card.reason, "No matching material");

  const silent = await routeSearchAnswer("What is the weather in Tokyo?", [], 0, {
    pack: NORTHSTAR,
    ask: ask(null),
  });
  assert.equal(silent.consumeQuota, false);
  assert.equal(silent.card.say, null);
});
