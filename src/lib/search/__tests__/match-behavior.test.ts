import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import type { Hit } from "../../repo/types.ts";
import { extractBestSentence, hitsForPrompt } from "../generate-answer.ts";

/**
 * Behavioral coverage for the private matching helpers in generate-answer.ts
 * (stemForMatch, wordsAreSimilar with its trigram threshold, wordsShareConcept
 * with CONCEPT_GROUPS). The helpers are module-private, so every assertion goes
 * through the nearest exported functions: extractBestSentence (sentence picking
 * driven by scoreSentenceAgainstQuery -> termMatchesText) and hitsForPrompt
 * (hit ordering driven by reorderHitsForQuery -> semanticHitScore).
 *
 * Convention: BASE is a sentence sharing no stems, trigrams, or concepts with
 * any query below. In "should match" cases the candidate sentence must win; in
 * "should not match" cases nothing scores, so the first sentence (BASE) wins.
 */
const BASE = "Zebra patterns in the moonlight sky above.";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../generate-answer.ts"), "utf8");

function picked(candidate: string, query: string): string {
  return extractBestSentence(`${BASE} ${candidate}`, query);
}

function codeHit(id: string, path: string, text: string): Hit {
  return {
    id,
    kind: "code",
    path,
    startLine: 1,
    endLine: 1,
    startOffset: 0,
    text,
    score: 0,
  };
}

test("trigram similarity threshold is pinned at 0.62", () => {
  assert.match(source, />=\s*0\.62/);
});

test("plural -s forms match their singular in both directions", () => {
  assert.match(picked("The cats sat outside today.", "cat"), /cats sat/);
  assert.match(picked("The cat sat outside today.", "cats"), /cat sat/);
});

test("-ies plurals match their singular in both directions", () => {
  assert.match(picked("The stories end too soon here.", "story"), /stories end/);
  assert.match(picked("The story ends too soon here.", "stories"), /story ends/);
});

test("-ing forms match their base in both directions", () => {
  assert.match(picked("We are testing the checkout flow.", "test"), /testing the checkout/);
  assert.match(picked("We ran a test of incoming flow.", "testing"), /ran a test/);
});

test("-ed forms match their base in both directions", () => {
  assert.match(picked("We deployed the service this morning.", "deploy"), /deployed the service/);
  assert.match(picked("We deploy the service every morning.", "deployed"), /deploy the service every/);
});

test("mixed-case queries match lowercase evidence", () => {
  assert.match(picked("The deployment finished this morning.", "DEPLOYMENT"), /deployment finished/);
  assert.match(picked("We deployed the service this morning.", "Deployment"), /deployed the service/);
});

test("already-stemmed words match exactly", () => {
  assert.match(picked("We will deploy on Friday morning.", "deploy"), /deploy on Friday/);
});

test("identical words match", () => {
  assert.match(picked("The token expired an hour ago.", "token"), /token expired/);
});

test("small typos above the trigram threshold match", () => {
  assert.match(picked("The tokken expired an hour ago.", "token"), /tokken expired/);
  assert.match(picked("The loggin attempt failed at midnight.", "login"), /loggin attempt/);
  assert.match(picked("The endpooint returns data at noon.", "endpoint"), /endpooint returns/);
  assert.match(picked("Authentcation uses signed tokens now.", "authentication"), /Authentcation uses/);
});

test("a typo just above 0.62 matches, pinning the threshold from above", () => {
  // databse ~ database scores ~0.667: raising the threshold to 0.70 would break this.
  assert.match(picked("The databse server is very fast.", "database"), /databse server/);
});

test("unrelated words do not match", () => {
  assert.equal(picked("The zebra crossed the river today.", "token"), BASE);
  assert.equal(picked("Quantum dots glow in the display.", "token"), BASE);
});

test("short fragments below the threshold do not match, pinning it from below", () => {
  // "tok" ~ "token" scores ~0.50: lowering the threshold to 0.50 would break this.
  assert.equal(picked("The tok value is configured here.", "token"), BASE);
});

test("auth group: login and authentication match symmetrically", () => {
  assert.match(picked("The login screen appears here today.", "authentication"), /login screen/);
  assert.match(picked("Authentication uses signed tokens now.", "login"), /Authentication uses/);
});

test("api group: endpoint and route match symmetrically", () => {
  assert.match(picked("The endpoint returns data at noon.", "route"), /endpoint returns/);
  assert.match(picked("The route handler runs at noon.", "endpoint"), /route handler/);
});

test("database group: database and schema match symmetrically", () => {
  assert.match(picked("The database backup runs at midnight.", "schema"), /database backup/);
  assert.match(picked("The schema changed again this week.", "database"), /schema changed/);
});

test("error group: failure and exception match symmetrically", () => {
  assert.match(picked("The failure was logged last night.", "exception"), /failure was logged/);
  assert.match(picked("The exception traceback ends here today.", "failure"), /exception traceback/);
});

test("deploy group: deployment and release match symmetrically", () => {
  assert.match(picked("The deployment finished this morning.", "release"), /deployment finished/);
  assert.match(picked("The release shipped this morning.", "deployment"), /release shipped/);
});

test("upload group: upload and ingest match symmetrically", () => {
  assert.match(picked("The upload completed this morning.", "ingest"), /upload completed/);
  assert.match(picked("The ingest pipeline runs at midnight.", "upload"), /ingest pipeline/);
});

test("search group: find and lookup match symmetrically", () => {
  assert.match(picked("The find command lists entries here.", "lookup"), /find command/);
  assert.match(picked("The lookup table loads at startup.", "find"), /lookup table/);
});

test("config group: settings and environment match symmetrically", () => {
  assert.match(picked("The settings panel opens on click.", "environment"), /settings panel/);
  assert.match(picked("The environment loads from disk now.", "settings"), /environment loads/);
});

test("document group: pdf and corpus match symmetrically", () => {
  assert.match(picked("The pdf opens in the viewer now.", "corpus"), /pdf opens/);
  assert.match(picked("The corpus contains many manuals.", "pdf"), /corpus contains/);
});

test("words from different concept groups do not match", () => {
  assert.equal(picked("The login screen appears here today.", "database"), BASE);
  assert.equal(picked("The endpoint returns data at noon.", "pdf"), BASE);
});

test("words in no concept group do not match each other", () => {
  assert.equal(picked("The quilt is folded neatly here.", "zebra"), BASE);
  assert.equal(picked("Moonlight falls across the meadow.", "quilt"), BASE);
});

test("hitsForPrompt ranks the concept mate first, symmetrically", () => {
  const mate = codeHit("mate", "a/auth.md", "The login screen appears here today for users.");
  const other = codeHit("other", "b/docs.md", BASE);
  const forAuth = hitsForPrompt([other, mate], 5, 2, "authentication").map((hit) => hit.id);
  assert.deepEqual(forAuth, ["mate", "other"]);
  const mate2 = codeHit("mate", "a/auth.md", "Authentication uses signed tokens now for users.");
  const forLogin = hitsForPrompt([other, mate2], 5, 2, "login").map((hit) => hit.id);
  assert.deepEqual(forLogin, ["mate", "other"]);
});

test("empty, whitespace, and punctuation queries return the first sentence", () => {
  assert.equal(picked("The tokken expired an hour ago.", ""), BASE);
  assert.equal(picked("The tokken expired an hour ago.", "   "), BASE);
  assert.equal(picked("The tokken expired an hour ago.", "!!! ??? ..."), BASE);
});

test("single-character, very short, and stop-word queries return the first sentence", () => {
  assert.equal(picked("The tokken expired an hour ago.", "a"), BASE);
  assert.equal(picked("The tokken expired an hour ago.", "go"), BASE);
  assert.equal(picked("The tokken expired an hour ago.", "is the"), BASE);
});

test("uppercase evidence matches a lowercase query", () => {
  assert.match(picked("THE LOGIN SCREEN APPEARS HERE TODAY.", "authentication"), /LOGIN SCREEN/);
});
