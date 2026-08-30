/**
 * Phase 4A.9.3 block reconstruction audit.
 * Writes only under .eval/phase4a/4a9.3/. Does not overwrite earlier trees.
 *
 * node --experimental-strip-types scripts/pdf-4a9.3-blocks.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DOCUMENT_CHUNKER_VERSION,
  DOCUMENT_NORMALIZER_VERSION,
  DOCUMENT_STRUCTURE_VERSION,
  PDF_PARSER_VERSION,
} from "../src/lib/context/index-versions.ts";
import { LIST_MARKER, projectChunkUnits } from "../src/lib/document/blocks.ts";
import { buildDocumentChunks } from "../src/lib/document/chunk.ts";
import { mappingErrors } from "../src/lib/document/pdf/map.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import { openPdfDocument, pdfjsDocumentOpenCount, resetPdfjsDocumentOpenCount } from "../src/lib/document/pdf/pdfjs.ts";
import { deriveDocumentStructure, structureErrors } from "../src/lib/document/structure.ts";
import type { DocumentChunk } from "../src/lib/document/types.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CORPUS = `${ROOT}.eval/phase4a/release/corpus`;
const OUT = `${ROOT}.eval/phase4a/4a9.3`;
const FROZEN_92 = `${ROOT}.eval/phase4a/4a9.2/chunk-impact.json`;

const FROZEN_CHUNKS = Object.fromEntries(
  (
    JSON.parse(readFileSync(FROZEN_92, "utf8")) as {
      perFile: Array<{ file: string; after: number }>;
    }
  ).perFile.map((row) => [row.file, row.after]),
) as Record<string, number>;

const MANUAL_PAGES: Record<string, number[]> = {
  "bert.pdf": [2, 3, 4, 5],
  "resnet.pdf": [2, 3, 4, 5],
  "tracemonkey.pdf": [2, 3, 4, 5],
  "attention.pdf": [2, 3, 7, 10, 11],
  "cs229-notes.pdf": [1, 2, 3, 4, 5, 8, 10, 14, 25, 26],
  "nist-800-63b.pdf": [],
  "cisa-ransomware.pdf": [],
  "nist-800-145.pdf": [2, 3],
  "nist-800-207.pdf": [2, 3],
};

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

function snapChunk(chunk: DocumentChunk) {
  return {
    id: chunk.id,
    page: chunk.page,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    text: chunk.text,
    readingOrder: chunk.readingOrder,
    heading: chunk.heading ?? null,
    contentHash: chunk.contentHash,
  };
}

function kindCounts(blocks: Array<{ kind: string }>) {
  const counts: Record<string, number> = {};
  for (const block of blocks) counts[block.kind] = (counts[block.kind] ?? 0) + 1;
  return counts;
}

function pageSummary(page: {
  pageNumber: number;
  lines: Array<{ id: string; features: { text: string; bulletPrefix: boolean } }>;
  blocks: Array<{
    id: string;
    kind: string;
    page: number;
    regionId?: string;
    lineIds: string[];
    itemIndexes: number[];
    normStart?: number;
    normEnd?: number;
    parentBlockId?: string;
  }>;
  diagnostics: { gridKind: string; listCandidates: unknown[]; captionCandidates: unknown[] };
  regions: unknown[];
}) {
  const listLike = page.lines.filter((line) => LIST_MARKER.test(line.features.text) || line.features.bulletPrefix);
  const assignedListLike = listLike.filter((line) =>
    page.blocks.some((block) => (block.kind === "list" || block.kind === "list-item") && block.lineIds.includes(line.id)),
  );
  return {
    page: page.pageNumber,
    lines: page.lines.length,
    regions: page.regions.length,
    gridKind: page.diagnostics.gridKind,
    blocks: page.blocks.length,
    kinds: kindCounts(page.blocks),
    listLikeLines: listLike.length,
    listBlocks: page.blocks.filter((block) => block.kind === "list").length,
    listItemBlocks: page.blocks.filter((block) => block.kind === "list-item").length,
    unassignedListLike: listLike.length - assignedListLike.length,
    captions: page.blocks.filter((block) => block.kind === "caption").length,
    furniture: page.blocks.filter((block) => block.kind === "furniture").length,
    math: page.blocks.filter((block) => block.kind === "math").length,
    paragraphs: page.blocks.filter((block) => block.kind === "paragraph").length,
    headings: page.blocks.filter((block) => block.kind === "heading").length,
    unknown: page.blocks.filter((block) => block.kind === "unknown").length,
  };
}

function blockPreview(
  pageText: string,
  block: { kind: string; lineIds: string[]; normStart?: number; normEnd?: number; regionId?: string; parentBlockId?: string },
  lines: Array<{ id: string; features: { text: string } }>,
) {
  const slice =
    block.normStart !== undefined && block.normEnd !== undefined
      ? pageText.slice(block.normStart, block.normEnd)
      : lines
          .filter((line) => block.lineIds.includes(line.id))
          .map((line) => line.features.text)
          .join(" / ");
  return {
    kind: block.kind,
    regionId: block.regionId ?? null,
    parent: block.parentBlockId ?? null,
    lines: block.lineIds.length,
    mapped: block.normStart !== undefined,
    text: slice.slice(0, 180),
  };
}

mkdirSync(OUT, { recursive: true });

const files = readdirSync(CORPUS)
  .filter((name) => name.endsWith(".pdf"))
  .sort();

const byDocument = [];
const attentionPages = [];
const cs229Pages = [];
const paragraphAudit = [];
const listAudit = [];
const mathAudit = [];
const captionAudit = [];
const furnitureAudit = [];
const manualAudit = [];
const timings: Record<string, { regionMs: number; blockMs: number; totalMs: number; pages: number }> = {};
const chunkRows = [];
let mappingErrorCount = 0;
let structureErrorCount = 0;
let reconstructionErrorCount = 0;
let crossRegionBlocks = 0;
let crossPageBlocks = 0;
let tableFlattened = 0;
let invalidItemRefs = 0;
let projectedTotal = 0;
const projectedPerFile: Array<{ file: string; production: number; projected: number }> = [];

for (const file of files) {
  const bytes = new Uint8Array(readFileSync(`${CORPUS}/${file}`));
  const parsed = await parsePdf({
    contextId: "4a93",
    sourceId: file,
    path: file,
    contentHash: file,
    blob: blobFrom(bytes),
  });
  if (parsed.readiness !== "ready") {
    byDocument.push({ file, readiness: parsed.readiness, pages: parsed.pageCount });
    continue;
  }

  const doc = await openPdfDocument(bytes);
  const sizes: Record<number, { width: number; height: number }> = {};
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      sizes[pageNumber] = { width: viewport.width, height: viewport.height };
    }
  } finally {
    try {
      await doc.cleanup();
    } catch {
      // ignore
    }
  }

  const t0 = performance.now();
  resetPdfjsDocumentOpenCount();
  const structure = deriveDocumentStructure(parsed.document, { pageSize: sizes });
  const totalMs = performance.now() - t0;
  const pdfjsDuring = pdfjsDocumentOpenCount();

  const errors = structureErrors(structure, parsed.document);
  structureErrorCount += errors.length;

  const chunks = buildDocumentChunks(parsed.document);
  chunkRows.push({
    file,
    frozen92: FROZEN_CHUNKS[file] ?? null,
    after: chunks.length,
    equal: chunks.length === (FROZEN_CHUNKS[file] ?? -1),
    snap: chunks.slice(0, 2).concat(chunks.slice(-1)).map(snapChunk),
  });

  let fileProjected = 0;
  const pageRows = [];
  const fileKinds: Record<string, number> = {};
  let listLike = 0;
  let listBlocks = 0;
  let listItems = 0;
  let unassignedListLike = 0;

  for (const page of structure.pages) {
    const source = parsed.document.pages.find((entry) => entry.pageNumber === page.pageNumber);
    mappingErrorCount += source ? mappingErrors(source).length : 1;
    const summary = pageSummary(page);
    pageRows.push(summary);
    listLike += summary.listLikeLines;
    listBlocks += summary.listBlocks;
    listItems += summary.listItemBlocks;
    unassignedListLike += summary.unassignedListLike;
    for (const [kind, n] of Object.entries(summary.kinds)) fileKinds[kind] = (fileKinds[kind] ?? 0) + n;
    fileProjected += projectChunkUnits(page.blocks);
    if (page.diagnostics.gridKind === "table") {
      const prose = page.blocks.filter((block) => block.kind === "paragraph" || block.kind === "list" || block.kind === "math");
      tableFlattened += prose.length;
    }
    for (const block of page.blocks) {
      if (block.page !== page.pageNumber) crossPageBlocks += 1;
      const lineLefts = block.lineIds
        .map((id) => page.lines.find((line) => line.id === id)?.left)
        .filter((left): left is number => left !== undefined);
      if (
        block.kind !== "unknown" &&
        lineLefts.some((left) => left < page.width / 2 - 14) &&
        lineLefts.some((left) => left > page.width / 2 + 14)
      ) {
        crossRegionBlocks += 1;
      }
      if (source) {
        for (const itemIndex of block.itemIndexes) {
          if (!source.items.some((item) => item.itemIndex === itemIndex)) invalidItemRefs += 1;
        }
        if (block.normStart !== undefined && block.normEnd !== undefined) {
          const slice = source.text.slice(block.normStart, block.normEnd);
          if (slice.length === 0 && block.kind !== "unknown") reconstructionErrorCount += 1;
        }
      }
    }

    const wanted = new Set(MANUAL_PAGES[file] ?? []);
    if (wanted.has(page.pageNumber) && source) {
      manualAudit.push({
        file,
        ...summary,
        previews: page.blocks.slice(0, 18).map((block) => blockPreview(source.text, block, page.lines)),
      });
    }
    if (file === "attention.pdf") {
      attentionPages.push({
        ...summary,
        readingOrder: source?.readingOrder ?? null,
        index: source?.index ?? null,
        twoDominantProse: page.diagnostics.twoDominantProse,
        widthDistrust: page.diagnostics.widthDistrust,
      });
    }
    if (file === "cs229-notes.pdf") {
      cs229Pages.push({
        ...summary,
        readingOrder: source?.readingOrder ?? null,
        index: source?.index ?? null,
        hypothesis: page.diagnostics.gridMath.hypothesis,
        unassignedLines: page.lines.filter((line) => !page.blocks.some((block) => block.lineIds.includes(line.id))).length,
      });
    }
  }

  projectedTotal += fileProjected;
  projectedPerFile.push({ file, production: chunks.length, projected: fileProjected });
  timings[file] = { regionMs: 0, blockMs: 0, totalMs, pages: structure.pages.length };

  const furnitureHits = structure.furnitureCandidates
    .filter((row) => row.pages >= 3 && (row.share >= 0.4 || /available free of charge|nist sp /i.test(row.text)))
    .slice(0, 10);
  byDocument.push({
    file,
    pages: structure.pages.length,
    kinds: fileKinds,
    listLikeLines: listLike,
    listBlocks,
    listItemBlocks: listItems,
    unassignedListLike,
    furnitureMarked: structure.pages.reduce((sum, page) => sum + page.blocks.filter((block) => block.kind === "furniture").length, 0),
    furnitureCandidates: structure.furnitureCandidates.length,
    projected: fileProjected,
    productionChunks: chunks.length,
    pdfjsDuringDerive: pdfjsDuring,
    structureErrors: errors.length,
  });

  if (file === "nist-800-63b.pdf" || file === "cisa-ransomware.pdf") {
    const heavy = [...pageRows].sort((a, b) => b.listLikeLines - a.listLikeLines).slice(0, 4);
    listAudit.push({ file, listLike, listBlocks, listItems, unassignedListLike, heavyPages: heavy });
    for (const row of heavy) {
      const page = structure.pages.find((entry) => entry.pageNumber === row.page);
      const source = parsed.document.pages.find((entry) => entry.pageNumber === row.page);
      if (page && source) {
        manualAudit.push({
          file,
          ...row,
          previews: page.blocks
            .filter((block) => block.kind === "list" || block.kind === "list-item" || block.kind === "paragraph")
            .slice(0, 16)
            .map((block) => blockPreview(source.text, block, page.lines)),
        });
      }
    }
  }
  if (file === "nist-800-145.pdf" || file === "nist-800-207.pdf" || file === "nist-800-63b.pdf") {
    furnitureAudit.push({
      file,
      marked: structure.pages.reduce((sum, page) => sum + page.blocks.filter((block) => block.kind === "furniture").length, 0),
      candidates: furnitureHits.map((row) => ({
        text: row.text.slice(0, 140),
        pages: row.pages,
        share: row.share,
        y: row.yValues.slice(0, 4),
      })),
    });
  }
  if (file === "cs229-notes.pdf") {
    mathAudit.push({
      file,
      pages: cs229Pages,
      mathBlocks: fileKinds.math ?? 0,
      paragraphs: fileKinds.paragraph ?? 0,
      unknown: fileKinds.unknown ?? 0,
    });
  }
  if (file === "bert.pdf" || file === "resnet.pdf" || file === "tracemonkey.pdf") {
    paragraphAudit.push({
      file,
      paragraphs: fileKinds.paragraph ?? 0,
      lists: fileKinds.list ?? 0,
      captions: fileKinds.caption ?? 0,
      unknown: fileKinds.unknown ?? 0,
    });
  }
  captionAudit.push({
    file,
    captions: fileKinds.caption ?? 0,
    captionCandidates: structure.pages.reduce((sum, page) => sum + page.diagnostics.captionCandidates.length, 0),
  });

  if (["bert.pdf", "attention.pdf", "cs229-notes.pdf", "nist-800-63b.pdf", "cisa-ransomware.pdf", "nist-800-145.pdf"].includes(file)) {
    const t1 = performance.now();
    deriveDocumentStructure(parsed.document, { pageSize: sizes });
    timings[file].blockMs = performance.now() - t1;
    timings[file].regionMs = timings[file].totalMs;
  }

}

const productionTotal = chunkRows.reduce((sum, row) => sum + row.after, 0);
const frozenTotal = Object.values(FROZEN_CHUNKS).reduce((sum, n) => sum + n, 0);
const over200 = projectedPerFile.filter((row) => row.projected > 200);
const largest5 = [...projectedPerFile].sort((a, b) => b.projected - a.projected).slice(0, 5);

const summary = {
  phase: "4A.9.3",
  generatedAt: new Date().toISOString(),
  versions: {
    parser: PDF_PARSER_VERSION,
    normalizer: DOCUMENT_NORMALIZER_VERSION,
    structure: DOCUMENT_STRUCTURE_VERSION,
    chunker: DOCUMENT_CHUNKER_VERSION,
  },
  documents: byDocument.length,
  kinds: byDocument.reduce((acc: Record<string, number>, row) => {
    for (const [kind, n] of Object.entries(row.kinds ?? {})) acc[kind] = (acc[kind] ?? 0) + n;
    return acc;
  }, {}),
  listLikeLines: byDocument.reduce((sum, row) => sum + (row.listLikeLines ?? 0), 0),
  listBlocks: byDocument.reduce((sum, row) => sum + (row.listBlocks ?? 0), 0),
  listItemBlocks: byDocument.reduce((sum, row) => sum + (row.listItemBlocks ?? 0), 0),
  unassignedListLike: byDocument.reduce((sum, row) => sum + (row.unassignedListLike ?? 0), 0),
  gates: {
    mappingErrorCount,
    structureErrorCount,
    reconstructionErrorCount,
    crossRegionBlocks,
    crossPageBlocks,
    tableFlattened,
    invalidItemRefs,
    productionChunks: productionTotal,
    frozen92Chunks: frozenTotal,
    chunkerUnchanged: DOCUMENT_CHUNKER_VERSION === 1,
    pdfjsDuringDerive: byDocument.reduce((sum, row) => sum + (row.pdfjsDuringDerive ?? 0), 0),
  },
};

const chunkEquality = {
  phase: "4A.9.3",
  note: "Production buildDocumentChunks must match accepted 4A.9.2 counts. Chunker version unchanged.",
  frozenTotal,
  afterTotal: productionTotal,
  equal: productionTotal === frozenTotal && chunkRows.every((row) => row.equal),
  perFile: chunkRows.map((row) => ({ file: row.file, frozen92: row.frozen92, after: row.after, equal: row.equal })),
};

const projected = {
  phase: "4A.9.3",
  note: "Diagnostic only. Furniture/unknown/unmapped math contribute 0. Not stored. Do not treat as a 4A.9.4 commitment.",
  productionTotal,
  projectedTotal,
  perFile: projectedPerFile,
  pdfsOver200: over200.map((row) => row.file),
  largest5: largest5.map((row) => ({ file: row.file, projected: row.projected })),
  largest5Sum: largest5.reduce((sum, row) => sum + row.projected, 0),
  contextCap: 800,
  pdfCap: 200,
};

writeFileSync(`${OUT}/blocks-summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(`${OUT}/blocks-by-document.json`, `${JSON.stringify(byDocument, null, 2)}\n`);
writeFileSync(`${OUT}/paragraph-audit.json`, `${JSON.stringify({ pages: manualAudit.filter((row) => /bert|resnet|tracemonkey/.test(row.file)), files: paragraphAudit }, null, 2)}\n`);
writeFileSync(`${OUT}/list-audit.json`, `${JSON.stringify(listAudit, null, 2)}\n`);
writeFileSync(`${OUT}/math-audit.json`, `${JSON.stringify(mathAudit, null, 2)}\n`);
writeFileSync(`${OUT}/caption-audit.json`, `${JSON.stringify(captionAudit, null, 2)}\n`);
writeFileSync(`${OUT}/furniture-audit.json`, `${JSON.stringify(furnitureAudit, null, 2)}\n`);
writeFileSync(`${OUT}/attention-blocks.json`, `${JSON.stringify(attentionPages, null, 2)}\n`);
writeFileSync(`${OUT}/cs229-blocks.json`, `${JSON.stringify(cs229Pages, null, 2)}\n`);
writeFileSync(`${OUT}/projected-chunks.json`, `${JSON.stringify(projected, null, 2)}\n`);
writeFileSync(`${OUT}/chunk-equality.json`, `${JSON.stringify(chunkEquality, null, 2)}\n`);
writeFileSync(`${OUT}/manual-audit.json`, `${JSON.stringify(manualAudit, null, 2)}\n`);
writeFileSync(`${OUT}/timings.json`, `${JSON.stringify({ timings, note: "blockMs is a second derive from the already-loaded NormalizedDocument" }, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      summary: summary.kinds,
      gates: summary.gates,
      projected: { total: projectedTotal, over200: over200.length, largest5Sum: projected.largest5Sum },
      chunks: { frozen: frozenTotal, after: productionTotal, equal: chunkEquality.equal },
    },
    null,
    2,
  ),
);
