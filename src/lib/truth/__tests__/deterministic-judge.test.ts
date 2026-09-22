import assert from "node:assert/strict";
import test from "node:test";
import {
  assessApplicabilityDeterministic,
  assessEscalationDeterministic,
  classifyQuestionDeterministic,
  DeterministicTruthJudge,
} from "../deterministic-judge.ts";

test("classifyQuestionDeterministic maps architecture and external facts", () => {
  assert.equal(classifyQuestionDeterministic("What is the architecture of this app?"), "architecture");
  assert.equal(classifyQuestionDeterministic("What is the weather today?"), "current_external_fact");
  assert.equal(classifyQuestionDeterministic("How much does Pro cost?"), "pricing_packaging");
});

test("assessApplicabilityDeterministic rejects wrong source", () => {
  const decision = assessApplicabilityDeterministic({
    question: "Why does that retry three times?",
    evidence: {
      path: "src/auth.ts",
      text: "The auth service verifies the session cookie on every non-public request.",
    },
  });
  assert.equal(decision, "NOT_APPLICABLE");
});

test("assessEscalationDeterministic silences off-topic low-score retrieval", () => {
  const decision = assessEscalationDeterministic({
    question: "What is the weather in Paris?",
    topEvidence: [{ path: "README.md", text: "Northstar exports settlement files.", score: 1 }],
  });
  assert.equal(decision, "SILENT");
});

test("DeterministicTruthJudge returns structured results", async () => {
  const judge = new DeterministicTruthJudge();
  const result = await judge.classifyQuestion({ question: "Where is retry logic?" });
  assert.equal(result.provider, "deterministic");
  assert.ok(result.latencyMs >= 0);
  assert.equal(typeof result.class, "string");
});
