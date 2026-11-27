import { onLexicalPath, warmPhase, type SearchWarmth } from "../search/readiness.ts";
import { formatIndexSummary, type IndexSummary } from "./index-summary.ts";

/**
 * What a load is doing right now, with the counts from the step doing it:
 * the file reader, then the store, then the indexer. Held only while a load
 * runs; the finished state is read from the index itself.
 */
export type IndexActivity =
  | { phase: "reading"; done: number; total: number }
  | { phase: "saving"; total: number }
  /** `total` is null when the indexer cannot know it up front (a space with several contexts). */
  | { phase: "indexing"; done: number; total: number | null; chunks: number };

/** The slice of PDF ingest progress the status line needs. */
export type PdfActivity = { phase: "reading" | "indexing" | "ready"; current: number; total: number };

/**
 * The step the index is at, in the order a load goes through them. `loading`
 * is a space being opened before any count is known.
 */
export type IndexPhase = "loading" | "reading" | "indexing" | "warming" | "ready" | "empty" | "error";

/** True while a load, a re-index or a PDF read is running. */
export function indexWorking(input: {
  status: string;
  loadingFolder: boolean;
  contextUpdating: boolean;
  pdf?: PdfActivity | null;
}): boolean {
  return (
    input.status === "booting" ||
    input.status === "hydrating" ||
    input.loadingFolder ||
    input.contextUpdating ||
    Boolean(input.pdf && input.pdf.phase !== "ready")
  );
}

export type IndexStatusView = {
  /**
   * working: a load is in progress, or search is still being warmed for it.
   * ready: the index is built, warm, and has something to search.
   * empty: the index is built and holds nothing.
   * error: the last load did not finish.
   */
  state: "working" | "ready" | "empty" | "error";
  text: string;
  /** Bar position from 0 to 1 while working. Null when there is nothing to measure yet. */
  fraction: number | null;
};

function count(value: number, one: string): string {
  return `${value.toLocaleString("en-US")} ${one}${value === 1 ? "" : "s"}`;
}

/**
 * Reading comes first and indexing last, so the bar gives reading its first
 * third and indexing the rest. These shares place the bar; they are not a
 * measurement of time. The numbers in the text are the real counts.
 */
const READ_SHARE = 0.3;
const INDEX_START = 0.35;

function ratio(done: number, total: number): number {
  return total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
}

/** Where the bar sits for an activity. Never moves backwards across the phases of one load. */
export function activityFraction(activity: IndexActivity | null): number | null {
  if (!activity) return null;
  if (activity.phase === "reading") return READ_SHARE * ratio(activity.done, activity.total);
  if (activity.phase === "saving") return READ_SHARE;
  if (activity.total === null) return null;
  return INDEX_START + (1 - INDEX_START) * ratio(activity.done, activity.total);
}

function workingText(activity: IndexActivity | null, pdf: PdfActivity | null, booting: boolean): string {
  if (activity?.phase === "reading") {
    return `Reading ${activity.done.toLocaleString("en-US")} of ${count(activity.total, "file")}…`;
  }
  if (activity?.phase === "saving") return `Saving ${count(activity.total, "file")}…`;
  if (activity?.phase === "indexing") {
    const chunks = `${count(activity.chunks, "chunk")} so far`;
    return activity.total === null
      ? `Indexing ${count(activity.done, "file")}, ${chunks}…`
      : `Indexing ${activity.done.toLocaleString("en-US")} of ${count(activity.total, "file")}, ${chunks}…`;
  }
  if (pdf && pdf.phase === "reading") {
    return pdf.total > 1 ? `Reading PDF ${pdf.current} of ${pdf.total}…` : "Reading PDF…";
  }
  return booting ? "Loading…" : "Indexing…";
}

function workingPhase(activity: IndexActivity | null, pdf: PdfActivity | null, booting: boolean): IndexPhase {
  if (activity?.phase === "reading") return "reading";
  if (activity) return "indexing";
  if (pdf && pdf.phase === "reading") return "reading";
  return booting ? "loading" : "indexing";
}

/**
 * The line shown once the chunks are in place and search is still being
 * warmed for them. Null when there is nothing left to warm.
 *
 * Building the word index is the last part of indexing, so it reads as
 * "Indexing". Reading the vectors in is its own step.
 */
function warmingText(warmth: SearchWarmth | null | undefined): { phase: IndexPhase; text: string; fraction: number } | null {
  if (!warmth) return null;
  const phase = warmPhase(warmth);
  if (phase === "ready") return null;
  if (phase === "words") {
    const { done, total } = warmth.words;
    return {
      phase: "indexing",
      text: `Indexing words, ${done.toLocaleString("en-US")} of ${count(total, "chunk")}…`,
      fraction: ratio(done, total),
    };
  }
  const { have, total } = warmth.vectors;
  return {
    phase: "warming",
    text: `Warming vectors, ${have.toLocaleString("en-US")} of ${count(total, "chunk")}…`,
    fraction: ratio(have, total),
  };
}

/** What the vectors still owe, for a space that is ready on word search. */
function lexicalNote(warmth: SearchWarmth | null | undefined): string | null {
  if (!warmth || !onLexicalPath(warmth)) return null;
  const { have, total } = warmth.vectors;
  return `Vectors are still warming (${have.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}). Answers use word search until they finish.`;
}

/**
 * The one line that says where the index stands.
 *
 * "Ready." is only ever said for a finished load with at least one chunk,
 * whose word index is built and whose vectors are in memory or given up on
 * for now. The counts beside it come from the chunks search runs over.
 */
export function indexStatusView(input: {
  /** A load, a re-index or a PDF read is running. */
  working: boolean;
  /** The store is still opening the space for the first time. */
  booting?: boolean;
  /** The last load ended in an error. */
  errored: boolean;
  activity: IndexActivity | null;
  pdf?: PdfActivity | null;
  summary: IndexSummary;
  /** How far search has been warmed for these chunks. Unset reads as fully warm. */
  warmth?: SearchWarmth | null;
}): IndexStatusView {
  if (input.working) {
    return {
      state: "working",
      text: workingText(input.activity, input.pdf ?? null, input.booting ?? false),
      fraction: activityFraction(input.activity),
    };
  }
  const counts = formatIndexSummary(input.summary);
  if (input.errored) {
    return {
      state: "error",
      text: input.summary.chunkCount > 0 ? `Indexing did not finish. ${counts}` : "Indexing did not finish.",
      fraction: null,
    };
  }
  if (input.summary.chunkCount === 0) {
    return { state: "empty", text: `${counts} Nothing to search yet.`, fraction: null };
  }
  const warming = warmingText(input.warmth);
  if (warming) return { state: "working", text: warming.text, fraction: warming.fraction };
  const lexical = lexicalNote(input.warmth);
  return { state: "ready", text: lexical ? `${counts} Ready. ${lexical}` : `${counts} Ready.`, fraction: null };
}

/** "report.docx" or "report.docx and 2 more", for the line that names what failed. */
export function namedFailures(paths: string[]): string {
  const [first, ...rest] = paths;
  if (!first) return "";
  const name = first.replace(/\/$/, "").split("/").pop() ?? first;
  return rest.length === 0 ? name : `${name} and ${rest.length.toLocaleString("en-US")} more`;
}

export type IndexChipView = {
  state: IndexStatusView["state"];
  /** "Indexed 142 files · 3 skipped · 18,400 chunks" once a load has finished. */
  text: string;
  /** True when the counts are final: no load, re-index or PDF read is running. */
  settled: boolean;
  /** True when a file that was meant to be indexed could not be. */
  attention: boolean;
  /** The step the index is at. */
  phase: IndexPhase;
  /**
   * True when the chip reports Ready: the counts are final, there is something
   * to search, and search is warm for it. Listen is on exactly when this is.
   */
  ready: boolean;
  /** "Ready", or "Ready · word search" while the vectors are still warming. Null until ready. */
  label: string | null;
  /** One sentence on what Ready means right now, when it is not the plain case. */
  detail: string | null;
};

/**
 * The header chip: the same facts as the status line, in the shape that fits
 * a chip and always says how many files search cannot reach.
 *
 * `skipped` is every file that is not searchable (left out when the selection
 * was loaded, stored with no chunk, or failed to parse). `failed` is the part
 * of it that was meant to be indexed. While a load runs the chip shows the
 * step in progress, because a file not reached yet has no chunks either and
 * would be miscounted as skipped.
 *
 * After the load the chip stays on the step in progress while search is
 * warmed for the new chunks ("Indexing words…", "Warming vectors…"), and
 * only then shows the counts with "Ready" beside them.
 */
export function indexChipView(input: {
  working: boolean;
  booting?: boolean;
  errored: boolean;
  activity: IndexActivity | null;
  pdf?: PdfActivity | null;
  summary: IndexSummary;
  skipped: number;
  failed: number;
  /** How far search has been warmed for these chunks. Unset reads as fully warm. */
  warmth?: SearchWarmth | null;
}): IndexChipView {
  const idle = { ready: false, label: null, detail: null };
  if (input.working) {
    return {
      state: "working",
      text: workingText(input.activity, input.pdf ?? null, input.booting ?? false),
      settled: false,
      attention: false,
      phase: workingPhase(input.activity, input.pdf ?? null, input.booting ?? false),
      ...idle,
    };
  }
  const { filesIndexed, chunkCount, filesStored } = input.summary;
  const counts = `Indexed ${count(filesIndexed, "file")} · ${input.skipped.toLocaleString("en-US")} skipped · ${count(chunkCount, "chunk")}`;
  if (input.errored) {
    return {
      state: "error",
      text: chunkCount > 0 ? `Indexing did not finish · ${counts}` : "Indexing did not finish",
      settled: true,
      attention: true,
      phase: "error",
      ...idle,
    };
  }
  if (chunkCount === 0) {
    // Nothing was ever added: there is no load to report on.
    const nothing = filesStored === 0 && input.skipped === 0;
    return {
      state: "empty",
      text: nothing ? "Nothing indexed yet" : counts,
      settled: true,
      attention: !nothing,
      phase: "empty",
      ...idle,
    };
  }
  const warming = warmingText(input.warmth);
  if (warming) {
    // The files and chunks are final, so the list of skipped files is too.
    // Only "Ready" is held back.
    return { state: "working", text: warming.text, settled: true, attention: false, phase: warming.phase, ...idle };
  }
  const lexical = lexicalNote(input.warmth);
  return {
    state: "ready",
    text: counts,
    settled: true,
    attention: input.failed > 0,
    phase: "ready",
    ready: true,
    label: lexical ? "Ready · word search" : "Ready",
    detail: lexical,
  };
}
