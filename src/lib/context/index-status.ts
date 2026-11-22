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

export type IndexStatusView = {
  /**
   * working: a load is in progress.
   * ready: the index is built and has something to search.
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

/**
 * The one line that says where the index stands.
 *
 * "Ready." is only ever said for a finished load with at least one chunk,
 * and the counts beside it come from the chunks search runs over.
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
  return { state: "ready", text: `${counts} Ready.`, fraction: null };
}

/** "report.docx" or "report.docx and 2 more", for the line that names what failed. */
export function namedFailures(paths: string[]): string {
  const [first, ...rest] = paths;
  if (!first) return "";
  const name = first.replace(/\/$/, "").split("/").pop() ?? first;
  return rest.length === 0 ? name : `${name} and ${rest.length.toLocaleString("en-US")} more`;
}
