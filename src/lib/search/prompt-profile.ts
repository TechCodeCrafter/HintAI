import type { SpaceMaterialView } from "../context/material-view.ts";
import type { Hit } from "../repo/types.ts";
import { buildSynthesisPrompt, buildWeakEvidencePrompt, hitsForPrompt } from "./generate-answer.ts";
import { estimatePromptTokens } from "./answer-fast-path.ts";

export type PromptProfile = {
  groundedTokens: number;
  synthesisTokens: number;
  chunkCount: number;
  chunkChars: number;
};

export function profileSynthesisPrompts(
  query: string,
  hits: Hit[],
  material?: SpaceMaterialView,
  history?: string[],
): PromptProfile {
  const grounded = buildSynthesisPrompt(query, hits, material);
  const synthesis = buildWeakEvidencePrompt(query, hits, history, material);
  const chunks = hitsForPrompt(hits);
  return {
    groundedTokens: estimatePromptTokens(grounded),
    synthesisTokens: estimatePromptTokens(synthesis),
    chunkCount: chunks.length,
    chunkChars: chunks.reduce((sum, hit) => sum + (hit.text?.length ?? 0), 0),
  };
}
