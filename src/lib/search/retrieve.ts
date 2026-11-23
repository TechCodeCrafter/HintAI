import type { Chunk, Hit, IndexedChunk, RepoFile, RepoPack, ScoreBoosts } from "@/lib/repo/types";
import { pathExcluded } from "../context/exclusions.ts";
import { fileChunkId, type BuildChunksOptions } from "../context/source-identity.ts";
import { USE_HYBRID_RETRIEVAL, USE_STRUCTURED_CHUNKER } from "../context/index-versions.ts";
import { llmDebug } from "../debug.ts";
import { buildFormatChunks } from "../repo/format-chunks.ts";
import { createRegexParser } from "../repo/parsers/regex-parser.ts";
import { buildStructuredChunks } from "../repo/structured-chunks.ts";
import { combineScores, RETRIEVAL_WEIGHTS } from "./retrieval-weights.ts";
import {
  closeRetrieval,
  evidenceTypeOf,
  formatRetrievalSummary,
  noteRetrieval,
  primaryChannel,
  type RetrievalTrace,
} from "./retrieval-trace.ts";
import { semanticRetrieve } from "./semantic-retrieve.ts";
import type { VectorStore } from "./vector-store.ts";
import { getVectorStore } from "./vector-access.ts";
import { asksAboutWholeApp, isProjectOverviewQuery } from "./question.ts";
import {
  declaredSymbols,
  symbolKey,
  type DeclaredSymbol,
  type MayDeclare,
  type NamedSymbol,
} from "./query-symbols.ts";
import { declaredWords } from "./declared-names.ts";
import {
  anyOf,
  bagOf,
  countOf,
  freq,
  holds,
  knownWordId,
  NO_WORDS,
  termOf,
  trimVocabulary,
  vocabularyGeneration,
  wordIdsWhere,
  type Bag,
} from "./word-index.ts";

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

/**
 * Test and fixture files. They stay searchable — a question about the tests
 * should find them — but they are demoted at rank time so a test docstring
 * describing what the suite *covers* cannot outrank the component it tests.
 */
const TEST_PATH =
  /(^|\/)(__tests__|tests?|testdata|fixtures?|mocks?|stories|e2e|examples?|snapshots?)(\/|$)|\.(spec|test|e2e)\.[a-z]+$/i;

export function isTestEvidencePath(path: string): boolean {
  return TEST_PATH.test(path);
}

/** Contracts, architecture, and security docs outrank tests/examples by default. */
const AUTHORITATIVE_PATH =
  /(^|\/)(docs|contracts?|architecture|security)(\/|$)|(^|\/)README\.md$|(^|\/)AGENTS\.md$|(^|\/)CLAUDE\.md$/i;

export function isAuthoritativePath(path: string): boolean {
  return AUTHORITATIVE_PATH.test(path) && !isTestEvidencePath(path);
}

/** True when the question is explicitly about tests, fixtures, or examples. */
export function queryAsksAboutTests(query: string): boolean {
  return /\b(tests?|testing|specs?|fixtures?|mocks?|snapshots?|examples?|e2e|unit tests?)\b/i.test(query);
}

/**
 * Files that perform behavior rather than describe an endpoint. Behavior
 * questions ("what does X do", "how does X work", "what happens after X") are
 * answered here; route handlers only describe the HTTP surface that triggers
 * the behavior, so they are a weaker source for those shapes.
 */
const BEHAVIOR_PATH =
  /(^|\/)(services?|workers?|container-lambdas|lambdas|handlers|usecases?|domain|core|pipeline|processing|ingest|extraction|indexing)(\/|$)/i;

export function isBehaviorPath(path: string): boolean {
  return BEHAVIOR_PATH.test(path);
}

/** A route/controller file — the API surface, not the behavior behind it. */
const ROUTE_PATH = /(^|\/)(routes?|controllers?|endpoints?|api)(\/|$)|(?:^|\/)(router|routes)\.[a-z]+$/i;

export function isRoutePath(path: string): boolean {
  return ROUTE_PATH.test(path) && !isBehaviorPath(path);
}

const REGEX_PARSER = createRegexParser();

export type { BuildChunksOptions } from "../context/source-identity.ts";

export function buildChunks(pack: RepoPack, options?: BuildChunksOptions): Chunk[] {
  const useStructured = options?.structured ?? USE_STRUCTURED_CHUNKER;
  const chunks: Chunk[] = [];
  for (const file of pack.files) {
    if (!isEvidencePath(options?.pathForRules ? options.pathForRules(file.path) : file.path)) continue;
    if (pathExcluded(file.path, pack.excludePatterns)) continue;
    // Documents, decks, spreadsheets and XML are cut on their own structure:
    // a section, a slide, a group of rows, whole elements.
    try {
      const formatted = buildFormatChunks(file, options);
      if (formatted && formatted.length > 0) {
        chunks.push(...formatted);
        continue;
      }
    } catch {
      // A file this cannot read is still searchable as line windows.
    }
    if (useStructured) {
      try {
        const structured = buildStructuredChunks(file, REGEX_PARSER, options);
        if (structured && structured.length > 0) {
          chunks.push(...structured);
          continue;
        }
      } catch {
        // Parser failure must not prevent the file from being searchable.
      }
    }
    chunks.push(...buildWindowChunks(file, options));
  }
  for (const commit of pack.commits) {
    const commitPath = commit.files[0] ?? "git";
    if (pathExcluded(commitPath, pack.excludePatterns)) continue;
    chunks.push({
      id: options?.chunkScope
        ? fileChunkId(options.chunkScope, commit.files[0] ?? "git", `commit:${commit.sha}`)
        : `commit:${commit.sha}`,
      kind: "why",
      sourceId: options?.sourceId ?? options?.chunkScope?.sourceId,
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
function buildWindowChunks(file: RepoFile, options?: BuildChunksOptions): Chunk[] {
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
    const rangeKey = `${startLine}-${endLine}`;
    chunks.push({
      id: options?.chunkScope
        ? fileChunkId(options.chunkScope, file.path, rangeKey)
        : `${file.path}:${rangeKey}`,
      kind: "code",
      sourceId: options?.sourceId ?? options?.chunkScope?.sourceId,
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
  const lowered = source.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  const split = lowered.split(/[^a-z0-9]+/).filter(Boolean);
  const out = [...split];
  // Keep snake_case identifiers whole so query tokens like smoke_gate_91626 match code.
  for (const match of lowered.match(/[a-z0-9]+(?:_[a-z0-9]+)+/g) ?? []) {
    if (match.length > 2) out.push(match);
  }
  // `tokenize` keeps a typed "dead-letter" or "runExporter" as one term
  // ("dead-letter", "runexporter"). Without the whole form here that term
  // matched nothing: the text only held "dead", "letter", "run", "exporter".
  for (const match of lowered.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) ?? []) {
    out.push(match);
  }
  for (const match of source.match(/[A-Za-z0-9]*[a-z0-9][A-Z][A-Za-z0-9]*/g) ?? []) {
    out.push(match.toLowerCase());
  }
  return out;
}

export { stemOf } from "./word-index.ts";

/**
 * What is true of a file whatever part of it a chunk holds. Chunks of one
 * file share one of these.
 */
type FileInfo = {
  /** Lower-case path. */
  path: string;
  base: string;
  stem: string;
  words: Bag;
  entryPoint: boolean;
  lambda: boolean;
  readme: boolean;
  behavior: boolean;
  office: boolean;
  test: boolean;
  authoritative: boolean;
};

type Indexed = {
  file: FileInfo;
  body: Bag;
  /**
   * Words of the heading a chunk sits under: a section title, a slide title,
   * the column names of a spreadsheet, an XML element path, a PDF section.
   * Empty for a chunk with no heading.
   */
  heading: Bag;
  /**
   * Words of the names this chunk declares: `function retryBackoff` gives
   * "retry" and "backoff". Source code only; empty for prose and documents.
   */
  declared: Bag;
  /**
   * Lower-casing the chunk's text leaves its words where they are. False for
   * the rare text with a character that lower-cases to a letter (the Kelvin
   * sign becomes "k"), which would join it to the word beside it. The word
   * filters below rule nothing out for such a chunk.
   */
  wordsHold: boolean;
  /** The vocabulary these word ids belong to. See `vocabularyGeneration`. */
  generation: number;
};

/** Source code, as opposed to prose that may show a declaration in a fence. */
const PROSE_FILE = /\.(md|mdx|markdown|txt|rst|adoc|docx|pptx|ppt|xlsx|csv|pdf)$/i;

function declaredIn(chunk: IndexedChunk): Bag {
  if (chunk.kind !== "code" || PROSE_FILE.test(chunk.path)) return NO_WORDS;
  const named = "symbol" in chunk && typeof chunk.symbol === "string" ? [chunk.symbol] : [];
  return bagOf(declaredWords(chunk.text ?? "", named));
}

/**
 * What ranking may know beyond the chunks themselves. Every field is optional
 * and absent means "no such signal": the ranking is then what it always was.
 */
export type RankSignals = {
  /**
   * Chunk path to how recently a commit changed that file: 1 for the newest
   * commit, towards 0 for older ones. Only files a recent commit touched.
   */
  recency?: ReadonlyMap<string, number>;
};

/** The heading of a chunk from a structured document, or "" when it has none. */
export function headingOf(chunk: IndexedChunk): string {
  return "heading" in chunk && typeof chunk.heading === "string" ? chunk.heading : "";
}

const INDEX = new WeakMap<IndexedChunk, Indexed>();

/** Chunks arrive file by file, so the last file's facts are usually the next chunk's too. */
let lastFile: { path: string; generation: number; info: FileInfo } | null = null;

function fileInfoOf(chunkPath: string): FileInfo {
  const generation = vocabularyGeneration();
  if (lastFile && lastFile.path === chunkPath && lastFile.generation === generation) return lastFile.info;
  const path = chunkPath.toLowerCase();
  const base = path.split("/").pop() ?? path;
  const info: FileInfo = {
    path,
    base,
    stem: base.replace(/\.[^.]+$/, ""),
    words: bagOf(toWords(chunkPath)),
    entryPoint: ENTRY_POINT_PATH.test(path),
    lambda: /container-lambdas\//.test(path),
    readme: /^readme\.(md|mdx|rst|txt)$/i.test(path),
    behavior: isBehaviorPath(path),
    // Office uploads only — do not boost README/ADR markdown inside code repos.
    office: /\.(docx|pptx|ppt|xlsx|csv)$/i.test(path),
    test: isTestEvidencePath(path),
    authoritative: isAuthoritativePath(path),
  };
  lastFile = { path: chunkPath, generation, info };
  return info;
}

const NON_ASCII = /[\u0080-\uffff]/g;
const ASCII_WORD_CHARACTER = /[a-z0-9]/;

/** True unless some non-ASCII character in `text` lower-cases to an ASCII letter or digit. */
function wordsHoldWhenLowered(text: string): boolean {
  NON_ASCII.lastIndex = 0;
  for (let match = NON_ASCII.exec(text); match; match = NON_ASCII.exec(text)) {
    if (ASCII_WORD_CHARACTER.test(match[0].toLowerCase())) {
      NON_ASCII.lastIndex = 0;
      return false;
    }
  }
  return true;
}

function indexOf(chunk: IndexedChunk): Indexed {
  const cached = INDEX.get(chunk);
  if (cached && cached.generation === vocabularyGeneration()) return cached;
  const heading = headingOf(chunk);
  const built: Indexed = {
    file: fileInfoOf(chunk.path),
    body: bagOf(
      toWords(`${chunk.text} ${"message" in chunk ? (chunk.message ?? "") : ""} ${"pr" in chunk ? (chunk.pr ?? "") : ""}`),
    ),
    heading: heading ? bagOf(toWords(heading)) : NO_WORDS,
    declared: declaredIn(chunk),
    wordsHold: wordsHoldWhenLowered(chunk.text ?? ""),
    generation: vocabularyGeneration(),
  };
  INDEX.set(chunk, built);
  return built;
}

/** One warm-up at a time: starting another ends the one before it. */
let warmRun = 0;

/**
 * Builds the word index for `chunks` ahead of the first question.
 *
 * A chunk's words are indexed the first time a search looks at it, so without
 * this the first question on new material pays for all of it at once: seconds
 * on a large folder, with the page frozen. This does the same work in short
 * slices with a pause between them, so the page keeps responding and a
 * question asked part-way through is answered (it indexes whatever is left).
 *
 * Returns how many chunks it indexed. Starting it again, or `isCancelled`
 * turning true, ends an earlier run.
 */
export async function warmSearchIndex(
  chunks: IndexedChunk[],
  options: { sliceMs?: number; isCancelled?: () => boolean; pause?: () => Promise<void> } = {},
): Promise<number> {
  const run = ++warmRun;
  const sliceMs = options.sliceMs ?? 12;
  const pause = options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let done = 0;
  let sliceStart = now();
  for (const chunk of chunks) {
    indexOf(chunk);
    done += 1;
    if (now() - sliceStart < sliceMs) continue;
    await pause();
    if (run !== warmRun || options.isCancelled?.()) return done;
    sliceStart = now();
  }
  return done;
}

/** Bounded term frequency: repetition helps, but cannot run away. */
function sat(tf: number): number {
  return tf <= 0 ? 0 : (tf * 2.2) / (tf + 1.2);
}

/** What a chunk's own text scored: the addends that count words in it. */
function textScore(boosts: ScoreBoosts | undefined): number {
  return (boosts?.body ?? 0) + (boosts?.commit ?? 0);
}

/** True when the heading a chunk sits under has this query term, by the same match the text gets. */
export function headingHolds(chunk: IndexedChunk, term: string): boolean {
  return freq(indexOf(chunk).heading, termOf(term)) > 0;
}

/**
 * Inverse document frequency over the loaded material, so a term that appears
 * in half the repo ("gate", "store", "client") cannot outrank the term that
 * actually identifies the subject.
 *
 * Also returns the terms the material mentions anywhere. A word no file
 * contains ("touched", "work") cannot tell one file from another, so it is
 * left out when judging how well a chunk backs the question.
 */
function termStats(terms: string[], chunks: IndexedChunk[]): { idf: Map<string, number>; known: Set<string> } {
  // Index first. A question word can only be resolved against words that
  // have been seen, and indexing a chunk is what makes its words seen.
  const indexed = chunks.map(indexOf);
  const asked = terms.map(termOf);
  const df = new Map<string, number>();
  for (const idx of indexed) {
    for (const term of asked) {
      if (freq(idx.body, term) > 0 || freq(idx.file.words, term) > 0 || freq(idx.heading, term) > 0) {
        df.set(term.text, (df.get(term.text) ?? 0) + 1);
      }
    }
  }
  return { idf: idfOf(terms, (term) => df.get(term) ?? 0, chunks.length), known: new Set(df.keys()) };
}

function idfOf(terms: string[], dfOf: (term: string) => number, chunkCount: number): Map<string, number> {
  const n = Math.max(1, chunkCount);
  const idf = new Map<string, number>();
  for (const term of terms) idf.set(term, Math.log(1 + n / (1 + dfOf(term))));
  return idf;
}

/** The query terms the material mentions in some path or body. */
export function knownTerms(terms: string[], chunks: IndexedChunk[]): Set<string> {
  return termStats(terms, chunks).known;
}

/**
 * How much a path or file-name match is worth for this chunk, from
 * `nameOnlyCredit` up to 1.
 *
 * A file name is a hint, not evidence. It counts in full when the path names
 * everything the question asked about ("what does the auth middleware do"), or
 * when the chunk's own text backs the rest of the question, and in proportion
 * when the text backs part of the rest. A file called `app.ts` or `server.ts`
 * that only shares a word with the question, and says nothing about the rest
 * of it, keeps `nameOnlyCredit`. Without this, shallow entry points outranked
 * the nested file that held the answer.
 *
 * `weightOf` should return 0 for a term the material never mentions: no chunk
 * can back it, so it says nothing about this one.
 */
export function nameCredit(
  terms: string[],
  chunk: IndexedChunk,
  weightOf: (term: string) => number = () => 1,
): number {
  const idx = indexOf(chunk);
  let rest = 0;
  let backed = 0;
  for (const text of terms) {
    const term = termOf(text);
    if (freq(idx.file.words, term) > 0) continue;
    const weight = weightOf(text);
    rest += weight;
    if (freq(idx.body, term) > 0 || freq(idx.heading, term) > 0) backed += weight;
  }
  if (rest === 0) return 1;
  return Math.max(RETRIEVAL_WEIGHTS.nameOnlyCredit, backed / rest);
}

/** Entry points: where an app is wired together, by file or directory name. */
const ENTRY_POINT_PATH = /(?:^|\/)(api|main|app|index|server|router|client|store)(?:\/|\.[a-z]+$)/;

export function namedPaths(query: string): string[] {
  return (query.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? []).map((p) => p.toLowerCase());
}

/** True when `name`, a file-like word from the question, is this chunk's file. */
function isNamedPath(file: FileInfo, name: string): boolean {
  return file.path.endsWith(name) || file.path.includes(`/${name}`) || file.base === name;
}

export type NamedCode = {
  /** Identifiers in the question that some code chunk declares. */
  symbols: DeclaredSymbol[];
  /** File-like words in the question that some chunk's path matches. */
  paths: string[];
};

/**
 * The code a question names, confirmed against the material. When this is not
 * empty the question is about a specific place, and path and symbol scores
 * decide the ranking: the README, docs and entry-point bonuses are not applied.
 */
export function namedCode(query: string, chunks: IndexedChunk[]): NamedCode {
  const named = namedPaths(query);
  const paths = named.filter((name) => chunks.some((chunk) => isNamedPath(indexOf(chunk).file, name)));
  return { symbols: declaredIdentifiers(query, chunks), paths };
}

/**
 * The identifiers a question names that the code declares. The same answer as
 * `declaredSymbols`, without running the declaration pattern over the text of
 * every chunk: the word index rules out the chunks that cannot hold the name.
 */
export function declaredIdentifiers(query: string, chunks: IndexedChunk[]): DeclaredSymbol[] {
  return declaredSymbols(query, chunks, mayDeclareIn(chunks));
}

/**
 * Rules out chunks that cannot declare an identifier, from their words alone.
 *
 * Why it never rules out a real declaration. The declaration pattern matches
 * the name ("verify_?claim", any case) with white space, a line start or a
 * dot before it and no letter, digit, "_" or "$" after it. So in the text the
 * name is a whole token, and it is written in one of two ways:
 *
 *   - with no "_" in it. Then it is one run of letters and digits, and
 *     `toWords` indexes every such run whole, so the chunk has the word
 *     "verifyclaim".
 *   - with a "_" at one of the joins between its parts. `toWords` indexes
 *     each chain of runs joined by "_" as one word, cut only at a camelCase
 *     hump. So the chunk has a word with "x_y" in it, where x ends the parts
 *     before that join and y starts the parts after it: "verify_claim", or
 *     "gate_91626" from `smokeGate_91626`.
 *
 * A chunk with neither word is skipped. A chunk with a character that
 * lower-cases to a letter is always passed on to the pattern: in the index
 * that character is joined to the word beside it, and in the text the pattern
 * reads it is not.
 */
function mayDeclareIn(chunks: IndexedChunk[]): MayDeclare {
  let indexed = false;
  return (symbol: NamedSymbol) => {
    const parts = symbol.parts;
    if (parts.length === 0) return () => true;
    // Word ids are looked up after every chunk is indexed, or a word first
    // seen in a later chunk would look unknown.
    if (!indexed) {
      for (const chunk of chunks) indexOf(chunk);
      indexed = true;
    }
    const whole = knownWordId(parts.join(""));
    // For each join: the parts before it and the parts after it, each as one string.
    const before: string[] = [];
    const after: string[] = [];
    for (let cut = 1; cut < parts.length; cut += 1) {
      before.push(parts.slice(0, cut).join(""));
      after.push(parts.slice(cut).join(""));
    }
    const withUnderscore =
      before.length === 0
        ? []
        : wordIdsWhere((word) => {
            if (!word.includes("_")) return false;
            const runs = word.split("_");
            for (let i = 0; i + 1 < runs.length; i += 1) {
              const left = runs[i];
              const right = runs[i + 1];
              if (!left || !right) continue;
              for (let cut = 0; cut < before.length; cut += 1) {
                if (before[cut].endsWith(left) && after[cut].startsWith(right)) return true;
              }
            }
            return false;
          });
    const hasUnderscored = anyOf(withUnderscore);
    return (chunk) => {
      const idx = indexOf(chunk);
      if (!idx.wordsHold) return true;
      return (whole >= 0 && countOf(idx.body, whole) > 0) || hasUnderscored(idx.body);
    };
  };
}

/**
 * A cheap test that rules out chunks which cannot contain `phrase`, so the
 * text of every chunk does not have to be lower-cased and searched for every
 * question. It never rules out a chunk that does contain it.
 *
 * Why that holds: every unbroken run of ASCII letters and digits in the
 * lower-cased text is one of the chunk's indexed words. So if the lower-cased text contains the
 * phrase, then for each run of letters and digits in the phrase:
 *   - a run with other characters on both sides in the phrase is a word of the chunk;
 *   - a run that starts the phrase is the end of a word of the chunk;
 *   - a run that ends the phrase is the start of a word of the chunk;
 *   - a phrase that is one run is inside a word of the chunk.
 * The one exception is text with a character that lower-cases to a letter
 * (see `wordsHold`). Such a chunk is always passed on to the real check.
 */
function phraseFilter(phrase: string): (idx: Indexed) => boolean {
  const tests: Array<(bag: Bag) => boolean> = [];
  let impossible = false;
  for (const match of phrase.matchAll(/[a-z0-9]+/g)) {
    const run = match[0];
    const opensPhrase = match.index === 0;
    const closesPhrase = match.index + run.length === phrase.length;
    if (!opensPhrase && !closesPhrase) {
      const id = knownWordId(run);
      if (id < 0) impossible = true;
      else tests.push(anyOf([id]));
    }
  }
  if (tests.length === 0 && !impossible) {
    // No run sits inside the phrase. Use the runs at its edges.
    const runs = [...phrase.matchAll(/[a-z0-9]+/g)];
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (first && first.index === 0 && first[0].length === phrase.length) {
      tests.push(anyOf(wordIdsWhere((word) => word.includes(first[0]))));
    } else {
      if (first && first.index === 0) tests.push(anyOf(wordIdsWhere((word) => word.endsWith(first[0]))));
      if (last && last.index + last[0].length === phrase.length) {
        tests.push(anyOf(wordIdsWhere((word) => word.startsWith(last[0]))));
      }
    }
  }
  return (idx) => {
    if (!idx.wordsHold) return true;
    if (impossible) return false;
    for (const test of tests) if (!test(idx.body)) return false;
    return true;
  };
}

// Same cap as the fused hybrid ranking (`capPerFile` in hybrid.ts), so a
// question gets the same spread of files with or without embeddings.
const MAX_PER_FILE = RETRIEVAL_WEIGHTS.maxChunksPerFile;
const MAX_PER_FILE_KIND = 2;

export function retrieve(query: string, chunks: IndexedChunk[], limit = 6, signals?: RankSignals): Hit[] {
  trimVocabulary();
  const terms = tokenize(query);
  const named = namedPaths(query);
  if (terms.length === 0 && named.length === 0) return [];

  const q = query.toLowerCase();
  const wantsApi = /\bapi\b|endpoint|fastapi|flask|express|router/.test(q);
  // The README and entry-point boosts below are for one kind of question: the
  // app as a whole. "What is the structure of the settlement file?" contains
  // "structure" and is not that question, so the wording alone no longer
  // qualifies. The question must also have no subject of its own.
  const wholeApp = asksAboutWholeApp(query);
  // A structural question is answered by the shape of the repo, so it retrieves
  // entry points and file heads. Kept deliberately narrow: the old blanket
  // "what is" bias boosted the head of every file and pinned citations to line 1.
  const wantsShape =
    wholeApp &&
    /\barchitecture\b|\bstructure\b|\boverview\b|how is (?:this|the|it) (?:built|organized|structured)|what does (?:this|the|our) (?:app|application|service|project|repo|codebase|product|platform|tool|system) do/.test(
      q,
    );
  const wantsOverview = isProjectOverviewQuery(query);
  // "Why seven lambdas?" used to rank a "7)" step list inside one function.
  const wantsLambdaFleet =
    /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten) lambdas?\b|\bwhy (?:are |do )?(?:there |you doing |we (?:have |use )?)?\w* ?lambdas\b/.test(
      q,
    );
  // Behavior questions are answered by the component that does the work, not
  // the route that triggers it. Used to boost services/workers/lambdas and to
  // avoid letting a router docstring stand in for the pipeline behind it.
  // Includes the spoken form "what this product does" (no adjacent "what
  // does") — without this, single-MD demos rank the "product plan" header
  // over the "X is a ..." definition line.
  const wantsBehavior =
    (/\bwhat does\b|\bwhat's\b|\bhow does\b|\bhow do\b|\bhow is\b|\bwhat happens\b|\bwhat is .* (?:for|doing)\b|\bhow are\b/.test(
      q,
    ) ||
      /\bwhat\b(?: this| that| the| our)?(?: product| app| application| platform| tool| system)?\s+does\b/.test(
        q,
      )) &&
    !wantsApi;
  const wantsDefinition = /\b(?:what is|what's|define|explain|describe)\b/i.test(q);
  // One pass over the material resolves every question word against every
  // chunk. The scoring pass below reads these numbers instead of looking the
  // words up again.
  // Index first: a question word can only be resolved against words that have
  // been seen, and indexing a chunk is what makes its words seen.
  const indexed = chunks.map(indexOf);
  const asked = terms.map(termOf);
  const width = asked.length;
  const inBodyOf = new Float64Array(chunks.length * width);
  const inPathOf = new Float64Array(chunks.length * width);
  const inHeadingOf = new Float64Array(chunks.length * width);
  const df = new Int32Array(width);
  for (let c = 0; c < chunks.length; c += 1) {
    const idx = indexed[c];
    const row = c * width;
    for (let t = 0; t < width; t += 1) {
      const body = freq(idx.body, asked[t]);
      const path = freq(idx.file.words, asked[t]);
      const heading = freq(idx.heading, asked[t]);
      inBodyOf[row + t] = body;
      inPathOf[row + t] = path;
      inHeadingOf[row + t] = heading;
      if (body > 0 || path > 0 || heading > 0) df[t] += 1;
    }
  }
  const idf = idfOf(terms, (term) => df[terms.indexOf(term)], chunks.length);
  const known = new Set(terms.filter((_, t) => df[t] > 0));
  const weightOf = (term: string) => idf.get(term) ?? 1;
  // A question that names an identifier the code declares, or a file that is
  // loaded, is about that place. Bonuses for what kind of file a chunk is in
  // (README, docs, entry point) are for questions that name no place.
  const code = namedCode(query, chunks);
  const namesCode = code.symbols.length > 0 || code.paths.length > 0;
  // The query term each symbol was typed as, for its weight.
  const symbolTerm = new Map(
    code.symbols.map((symbol) => [symbol.key, terms.find((term) => symbolKey(term) === symbol.key)] as const),
  );
  // Backing is judged on the terms the material can speak to.
  const backable = (term: string) => (known.has(term) ? weightOf(term) : 0);
  const weights = terms.map(weightOf);
  const backs = terms.map(backable);
  const phrase = terms.join(" ");
  const mayHoldPhrase = phrase.length > 4 ? phraseFilter(phrase) : null;
  const asksAboutTests = queryAsksAboutTests(query);

  const scored: Hit[] = [];
  const lastResort: Hit[] = [];
  // The best any chunk's text scored for this question. See `symbolLift`.
  let bestText = 0;
  for (let c = 0; c < chunks.length; c += 1) {
    const chunk = chunks[c];
    const idx = indexed[c];
    const file = idx.file;
    const row = c * width;
    // Every addend is recorded under its name, so the search debug log can
    // show what each one contributed. The score is their sum and nothing else.
    const boosts: ScoreBoosts = {};
    let score = 0;
    const add = (name: string, value: number) => {
      if (value === 0) return;
      boosts[name] = (boosts[name] ?? 0) + value;
      score += value;
    };
    // Path and file-name matches are scaled by how much of the rest of the
    // question this chunk's text covers. See `nameCredit`.
    // The same sum `nameCredit` makes, from the numbers already looked up.
    let rest = 0;
    let backed = 0;
    for (let t = 0; t < width; t += 1) {
      if (inPathOf[row + t] > 0) continue;
      rest += backs[t];
      if (inBodyOf[row + t] > 0 || inHeadingOf[row + t] > 0) backed += backs[t];
    }
    const credit = rest === 0 ? 1 : Math.max(RETRIEVAL_WEIGHTS.nameOnlyCredit, backed / rest);
    let askedWeight = 0;
    let covered = 0;
    for (let t = 0; t < width; t += 1) {
      const term = terms[t];
      const weight = weights[t];
      const inBody = inBodyOf[row + t];
      add("pathWords", credit * weight * 2.4 * sat(inPathOf[row + t]));
      add("body", weight * 1.6 * sat(inBody));
      // A word the chunk's text does not have, and the heading it sits under
      // does. "Notice period" is in a spreadsheet's header row, not in row 40;
      // "refund" is in the section title, not in the third paragraph under it.
      // Counted only when the text lacks the word, so a section whose first
      // line is its own title is not scored for that title twice.
      const inHeading = inBody > 0 ? 0 : inHeadingOf[row + t];
      add("heading", weight * RETRIEVAL_WEIGHTS.headingTerm * sat(inHeading));
      if (term === file.stem || term === file.base) add("fileName", credit * weight * RETRIEVAL_WEIGHTS.filenameMatch);
      if (chunk.kind === "why") add("commit", weight * 1.1 * sat(inBody));
      // The word is part of a name this chunk declares, so this is where the
      // thing is defined, not one of the places that call it.
      if (holds(idx.declared, asked[t])) add("declares", weight * RETRIEVAL_WEIGHTS.declaredTerm);
      askedWeight += backs[t];
      if (inBody > 0 || inHeading > 0) covered += backs[t];
    }
    // 0 when the text shares no word with the question, 1 once it covers
    // `backingShare` of it. Bonuses for what kind of file this is are scaled by
    // it, so a README or an entry point cannot score on its name alone.
    const backing = askedWeight > 0 ? Math.min(1, covered / askedWeight / RETRIEVAL_WEIGHTS.backingShare) : 0;
    bestText = Math.max(bestText, textScore(boosts));
    // A file a recent commit changed, when the folder's history was readable.
    // Scaled by how much of the question this chunk's text covers, so a recent
    // file that does not match the question gets nothing.
    const recency = backing > 0 ? (signals?.recency?.get(chunk.path) ?? 0) : 0;
    if (recency > 0) add("recentCommit", RETRIEVAL_WEIGHTS.recentCommit * recency * backing);
    for (const name of named) {
      if (isNamedPath(file, name)) add("namedPath", RETRIEVAL_WEIGHTS.pathMatch);
    }
    for (const symbol of code.symbols) {
      // The declaration is where the question points.
      if (symbol.chunks.has(chunk)) add("symbolDefinition", RETRIEVAL_WEIGHTS.symbolDefinition);
      // `answer-card.tsx` is the file of `AnswerCard`. The exact-match rule
      // above only sees a stem spelled the way the term is.
      const term = symbolTerm.get(symbol.key);
      if (symbolKey(file.stem) === symbol.key && file.stem !== term && file.base !== term) {
        add("symbolFile", credit * weightOf(term ?? symbol.key) * RETRIEVAL_WEIGHTS.filenameMatch);
      }
    }
    if ((wantsApi || wantsShape) && file.entryPoint) {
      // In full for a question about the whole app or the whole API. For "which
      // router handles retries", only as far as the file's text backs it. Not
      // at all when the question names the code it is about.
      add("entryPoint", RETRIEVAL_WEIGHTS.apiShapePath * (wholeApp ? 1 : namesCode ? 0 : backing));
    }
    if (wantsLambdaFleet && file.lambda) {
      add("lambdaFleet", RETRIEVAL_WEIGHTS.apiShapePath);
    }
    if (wantsOverview && file.readme) {
      add("readmeOverview", RETRIEVAL_WEIGHTS.pathMatch);
    }
    if ((named.length > 0 || wantsShape || wantsLambdaFleet) && chunk.kind === "code" && chunk.startLine <= 8) {
      add("fileHead", RETRIEVAL_WEIGHTS.fileHead);
    }
    // Behavior questions prefer the file that performs the work over the route
    // that triggers it. A router docstring is the API surface, not the answer.
    if (wantsBehavior && file.behavior) {
      add("behaviorPath", RETRIEVAL_WEIGHTS.behaviorPath);
    }
    const isUploadedOffice = file.office;
    if (isUploadedOffice) {
      add("documentPath", RETRIEVAL_WEIGHTS.documentPath);
    }
    if (wantsDefinition && isUploadedOffice) {
      add("documentDefinition", RETRIEVAL_WEIGHTS.documentDefinition);
    }
    // The filter only rules out chunks whose words show the phrase cannot be
    // there. Whether it is there is still decided by the text itself.
    if (mayHoldPhrase && mayHoldPhrase(idx)) {
      const body = chunk.text?.toLowerCase() ?? "";
      if (body.includes(phrase)) add("exactPhrase", RETRIEVAL_WEIGHTS.exactPhrase);
    }
    // Test/fixture files describe what the suite covers, not what the system
    // does. Demote so a test docstring cannot outrank the component it tests
    // and be spoken as a confident wrong answer. Applied last so it cannot be
    // fully cancelled by the behavior boost on a test living under a behavior
    // directory.
    if (file.test && !asksAboutTests) {
      // The penalty is a demotion. Where it would erase the match, keep the
      // chunk aside: it is used only if nothing else in the material matches.
      if (score > 0 && score <= RETRIEVAL_WEIGHTS.testPathPenalty) lastResort.push({ ...chunk, score, boosts: { ...boosts } });
      add("testPath", -RETRIEVAL_WEIGHTS.testPathPenalty);
    }
    if (file.authoritative && !asksAboutTests) {
      // Docs outrank tests and examples that say the same thing. This used to
      // be a flat bonus, which put the README in the results of every question,
      // including ones it shares no word with. It is still flat for a question
      // about the whole app, which is the README's question to answer.
      // And it is off when the question names a symbol or a file: the code is
      // then the authority, and a document that mentions it ranks on its text.
      add("authoritativePath", RETRIEVAL_WEIGHTS.authoritativePath * (wholeApp ? 1 : namesCode ? 0 : backing));
    }
    if (score > 0) scored.push({ ...chunk, score, boosts });
  }
  // A declaration is short, and a document can mention the symbol in every
  // line. So a chunk that declares a named symbol is scored as if its text
  // were the best text match in the material, and `symbolDefinition` is added
  // on top of that. A chunk that only mentions the symbol cannot make up the
  // difference with kind-of-file bonuses. Only a path score can compete.
  if (code.symbols.length > 0) {
    for (const hit of [...scored, ...lastResort]) {
      if (hit.boosts?.symbolDefinition == null) continue;
      const lift = bestText - textScore(hit.boosts);
      if (lift <= 0) continue;
      hit.boosts.symbolLift = lift;
      hit.score += lift;
    }
  }
  // A string that exists only in a test file used to be unsearchable: the
  // penalty took its score below zero. The weight's own rule is that a test
  // file wins "when nothing else matches at all", so that is when these count.
  if (scored.length === 0) scored.push(...lastResort);
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

export type RetrieveHitsOptions = {
  /** Required at every call site so an active pack's skip list cannot be forgotten. */
  excludePatterns: string[] | undefined;
  limit?: number;
  vectorStore?: VectorStore | null;
  hybrid?: boolean;
  /** Recent-commit recency by chunk path, when the loaded folder had history. */
  recency?: RankSignals["recency"];
  /** Tenant filter applied before ranking — required on every retrieveHits call. */
  scope: import("./retrieval-scope.ts").RetrievalScope;
};

/** Options `search()` and every other live path must pass. */
export function retrieveHitsOptionsForPack(
  pack: Pick<RepoPack, "excludePatterns">,
  scope: RetrieveHitsOptions["scope"],
  extras: Omit<RetrieveHitsOptions, "excludePatterns" | "scope"> = {},
): RetrieveHitsOptions {
  return { ...extras, excludePatterns: pack.excludePatterns, scope };
}

export function formatExclusionSummary(chunkCount: number, excludedCount: number, hitCount: number): string {
  return `${chunkCount} chunks | ${excludedCount} excluded | ${hitCount} hits`;
}

/** Flight-recorder line: exclusion counts plus channel mix when hits exist. */
export function formatFlightRetrievalSummary(
  chunks: IndexedChunk[],
  hits: Hit[],
  excludePatterns?: string[],
): string {
  const excludedCount = excludePatterns?.length
    ? chunks.length - chunks.filter((chunk) => !pathExcluded(chunk.path, excludePatterns)).length
    : 0;
  const base = formatExclusionSummary(chunks.length, excludedCount, hits.length);
  if (hits.length === 0) return base;
  const mix = formatRetrievalSummary(hits).replace(/^\d+ hits \| /, "");
  return `${base} | ${mix}`;
}

/**
 * Live retrieve entry. Hybrid is on by default when a VectorStore is
 * installed. A failed or empty semantic channel degrades to lexical.
 */
export async function retrieveHits(
  query: string,
  chunks: IndexedChunk[],
  options: RetrieveHitsOptions,
): Promise<Hit[]> {
  const { assertRetrievalScope, filterChunksForScope } = await import("./retrieval-scope.ts");
  const scoped = filterChunksForScope(chunks, options.scope);
  assertRetrievalScope(scoped, options.scope);
  const excludePatterns = options.excludePatterns;
  const limit = options.limit ?? 6;
  const vectorStore = options.vectorStore === undefined ? getVectorStore() : options.vectorStore;
  const hybrid = options.hybrid ?? USE_HYBRID_RETRIEVAL;
  const usable = excludePatterns?.length
    ? scoped.filter((chunk) => !pathExcluded(chunk.path, excludePatterns))
    : scoped;
  const excludedCount = chunks.length - usable.length;
  const signals: RankSignals | undefined = options.recency?.size ? { recency: options.recency } : undefined;
  const hits =
    hybrid && vectorStore
      ? await hybridRetrieve(query, usable, vectorStore, limit, signals)
      : retrieve(query, usable, limit, signals);
  logRetrieval(hits, chunks.length, excludedCount);
  return hits;
}

/**
 * Fuse lexical, semantic, and structural scores into ranked chunk candidates.
 * Rank only — composition and verifyClaim run later; embeddings must not
 * bypass literal word support.
 */
export async function hybridRetrieve(
  query: string,
  chunks: IndexedChunk[],
  vectorStore: VectorStore,
  limit = 6,
  signals?: RankSignals,
): Promise<Hit[]> {
  const { vectorCacheKey } = await import("./retrieval-scope.ts");
  const cached = await vectorStore.get(chunks.map((chunk) => vectorCacheKey(chunk)));
  const lexicalHits = retrieve(query, chunks, limit * 2, signals);
  const { candidatesForCap, capPerFile, retrieveStructural } = await import("./hybrid.ts");
  // These two channels rank chunks, not files, so each is asked for everything
  // it scored and `candidatesForCap` picks the window: the top `limit * 2` as
  // before, plus the chunks from other files the per-file cap would promote.
  const structuralHits = candidatesForCap(retrieveStructural(query, chunks, chunks.length), limit * 2);
  let semanticHits: Hit[] = [];
  if (cached.size > 0) {
    try {
      semanticHits = candidatesForCap(await semanticRetrieve(query, chunks, vectorStore, chunks.length), limit * 2);
    } catch {
      llmDebug("[retrieve] semantic skipped: embed failed");
    }
  } else {
    llmDebug("[retrieve] semantic skipped: no embeddings");
  }

  if (semanticHits.length === 0 && structuralHits.length === 0) {
    // `retrieve` has already applied the per-file cap.
    const lexical = lexicalHits.slice(0, limit);
    return finishTraces(
      query,
      lexical.map((hit) => ({ ...hit, lexicalScore: hit.score, semanticScore: 0, structuralScore: 0 })),
    ).slice(0, limit);
  }

  const byId = new Map<string, Hit>();
  for (const hit of lexicalHits) {
    byId.set(hit.id, { ...hit, lexicalScore: hit.score, semanticScore: 0, structuralScore: 0 });
  }
  for (const hit of semanticHits) {
    const existing = byId.get(hit.id);
    if (existing) {
      existing.semanticScore = hit.score;
    } else {
      byId.set(hit.id, {
        ...hit,
        lexicalScore: 0,
        semanticScore: hit.score,
        structuralScore: 0,
      });
    }
  }
  for (const hit of structuralHits) {
    const existing = byId.get(hit.id);
    if (existing) {
      existing.structuralScore = hit.score;
      existing.structuralBoosts = hit.structuralBoosts;
    } else {
      byId.set(hit.id, {
        ...hit,
        lexicalScore: 0,
        semanticScore: 0,
        structuralScore: hit.score,
      });
    }
  }

  const combined = finishTraces(
    query,
    [...byId.values()].map((hit) => ({
      ...hit,
      score: combineScores(hit.lexicalScore ?? 0, hit.semanticScore ?? 0, hit.structuralScore ?? 0),
    })),
  );
  combined.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  // Each channel ranks on its own, and the semantic and structural channels
  // have no per-file limit, so the union can be one file several times over.
  // This is the last step before the hits reach routeSearchAnswer, localCard
  // or generateAnswer: cap per file first, then take the top `limit`.
  return capPerFile(combined, limit);
}

function finishTraces(query: string, hits: Hit[]): Hit[] {
  const traces: RetrievalTrace[] = [];
  const scored = hits.map((hit) => {
    const lexicalScore = hit.lexicalScore ?? 0;
    const semanticScore = hit.semanticScore ?? 0;
    const structuralScore = hit.structuralScore ?? 0;
    const signals = signalsFor(query, hit, lexicalScore, semanticScore, structuralScore);
    const next = { ...hit, lexicalScore, semanticScore, structuralScore, signals };
    const channel = primaryChannel(next);
    const evidenceType = evidenceTypeOf(next);
    const trace: RetrievalTrace = {
      chunkId: hit.id,
      path: hit.path,
      channel,
      evidenceType,
      lexicalScore,
      semanticScore,
      structuralScore,
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

function logRetrieval(hits: Hit[], chunkCount: number, excludedCount: number): void {
  llmDebug("[retrieve]", formatExclusionSummary(chunkCount, excludedCount, hits.length));
  for (const hit of hits) {
    llmDebug("[retrieve]", hit.path, primaryChannel(hit), hit.score, evidenceTypeOf(hit));
  }
  llmDebug("[retrieve]", formatRetrievalSummary(hits));
}

function signalsFor(
  query: string,
  hit: Hit,
  lexicalScore: number,
  semanticScore: number,
  structuralScore = 0,
): string[] {
  const signals: string[] = [];
  if (lexicalScore > 0) signals.push("lexical");
  if (semanticScore > 0) signals.push("semantic");
  if (structuralScore > 0) signals.push("structural");
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
