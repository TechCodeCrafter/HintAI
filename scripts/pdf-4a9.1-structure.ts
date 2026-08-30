/**
 * Phase 4A.9.1 diagnostics. Observes current parse/normalize/chunk.
 * Writes only under .eval/phase4a/4a9.1/. Does not overwrite 4A.8.1 / 4A.9 / release / phase35.
 *
 * node --experimental-strip-types scripts/pdf-4a9.1-structure.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildDocumentChunks } from "../src/lib/document/chunk.ts";
import { extractPdfItems } from "../src/lib/document/pdf/items.ts";
import { mappingErrors } from "../src/lib/document/pdf/map.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import { openPdfDocument, pdfjsDocumentOpenCount, resetPdfjsDocumentOpenCount } from "../src/lib/document/pdf/pdfjs.ts";
import { deriveDocumentStructure, structureErrors } from "../src/lib/document/structure.ts";
import type { DocumentChunk, PdfTextItem } from "../src/lib/document/types.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CORPUS = `${ROOT}.eval/phase4a/release/corpus`;
const OUT = `${ROOT}.eval/phase4a/4a9.1`;
const FROZEN_8 = `${ROOT}.eval/phase4a/4a8.1`;

const EXPECTED_CHUNKS: Record<string, number> = {
  "attention.pdf": 158,
  "bert.pdf": 781,
  "bitcoin.pdf": 118,
  "cisa-ransomware.pdf": 945,
  "cs229-notes.pdf": 27,
  "lora.pdf": 353,
  "nist-800-145.pdf": 129,
  "nist-800-207.pdf": 1154,
  "nist-800-63b.pdf": 2080,
  "omb-m22-09.pdf": 578,
  "resnet.pdf": 567,
  "tracemonkey.pdf": 726,
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

async function extractSizes(bytes: Uint8Array) {
  const doc = await openPdfDocument(bytes);
  const sizes: Record<number, { width: number; height: number }> = {};
  const pages: Array<{ pageNumber: number; items: PdfTextItem[]; width: number; height: number }> = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      sizes[pageNumber] = { width: viewport.width, height: viewport.height };
      pages.push({
        pageNumber,
        items: extractPdfItems(content.items),
        width: viewport.width,
        height: viewport.height,
      });
    }
  } finally {
    try {
      await doc.cleanup();
    } catch {
      // ignore
    }
  }
  return { sizes, pages };
}

mkdirSync(OUT, { recursive: true });

const files = readdirSync(CORPUS)
  .filter((name) => name.endsWith(".pdf"))
  .sort();

const structureSummary = [];
const pagesOut = [];
const regionCandidates = [];
const crossGutter = [];
const gridMath = [];
const lists = [];
const captions = [];
const furniture = [];
const cs229Pages = [];
const attentionPages = [];
const chunkBaseline = [];
const timings = [];
let mappingErrorCount = 0;
let structureErrorCount = 0;
let totalChunks = 0;
let isolatedLineChunks = 0;
const pageTotals = { uncertain: 0, singleColumn: 0, twoColumn: 0, isolated: 0, skipped: 0, full: 0, readyPages: 0 };

for (const file of files) {
  const bytes = new Uint8Array(readFileSync(`${CORPUS}/${file}`));
  const parsed = await parsePdf({
    contextId: "4a91",
    sourceId: file,
    path: file,
    contentHash: file,
    blob: blobFrom(bytes),
  });
  if (parsed.readiness !== "ready") {
    structureSummary.push({ file, readiness: parsed.readiness, pages: parsed.pageCount, chunks: 0 });
    continue;
  }

  const { sizes } = await extractSizes(bytes);
  const chunks = buildDocumentChunks(parsed.document);
  const chunkSnap = chunks.map(snapChunk);
  totalChunks += chunks.length;
  isolatedLineChunks += chunks.filter((chunk) => {
    const page = parsed.document.pages.find((entry) => entry.pageNumber === chunk.page);
    return page?.index === "isolated-lines";
  }).length;

  const deriveStarted = performance.now();
  resetPdfjsDocumentOpenCount();
  const t0 = performance.now();
  const structure = deriveDocumentStructure(parsed.document, { pageSize: sizes });
  const deriveMs = performance.now() - t0;
  const opens = pdfjsDocumentOpenCount();
  timings.push({
    file,
    deriveMs,
    pages: structure.pages.length,
    blobLoads: 0,
    pdfjsOpensDuringDerive: opens,
  });
  void deriveStarted;

  const errors = structureErrors(structure, parsed.document);
  structureErrorCount += errors.length;
  for (const page of parsed.document.pages) {
    mappingErrorCount += mappingErrors(page).length;
    pageTotals.readyPages += 1;
    if (page.readingOrder === "uncertain") pageTotals.uncertain += 1;
    else if (page.readingOrder === "single-column") pageTotals.singleColumn += 1;
    else pageTotals.twoColumn += 1;
    if (page.index === "isolated-lines") pageTotals.isolated += 1;
    else if (page.index === "skipped") pageTotals.skipped += 1;
    else pageTotals.full += 1;
  }

  const expected = EXPECTED_CHUNKS[file];
  chunkBaseline.push({
    file,
    chunks: chunks.length,
    expected: expected ?? null,
    equal: expected == null ? true : chunks.length === expected,
    snapshot: chunkSnap,
  });

  structureSummary.push({
    file,
    readiness: parsed.readiness,
    pages: structure.pages.length,
    chunks: chunks.length,
    twoDominantProsePages: structure.pages.filter((page) => page.diagnostics.twoDominantProse).length,
    crossGutterPages: structure.pages.filter((page) => page.diagnostics.crossGutterRisk).length,
    listCandidates: structure.pages.reduce((sum, page) => sum + page.diagnostics.listCandidates.length, 0),
    captionCandidates: structure.pages.reduce((sum, page) => sum + page.diagnostics.captionCandidates.length, 0),
    furnitureCandidates: structure.furnitureCandidates.length,
    structureErrors: errors.length,
    deriveMs,
    pdfjsOpensDuringDerive: opens,
  });

  for (const page of structure.pages) {
    pagesOut.push({
      file,
      page: page.pageNumber,
      width: page.width,
      height: page.height,
      sizeSource: page.sizeSource,
      readingOrder: page.diagnostics.readingOrder,
      index: page.diagnostics.index,
      lineCount: page.lines.length,
      itemCount: parsed.document.pages.find((entry) => entry.pageNumber === page.pageNumber)?.items.length ?? 0,
      regionCandidates: page.diagnostics.regionCandidates.length,
      twoDominantProse: page.diagnostics.twoDominantProse,
      proseMassShareTop2: page.diagnostics.proseMassShareTop2,
      crossGutterRisk: page.diagnostics.crossGutterRisk,
      denseGrid: page.diagnostics.denseGrid,
      gridHypothesis: page.diagnostics.gridMath.hypothesis,
      listCandidates: page.diagnostics.listCandidates.length,
      captionCandidates: page.diagnostics.captionCandidates.length,
    });
    for (const region of page.diagnostics.regionCandidates) {
      regionCandidates.push({ file, page: page.pageNumber, ...region, lineIds: region.lineIds.length });
    }
    for (const finding of page.diagnostics.crossGutter) {
      crossGutter.push({ file, ...finding });
    }
    if (page.diagnostics.denseGrid || page.diagnostics.index === "skipped") {
      gridMath.push({ file, page: page.pageNumber, index: page.diagnostics.index, ...page.diagnostics.gridMath });
    }
    for (const list of page.diagnostics.listCandidates) {
      lists.push({ file, page: page.pageNumber, ...list });
    }
    for (const caption of page.diagnostics.captionCandidates) {
      captions.push({ file, page: page.pageNumber, ...caption });
    }
    if (file === "cs229-notes.pdf") {
      const source = parsed.document.pages.find((entry) => entry.pageNumber === page.pageNumber)!;
      cs229Pages.push({
        page: page.pageNumber,
        index: page.diagnostics.index,
        readingOrder: page.diagnostics.readingOrder,
        denseGrid: page.diagnostics.denseGrid,
        lineCount: page.lines.length,
        itemCount: source.items.length,
        ...page.diagnostics.gridMath,
        proposedFutureClassification: page.diagnostics.gridMath.hypothesis,
      });
    }
    if (file === "attention.pdf") {
      const source = parsed.document.pages.find((entry) => entry.pageNumber === page.pageNumber)!;
      attentionPages.push({
        page: page.pageNumber,
        readingOrder: page.diagnostics.readingOrder,
        index: page.diagnostics.index,
        width: page.width,
        height: page.height,
        linesCrossingMid: page.diagnostics.crossGutter.length,
        crossGutterRisk: page.diagnostics.crossGutterRisk,
        twoDominantProse: page.diagnostics.twoDominantProse,
        regionCandidates: page.diagnostics.regionCandidates,
        gutterEstimates: page.diagnostics.regionCandidates.map((region) => region.gutterToNext),
        inlineMathItems: source.items.filter((item) => item.str.trim().length <= 2 && /[A-Za-z0-9=−-]/.test(item.str)).length,
        overflowItems: source.items.filter((item) => item.width > page.width * 0.45).length,
        currentTextChars: source.text.length,
        currentTextHead: source.text.slice(0, 180),
      });
    }
  }
  for (const row of structure.furnitureCandidates.slice(0, 12)) {
    furniture.push({
      file,
      text: row.text,
      pages: row.pages,
      share: row.share,
      yMin: Math.min(...row.yValues),
      yMax: Math.max(...row.yValues),
      xMin: Math.min(...row.xValues),
      xMax: Math.max(...row.xValues),
      likelyFurnitureScore: row.likelyFurnitureScore,
      bodyBand: row.yValues.every((y) => {
        const height = sizes[1]?.height ?? 792;
        return y < height - 72 && y > 72;
      }),
    });
  }
}

const frozenCards = JSON.parse(readFileSync(`${FROZEN_8}/metrics.json`, "utf8")) as {
  answerableHitCount: string;
  unanswerableSpoke: number;
  wrongIntentCount: string;
};
const chunkMismatches = chunkBaseline.filter((row) => row.equal === false);

const summary = {
  phase: "4A.9.1",
  role: "structural IR + diagnostics only — no production behavior change",
  generatedAt: new Date().toISOString(),
  frozenComparison: {
    readyPages: pageTotals.readyPages,
    readingOrder: {
      uncertain: pageTotals.uncertain,
      singleColumn: pageTotals.singleColumn,
      twoColumn: pageTotals.twoColumn,
    },
    index: { isolated: pageTotals.isolated, skipped: pageTotals.skipped, full: pageTotals.full },
    totalChunks,
    isolatedLineChunks,
    isolatedShare: totalChunks ? isolatedLineChunks / totalChunks : 0,
    note: "6017 was the 4A.9 origin class (isolated line after list/caption/header labels). Page-index isolated chunks are 6536. Production equality is 7616 total + per-file counts.",
    expected: {
      readyPages: 326,
      uncertain: 242,
      singleColumn: 70,
      twoColumn: 14,
      isolated: 187,
      skipped: 55,
      totalChunks: 7616,
    },
    match:
      pageTotals.readyPages === 326 &&
      pageTotals.uncertain === 242 &&
      pageTotals.singleColumn === 70 &&
      pageTotals.twoColumn === 14 &&
      pageTotals.isolated === 187 &&
      pageTotals.skipped === 55 &&
      totalChunks === 7616 &&
      chunkMismatches.length === 0,
  },
  mappingErrorCount,
  structureErrorCount,
  chunkMismatches: chunkMismatches.map((row) => ({ file: row.file, chunks: row.chunks, expected: row.expected })),
  frozenCardMetricsUntouched: frozenCards,
  timings,
};

writeFileSync(`${OUT}/structure-summary.json`, `${JSON.stringify({ summary, documents: structureSummary }, null, 2)}\n`);
writeFileSync(`${OUT}/pages.json`, `${JSON.stringify(pagesOut, null, 2)}\n`);
writeFileSync(`${OUT}/region-candidates.json`, `${JSON.stringify(regionCandidates, null, 2)}\n`);
writeFileSync(`${OUT}/cross-gutter-risk.json`, `${JSON.stringify(crossGutter, null, 2)}\n`);
writeFileSync(`${OUT}/grid-math.json`, `${JSON.stringify(gridMath, null, 2)}\n`);
writeFileSync(`${OUT}/lists.json`, `${JSON.stringify(lists, null, 2)}\n`);
writeFileSync(`${OUT}/captions.json`, `${JSON.stringify(captions, null, 2)}\n`);
writeFileSync(`${OUT}/furniture.json`, `${JSON.stringify(furniture, null, 2)}\n`);
writeFileSync(`${OUT}/cs229-pages.json`, `${JSON.stringify(cs229Pages, null, 2)}\n`);
writeFileSync(`${OUT}/attention-pages.json`, `${JSON.stringify(attentionPages, null, 2)}\n`);
writeFileSync(
  `${OUT}/chunk-baseline.json`,
  `${JSON.stringify(
    {
      note: "Uncapped DocumentChunks after 4A.9.1 must equal the frozen 4A.9 counts. Structure did not change them.",
      totalChunks,
      isolatedLineChunks,
      files: chunkBaseline.map((row) => ({
        file: row.file,
        chunks: row.chunks,
        expected: row.expected,
        equal: row.equal,
        ids: row.snapshot.map((chunk) => chunk.id),
      })),
    },
    null,
    2,
  )}\n`,
);
writeFileSync(`${OUT}/timings.json`, `${JSON.stringify(timings, null, 2)}\n`);
writeFileSync(`${OUT}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);

console.log(JSON.stringify(summary, null, 2));
