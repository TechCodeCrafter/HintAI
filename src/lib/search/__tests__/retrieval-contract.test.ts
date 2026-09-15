import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { hashText, verifyClaim } from "../evidence.ts";
import { createEvidenceSpan } from "../evidence-span.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("paraphrase fails verifyClaim — semantic recall cannot soften the spoken line", () => {
  const content = "The session cookie must rotate on every non-public request.";
  const span = createEvidenceSpan({
    path: "src/auth.ts",
    content,
    start: 0,
    end: content.length,
    contentHash: hashText(content),
    normalizedText: content,
  });
  assert.ok(span);
  assert.equal(verifyClaim("The session cookie must rotate on every non-public request.", [span]).ok, true);
  assert.equal(verifyClaim("The session cookie must rotated on every non-public request.", [span]).ok, false);
});

test("semantic and embedding modules document rank-only contract", () => {
  const embedding = readFileSync(join(root, "embedding.ts"), "utf8");
  const semantic = readFileSync(join(root, "semantic-retrieve.ts"), "utf8");
  const hybrid = readFileSync(join(root, "retrieve.ts"), "utf8");
  assert.match(embedding, /only ranks candidate chunks|never writes a spoken line/i);
  assert.match(semantic, /never composes a spoken line/);
  assert.match(hybrid, /Rank only — composition and verifyClaim/);
});

test("every speak path still calls verifyClaim after hybrid retrieve", () => {
  const localCard = readFileSync(join(root, "local-card.ts"), "utf8");
  const generate = readFileSync(join(root, "generate-answer.ts"), "utf8");
  const route = readFileSync(join(root, "answer-route.ts"), "utf8");
  assert.match(localCard, /verifyClaim\(/);
  assert.match(generate, /verifyClaim\(/);
  assert.match(route, /routeSearchAnswer/);
  assert.match(route, /localCard fallback — never general knowledge/);
  assert.match(route, /localCardFastPathEligible/);
  assert.doesNotMatch(route, /verifyClaim.*semantic|semantic.*skip.*verify/i);
});
