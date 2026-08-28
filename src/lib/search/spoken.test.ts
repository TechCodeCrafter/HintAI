import assert from "node:assert/strict";
import { test } from "node:test";

import { shapeOf } from "./intent.ts";
import { normalizeSpokenQuestion } from "./spoken.ts";

const canonical = (raw: string) => normalizeSpokenQuestion(raw).canonical;
const removed = (raw: string) => normalizeSpokenQuestion(raw).removed;

test("leading discourse markers come off, the question body does not", () => {
  assert.equal(canonical("So where is upload handled?"), "where is upload handled?");
  assert.equal(canonical("Basically, what owns this flow?"), "what owns this flow?");
  assert.equal(canonical("Okay so what does the BDA worker do?"), "what does the BDA worker do?");
  assert.equal(canonical("Right, but what happens if that fails?"), "what happens if that fails?");
  assert.equal(canonical("Um, what does the session service do again?"), "what does the session service do again?");
});

test("a marker word inside the question is left alone", () => {
  // "so" here introduces a purpose clause and is not scaffolding.
  const q = "Why do we retry so the job finishes?";
  assert.equal(canonical(q), q);
  // "right" as a direction, not a confirmation.
  assert.equal(canonical("Which files sit to the right of the router?"), "Which files sit to the right of the router?");
});

test("adverbial hedges come off in the position that makes them hedges", () => {
  assert.equal(canonical("Where are we actually doing the upload?"), "Where are we doing the upload?");
  assert.equal(canonical("Do we even have tests around this?"), "Do we have tests this?");
  assert.equal(canonical("So this service is just doing all of it?"), "this service is doing all of it?");
  assert.ok(removed("Where are we actually doing the upload?").includes("actually"));
});

test("a vague preposition on a trailing pronoun comes off", () => {
  assert.equal(canonical("Do we have tests around this?"), "Do we have tests this?");
  assert.equal(canonical("Is there anything about that?"), "Is there anything that?");
  assert.ok(removed("Do we have tests around this?").includes("around"));
});

test("the same preposition is kept wherever it qualifies something", () => {
  assert.equal(canonical("What happens around midnight?"), "What happens around midnight?");
  assert.equal(canonical("Which jobs run around this time?"), "Which jobs run around this time?");
  assert.equal(canonical("What does the doc say about retries?"), "What does the doc say about retries?");
});

test("a hedge token is kept where it carries meaning", () => {
  // "around" is never a hedge: here it is a time.
  assert.equal(canonical("What happens around midnight?"), "What happens around midnight?");
  // "actual" is an adjective naming a concept, not the adverb "actually".
  assert.equal(
    canonical("What does the actual retry count represent?"),
    "What does the actual retry count represent?",
  );
  // An "even" that modifies a noun stays.
  assert.equal(canonical("Does it split into even batches?"), "Does it split into even batches?");
});

test("explicit self-repair keeps the corrected subject, and only that", () => {
  const fixed = normalizeSpokenQuestion("Where's the config — I mean the template config?");
  assert.equal(fixed.canonical, "Where's the template config?");
  assert.equal(fixed.repairs.length, 1);
  // The abandoned subject must not survive alongside the correction.
  assert.doesNotMatch(fixed.canonical, /the config —/);

  const restated = normalizeSpokenQuestion("Does the worker, sorry, does the ingest worker retry?");
  assert.equal(restated.canonical, "does the ingest worker retry?");
});

test("negation, existence words and confirmation tags always survive", () => {
  // Absence detection reads all of these; losing any turns a challenge into a
  // request for a description.
  for (const q of [
    "We don't actually test this, right?",
    "We're not testing this anywhere, correct?",
    "So there aren't really any tests?",
    "Wait, this isn't persisted anywhere?",
  ]) {
    const out = canonical(q);
    // No \b before "n't": there is no word boundary inside "don't".
    assert.match(out, /(n't|\bnot\b|\bno\b|\bany)/i, `lost the negation: ${q} -> ${out}`);
    assert.equal(shapeOf(out), "absence", `${q} -> ${out}`);
  }
});

test("absence intent survives a modifier inside the construction", () => {
  for (const q of [
    "Do we have tests?",
    "Do we even have tests?",
    "Do we actually have tests?",
    "Do we have any tests at all?",
  ]) {
    assert.equal(shapeOf(canonical(q)), "absence", q);
  }
});

test("normalization does not change a question's shape", () => {
  // The point is to remove framing, never to reinterpret the ask.
  assert.equal(shapeOf(canonical("Why are we actually using retries?")), "why");
  assert.equal(shapeOf(canonical("So why did we do it this way?")), "why");
  assert.equal(shapeOf(canonical("Okay, so what happens when that thing blows up?")), "failure");
  assert.equal(shapeOf(canonical("So where does the Excel actually get written?")), "where");
  assert.equal(shapeOf(canonical("Basically, what owns this flow?")), "what");
});

test("a question that is only filler is left intact rather than emptied", () => {
  assert.equal(canonical("So?"), "So?");
  assert.equal(canonical("Okay"), "Okay");
});

test("identifiers and filenames pass through untouched", () => {
  assert.equal(
    canonical("So what does document_processing_service.py actually do?"),
    "what does document_processing_service.py do?",
  );
  assert.equal(canonical("Okay, where is MAX_RETRIES set?"), "where is MAX_RETRIES set?");
});
