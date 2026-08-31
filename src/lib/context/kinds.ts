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
