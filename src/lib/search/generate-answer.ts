import { llmDebug } from "../debug.ts";
import { getDefaultModel, getModelById } from "../ai/models.ts";
import type { SpaceMaterialView } from "../context/material-view.ts";
import { completeChat } from "../ai/synthesis-client.ts";
import { readClientKeys } from "../ai/client-keys.ts";
import { enrichFileCitation, fileInMaterial, sourceLabel } from "../context/material-view.ts";
import { isFileHit, type Citation, type Hit, type RepoPack } from "../repo/types.ts";
import type { AnswerMode } from "./answer-mode.ts";
import { provenanceLabel } from "./cite.ts";
import { corpusHasWord, textEvidence, verifyClaim, type Evidence } from "./evidence.ts";

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
const CHUNK_CAP = 8;
/** Per-chunk text budget; source identity is preserved in chunkHeader. */
const CHUNK_CHARS = 1200;
const CHUNKS_PER_FILE = 4;

// Every content word of the answer is checked against the cited chunks, so a
// paraphrase ("send back", "phase") is rejected even when the fact is right.
// Asking for the chunks' own wording is what lets correct answers through.
const GROUNDED_INSTRUCTION = `Use ONLY the chunks below. Never use general knowledge.
If insufficient, respond exactly: INSUFFICIENT
Answer in the chunks' own words: reuse their terms, names, and numbers; do not add words they do not contain.
Cite every chunk you take words from, e.g. [1][2]. Max 2 sentences.`;

/**
 * Keep retrieval order but stop a single file from filling the prompt. PDFs
 * count per page (as in retrieval), or a one-PDF space could never fill it.
 */
export function hitsForPrompt(hits: Hit[], cap = CHUNK_CAP, perFile = CHUNKS_PER_FILE): Hit[] {
  const used = new Map<string, number>();
  const out: Hit[] = [];
  for (const hit of hits) {
    const unit = hit.kind === "document" ? `${hit.path}#page=${hit.page}` : hit.path;
    const taken = used.get(unit) ?? 0;
    if (taken >= perFile) continue;
    used.set(unit, taken + 1);
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

/** First `max` sentences, punctuation kept; "..." marks a cut. */
export function firstSentences(text: string, max = 2): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= max) return sentences.join(" ");
  return `${sentences.slice(0, max).join(" ")}...`;
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
  // [N] numbers the chunks as the prompt showed them, after per-file filtering.
  const numbered = hitsForPrompt(hits);
  for (const index of citationIndexes(text)) {
    const hit = numbered[index - 1];
    if (!hit) continue;
    const span = evidenceFromHit(hit, pack, material);
    if (!span || seen.has(span.id)) continue;
    seen.add(span.id);
    evidence.push(span);
    citations.push(citationFrom(hit, span, material));
  }
  return { evidence, citations };
}

type VerifiedEvidence = {
  evidence: Evidence[];
  citations: Citation[];
  check: ReturnType<typeof verifyClaim> | null;
};

/**
 * Verify against the chunks the model cited. Models routinely cite the chunk
 * holding the fact ("2–2.5 hour test session") while taking the subject from a
 * neighbouring chunk they were shown ("Beta testing session guide"). When the
 * cited chunks alone fall short, prompt chunks that supply a missing word join
 * the evidence and are cited too, so every spoken word still comes from the
 * user's material and every chunk it came from is shown.
 */
function verifiedEvidence(
  say: string,
  text: string,
  hits: Hit[],
  pack?: RepoPack,
  material?: SpaceMaterialView,
): VerifiedEvidence {
  const cited = evidenceForMarkers(text, hits, pack, material);
  if (cited.evidence.length === 0) return { ...cited, check: null };
  const first = verifyClaim(say, cited.evidence);
  if (first.ok) return { ...cited, check: first };

  const seen = new Set(cited.evidence.map((span) => span.id));
  const evidence = [...cited.evidence];
  const citations = [...cited.citations];
  for (const hit of hitsForPrompt(hits)) {
    const body = (hit.text ?? "").toLowerCase();
    if (!first.missing.some((word) => corpusHasWord(body, word))) continue;
    const span = evidenceFromHit(hit, pack, material);
    if (!span || seen.has(span.id)) continue;
    seen.add(span.id);
    evidence.push(span);
    citations.push(citationFrom(hit, span, material));
  }
  if (evidence.length === cited.evidence.length) return { ...cited, check: first };
  return { evidence, citations, check: verifyClaim(say, evidence) };
}

/** Sentences of a raw reply, each keeping the [N] markers written after its full stop. */
export function citedSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?](?:\s*\[\d+\])*)\s+(?!\[\d+\])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The spoken line and the evidence behind it, or null for silence. The whole
 * reply is checked first; failing that, each sentence is checked against its
 * own citations and only the sentences that pass are kept, so one paraphrased
 * sentence no longer silences a correct one beside it.
 */
function verifiedAnswer(
  text: string,
  hits: Hit[],
  pack?: RepoPack,
  material?: SpaceMaterialView,
): { say: string; evidence: Evidence[]; citations: Citation[] } | null {
  const say = firstSentences(stripCitationMarkers(text));
  if (!say) return null;
  const whole = verifiedEvidence(say, text, hits, pack, material);
  if (whole.check?.ok && whole.check.checked > 0) {
    return { say, evidence: whole.evidence, citations: whole.citations };
  }

  const kept: string[] = [];
  const evidence: Evidence[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const part of citedSentences(text).slice(0, 2)) {
    const line = stripCitationMarkers(part);
    if (!line) continue;
    const verified = verifiedEvidence(line, part, hits, pack, material);
    if (!verified.check?.ok || verified.check.checked === 0) continue;
    kept.push(line);
    verified.evidence.forEach((span, i) => {
      if (seen.has(span.id)) return;
      seen.add(span.id);
      evidence.push(span);
      const citation = verified.citations[i];
      if (citation) citations.push(citation);
    });
  }
  return kept.length > 0 ? { say: kept.join(" "), evidence, citations } : null;
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
  const verifyStart = performance.now();
  const verified = verifiedAnswer(remote.text, hits, opts?.pack, opts?.material);
  const verifyMs = Math.round(performance.now() - verifyStart);
  if (!verified) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs } };
  const { say, evidence, citations } = verified;
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
  const verifyStart = performance.now();
  const verified = verifiedAnswer(remote.text, hits, opts?.pack, opts?.material);
  const verifyMs = Math.round(performance.now() - verifyStart);
  if (!verified) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs } };
  const { say, evidence, citations } = verified;
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

/**
 * General knowledge fallback: answers from the model's own knowledge when the
 * loaded material does not support a confident answer. No citations, no
 * evidence, no cite-or-silence contract — just a direct AI answer.
 */
export async function generateGeneralAnswer(
  query: string,
  t0: number,
  opts?: GenerateOpts,
): Promise<AnswerResult> {
  const llmStart = performance.now();
  const model = getModelById(opts?.modelId) ?? getDefaultModel();
  const system =
    "You are a helpful AI assistant. Answer the user's question directly, accurately, and concisely using your own knowledge. Do not cite sources or refer to uploaded documents.";
  const keys = readClientKeys();
  const remote = await completeChat(system, query, model, keys, 12000, opts?.maxTokens);
  const llmMs = Math.round(performance.now() - llmStart);
  if (!remote.raw) {
    return { ok: false, reason: "error", message: remote.reason ?? "empty", timing: { llmMs, verifyMs: 0 } };
  }
  return {
    ok: true,
    answer: {
      say: remote.raw,
      usedEvidence: false,
      citations: [],
      evidence: [],
      latencyMs: Math.round(performance.now() - t0),
      modelName: model.name,
      answerMode: "generated",
    },
    timing: { llmMs, verifyMs: 0 },
  };
}
