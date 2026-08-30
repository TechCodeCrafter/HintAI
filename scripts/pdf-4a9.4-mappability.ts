/**
 * Phase 4A.9.4 pre-implementation mappability audit.
 * Observes 4A.9.3 DocumentBlocks. Does not change the chunker.
 *
 * node --experimental-strip-types scripts/pdf-4a9.4-mappability.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import { deriveDocumentStructure } from "../src/lib/document/structure.ts";
import type { DocumentBlock } from "../src/lib/document/blocks.ts";
import type { NormalizedPage } from "../src/lib/document/types.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CORPUS = `${ROOT}.eval/phase4a/release/corpus`;
const OUT = `${ROOT}.eval/phase4a/4a9.4`;

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

function rangeStatus(page: NormalizedPage, block: DocumentBlock): "valid" | "missing" | "invalid" {
  if (block.normStart === undefined || block.normEnd === undefined) return "missing";
  if (block.normStart < 0 || block.normEnd > page.text.length || block.normStart >= block.normEnd) return "invalid";
  const slice = page.text.slice(block.normStart, block.normEnd);
  if (slice.length === 0) return "invalid";
  return "valid";
}

mkdirSync(OUT, { recursive: true });

const files = readdirSync(CORPUS)
  .filter((name) => name.endsWith(".pdf"))
  .sort();

const byKind: Record<string, { total: number; valid: number; missing: number; invalid: number }> = {};
const byFile: Array<Record<string, unknown>> = [];
const focus = [
  "cs229-notes.pdf",
  "attention.pdf",
  "bert.pdf",
  "resnet.pdf",
  "tracemonkey.pdf",
  "nist-800-63b.pdf",
  "cisa-ransomware.pdf",
  "nist-800-145.pdf",
  "nist-800-207.pdf",
];

function bump(kind: string, status: "valid" | "missing" | "invalid") {
  const row = byKind[kind] ?? { total: 0, valid: 0, missing: 0, invalid: 0 };
  row.total += 1;
  row[status] += 1;
  byKind[kind] = row;
}

for (const file of files) {
  const bytes = new Uint8Array(readFileSync(`${CORPUS}/${file}`));
  const parsed = await parsePdf({
    contextId: "4a94-map",
    sourceId: file,
    path: file,
    contentHash: file,
    blob: blobFrom(bytes),
  });
  if (parsed.readiness !== "ready") {
    byFile.push({ file, readiness: parsed.readiness });
    continue;
  }
  const structure = deriveDocumentStructure(parsed.document);
  const kinds: Record<string, { total: number; valid: number; missing: number; invalid: number }> = {};
  let skippedPages = 0;
  let skippedWithMappedSearchable = 0;
  for (const page of structure.pages) {
    const source = parsed.document.pages.find((entry) => entry.pageNumber === page.pageNumber);
    if (!source) continue;
    if (source.index === "skipped") skippedPages += 1;
    let mappedSearchable = 0;
    for (const block of page.blocks) {
      const status = rangeStatus(source, block);
      bump(block.kind, status);
      const row = kinds[block.kind] ?? { total: 0, valid: 0, missing: 0, invalid: 0 };
      row.total += 1;
      row[status] += 1;
      kinds[block.kind] = row;
      if (
        status === "valid" &&
        (block.kind === "paragraph" || block.kind === "list" || block.kind === "list-item" || block.kind === "caption")
      ) {
        mappedSearchable += 1;
      }
    }
    if (source.index === "skipped" && mappedSearchable > 0) skippedWithMappedSearchable += 1;
  }
  byFile.push({
    file,
    pages: structure.pages.length,
    kinds,
    skippedPages,
    skippedWithMappedSearchable,
  });
}

const cs229 = byFile.find((row) => row.file === "cs229-notes.pdf");
const report = {
  phase: "4A.9.4",
  note: "Pre-implementation. A production chunk requires a valid contiguous page.text range. Missing ranges must not emit chunks.",
  byKind,
  focus: byFile.filter((row) => typeof row.file === "string" && focus.includes(row.file)),
  cs229,
};
writeFileSync(`${OUT}/block-mappability.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ byKind, cs229 }, null, 2));
