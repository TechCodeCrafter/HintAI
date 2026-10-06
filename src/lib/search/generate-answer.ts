import { llmDebug } from "../debug.ts";
import { getDefaultModel, getModelById } from "../ai/models.ts";
import type { SpaceMaterialView } from "../context/material-view.ts";
import { enrichFileCitation, fileInMaterial, sourceLabel } from "../context/material-view.ts";
import { documentEvidenceFromRange } from "../document/evidence.ts";
import { isFileHit, type Citation, type Hit, type RepoPack } from "../repo/types.ts";
import type { AnswerMode } from "./answer-mode.ts";
import { provenanceLabel } from "./cite.ts";
import { textEvidence, verifyClaim, type Evidence } from "./evidence.ts";
import type { LocalCardContext } from "./local-card.ts";

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
Interpret the user's intent, concepts, synonyms, and paraphrases within those chunks — exact wording is not required.
If insufficient, respond exactly: INSUFFICIENT
Cite claims with [1] or [2]. Max 2 sentences.`;

/** Keep retrieval order but stop a single file from filling the prompt. */
export function hitsForPrompt(
  hits: Hit[],
  cap = CHUNK_CAP,
  perFile = CHUNKS_PER_FILE,
  query?: string,
): Hit[] {
  const ordered = query ? reorderHitsForQuery(hits, query) : hits;
  const used = new Map<string, number>();
  const out: Hit[] = [];
  for (const hit of ordered) {
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
  const chunks = hitsForPrompt(hits, CHUNK_CAP, CHUNKS_PER_FILE, query).map((hit, i) => {
    return `[${i + 1}] ${chunkHeader(hit, material)}\n${(hit.text ?? "").slice(0, CHUNK_CHARS)}`;
  });
  const documents = chunks.length > 0 ? chunks.join("\n\n") : "(no matching documents)";
  return `${GROUNDED_INSTRUCTION}

DOCUMENTS:
${documents}

QUESTION: "${query}"`;
}

function formatChunks(hits: Hit[], material?: SpaceMaterialView, query?: string): string {
  const chunks = hitsForPrompt(hits, CHUNK_CAP, CHUNKS_PER_FILE, query).map((hit, i) => {
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
${formatChunks(hits, material, query)}

QUESTION: "${query}"`;
}

const MATCH_STOP_WORDS = new Set([
  "what", "when", "where", "which", "how", "why", "who", "whose",
  "does", "do", "did", "is", "are", "was", "were", "can", "could",
  "should", "would", "will", "has", "have", "had", "the", "a", "an",
  "this", "that", "these", "those", "with", "from", "about", "into",
]);

const CONCEPT_GROUPS: string[][] = [
  ["auth", "authentication", "authenticate", "login", "signin", "session", "token"],
  ["api", "endpoint", "route", "router"],
  ["database", "db", "storage", "persistence", "schema"],
  ["error", "failure", "fault", "exception", "retry"],
  ["deploy", "deployment", "release", "hosting", "production"],
  ["upload", "import", "ingest", "add"],
  ["search", "find", "retrieve", "query", "lookup"],
  ["config", "configuration", "settings", "env", "environment"],
  ["document", "pdf", "file", "source", "corpus"],
];

const DIGIT_WORD: Record<string, string> = {
  "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
  "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
};
const WORD_DIGIT: Record<string, string> = Object.fromEntries(
  Object.entries(DIGIT_WORD).map(([digit, word]) => [word, digit]),
);

/** Shallow suffix normalization; enough for concept overlap without pretending to be a full stemmer. */
function stemForMatch(word: string): string {
  const cut = word
    .replace(/ies$/, "y")
    .replace(/(ational|ization|ations|ition|ment|ness)$/, "")
    .replace(/(ing|ed|es|s|al|ly)$/, "");
  return cut.length >= 3 ? cut : word;
}

function matchWords(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter((word) => (word.length > 2 || /^\d+$/.test(word)) && !MATCH_STOP_WORDS.has(word));
  const out = [...raw];
  for (const word of raw) {
    const alias = DIGIT_WORD[word] ?? WORD_DIGIT[word];
    if (alias) out.push(alias);
  }
  return out;
}

function trigramSet(word: string): Set<string> {
  const padded = `  ${word} `;
  const grams = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

function wordsAreSimilar(a: string, b: string): boolean {
  if (a === b || stemForMatch(a) === stemForMatch(b)) return true;
  if ((a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b))) return true;
  const left = trigramSet(a);
  const right = trigramSet(b);
  let overlap = 0;
  for (const gram of left) if (right.has(gram)) overlap += 1;
  return overlap / Math.max(left.size, right.size, 1) >= 0.62;
}

function wordsShareConcept(a: string, b: string): boolean {
  const aStem = stemForMatch(a);
  const bStem = stemForMatch(b);
  return CONCEPT_GROUPS.some((group) => {
    const stems = group.map(stemForMatch);
    return (stems.includes(aStem) || stems.includes(a)) &&
      (stems.includes(bStem) || stems.includes(b));
  });
}

/** Soft lexical affinity: stems, similar spellings, and nearby technical concepts. */
function termMatchesText(term: string, words: string[]): boolean {
  const termStem = stemForMatch(term);
  return words.some((word) => {
    const wordStem = stemForMatch(word);
    return word === term || wordStem === termStem || wordsAreSimilar(wordStem, termStem) || wordsShareConcept(word, term);
  });
}

function semanticHitScore(hit: Hit, query: string): number {
  const terms = [...new Set(matchWords(query))];
  if (terms.length === 0) return 0;
  const haystackWords = matchWords(`${hit.path}\n${hit.text ?? ""}`);
  return terms.reduce((score, term) => score + (termMatchesText(term, haystackWords) ? 1 : 0), 0);
}

function reorderHitsForQuery(hits: Hit[], query: string): Hit[] {
  return hits
    .map((hit) => ({ hit, semantic: semanticHitScore(hit, query) }))
    .sort((a, b) => b.semantic - a.semantic || (b.hit.score ?? 0) - (a.hit.score ?? 0))
    .map(({ hit }) => hit);
}

function scoreSentenceAgainstQuery(sentence: string, query: string): number {
  const terms = [...new Set(matchWords(query))];
  if (terms.length === 0) return 0;
  const words = matchWords(sentence);
  const stemSet = new Set(words.map(stemForMatch));
  let matched = 0;
  for (const term of terms) {
    if (words.includes(term) || stemSet.has(stemForMatch(term)) || termMatchesText(term, words)) {
      matched += 1;
    }
  }
  const fullPhrase = query.toLowerCase().replace(/\s+/g, " ").trim();
  const exactPhraseBonus = fullPhrase.length > 4 && sentence.toLowerCase().includes(fullPhrase) ? 2 : 0;
  return matched / terms.length + matched * 0.2 + exactPhraseBonus;
}

/** Pick the sentence in a chunk that overlaps the question most. */
export function extractBestSentence(text: string, query: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 12);
  if (sentences.length === 0) return text.replace(/\s+/g, " ").trim().slice(0, 240);
  let best = sentences[0]!;
  let bestScore = -1;
  for (const sentence of sentences) {
    const score = scoreSentenceAgainstQuery(sentence, query);
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

function evidenceFromHit(
  hit: Hit,
  pack?: RepoPack,
  material?: SpaceMaterialView,
  context?: LocalCardContext,
): Evidence | null {
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
  if (hit.kind === "document") {
    const document = context?.document?.(hit.sourceId);
    if (document && document.contentHash === hit.contentHash) {
      const evidence = documentEvidenceFromRange({
        document,
        page: hit.page,
        normStart: hit.startOffset,
        normEnd: hit.endOffset,
        spokenText: hit.text,
      });
      if (evidence) return evidence;
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
  context?: LocalCardContext,
): { evidence: Evidence[]; citations: Citation[] } {
  const evidence: Evidence[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const index of citationIndexes(text)) {
    const hit = hits[index - 1];
    if (!hit) continue;
    const span = evidenceFromHit(hit, pack, material, context);
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
  /** Document lookup used to turn PDF hits into page-level evidence. */
  cardContext?: LocalCardContext;
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
  const selectedHits = hitsForPrompt(hits, CHUNK_CAP, CHUNKS_PER_FILE, query);
  const remote = await completePrompt(query, buildSynthesisPrompt(query, selectedHits, opts?.material), "extract", opts);
  const llmMs = Math.round(performance.now() - llmStart);
  if (!remote.ok) return { ...remote, timing: { llmMs, verifyMs: 0 } };
  if (isInsufficient(remote.text)) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs: 0 } };
  const say = stripCitationMarkers(remote.text);
  if (!say) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs: 0 } };
  const { evidence, citations } = evidenceForMarkers(remote.text, selectedHits, opts?.pack, opts?.material, opts?.cardContext);
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
  const selectedHits = hitsForPrompt(hits, CHUNK_CAP, CHUNKS_PER_FILE, query);
  const remote = await completePrompt(
    query,
    buildWeakEvidencePrompt(query, selectedHits, opts?.threadHistory, opts?.material),
    "synthesize",
    opts,
  );
  const llmMs = Math.round(performance.now() - llmStart);
  if (!remote.ok) return { ...remote, timing: { llmMs, verifyMs: 0 } };
  if (isInsufficient(remote.text)) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs: 0 } };
  const say = stripCitationMarkers(remote.text);
  if (!say) return { ok: false, reason: "insufficient", timing: { llmMs, verifyMs: 0 } };
  const { evidence, citations } = evidenceForMarkers(remote.text, selectedHits, opts?.pack, opts?.material, opts?.cardContext);
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
