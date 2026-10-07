import { completePrompt, type CompletionResult, type GenerateOpts } from "./generate-answer.ts";

export type GeneralAnswerResult =
  | { ok: true; say: string; modelName?: string; latencyMs: number }
  | { ok: false; reason: "error"; message: string };

const GENERAL_INSTRUCTION = `You are a meeting copilot's general-knowledge fallback. The user's own files did NOT cover their question, so answer from general knowledge.

Rules:
- Give a short, speakable answer: max 2 sentences.
- State uncertainty plainly when unsure ("I believe…", "Generally…").
- NEVER invent file names, paths, line numbers, page numbers, or citations.
- NEVER use citation markers like [1] or [2].
- NEVER claim the answer comes from the user's material.
- If you cannot answer helpfully, respond exactly: INSUFFICIENT`;

/** Citation-shaped text that must never leak into a general answer. */
const CITATION_SHAPES: RegExp[] = [
  /\[\d+\]/g, // [1] markers
  /\b[\w\-./]+\.(ts|tsx|js|jsx|md|pdf|py|java|go|rs)\s*:\s*\d+/gi, // file.ts:42
  /\b(?:file|path)\s*:\s*\S+/gi, // file: x, path: y
  /\bline\s+\d+/gi, // line 42
  /\bpage\s+\d+\s+of\b/gi, // page 3 of
];

/**
 * Strip citation-shaped text from a general answer. Belt and suspenders:
 * the prompt already forbids citations, this catches stragglers so a
 * general card can never present as cited.
 */
export function stripCitationShapes(text: string): string {
  let out = text;
  for (const shape of CITATION_SHAPES) {
    out = out.replace(shape, "");
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}

function historyBlock(history?: string[]): string {
  if (!history || history.length === 0) return "";
  const recent = history.slice(-3);
  return `\nRecent questions for context:\n${recent.map((q) => `- ${q}`).join("\n")}\n`;
}

export function buildGeneralPrompt(query: string, history?: string[]): string {
  return `${GENERAL_INSTRUCTION}${historyBlock(history)}\nQUESTION: "${query}"`;
}

/**
 * General-knowledge fallback. Runs ONLY when the grounded pipeline returned
 * INSUFFICIENT — the retrieved chunks are deliberately NOT passed in, so the
 * model cannot launder file content into an "uncited" answer.
 *
 * The result carries no citations and no evidence by construction: the return
 * type has no fields for them.
 */
export async function generalAnswer(
  query: string,
  t0: number,
  opts?: GenerateOpts,
): Promise<GeneralAnswerResult> {
  const prompt = buildGeneralPrompt(query, opts?.threadHistory);
  let completion: CompletionResult;
  try {
    completion = await completePrompt(query, prompt, "synthesize", opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "error", message: message.trim() || "general answer failed" };
  }
  if (!completion.ok) {
    return { ok: false, reason: "error", message: completion.message };
  }
  const say = stripCitationShapes(completion.text).trim();
  // The model signals it cannot answer helpfully with INSUFFICIENT (prompt
  // contract). Match leniently: the word alone, with punctuation, or as a
  // short prefix ("Insufficient information…").
  if (!say || /^insufficient\b[.!…]*$/i.test(say) || (/^insufficient\b/i.test(say) && say.length < 60)) {
    return { ok: false, reason: "error", message: "general answer insufficient" };
  }
  return {
    ok: true,
    say,
    modelName: completion.modelName,
    latencyMs: Math.round(performance.now() - t0),
  };
}
