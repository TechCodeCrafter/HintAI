import assert from "node:assert/strict";
import { test } from "node:test";
import { isLiveQuestion } from "./question.ts";
import { buildChunks, packVocabulary } from "./retrieve.ts";
import { sayable } from "./say.ts";
import type { RepoPack } from "../repo/types.ts";

const PACK: RepoPack = {
  id: "audit-fixture",
  name: "fixture",
  description: "fixture pack for gate tests",
  files: [
    {
      path: "src/auth/flow.ts",
      language: "ts",
      content: [
        "// Authorization flow. We implement session rotation in edge middleware.",
        "export function rotateSession(token: string) {",
        "  if (verify(token) fails) return null;",
        "  return issue(token);",
        "}",
      ].join("\n"),
    },
    {
      path: "src/exporter/retry.ts",
      language: "ts",
      content: ["export const MAX_ATTEMPTS = 3;", "// Gateway timeouts forced this cap."].join("\n"),
    },
  ],
  commits: [],
};

const gate = { vocab: packVocabulary(buildChunks(PACK)) };

// Meeting logistics. None of these may ever cost the room a Card.
const CHATTER = [
  "Can you hear me?",
  "Can you see my screen?",
  "How are you?",
  "Are you there?",
  "Next slide?",
  "Should we move on?",
  "Any questions?",
  "We'll take that offline.",
  "Are we good?",
  "Can everyone see this?",
  "I think you're muted.",
];

// Real questions about loaded material.
const REAL = [
  "Where is authentication handled?",
  "Why did you implement it this way?",
  "What service owns this?",
  "What happens if this call fails?",
  "How does the authorization flow work?",
  "What does this contract say about termination?",
  "What were the revenue numbers?",
  "What are the requirements for this feature?",
];

test("chatter never triggers retrieval", () => {
  for (const line of CHATTER) {
    assert.equal(isLiveQuestion(line, gate), false, `should stay quiet: ${line}`);
  }
});

test("questions about the material trigger retrieval", () => {
  for (const line of REAL) {
    assert.equal(isLiveQuestion(line, gate), true, `should trigger: ${line}`);
  }
});

test("an open thread lets a terse follow-up through", () => {
  assert.equal(isLiveQuestion("And why that number?", gate), false);
  assert.equal(isLiveQuestion("And why that number?", { ...gate, threadOpen: true }), true);
});

test("an open thread still does not let chatter through", () => {
  for (const line of CHATTER) {
    assert.equal(
      isLiveQuestion(line, { ...gate, threadOpen: true }),
      false,
      `should stay quiet even mid-thread: ${line}`,
    );
  }
});

test("sayable strips source narration and keeps the answer", () => {
  assert.equal(
    sayable("Based on the provided repository context, authentication happens upstream."),
    "Authentication happens upstream.",
  );
  assert.equal(
    sayable("It appears that the retries are capped at three."),
    "The retries are capped at three.",
  );
  assert.equal(
    sayable("According to the documentation, sessions rotate in edge middleware."),
    "Sessions rotate in edge middleware.",
  );
});

test("sayable rejects a line that is only narration", () => {
  assert.equal(sayable("Based on the provided context."), null);
  assert.equal(sayable("It appears that."), null);
  assert.equal(sayable(null), null);
});

test("sayable leaves a clean spoken line alone", () => {
  const line = "Authentication happens upstream. The frontend only reads authorities.";
  assert.equal(sayable(line), line);
});
