import { llmDebug } from "../debug.ts";
import { getDefaultModel, getModelById } from "../ai/models.ts";
import type { SpaceMaterialView } from "../context/material-view.ts";
import { enrichFileCitation, fileInMaterial, sourceLabel } from "../context/material-view.ts";
import { isFileHit, type Citation, type Hit, type RepoPack } from "../repo/types.ts";
import type { AnswerMode } from "./answer-mode.ts";
import { provenanceLabel } from "./cite.ts";
import { textEvidence, verifyClaim, type Evidence } from "./evidence.ts";

export type AnswerPolicy = "extract" | "synthesize";

export type GeneratedAnswer = {
  say: string;
  usedEvidence: boolean;
  citations: Citation[];
  evidence?: Evidence[];
  latencyMs: number;
  modelName?: string;
  answerMode: AnswerMode;
};

export type AnswerTiming = {
  llmMs: number;
  verifyMs: number;
};

export type AnswerResult =
  | { ok: true; answer: GeneratedAnswer; timing: AnswerTiming }
  | { ok: false; reason: "insufficient"; timing?: AnswerTiming }
  | { ok: false; reason: "error"; message: string; timing?: AnswerTiming };

export type SynthesisAsk = (payload: {
  query: string;
  prompt: string;
  modelId: string;
  maxTokens?: number;
  policy?: AnswerPolicy;
}) => Promise<{ text: string | null; reason?: string; modelName?: string }>;

const INSUFFICIENT = "INSUFFICIENT";
const MARKER = /\[(\d+)\]/g;
const CHUNK_CAP = 5;
/** Trimmed from 1000 — source identity preserved in chunkHeader; lowers LLM input tokens. */
const CHUNK_CHARS = 720;
const CHUNKS_PER_FILE = 2;

const GROUNDED_INSTRUCTION = `Use ONLY the chunks below. Never use general knowledge.
If insufficient, respond exactly: INSUFFICIENT
Cite claims with [1] or [2]. Max 2 sentences.`;

/** Keep retrieval order but stop a single file from filling the prompt. */
export function hitsForPrompt(hits: Hit[], cap = CHUNK_CAP, perFile = CHUNKS_PER_FILE): Hit[] {
  const used = new Map<string, number>();
  const out: Hit[] = [];
  for (const hit of hits) {
    const taken = used.get(hit.path) ?? 0;
    if (taken >= perFile) continue;
    used.set(hit.path, taken + 1);
    out.push(hit);
    if (out.length >= cap) break;
  }
  return out;
}

function chunkHeader(hit: Hit, material?: SpaceMaterialView): string {
  const where = isFileHit(hit) ? `${hit.path}:${hit.startLine}` : `${hit.path} (page ${hit.page})`;
  const label = sourceLabel(material, "sourceId" in hit ? hit.sourceId : undefined);
  return label ? `${label} · ${where}` : where;
}

/** Grounded synthesis prompt. The model may use only the numbered chunks. */
export function buildSynthesisPrompt(query: string, hits: Hit[], material?: SpaceMaterialView): string {
  const chunks = hitsForPrompt(hits).map((hit, i) => {
    return `[${i + 1}] ${chunkHeader(hit, material)}\n${(hit.text ?? "").slice(0, CHUNK_CHARS)}`;
  });
  const documents = chunks.length > 0 ? chunks.join("\n\n") : "(no matching documents)";
  return `${GROUNDED_INSTRUCTION}

DOCUMENTS:
${documents}

QUESTION: "${query}"`;
}

function formatChunks(hits: Hit[], material?: SpaceMaterialView): string {
  const chunks = hitsForPrompt(hits).map((hit, i) => {
    return `[${i + 1}] ${chunkHeader(hit, material)}\n${(hit.text ?? "").slice(0, CHUNK_CHARS)}`;
  });
  return chunks.length > 0 ? chunks.join("\n\n") : "(no matching documents)";
}

function historyBlock(history?: string[]): string {
  if (!history?.length) return "";
  return `\nRECENT QUESTIONS:\n${history
    .slice(0, 4)
    .map((item) => `- ${item}`)
    .join("\n")}\n`;
}

/** Cited synthesis when grounded extract returned INSUFFICIENT. Same cite-or-silence contract as tier 1. */
export function buildWeakEvidencePrompt(
  query: string,
  hits: Hit[],
  history?: string[],
  material?: SpaceMaterialView,
): string {
  return `${GROUNDED_INSTRUCTION}
${historyBlock(history)}
DOCUMENT CHUNKS:
${formatChunks(hits, material)}

QUESTION: "${query}"`;
}

/** Pick the sentence in a chunk that overlaps the question most. */
export function extractBestSentence(text: string, query: string): string {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2);
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 12);
  if (sentences.length === 0) return text.replace(/\s+/g, " ").trim().slice(0, 240);
  let best = sentences[0]!;
  let bestScore = -1;
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }
  return best;
}

/** 1-based chunk indexes cited as [N], in first-seen order. */
export function citationIndexes(text: string): number[] {
  const found: number[] = [];
  const seen = new Set<number>();
  for (const match of text.matchAll(MARKER)) {
    const n = Number(match[1]);
    if (!Number.isInteger(n) || n < 1 || seen.has(n)) continue;
    seen.add(n);
    found.push(n);
  }
  return found;
}

export function stripCitationMarkers(text: string): string {
  return text.replace(MARKER, "").replace(/\s+([.!?])/g, "$1").replace(/\s+/g, " ").trim();
}

function isInsufficient(text: string): boolean {
  return text.replace(/[.!]+$/g, "").trim().toUpperCase() === INSUFFICIENT;
}

function resolveFileContent(hit: Hit, pack?: RepoPack, material?: SpaceMaterialView) {
  if (!isFileHit(hit)) return null;
  return (
    (material ? fileInMaterial(material, hit.path, hit.sourceId) : undefined) ??
    pack?.files.find((item) => item.path === hit.path) ??
    null
  );
}

function evidenceFromHit(hit: Hit, pack?: RepoPack, material?: SpaceMaterialView): Evidence | null {
  if (isFileHit(hit)) {
    const file = resolveFileContent(hit, pack, material);
    if (file) {
      const fromOffset = file.content.slice(hit.startOffset, hit.startOffset + hit.text.length);
      const start = fromOffset === hit.text ? hit.startOffset : file.content.indexOf(hit.text);
      if (start >= 0) {
        return textEvidence({
          path: hit.path,
          content: file.content,
          start,
          end: start + hit.text.length,
          normalizedText: hit.text,
          sourceId: hit.sourceId ?? (material ? fileInMaterial(material, hit.path, hit.sourceId)?.sourceId : undefined),
        });
      }
    }
  }
  if (!hit.text) return null;
  return textEvidence({
    path: hit.path,
    content: hit.text,
    start: 0,
    end: hit.text.length,
    normalizedText: hit.text,
  });
}

function citationFrom(hit: Hit, evidence: Evidence, material?: SpaceMaterialView): Citation {
  if (evidence.kind === "text" && isFileHit(hit)) {
    return enrichFileCitation(
      {
        kind: "file",
        path: evidence.path,
        line: evidence.startLine,
        endLine: evidence.endLine,
        evidenceId: evidence.id,
        sha: hit.sha,
        pr: hit.pr,
        label: provenanceLabel(hit),
        sourceId: evidence.sourceId,
        contentHash: evidence.contentHash,
      },
      material,
      evidence.sourceId,
    );
  }
  if (hit.kind === "document") {
    const ref = material?.sources.find((row) => row.sourceId === hit.sourceId);
    return {
      kind: "document",
      sourceId: hit.sourceId,
      path: hit.path,
      page: hit.page,
      heading: hit.heading,
      evidenceId: evidence.id,
      displayName: ref?.displayName,
      contextId: ref?.contextId,
      label: hit.heading ?? ref?.displayName ?? "",
    };
  }
  return enrichFileCitation(
    {
      kind: "file",
      path: hit.path,
      line: isFileHit(hit) ? hit.startLine : 1,
      endLine: isFileHit(hit) && hit.endLine > hit.startLine ? hit.endLine : undefined,
      sourceId: isFileHit(hit) ? hit.sourceId : undefined,
      label: hit.path,
    },
    material,
    isFileHit(hit) ? hit.sourceId : undefined,
  );
}

function evidenceForMarkers(
  text: string,
  hits: Hit[],
  pack?: RepoPack,
  material?: SpaceMaterialView,
): { evidence: Evidence[]; citations: Citation[] } {
  const evidence: Evidence[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const index of citationIndexes(text)) {
    const hit = hits[index - 1];
    if (!hit) continue;
    const span = evidenceFromHit(hit, pack, material);
    if (!span || seen.has(span.id)) continue;
    seen.add(span.id);
    evidence.push(span);
    citations.push(citationFrom(hit, span, material));
  }
  return { evidence, citations };
}

async function defaultAsk(prompt: string, modelId: string, maxTokens?: number, policy: AnswerPolicy = "extract") {
  llmDebug("[ask] prompt length:", prompt.length, "head:", prompt.slice(0, 60));
  const { completeSynthesis } = await import("@/lib/ai/cardsmith");
  const { readClientKeys } = await import("@/lib/ai/client-keys");
  return completeSynthesis({ data: { prompt, modelId, maxTokens, keys: readClientKeys(), policy } });
}

export type GenerateOpts = {
  ask?: SynthesisAsk;
  modelId?: string;
  pack?: RepoPack;
  material?: SpaceMaterialView;
  maxTokens?: number;
  threadHistory?: string[];
};

type CompletionResult =
  | { ok: true; text: string; modelName?: string }
  | { ok: false; reason: "error"; message: string };

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (typeof err === "string" && err.trim()) return err.trim();
  return fallback;
}

async function runCompletion(
  run: () => Promise<{ text: string | null; reason?: string; modelName?: string }>,
  fallbackName: string,
): Promise<CompletionResult> {
  try {
    const remote = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        globalThis.setTimeout(() => reject(new Error("timeout")), 12000);
      }),
    ]);
    const raw = remote.text?.replace(/\s+/g, " ").trim() ?? "";
    if (!raw) {
      return { ok: false, reason: "error", message: (remote.reason ?? "empty").trim() || "empty" };
    }
    return { ok: true, text: raw, modelName: remote.modelName ?? fallbackName };
  } catch (err) {
    return { ok: false, reason: "error", message: errorMessage(err, "timeout") };
  }
}

async function completePrompt(
  query: string,
  prompt: string,
  policy: AnswerPolicy,
  opts?: GenerateOpts,
): Promise<CompletionResult> {
  const model = getModelById(opts?.modelId) ?? getDefaultModel();
  return runCompletion(async () => {
    if (typeof window !== "undefined" && window.__mockCraftCard) {
      const mocked = await window.__mockCraftCard({
        query,
        instruction: prompt,
        hits: [],
        task: "answer",
        modelId: model.id,
      });
      return { text: mocked?.say ?? null, modelName: model.name };
    }
    return opts?.ask
      ? opts.ask({ query, prompt, modelId: model.id, maxTokens: opts.maxTokens, policy })
      : defaultAsk(prompt, model.id, opts?.maxTokens, policy);
  }, model.name);
}

/**
 * Combine cited chunks into a short spoken line. Does not invent.
 * Unverified synthesis is silence.
 */
export async function generateAnswer(
  query: string,
  hits: Hit[],
  t0: number,
  opts?: GenerateOpts,
): Promise<AnswerResult> {
  if (hits.length === 0) return { ok: false, reason: "insufficient" };
  const llmStart = performance.now();
  const remote = await completePrompt(query, buildSynthesisPrompt(query, hits, opts?.material), "extract", opts);
  const llmMs = Math.round(performance.now() - llmStart);
  if (!remote.ok) return { ...remote, timing: { llmMs, verifyMs: 0 } };
  if (isInsufficient(remote.text)) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs: 0 } };
  const say = stripCitationMarkers(remote.text);
  if (!say) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs: 0 } };
  const { evidence, citations } = evidenceForMarkers(remote.text, hits, opts?.pack, opts?.material);
  if (evidence.length === 0) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs: 0 } };
  const verifyStart = performance.now();
  const check = verifyClaim(say, evidence);
  const verifyMs = Math.round(performance.now() - verifyStart);
  if (!check.ok || check.checked === 0) {
    return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs } };
  }
  return {
    ok: true,
    answer: {
      say,
      usedEvidence: true,
      citations,
      evidence,
      latencyMs: Math.round(performance.now() - t0),
      modelName: remote.modelName,
      answerMode: "docs",
    },
    timing: { llmMs, verifyMs },
  };
}

/** Cited synthesis when grounded extract returned INSUFFICIENT. Uncited lines are insufficient. */
export async function synthesizeAnswer(
  query: string,
  hits: Hit[],
  t0: number,
  opts?: GenerateOpts,
): Promise<AnswerResult> {
  const llmStart = performance.now();
  const remote = await completePrompt(
    query,
    buildWeakEvidencePrompt(query, hits, opts?.threadHistory, opts?.material),
    "synthesize",
    opts,
  );
  const llmMs = Math.round(performance.now() - llmStart);
  if (!remote.ok) return { ...remote, timing: { llmMs, verifyMs: 0 } };
  if (isInsufficient(remote.text)) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs: 0 } };
  const say = stripCitationMarkers(remote.text);
  if (!say) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs: 0 } };
  const { evidence, citations } = evidenceForMarkers(remote.text, hits, opts?.pack, opts?.material);
  if (evidence.length === 0) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs: 0 } };
  const verifyStart = performance.now();
  const check = verifyClaim(say, evidence);
  const verifyMs = Math.round(performance.now() - verifyStart);
  if (!check.ok || check.checked === 0) {
    return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs } };
  }
  return {
    ok: true,
    answer: {
      say,
      usedEvidence: true,
      citations,
      evidence,
      latencyMs: Math.round(performance.now() - t0),
      modelName: remote.modelName,
      answerMode: "synthesized",
    },
    timing: { llmMs, verifyMs },
  };
}
