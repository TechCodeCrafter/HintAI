import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  AUTH_SERVICE_CLAIM,
  AUTH_SERVICE_LINE,
  AUTH_SERVICE_PATH,
  HOME_TRY_QUESTION,
  NORTHSTAR,
} from "../../repo/northstar.ts";
import { localCard } from "../local-card.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const chunks = buildChunks(NORTHSTAR);

test("search() never generates — retrieve, then localCard, then admit", () => {
  const store = readFileSync(join(root, "src/lib/store.ts"), "utf8");
  assert.doesNotMatch(store, /generateAnswer\s*\(/);
  assert.doesNotMatch(store, /hitsGroundAnswer/);
  assert.doesNotMatch(store, /speakAnswer/);
  assert.doesNotMatch(store, /craftCard/);
  assert.match(store, /retrieveHits/);
  assert.match(store, /localCard\(/);
});

test("a question the pack cannot cite stays silent", () => {
  const weather = localCard("What is the weather in Tokyo today?", retrieve("What is the weather in Tokyo today?", chunks), NORTHSTAR, 0);
  assert.equal(weather.say, null);
  assert.equal((weather.citations ?? []).length, 0);

  const cards = localCard("Do we store card numbers in the export?", retrieve("Do we store card numbers in the export?", chunks), NORTHSTAR, 0);
  assert.equal(cards.say, null);
});

test("a question the files can admit speaks the cited line", () => {
  const card = localCard("Why does that retry three times?", retrieve("Why does that retry three times?", chunks), NORTHSTAR, 0);
  assert.ok(card.say);
  assert.match(card.say, /three/i);
  assert.ok(card.citations.some((c) => "path" in c && String(c.path).includes("retry")));
});

test("the first-visit question cites src/auth.ts line 47", () => {
  const card = localCard(HOME_TRY_QUESTION, retrieve(HOME_TRY_QUESTION, chunks), NORTHSTAR, 0);
  assert.equal(card.say, AUTH_SERVICE_CLAIM);
  const cite = card.citations.find((c) => c.kind === "file");
  assert.ok(cite && cite.kind === "file");
  assert.equal(cite.path, AUTH_SERVICE_PATH);
  assert.equal(cite.line, AUTH_SERVICE_LINE);
});
