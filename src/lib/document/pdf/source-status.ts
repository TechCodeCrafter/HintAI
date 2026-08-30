import type { PdfReadiness, PdfStoredSource } from "../../context/types.ts";
import { READINESS_NOTES } from "./notes.ts";

export type SourceStatusLabel = {
  short: string;
  detail: string;
};

/** Concise Repo labels. Parser notes stay unchanged; this only maps them for UI. */
export function pdfSourceStatus(source: PdfStoredSource): SourceStatusLabel {
  if (source.stagedContentHash && (!source.stagedReadiness || source.stagedReadiness === "pending")) {
    return { short: "Reading…", detail: "Reading PDF…" };
  }
  if (source.stagedReadiness === "ready" && !source.stagedChunked) {
    return { short: "Indexing…", detail: "Indexing…" };
  }
  if (source.readiness === "pending") {
    return { short: "Waiting", detail: "Waiting" };
  }
  if (source.readiness === "ready") {
    if (source.lastFailedNote) {
      return {
        short: "Ready",
        detail: `Update failed. ${userFacingPdfNote(source.lastFailedReadiness ?? "unreadable", source.lastFailedNote)}`,
      };
    }
    return { short: "Ready", detail: "Ready" };
  }
  return {
    short: shortLabel(source.readiness, source.readinessNote),
    detail: userFacingPdfNote(source.readiness, source.readinessNote),
  };
}

export function shortLabel(readiness: PdfReadiness, note?: string): string {
  if (readiness === "scanned") return "Scanned PDF";
  if (readiness === "unreadable") return "Cannot read";
  if (readiness === "refused") {
    if (note === READINESS_NOTES.refusedPages) return "Too many pages";
    if (note === READINESS_NOTES.refusedBytes) return "Too large";
    return "Too large";
  }
  if (readiness === "pending") return "Waiting";
  return "Ready";
}

export function userFacingPdfNote(readiness: PdfReadiness, note?: string): string {
  if (readiness === "scanned") {
    return READINESS_NOTES.scanned;
  }
  if (readiness === "unreadable") {
    return "MeetHint couldn't read this PDF.";
  }
  if (note === READINESS_NOTES.refusedPages) {
    return "This PDF is over the 80-page limit.";
  }
  if (note === READINESS_NOTES.refusedBytes) {
    return "This PDF is over the 12 MB limit.";
  }
  return note || "This PDF could not be indexed.";
}

export function contextNameForPdfs(files: File[]): string {
  if (files.length === 1) {
    const base = files[0].name.replace(/\.pdf$/i, "").trim();
    return base || "Documents";
  }
  return "Documents";
}
