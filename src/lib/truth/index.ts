export * from "./truth-judge.ts";
export * from "./question-classes.ts";
export * from "./deterministic-judge.ts";
export * from "./jev-client.ts";
export * from "./jev-judge.ts";
export * from "./llm-judge.ts";
export * from "./metrics.ts";

import { DeterministicTruthJudge } from "./deterministic-judge.ts";
import { JevTruthJudge } from "./jev-judge.ts";
import { LLMTruthJudge } from "./llm-judge.ts";
import type { TruthJudge, TruthJudgeKind } from "./truth-judge.ts";

export function createTruthJudge(kind: TruthJudgeKind): TruthJudge {
  if (kind === "deterministic") return new DeterministicTruthJudge();
  if (kind === "jev") return new JevTruthJudge();
  return new LLMTruthJudge();
}
