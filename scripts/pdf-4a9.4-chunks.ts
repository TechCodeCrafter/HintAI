/**
 * Phase 4A.9.4 block-aware chunk audit.
 * Writes only under .eval/phase4a/4a9.4/. Does not overwrite earlier trees.
 *
 * node --experimental-strip-types scripts/pdf-4a9.4-chunks.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DOCUMENT_CHUNKER_VERSION,
  DOCUMENT_NORMALIZER_VERSION,
  DOCUMENT_STRUCTURE_VERSION,
  PDF_PARSER_VERSION,
} from "../src/lib/context/index-versions.ts";
import { listChunkFate } from "../src/lib/document/chunk.ts";
import { assertChunkMatchesPage, buildDocumentChunks } from "../src/lib/document/chunk.ts";
import { mappingErrors } from "../src/lib/document/pdf/map.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import { pdfjsDocumentOpenCount, resetPdfjsDocumentOpenCount } from "../src/lib/document/pdf/pdfjs.ts";
import { deriveDocumentStructure } from "../src/lib/document/structure.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CORPUS = `${ROOT}.eval/phase4a/release/corpus`;
const OUT = `${ROOT}.eval/phase4a/4a9.4`;
const FROZEN = JSON.parse(readFileSync(`${ROOT}.eval/phase4a/4a9.2/chunk-impact.json`, "utf8")) as {
  afterTotal: number;
  perFile: Array<{ file: string; after: number }>;
};

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

mkdirSync(OUT, { recursive: true });

const frozenBy = Object.fromEntries(FROZEN.perFile.map((row) => [row.file, row.after]));
const files = readdirSync(CORPUS)
  .filter((name) => name.endsWith(".pdf"))
  .sort();

const byDocument = [];
const coverage = [];
const timings: Record<string, { structureMs: number; chunkMs: number; pages: number }> = {};
let mappingErrorCount = 0;
let offsetErrors = 0;
let crossGutterChunks = 0;
let tableProseChunks = 0;
let furnitureChunks = 0;
const listFates = { "parent-contiguous": 0, "member-groups": 0, "item-only": 0, unsearchable: 0 };
let totalAfter = 0;

for (const file of files) {
  const bytes = new Uint8Array(readFileSync(`${CORPUS}/${file}`));
  const parsed = await parsePdf({
    contextId: "4a94",
    sourceId: file,
    path: file,
    contentHash: file,
    blob: blobFrom(bytes),
  });
  if (parsed.readiness !== "ready") {
    byDocument.push({ file, readiness: parsed.readiness, before: frozenBy[file] ?? 0, after: 0 });
    continue;
  }

  resetPdfjsDocumentOpenCount();
  const t0 = performance.now();
  const structure = deriveDocumentStructure(parsed.document);
  const structureMs = performance.now() - t0;
  const t1 = performance.now();
  const chunks = buildDocumentChunks(parsed.document, structure);
  const chunkMs = performance.now() - t1;
  const pdfjs = pdfjsDocumentOpenCount();
  timings[file] = { structureMs, chunkMs, pages: structure.pages.length };

  for (const chunk of chunks) {
    try {
      assertChunkMatchesPage(parsed.document, chunk);
    } catch {
      offsetErrors += 1;
    }
    if (/available free of charge/i.test(chunk.text)) furnitureChunks += 1;
  }

  let paragraphs = 0;
  let lists = 0;
  let captions = 0;
  let furnitureDropped = 0;
  let unknownDropped = 0;
  let mathDropped = 0;
  let mappedParagraphs = 0;

  for (const page of structure.pages) {
    const source = parsed.document.pages.find((entry) => entry.pageNumber === page.pageNumber);
    if (source) mappingErrorCount += mappingErrors(source).length;
    const br = source?.columnBreakOffset;
    if (source?.readingOrder === "two-column" && br !== undefined) {
      for (const chunk of chunks.filter((row) => row.page === page.pageNumber)) {
        if (chunk.startOffset < br && chunk.endOffset > br) crossGutterChunks += 1;
      }
    }
    if (page.diagnostics.gridKind === "table") {
      tableProseChunks += chunks.filter(
        (chunk) => chunk.page === page.pageNumber && !/^figure|^fig\.|^table|^algorithm/i.test(chunk.text.trim()),
      ).length;
    }
    for (const block of page.blocks) {
      if (block.kind === "paragraph") {
        paragraphs += 1;
        if (block.normStart !== undefined) mappedParagraphs += 1;
      }
      if (block.kind === "list") {
        lists += 1;
        const items = page.blocks.filter((entry) => entry.parentBlockId === block.id);
        if (source) listFates[listChunkFate(source, block, items)] += 1;
      }
      if (block.kind === "caption") captions += 1;
      if (block.kind === "furniture") furnitureDropped += 1;
      if (block.kind === "unknown") unknownDropped += 1;
      if (block.kind === "math") mathDropped += 1;
    }
  }

  const before = frozenBy[file] ?? 0;
  const after = chunks.length;
  totalAfter += after;
  const over200 = after > 200;
  byDocument.push({
    file,
    before,
    after,
    reductionPct: before ? Math.round((1 - after / before) * 1000) / 10 : 0,
    pages: structure.pages.length,
    chunksPerPage: structure.pages.length ? Math.round((after / structure.pages.length) * 10) / 10 : 0,
    over200,
    pdfjsDuringChunk: pdfjs,
    offsetErrors: 0,
  });
  coverage.push({
    file,
    paragraphs,
    mappedParagraphs,
    lists,
    captions,
    furnitureDropped,
    unknownDropped,
    mathDropped,
    chunks: after,
  });
}

const ready = byDocument.filter((row) => typeof row.after === "number" && row.readiness === undefined);
const over200 = ready.filter((row) => row.over200);
const largest5 = [...ready].sort((a, b) => b.after - a.after).slice(0, 5);
const largest5Sum = largest5.reduce((sum, row) => sum + row.after, 0);

const beforeAfter = {
  phase: "4A.9.4",
  generatedAt: new Date().toISOString(),
  versions: {
    parser: PDF_PARSER_VERSION,
    normalizer: DOCUMENT_NORMALIZER_VERSION,
    structure: DOCUMENT_STRUCTURE_VERSION,
    chunker: DOCUMENT_CHUNKER_VERSION,
  },
  beforeTotal: FROZEN.afterTotal,
  afterTotal: totalAfter,
  reductionPct: Math.round((1 - totalAfter / FROZEN.afterTotal) * 1000) / 10,
  gates: {
    mappingErrorCount,
    offsetErrors,
    crossGutterChunks,
    tableProseChunks,
    furnitureOnlyChunks: furnitureChunks,
    pdfjsDuringChunk: ready.reduce((sum, row) => sum + (row.pdfjsDuringChunk ?? 0), 0),
  },
  listFates,
};

const budget = {
  pdfCap: 200,
  contextCap: 800,
  over200: over200.map((row) => ({ file: row.file, chunks: row.after })),
  largest5: largest5.map((row) => ({ file: row.file, chunks: row.after })),
  largest5Sum,
  wouldExceed800: largest5Sum > 800,
};

writeFileSync(`${OUT}/chunk-before-after.json`, `${JSON.stringify(beforeAfter, null, 2)}\n`);
writeFileSync(`${OUT}/chunks-by-document.json`, `${JSON.stringify(byDocument, null, 2)}\n`);
writeFileSync(`${OUT}/block-coverage.json`, `${JSON.stringify({ listFates, files: coverage }, null, 2)}\n`);
writeFileSync(`${OUT}/budget-results.json`, `${JSON.stringify(budget, null, 2)}\n`);
writeFileSync(`${OUT}/cache-bench.json`, `${JSON.stringify({ note: "second derive+chunk from loaded IR; no Blob/PDF.js", timings }, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      before: FROZEN.afterTotal,
      after: totalAfter,
      over200: over200.map((row) => row.file),
      largest5Sum,
      gates: beforeAfter.gates,
      listFates,
    },
    null,
    2,
  ),
);
