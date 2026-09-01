import type { Chunk, Hit, IndexedChunk, RepoFile, RepoPack } from "@/lib/repo/types";
import { USE_HYBRID_RETRIEVAL, USE_STRUCTURED_CHUNKER } from "../context/index-versions.ts";
import { createRegexParser } from "../repo/parsers/regex-parser.ts";
import { buildStructuredChunks } from "../repo/structured-chunks.ts";
import { combineScores, RETRIEVAL_WEIGHTS } from "./retrieval-weights.ts";
import { closeRetrieval, noteRetrieval, type RetrievalTrace } from "./retrieval-trace.ts";
import { semanticRetrieve } from "./semantic-retrieve.ts";
import type { VectorStore } from "./vector-store.ts";
import { getVectorStore } from "./vector-access.ts";

const STOP = new Set([
  "a",
  "an",
  "the",
  "that",
  "this",
  "does",
  "did",
  "do",
  "we",
  "you",
  "in",
  "of",
  "for",
  "to",
  "and",
  "or",
  "why",
  "what",
  "who",
  "how",
  "is",
  "it",
  "its",
  "our",
  "was",
  "were",
  "with",
  "from",
  "about",
  "please",
  // Function words that carry no retrieval signal but do collide with code.
  // "out" is the worst offender: it used to substring-match every "route".
  "where",
  "when",
  "which",
  "can",
  "could",
  "should",
  "would",
  "will",
  "are",
  "am",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "not",
  "but",
  "if",
  "then",
  "than",
  "also",
  "any",
  "all",
  "some",
  "more",
  "most",
  "much",
  "many",
  "very",
  "really",
  "actually",
  "just",
  "out",
  "up",
  "into",
  "over",
  "again",
  "still",
  "now",
  "here",
  "there",
  "these",
  "those",
  "they",
  "them",
  "their",
  "us",
  "me",
  "my",
  "your",
  "because",
  "while",
]);

const DIGIT_WORD: Record<string, string> = {
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
  "10": "ten",
};
const WORD_DIGIT: Record<string, string> = Object.fromEntries(
  Object.entries(DIGIT_WORD).map(([digit, word]) => [word, digit]),
);

export function tokenize(q: string): string[] {
  const raw = q
    .toLowerCase()
    .replace(/[^a-z0-9_./#-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

  const out: string[] = [];
  for (const term of raw) {
    out.push(term);
    // "three" and "3" should find each other; nothing else should alias.
    const alias = DIGIT_WORD[term] ?? WORD_DIGIT[term];
    if (alias) out.push(alias);
    // Whisper writes "re-try" and "auto-answer"; index the joined form too.
    if (term.includes("-")) {
      const joined = term.replace(/-/g, "");
      if (joined.length > 2) out.push(joined);
    }
  }
  return [...new Set(out)];
}

const JUNK_PATH =
  /(node_modules|site-packages|dist-packages|__pypackages__|\.venv|\/venv\/|\.deno|deno-deck-venv|lib\/python\d)/i;

/**
 * Machine-written files. They are real files and stay visible in the tree, but
 * they are not evidence: nobody asks a question whose answer is a generated
 * route table, and their repetitive contents used to dominate scoring.
 */
const GENERATED_PATH =
  /(^|\/)(dist|build|out|coverage|vendor|__generated__|generated|\.next|\.turbo|\.cache|__snapshots__)\/|\.(gen|generated)\.[a-z]+$|\.d\.ts$|\.min\.(js|css)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|composer\.lock)$|\.snap$/i;

/**
 * Deploy output and agent/editor tooling are not the user's material. Citing
 * `.vercel/output` or `.grok/skills` is never a defensible answer about a repo.
 */
const TOOLING_PATH = /(^|\/)\.[A-Za-z0-9_-]+\//;

export function isEvidencePath(path: string): boolean {
  return !JUNK_PATH.test(path) && !GENERATED_PATH.test(path) && !TOOLING_PATH.test(path);
}

const REGEX_PARSER = createRegexParser();

export type BuildChunksOptions = {
  /** Overrides USE_STRUCTURED_CHUNKER for tests and the eval harness. */
  structured?: boolean;
};

export function buildChunks(pack: RepoPack, options?: BuildChunksOptions): Chunk[] {
  const useStructured = options?.structured ?? USE_STRUCTURED_CHUNKER;
  const chunks: Chunk[] = [];
  for (const file of pack.files) {
    if (!isEvidencePath(file.path)) continue;
    if (useStructured) {
      try {
        const structured = buildStructuredChunks(file, REGEX_PARSER);
        if (structured && structured.length > 0) {
          chunks.push(...structured);
          continue;
        }
      } catch {
        // Parser failure must not prevent the file from being searchable.
      }
    }
    chunks.push(...buildWindowChunks(file));
  }
  for (const commit of pack.commits) {
    chunks.push({
      id: `commit:${commit.sha}`,
      kind: "why",
      path: commit.files[0] ?? "git",
      startLine: 1,
      endLine: 1,
      startOffset: 0,
      text: `${commit.message}\n${commit.files.join(", ")}\nPR #${commit.pr ?? "—"} ${commit.author}`,
      sha: commit.sha,
      author: commit.author,
      date: commit.date,
      pr: commit.pr,
      message: commit.message,
    });
  }
  return chunks;
}

/** Existing 28-line windows, 22-line step. Kept as the default and the fallback. */
function buildWindowChunks(file: RepoFile): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = file.content.replace(/\n$/, "").split("\n");
  // Offset of the first character of each line, so a chunk knows its position
  // in the file and a claim read out of one can be cited against the file.
  const lineStart: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    lineStart.push(cursor);
    cursor += line.length + 1;
  }
  const size = 28;
  const step = 22;
  for (let start = 0; start < lines.length; start += step) {
    const slice = lines.slice(start, start + size);
    const startLine = start + 1;
    const endLine = start + slice.length;
    chunks.push({
      id: `${file.path}:${startLine}-${endLine}`,
      kind: "code",
      path: file.path,
      startLine,
      endLine,
      startOffset: lineStart[start],
      text: slice.join("\n"),
    });
    if (endLine >= lines.length) break;
  }
  return chunks;
}

const VOCAB_CHUNKS = 3000;
const VOCAB_MAX = 24000;

function vocabWords(source: string): string[] {
  return (
    source
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[a-z][a-z0-9]{2,}/g) ?? []
  );
}

/**
 * The set of words the loaded material actually contains. The question gate uses
 * this instead of a fixed keyword list, so a question earns retrieval by
 * overlapping with the material rather than by sounding technical.
 */
export function packVocabulary(chunks: IndexedChunk[]): Set<string> {
  const vocab = new Set<string>();
  const scan = chunks.length > VOCAB_CHUNKS ? chunks.slice(0, VOCAB_CHUNKS) : chunks;
  for (const chunk of scan) {
    for (const word of vocabWords(chunk.path)) {
      if (vocab.size >= VOCAB_MAX) return vocab;
      vocab.add(word);
    }
    for (const word of vocabWords(chunk.text)) {
      if (vocab.size >= VOCAB_MAX) return vocab;
      vocab.add(word);
    }
    if ("message" in chunk && chunk.message) {
      for (const word of vocabWords(chunk.message)) {
        if (vocab.size >= VOCAB_MAX) return vocab;
        vocab.add(word);
      }
    }
  }
  return vocab;
}

/**
 * Split identifiers and punctuation into words, so "buildChunks" matches the
 * term "chunks" while "route" no longer matches the term "out".
 */
function toWords(source: string): string[] {
  return source
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Light suffix stripping so "retrieval" reaches "retrieve" and "captions"
 * reaches "caption". Deliberately shallow: aggressive stemming collides more
 * than it helps on identifier-heavy text.
 */
function stemOf(word: string): string {
  const cut = word.replace(/(ational|ization|ations|ition|ment|ness)$/, "").replace(/(ing|ed|es|s|al|ly)$/, "");
  const base = cut.length >= 3 ? cut : word;
  return base.endsWith("e") && base.length > 3 ? base.slice(0, -1) : base;
}

type Indexed = {
  path: string;
  base: string;
  stem: string;
  pathWords: Map<string, number>;
  bodyWords: Map<string, number>;
};

function tally(words: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const word of words) {
    map.set(word, (map.get(word) ?? 0) + 1);
    const stem = stemOf(word);
    if (stem !== word) map.set(`~${stem}`, (map.get(`~${stem}`) ?? 0) + 1);
  }
  return map;
}

const INDEX = new WeakMap<IndexedChunk, Indexed>();

function indexOf(chunk: IndexedChunk): Indexed {
  const cached = INDEX.get(chunk);
  if (cached) return cached;
  const path = chunk.path.toLowerCase();
  const base = path.split("/").pop() ?? path;
  const built: Indexed = {
    path,
    base,
    stem: base.replace(/\.[^.]+$/, ""),
    pathWords: tally(toWords(chunk.path)),
    bodyWords: tally(
      toWords(`${chunk.text} ${"message" in chunk ? (chunk.message ?? "") : ""} ${"pr" in chunk ? (chunk.pr ?? "") : ""}`),
    ),
  };
  INDEX.set(chunk, built);
  return built;
}

/** Bounded term frequency: repetition helps, but cannot run away. */
function sat(tf: number): number {
  return tf <= 0 ? 0 : (tf * 2.2) / (tf + 1.2);
}

function freq(words: Map<string, number>, term: string): number {
  const exact = words.get(term) ?? 0;
  const stem = words.get(`~${stemOf(term)}`) ?? 0;
  return exact + 0.5 * stem;
}

/**
 * Inverse document frequency over the loaded material, so a term that appears
 * in half the repo ("gate", "store", "client") cannot outrank the term that
 * actually identifies the subject.
 */
function idfMap(terms: string[], chunks: IndexedChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    const idx = indexOf(chunk);
    for (const term of terms) {
      if (freq(idx.bodyWords, term) > 0 || freq(idx.pathWords, term) > 0) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
  }
  const n = Math.max(1, chunks.length);
  const out = new Map<string, number>();
  for (const term of terms) {
    out.set(term, Math.log(1 + n / (1 + (df.get(term) ?? 0))));
  }
  return out;
}

export function namedPaths(query: string): string[] {
  return (query.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? []).map((p) => p.toLowerCase());
}

const MAX_PER_FILE = 3;
const MAX_PER_FILE_KIND = 2;

export function retrieve(query: string, chunks: IndexedChunk[], limit = 6): Hit[] {
  const terms = tokenize(query);
  const named = namedPaths(query);
  if (terms.length === 0 && named.length === 0) return [];

  const q = query.toLowerCase();
  const wantsApi = /\bapi\b|endpoint|fastapi|flask|express|router/.test(q);
  // A structural question is answered by the shape of the repo, so it retrieves
  // entry points and file heads. Kept deliberately narrow: the old blanket
  // "what is" bias boosted the head of every file and pinned citations to line 1.
  const wantsShape =
    /\barchitecture\b|\bstructure\b|\boverview\b|how is (?:this|the|it) (?:built|organized|structured)|what does (?:this|the) (?:app|application|service|project|repo|codebase) do/.test(
      q,
    );
  // "Why seven lambdas?" used to rank a "7)" step list inside one function.
  const wantsLambdaFleet =
    /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten) lambdas?\b|\bwhy (?:are |do )?(?:there |you doing |we (?:have |use )?)?\w* ?lambdas\b/.test(
      q,
    );
  const idf = idfMap(terms, chunks);

  const scored: Hit[] = [];
  for (const chunk of chunks) {
    const idx = indexOf(chunk);
    let score = 0;
    for (const term of terms) {
      const weight = idf.get(term) ?? 1;
      score += weight * 2.4 * sat(freq(idx.pathWords, term));
      score += weight * 1.6 * sat(freq(idx.bodyWords, term));
      if (term === idx.stem || term === idx.base) score += weight * RETRIEVAL_WEIGHTS.filenameMatch;
      if (chunk.kind === "why") score += weight * 1.1 * sat(freq(idx.bodyWords, term));
    }
    for (const name of named) {
      if (idx.path.endsWith(name) || idx.path.includes(`/${name}`) || idx.base === name) {
        score += RETRIEVAL_WEIGHTS.pathMatch;
      }
    }
    if (
      (wantsApi || wantsShape) &&
      /(?:^|\/)(api|main|app|index|server|router|client|store)(?:\/|\.[a-z]+$)/.test(idx.path)
    ) {
      score += RETRIEVAL_WEIGHTS.apiShapePath;
    }
    if (wantsLambdaFleet && /container-lambdas\//.test(idx.path)) {
      score += RETRIEVAL_WEIGHTS.apiShapePath;
    }
    if ((named.length > 0 || wantsShape || wantsLambdaFleet) && chunk.kind === "code" && chunk.startLine <= 8) {
      score += RETRIEVAL_WEIGHTS.fileHead;
    }
    if (score > 0) scored.push({ ...chunk, score });
  }
  if (scored.length === 0) return [];

  // Rank files by their best chunk, with a modest bonus for corroborating
  // chunks, then draw from files in order so one file cannot flood the top.
  const byFile = new Map<string, Hit[]>();
  for (const hit of scored) {
    const list = byFile.get(hit.path);
    if (list) list.push(hit);
    else byFile.set(hit.path, [hit]);
  }

  const files = [...byFile.entries()].map(([path, hits]) => {
    const sorted = hits.sort((a, b) => b.score - a.score);
    const best = sorted[0].score;
    const rest = sorted.slice(1).reduce((sum, h) => sum + h.score, 0);
    return { path, hits: sorted, score: best + Math.min(0.5 * best, 0.2 * rest) };
  });
  files.sort((a, b) => {
    if (wantsLambdaFleet) {
      const aWorker = /container-lambdas\//.test(a.path) ? 1 : 0;
      const bWorker = /container-lambdas\//.test(b.path) ? 1 : 0;
      if (aWorker !== bWorker) return bWorker - aWorker;
    }
    return b.score - a.score;
  });

  const top = files[0].score;
  const floor = Math.max(named.length > 0 || wantsApi ? 0.6 : 1.0, top * 0.12);

  const out: Hit[] = [];
  const takenPerFile = new Map<string, number>();
  const takenPerKind = new Map<string, number>();
  for (let round = 0; round < MAX_PER_FILE && out.length < limit; round += 1) {
    for (const file of files) {
      if (out.length >= limit) break;
      const used = takenPerFile.get(file.path) ?? 0;
      if (used > round) continue;
      const next = file.hits.find((h) => {
        const kindKey = `${h.path}|${h.kind}`;
        return (
          !out.includes(h) &&
          h.score >= floor &&
          (takenPerKind.get(kindKey) ?? 0) < MAX_PER_FILE_KIND
        );
      });
      if (!next) continue;
      out.push(next);
      takenPerFile.set(file.path, used + 1);
      const kindKey = `${next.path}|${next.kind}`;
      takenPerKind.set(kindKey, (takenPerKind.get(kindKey) ?? 0) + 1);
    }
  }
  // Diversity decides which chunks survive; score decides how they rank.
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Live retrieve entry. Flag off (default) is the existing synchronous IDF
 * path. Flag on uses hybridRetrieve when a VectorStore is installed.
 */
export async function retrieveHits(
  query: string,
  chunks: IndexedChunk[],
  limit = 6,
  vectorStore: VectorStore | null = getVectorStore(),
  hybrid = USE_HYBRID_RETRIEVAL,
): Promise<Hit[]> {
  if (hybrid && vectorStore) return hybridRetrieve(query, chunks, vectorStore, limit);
  return retrieve(query, chunks, limit);
}

export async function hybridRetrieve(
  query: string,
  chunks: IndexedChunk[],
  vectorStore: VectorStore,
  limit = 6,
): Promise<Hit[]> {
  const cached = await vectorStore.get(chunks.map((chunk) => chunk.id));
  if (cached.size === 0) {
    const lexical = retrieve(query, chunks, limit);
    finishTraces(query, lexical.map((hit) => ({ ...hit, lexicalScore: hit.score, semanticScore: 0 })));
    return lexical;
  }

  const lexicalHits = retrieve(query, chunks, limit * 2);
  let semanticHits: Hit[] = [];
  try {
    semanticHits = await semanticRetrieve(query, chunks, vectorStore, limit * 2);
  } catch {
    // A failed embed must not hide lexical evidence.
  }
  if (semanticHits.length === 0) {
    const lexical = retrieve(query, chunks, limit);
    finishTraces(query, lexical.map((hit) => ({ ...hit, lexicalScore: hit.score, semanticScore: 0 })));
    return lexical;
  }

  const byId = new Map<string, Hit>();
  for (const hit of lexicalHits) {
    byId.set(hit.id, { ...hit, lexicalScore: hit.score, semanticScore: 0 });
  }
  for (const hit of semanticHits) {
    const existing = byId.get(hit.id);
    if (existing) {
      existing.semanticScore = hit.score;
      existing.score = combineScores(existing.lexicalScore ?? 0, existing.semanticScore ?? 0);
    } else {
      byId.set(hit.id, {
        ...hit,
        lexicalScore: 0,
        semanticScore: hit.score,
        score: hit.score,
      });
    }
  }

  const combined = finishTraces(query, [...byId.values()]);
  combined.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return combined.slice(0, limit);
}

function finishTraces(query: string, hits: Hit[]): Hit[] {
  const traces: RetrievalTrace[] = [];
  const scored = hits.map((hit) => {
    const lexicalScore = hit.lexicalScore ?? (hit.semanticScore ? 0 : hit.score);
    const semanticScore = hit.semanticScore ?? 0;
    const signals = signalsFor(query, hit, lexicalScore, semanticScore);
    const next = { ...hit, lexicalScore, semanticScore, signals };
    const trace = {
      chunkId: hit.id,
      lexicalScore,
      semanticScore,
      combinedScore: next.score,
      signals,
    };
    traces.push(trace);
    noteRetrieval(trace);
    return next;
  });
  closeRetrieval(traces.sort((a, b) => b.combinedScore - a.combinedScore));
  return scored;
}

function signalsFor(query: string, hit: Hit, lexicalScore: number, semanticScore: number): string[] {
  const signals: string[] = [];
  if (lexicalScore > 0) signals.push("lexical");
  if (semanticScore > 0) signals.push("semantic");
  const q = query.toLowerCase();
  const named = namedPaths(query);
  const path = hit.path.toLowerCase();
  const base = path.split("/").pop() ?? path;
  if (named.some((name) => path.endsWith(name) || path.includes(`/${name}`) || base === name)) {
    signals.push("path-match");
  }
  if ("symbol" in hit && typeof hit.symbol === "string" && hit.symbol && q.includes(hit.symbol.toLowerCase())) {
    signals.push("symbol-match");
  }
  if ("heading" in hit && typeof hit.heading === "string" && hit.heading && q.includes(hit.heading.toLowerCase())) {
    signals.push("heading-match");
  }
  const phrase = q.replace(/[^a-z0-9 ]+/g, " ").trim();
  if (phrase.length >= 8 && hit.text.toLowerCase().includes(phrase)) signals.push("exact-phrase");
  return signals;
}

export function lineInFile(pack: RepoPack, path: string, needle: string): number {
  const file = pack.files.find((f) => f.path === path);
  if (!file) return 1;
  const lines = file.content.split("\n");
  const idx = lines.findIndex((l) => l.includes(needle));
  return idx >= 0 ? idx + 1 : 1;
}
