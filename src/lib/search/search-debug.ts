/**
 * Search debugging: what was indexed, what retrieval ranked, and which stage
 * answered. One record per search.
 *
 * Off unless VITE_DEBUG_SEARCH (browser build) or DEBUG_SEARCH (node) is
 * "true". When off, nothing here runs: no extra retrieval, no console output,
 * no record kept.
 *
 * Output stays on the device. A record is printed to the console and kept in
 * `globalThis.__meethintSearchDebug` (the last 20), so it can be read back in
 * DevTools on a deployed build. Nothing is sent anywhere. A record holds the
 * question and file paths, never file contents.
 */
import { pathExcluded } from "../context/exclusions.ts";
import { isSearchDebug } from "../debug.ts";
import type { Hit, IndexedChunk, ScoreBoosts } from "../repo/types.ts";
import type { AnswerTier } from "./answer-route.ts";
import { RETRIEVAL_WEIGHTS } from "./retrieval-weights.ts";
import { namedCode } from "./retrieve.ts";

/** How many ranked hits a record lists. The answer stages are sent fewer. */
export const SEARCH_DEBUG_TOP = 10;

const KEEP = 20;

/** The function that produced the card, or `silence` when none could. */
export type SearchDebugStage = "localCard" | "generateAnswer" | "synthesizeAnswer" | "silence";

export type SearchDebugHit = {
  rank: number;
  path: string;
  /** Start line of a code or commit chunk. */
  line?: number;
  /** Page of a document chunk. */
  page?: number;
  kind: Hit["kind"];
  score: number;
  /**
   * Every addend the lexical channel applied to this chunk, by name, exactly
   * as scored (rounded to two places). They sum to `lexical`, or to `score`
   * when retrieval ran without the hybrid channels.
   */
  boosts?: ScoreBoosts;
  /** Channel scores on the hybrid path, before the channel weights. */
  lexical?: number;
  semantic?: number;
  structural?: number;
  /** Every addend the structural channel applied. They sum to `structural`. */
  structuralBoosts?: ScoreBoosts;
  /** True when this chunk was one of the hits handed to the answer stages. */
  sentToAnswer: boolean;
};

export type SearchDebugRecord = {
  at: string;
  query: string;
  /** Files with at least one searchable chunk, after exclusions. */
  filesIndexed: number;
  /** Searchable chunks, after exclusions. */
  chunksIndexed: number;
  /** Files in the loaded material, when the caller knows it. */
  filesLoaded?: number;
  /** How many hits the answer stages were given. */
  hitsSent: number;
  /**
   * The code the question names and the material confirms: identifiers some
   * code chunk declares, and file names some path matches. When either list
   * has an entry, the README, docs and entry-point bonuses were not applied.
   */
  namedSymbols: string[];
  namedPaths: string[];
  topHits: SearchDebugHit[];
  stage: SearchDebugStage;
  /** The silence reason shown on the card, when the stage is `silence`. */
  reason: string | null;
  totalMs?: number;
};

export type SearchDebugInput = {
  query: string;
  /**
   * The question as retrieval ranked it, when that is not `query`: a follow-up
   * is expanded with the question before it. Used to report the code it names.
   */
  retrievalQuery?: string;
  /** Every chunk the search could draw on, before exclusions. */
  chunks: IndexedChunk[];
  excludePatterns?: string[];
  filesLoaded?: number;
  /** Retrieval's ranking, best first. Only the first `SEARCH_DEBUG_TOP` are listed. */
  ranked: Hit[];
  /** The hits that were handed to the answer stages. */
  sent: Hit[];
  stage: SearchDebugStage;
  reason?: string | null;
  totalMs?: number;
};

declare global {
  var __meethintSearchDebug: SearchDebugRecord[] | undefined;
}

/** The router's tier, named after the function that ran. */
export function stageOfTier(tier: AnswerTier): SearchDebugStage {
  if (tier === "grounded") return "generateAnswer";
  if (tier === "synthesis") return "synthesizeAnswer";
  if (tier === "localCard") return "localCard";
  return "silence";
}

/** A file is a path within a source, the same identity the per-file cap uses. */
function fileKey(chunk: Pick<IndexedChunk, "path"> & { sourceId?: string }): string {
  return `${chunk.sourceId ?? ""}\u0000${chunk.path}`;
}

export function indexCounts(
  chunks: IndexedChunk[],
  excludePatterns?: string[],
): { filesIndexed: number; chunksIndexed: number } {
  const files = new Set<string>();
  let chunksIndexed = 0;
  for (const chunk of chunks) {
    if (pathExcluded(chunk.path, excludePatterns)) continue;
    chunksIndexed += 1;
    files.add(fileKey(chunk));
  }
  return { filesIndexed: files.size, chunksIndexed };
}

function rounded(value: number): number {
  return Number(value.toFixed(2));
}

function roundedBoosts(boosts: ScoreBoosts | undefined): ScoreBoosts | undefined {
  if (!boosts) return undefined;
  const entries = Object.entries(boosts).filter(([, value]) => value !== 0);
  return entries.length > 0 ? Object.fromEntries(entries.map(([name, value]) => [name, rounded(value)])) : undefined;
}

/** `body 6.54 + symbolDefinition 30.66`, and `- testPath 9.00` for a penalty. */
function sumOf(boosts: ScoreBoosts): string {
  return Object.entries(boosts)
    .map(([name, value], index) =>
      index === 0 ? `${name} ${value.toFixed(2)}` : `${value < 0 ? "-" : "+"} ${name} ${Math.abs(value).toFixed(2)}`,
    )
    .join(" ");
}

/** The lines under one ranked hit that say where its score came from. */
function scoreLines(hit: SearchDebugHit): string[] {
  const lines: string[] = [];
  const hybrid = hit.lexical != null || hit.semantic != null || hit.structural != null;
  if (hybrid) {
    lines.push(
      `score = ${RETRIEVAL_WEIGHTS.lexical} x lexical ${(hit.lexical ?? 0).toFixed(2)}` +
        ` + ${RETRIEVAL_WEIGHTS.semantic} x semantic ${(hit.semantic ?? 0).toFixed(2)}` +
        ` + ${RETRIEVAL_WEIGHTS.structural} x structural ${(hit.structural ?? 0).toFixed(2)}`,
    );
  }
  if (hit.boosts) lines.push(`${hybrid ? "lexical" : "score"} = ${sumOf(hit.boosts)}`);
  if (hit.structuralBoosts) lines.push(`structural = ${sumOf(hit.structuralBoosts)}`);
  return lines;
}

export function buildSearchDebug(input: SearchDebugInput): SearchDebugRecord {
  const sent = new Set(input.sent.map((hit) => hit.id));
  const topHits = input.ranked.slice(0, SEARCH_DEBUG_TOP).map((hit, index): SearchDebugHit => {
    const hybrid = hit.lexicalScore != null || hit.semanticScore != null || hit.structuralScore != null;
    return {
      rank: index + 1,
      path: hit.path,
      line: hit.kind === "document" ? undefined : hit.startLine,
      page: hit.kind === "document" ? hit.page : undefined,
      kind: hit.kind,
      score: rounded(hit.score),
      boosts: roundedBoosts(hit.boosts),
      lexical: hybrid ? rounded(hit.lexicalScore ?? 0) : undefined,
      semantic: hybrid ? rounded(hit.semanticScore ?? 0) : undefined,
      structural: hybrid ? rounded(hit.structuralScore ?? 0) : undefined,
      structuralBoosts: roundedBoosts(hit.structuralBoosts),
      sentToAnswer: sent.has(hit.id),
    };
  });
  const usable = input.excludePatterns?.length
    ? input.chunks.filter((chunk) => !pathExcluded(chunk.path, input.excludePatterns))
    : input.chunks;
  const named = namedCode(input.retrievalQuery ?? input.query, usable);
  return {
    at: new Date().toISOString(),
    query: input.query,
    ...indexCounts(input.chunks, input.excludePatterns),
    filesLoaded: input.filesLoaded,
    hitsSent: input.sent.length,
    namedSymbols: named.symbols.map((symbol) => symbol.name),
    namedPaths: named.paths,
    topHits,
    stage: input.stage,
    reason: input.stage === "silence" ? (input.reason ?? null) : null,
    totalMs: input.totalMs,
  };
}

/**
 * Record one search and print it. Returns the record, or null when the flag
 * is off. Call it once per search, after the card is decided.
 */
export function reportSearchDebug(input: SearchDebugInput): SearchDebugRecord | null {
  if (!isSearchDebug()) return null;
  const record = buildSearchDebug(input);

  const log = (globalThis.__meethintSearchDebug ??= []);
  log.push(record);
  if (log.length > KEEP) log.splice(0, log.length - KEEP);

  const loaded =
    record.filesLoaded != null && record.filesLoaded !== record.filesIndexed
      ? ` (${record.filesLoaded} files loaded)`
      : "";
  const timing = record.totalMs != null ? ` in ${record.totalMs} ms` : "";
  console.info(`[search] ${JSON.stringify(record.query)}`);
  console.info(`[search] indexed: ${record.filesIndexed} files, ${record.chunksIndexed} chunks${loaded}`);
  console.info(
    `[search] answered by: ${record.stage}${timing}${record.reason ? ` (${record.reason})` : ""}`,
  );
  const namedHere = [...record.namedSymbols, ...record.namedPaths];
  console.info(
    namedHere.length > 0
      ? `[search] names code: ${namedHere.join(", ")}. README, docs and entry-point boosts are off for this question.`
      : "[search] names no symbol or file in the material. README, docs and entry-point boosts apply as far as the text backs them.",
  );
  console.info(
    `[search] top ${record.topHits.length} hits, ${record.hitsSent} sent to the answer stages:`,
  );
  for (const hit of record.topHits) {
    const where = hit.page != null ? ` p.${hit.page}` : hit.line != null ? `:${hit.line}` : "";
    console.info(
      `[search]   ${String(hit.rank).padStart(2)}. ${hit.score.toFixed(2).padStart(6)}  ${hit.path}${where}` +
        `${hit.kind === "why" ? " (commit)" : ""}${hit.sentToAnswer ? "" : "  [not sent]"}`,
    );
    for (const line of scoreLines(hit)) console.info(`[search]             ${line}`);
  }
  return record;
}

/** The records kept so far, oldest first. */
export function searchDebugLog(): SearchDebugRecord[] {
  return (globalThis.__meethintSearchDebug ?? []).slice();
}

export function clearSearchDebugLog(): void {
  globalThis.__meethintSearchDebug = [];
}
