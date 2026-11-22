import type { DocumentChunk } from "@/lib/document/types";
import type { Evidence } from "@/lib/search/evidence";
import type { SilenceKind } from "@/lib/search/silence";
import type { SymbolKind } from "./parser";

export type { DocumentChunk };

export type RepoFile = {
  path: string;
  language: string;
  content: string;
};

export type RepoCommit = {
  sha: string;
  date: string;
  author: string;
  message: string;
  files: string[];
  pr?: string;
};

export type RepoPack = {
  id: string;
  name: string;
  description: string;
  files: RepoFile[];
  commits: RepoCommit[];
  /** Globs and paths dropped at chunk time. Files stay visible in the pack UI. */
  excludePatterns?: string[];
};

export type FileChunk = {
  id: string;
  kind: "code" | "why";
  /** Ingest unit id (repo bundle). Required on indexed chunks; optional during in-memory pack builds. */
  sourceId?: string;
  path: string;
  startLine: number;
  endLine: number;
  /**
   * Offset of `text` within the source file. A claim extracted from a chunk is
   * located in chunk coordinates; this is what turns that back into a position
   * in the file, which is the only coordinate system a citation may quote.
   */
  startOffset: number;
  text: string;
  /** Present on structured code chunks; window chunks omit it. */
  symbol?: string;
  symbolKind?: SymbolKind;
  language?: string;
  sha?: string;
  author?: string;
  date?: string;
  pr?: string;
  message?: string;
};

/** Code and commit chunks. Document chunks are a separate type. */
export type Chunk = FileChunk;

/** Anything retrieve() and packVocabulary() may see. */
export type IndexedChunk = Chunk | DocumentChunk;

/**
 * The named addends behind a channel score, for the search debug log. The
 * values sum to that channel's score. Diagnostic only: nothing ranks on it.
 */
export type ScoreBoosts = Record<string, number>;

export type RetrievalScores = {
  score: number;
  lexicalScore?: number;
  semanticScore?: number;
  structuralScore?: number;
  signals?: string[];
  /** What the lexical channel added and subtracted for this chunk. */
  boosts?: ScoreBoosts;
  /** What the structural channel added for this chunk, on the hybrid path. */
  structuralBoosts?: ScoreBoosts;
};

export type FileHit = FileChunk & RetrievalScores;
export type DocumentHit = DocumentChunk & RetrievalScores;
export type Hit = FileHit | DocumentHit;

export function isDocumentChunk(chunk: IndexedChunk): chunk is DocumentChunk {
  return chunk.kind === "document";
}

export function isFileChunk(chunk: IndexedChunk): chunk is Chunk {
  return chunk.kind === "code" || chunk.kind === "why";
}

export function isFileHit(hit: Hit): hit is FileHit {
  return hit.kind === "code" || hit.kind === "why";
}

export function isDocumentHit(hit: Hit): hit is DocumentHit {
  return hit.kind === "document";
}

/**
 * A citation is a rendering of one piece of evidence, and it is tagged for the
 * same reason the evidence is: the two kinds have different coordinates, and a
 * single shape with optional fields is an invitation to fill the missing ones
 * in. There is no `line` on a `CommitCitation` to default to 1.
 */
export type FileCitation = {
  kind: "file";
  path: string;
  line: number;
  /** Last line of the evidence, when the claim spans more than one. */
  endLine?: number;
  /** The Evidence this citation was generated from. */
  evidenceId?: string;
  /** Stable ingest unit — required for multi-source spaces. */
  sourceId?: string;
  sourceType?: "repo" | "pdf" | "file";
  displayName?: string;
  contextId?: string;
  contentHash?: string;
  sha?: string;
  pr?: string;
  label: string;
};

export type CommitCitation = {
  kind: "commit";
  sha: string;
  shortSha: string;
  pr?: string;
  author?: string;
  date?: string;
  evidenceId?: string;
  label: string;
};

export type DocumentCitation = {
  kind: "document";
  sourceId: string;
  path: string;
  page: number;
  heading?: string;
  evidenceId?: string;
  displayName?: string;
  contextId?: string;
  contentHash?: string;
  label: string;
};

export type Citation = FileCitation | CommitCitation | DocumentCitation;

/**
 * A loaded file that retrieval ranked for the question and the answer did not
 * cite. Deliberately not a `Citation`: nothing spoken rests on it, it carries
 * no evidence id, and it is never counted, verified, or shown as "Verified".
 * It exists so the room can see what else was read.
 *
 * Coordinates are the ranked chunk's real position in the loaded source:
 * lines for a file, a page for a PDF. An entry whose source is not loaded, or
 * whose text is no longer at that position, is never built.
 */
export type ConsideredFile = {
  kind: "file";
  path: string;
  startLine: number;
  endLine: number;
  sourceId?: string;
  displayName?: string;
};

export type ConsideredDocument = {
  kind: "document";
  path: string;
  sourceId: string;
  page: number;
  heading?: string;
  displayName?: string;
};

export type ConsideredSource = ConsideredFile | ConsideredDocument;

export type Card = {
  say: string | null;
  /** Why the Card is silent, as one sentence the room can read. Set whenever `say` is null. */
  reason?: string;
  /** The cause behind `reason`, so the UI can offer the right next step. */
  silence?: SilenceKind;
  citations: Citation[];
  /**
   * Up to three other loaded files retrieval ranked for this question and the
   * answer did not cite. Never evidence; see `ConsideredSource`.
   */
  considered?: ConsideredSource[];
  /**
   * The exact evidence behind `say`. Non-empty whenever a Card speaks from the
   * material: composition derives citations from these, and the support gate
   * checks the spoken words against them.
   */
  evidence?: Evidence[];
  query: string;
  latencyMs: number;
  /** Extract is "local". Synthesize/generate store the model name. */
  source: "grok" | "local" | "polished" | "assisted" | "synthesize" | string;
  /** How the spoken line was produced. */
  answerMode?: "docs" | "synthesized" | "generated";
  /** False when a synthesized line did not cite the pack. */
  usedEvidence?: boolean;
  modelName?: string;
  /** Flight-recorder id for thumbs-down feedback on this answer. */
  answerId?: string;
  flightTier?: "grounded" | "synthesis" | "localCard" | "silent";
  flightLatencyMs?: number;
};

export type Utterance = {
  id: string;
  at: number;
  speaker: string;
  role: "them" | "you" | "system";
  text: string;
};

/**
 * One commit from a listening lane.
 *
 * `id` is the identity of the audio event, minted where the clip is committed —
 * never derived from the text. Two people asking byte-identical questions are
 * two events and must both reach the question gate; one clip re-transcribed by a
 * longer pass is one event, and rewrites the line it already owns.
 */
export type HeardEvent = {
  id: string;
  role: "them" | "you";
  text: string;
};
