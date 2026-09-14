import type { ContextKind } from "./types.ts";

export const CONTEXT_KINDS: ReadonlyArray<{ id: ContextKind; label: string }> = [
  { id: "work", label: "Work project" },
  { id: "course", label: "Course / studying" },
  { id: "client", label: "Client" },
  { id: "presentation", label: "Presentation" },
  { id: "research", label: "Research" },
  { id: "other", label: "Something else" },
];

export function contextKindLabel(kind: ContextKind | undefined): string {
  return CONTEXT_KINDS.find((item) => item.id === kind)?.label ?? "Context";
}

export function contextHasSources(input: { fileCount: number; pdfCount: number }): boolean {
  return input.fileCount + input.pdfCount > 0;
}

export function formatContextCounts(input: {
  fileCount: number;
  pdfCount: number;
  chunkCount: number;
}): string {
  const parts: string[] = [];
  if (input.fileCount > 0) {
    parts.push(`${input.fileCount} ${input.fileCount === 1 ? "file" : "files"}`);
  }
  if (input.pdfCount > 0) {
    parts.push(`${input.pdfCount} ${input.pdfCount === 1 ? "PDF" : "PDFs"}`);
  }
  if (parts.length === 0) parts.push("No sources yet");
  parts.push(`${input.chunkCount} ${input.chunkCount === 1 ? "chunk" : "chunks"}`);
  return parts.join(", ");
}

/** User-facing Knowledge Space counts — repos and documents, not internal chunks. */
export function formatSpaceCounts(input: { repoCount: number; docCount: number }): string {
  const parts: string[] = [];
  if (input.repoCount > 0) {
    parts.push(`${input.repoCount} ${input.repoCount === 1 ? "repo" : "repos"}`);
  }
  if (input.docCount > 0) {
    parts.push(`${input.docCount} ${input.docCount === 1 ? "doc" : "docs"}`);
  }
  if (parts.length === 0) return "No sources yet";
  return parts.join(" · ");
}

export function spaceHasSources(input: { repoCount: number; docCount: number }): boolean {
  return input.repoCount + input.docCount > 0;
}

export function spaceStatusLabel(status: "ready" | "indexing" | "error"): string {
  if (status === "indexing") return "Indexing";
  if (status === "error") return "Error";
  return "Ready";
}
