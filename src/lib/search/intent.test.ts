import assert from "node:assert/strict";
import { test } from "node:test";

import { evidenceFitsShape, shapeOf } from "./intent.ts";

test("rationale questions are read as why, however they open", () => {
  for (const q of [
    "Why did the team choose an in-memory repository?",
    "Why are there seven lambdas?",
    "why is data not persisted between runs?",
    "Why is the extraction done in a container lambda?",
  ]) {
    assert.equal(shapeOf(q), "why", q);
  }
});

test("error-path questions are failure, even when they open with what", () => {
  for (const q of [
    "What happens if the extraction fails?",
    "What happens when the upload fails?",
    "What is the retry behaviour?",
  ]) {
    assert.equal(shapeOf(q), "failure", q);
  }
});

test("existence questions are absence", () => {
  for (const q of ["Do we have unit tests?", "Is there a rate limiter?", "Does it support webhooks?"]) {
    assert.equal(shapeOf(q), "absence", q);
  }
});

test("a challenge is an absence question, not a request for a description", () => {
  // Heard on a live call. It reads as a statement, but it asks GROUND to confirm
  // that something does not exist, which no retrieved prose can do.
  for (const q of [
    "We're not testing this application at all, right?",
    "So we are not having any test cases?",
    "We have no test cases, right?",
    "There isn't any retry logic, correct?",
  ]) {
    assert.equal(shapeOf(q), "absence", q);
  }
});

test("a negation that is not a challenge keeps its own shape", () => {
  // "not" alone must not silence ordinary questions.
  assert.equal(shapeOf("Why is data not persisted between runs?"), "why");
  assert.equal(shapeOf("What does the worker do when a document is not a PDF?"), "what");
});

test("descriptive and locational questions keep their ordinary shapes", () => {
  assert.equal(shapeOf("What does the BDA ingest worker do?"), "what");
  assert.equal(shapeOf("How does the Excel export work?"), "how");
  assert.equal(shapeOf("Where does document upload happen?"), "where");
  assert.equal(shapeOf("Who touched the auth flow?"), "who");
});

test("a description of behaviour never answers why", () => {
  const behaviour = "Stores data in memory using dictionaries, for unit testing and rapid prototyping.";
  assert.equal(evidenceFitsShape("why", behaviour), false);
  // The same sentence is a perfectly good answer to what it does.
  assert.equal(evidenceFitsShape("what", behaviour), true);
});

test("evidence that states a reason does answer why", () => {
  assert.equal(
    evidenceFitsShape("why", "We capped retries at three because the payment gateway stalled in March."),
    true,
  );
  assert.equal(evidenceFitsShape("why", "Three on purpose, not a generic backoff."), true);
  assert.equal(evidenceFitsShape("why", "Held in memory rather than a database to avoid setup."), true);
});

test("a commit or ADR is rationale evidence by construction", () => {
  // Not because of its wording — because of what that kind of document is for.
  assert.equal(evidenceFitsShape("why", "Cap exporter attempts at three.", true), true);
});

test("failure questions need evidence about the failure path", () => {
  assert.equal(evidenceFitsShape("failure", "Generates presigned S3 upload URLs for the client."), false);
  assert.equal(evidenceFitsShape("failure", "On timeout the job retries, then goes to the dead-letter queue."), true);
});

test("absence is never answered from retrieved prose", () => {
  // A docstring mentioning "unit testing" is not proof that tests exist.
  assert.equal(evidenceFitsShape("absence", "Perfect for unit testing and integration tests."), false);
  assert.equal(evidenceFitsShape("absence", "anything at all", true), false);
});
