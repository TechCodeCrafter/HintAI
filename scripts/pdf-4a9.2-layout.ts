/**
 * Phase 4A.9.2 layout audit. Writes only under .eval/phase4a/4a9.2/.
 * Does not overwrite 4A.9.1 / 4A.8.1 / 4A.9 / release / phase35.
 *
 * node --experimental-strip-types scripts/pdf-4a9.2-layout.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DOCUMENT_NORMALIZER_VERSION, DOCUMENT_STRUCTURE_VERSION } from "../src/lib/context/index-versions.ts";
import { buildDocumentChunks } from "../src/lib/document/chunk.ts";
import { extractPdfItems } from "../src/lib/document/pdf/items.ts";
import { detectReadingOrder, findDominantProseRegions, isTableLikeGrid } from "../src/lib/document/pdf/layout.ts";
import { mappingErrors } from "../src/lib/document/pdf/map.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import { openPdfDocument } from "../src/lib/document/pdf/pdfjs.ts";
import { classifyGridKind } from "../src/lib/document/pdf/prose-regions.ts";
import { deriveDocumentStructure, structureErrors } from "../src/lib/document/structure.ts";
import type { DocumentChunk, NormalizedPage, PdfTextItem } from "../src/lib/document/types.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CORPUS = `${ROOT}.eval/phase4a/release/corpus`;
const OUT = `${ROOT}.eval/phase4a/4a9.2`;
const FROZEN_91 = `${ROOT}.eval/phase4a/4a9.1`;

const FROZEN_CHUNKS: Record<string, number> = {
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

const MANUAL: Record<string, Array<{ page: number; expected: string; note: string }>> = {
  "attention.pdf": [
    { page: 1, expected: "uncertain", note: "title page" },
    { page: 2, expected: "two-column|uncertain", note: "false single-column in 4A.9.1" },
    { page: 3, expected: "two-column|uncertain", note: "false single-column in 4A.9.1" },
    { page: 7, expected: "two-column|uncertain", note: "false single-column in 4A.9.1" },
    { page: 10, expected: "two-column|uncertain", note: "false single-column in 4A.9.1" },
    { page: 11, expected: "two-column|uncertain", note: "false single-column in 4A.9.1" },
    { page: 12, expected: "two-column|uncertain", note: "false single-column in 4A.9.1" },
  ],
  "bert.pdf": [
    { page: 2, expected: "two-column", note: "body" },
    { page: 3, expected: "two-column", note: "body" },
    { page: 4, expected: "two-column", note: "body" },
    { page: 5, expected: "two-column", note: "body" },
  ],
  "resnet.pdf": [
    { page: 2, expected: "two-column", note: "body" },
    { page: 3, expected: "two-column", note: "body" },
    { page: 4, expected: "two-column|uncertain", note: "body" },
    { page: 5, expected: "two-column", note: "body" },
  ],
  "tracemonkey.pdf": [
    { page: 2, expected: "two-column|uncertain", note: "body" },
    { page: 3, expected: "two-column|uncertain", note: "body" },
    { page: 4, expected: "two-column|uncertain", note: "body" },
  ],
  "cs229-notes.pdf": [
    { page: 1, expected: "single-column|uncertain|skipped", note: "formerly skipped math" },
    { page: 2, expected: "single-column|two-column|uncertain|skipped", note: "formerly skipped math" },
    { page: 3, expected: "single-column|two-column|uncertain|skipped", note: "formerly skipped math" },
    { page: 4, expected: "single-column|two-column|uncertain|skipped", note: "formerly skipped math" },
    { page: 8, expected: "single-column|two-column|uncertain|skipped", note: "formerly skipped math" },
    { page: 14, expected: "uncertain|single-column|two-column", note: "only previously indexed page" },
    { page: 25, expected: "single-column|uncertain|skipped", note: "formerly skipped math" },
    { page: 26, expected: "single-column|uncertain|skipped", note: "formerly skipped math" },
  ],
  "nist-800-63b.pdf": [
    { page: 2, expected: "single-column|two-column|uncertain", note: "normal prose" },
    { page: 10, expected: "single-column|two-column|uncertain|skipped", note: "representative" },
  ],
};

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

function expectedOk(expected: string, actual: string): boolean {
  return expected.split("|").includes(actual);
}

function lineJoinsRegions(page: NormalizedPage, items: PdfTextItem[], pageWidth: number): boolean {
  const mid = pageWidth / 2;
  const analysis = findDominantProseRegions(items, pageWidth);
  if (!analysis.splitX) return false;
  const layout = detectReadingOrder(items, pageWidth);
  for (const line of [...layout.left, ...layout.right, ...layout.lines]) {
    const left = line.items.some((entry) => entry.transform[4] < (analysis.splitX ?? mid) - 8);
    const right = line.items.some((entry) => entry.transform[4] > (analysis.splitX ?? mid) + 8);
    if (left && right) return true;
  }
  void page;
  return false;
}

mkdirSync(OUT, { recursive: true });

const beforePages = JSON.parse(readFileSync(`${FROZEN_91}/pages.json`, "utf8")) as Array<{
  file: string;
  page: number;
  readingOrder: string;
  index: string;
}>;
const beforeByKey = new Map(beforePages.map((row) => [`${row.file}:${row.page}`, row]));

const files = readdirSync(CORPUS)
  .filter((name) => name.endsWith(".pdf"))
  .sort();

const layoutRows = [];
const attentionAudit = [];
const bertAudit = [];
const resnetAudit = [];
const tmAudit = [];
const cs229Audit = [];
const gridMathAudit = [];
const manualAudit = [];
let mappingErrorCount = 0;
let structureErrorCount = 0;
let crossGutterJoins = 0;
let falseSingle = 0;
let tableFlattened = 0;
const totals = {
  readyPages: 0,
  uncertain: 0,
  singleColumn: 0,
  twoColumn: 0,
  isolated: 0,
  skipped: 0,
  full: 0,
  chunks: 0,
  isolatedChunks: 0,
};
const perFileChunks: Array<{ file: string; before: number; after: number }> = [];

for (const file of files) {
  const bytes = new Uint8Array(readFileSync(`${CORPUS}/${file}`));
  const parsed = await parsePdf({
    contextId: "4a92",
    sourceId: file,
    path: file,
    contentHash: file,
    blob: blobFrom(bytes),
  });
  if (parsed.readiness !== "ready") {
    layoutRows.push({ file, readiness: parsed.readiness, pages: parsed.pageCount });
    continue;
  }

  const doc = await openPdfDocument(bytes);
  const sizes: Record<number, { width: number; height: number }> = {};
  const rawPages: Array<{ pageNumber: number; items: PdfTextItem[]; width: number; height: number }> = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      sizes[pageNumber] = { width: viewport.width, height: viewport.height };
      rawPages.push({
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

  const structure = deriveDocumentStructure(parsed.document, { pageSize: sizes });
  structureErrorCount += structureErrors(structure, parsed.document).length;

  const chunks = buildDocumentChunks(parsed.document);
  totals.chunks += chunks.length;
  const isolatedChunks = chunks.filter((chunk: DocumentChunk) => {
    const source = parsed.document.pages.find((page) => page.pageNumber === chunk.page);
    return source?.index === "isolated-lines";
  }).length;
  totals.isolatedChunks += isolatedChunks;
  perFileChunks.push({ file, before: FROZEN_CHUNKS[file] ?? 0, after: chunks.length });

  for (const page of parsed.document.pages) {
    totals.readyPages += 1;
    if (page.readingOrder === "uncertain") totals.uncertain += 1;
    else if (page.readingOrder === "single-column") totals.singleColumn += 1;
    else totals.twoColumn += 1;
    if (page.index === "isolated-lines") totals.isolated += 1;
    else if (page.index === "skipped") totals.skipped += 1;
    else totals.full += 1;

    const raw = rawPages.find((entry) => entry.pageNumber === page.pageNumber);
    const items = raw?.items ?? page.items;
    const width = raw?.width ?? sizes[page.pageNumber]?.width ?? 612;
    const errors = mappingErrors(page);
    mappingErrorCount += errors.length;
    const analysis = findDominantProseRegions(items, width);
    const joined = lineJoinsRegions(page, items, width);
    if (joined) crossGutterJoins += 1;
    const before = beforeByKey.get(`${file}:${page.pageNumber}`);
    const wasFalseSingle =
      file === "attention.pdf" &&
      before?.readingOrder === "single-column" &&
      analysis.crossGutterRisk &&
      page.readingOrder === "single-column";
    if (wasFalseSingle) falseSingle += 1;
    if (isTableLikeGrid(items) && page.index !== "skipped") tableFlattened += 1;

    const row = {
      file,
      page: page.pageNumber,
      beforeReadingOrder: before?.readingOrder ?? null,
      afterReadingOrder: page.readingOrder,
      beforeIndex: before?.index ?? null,
      afterIndex: page.index,
      twoDominantProse: analysis.twoDominantProse,
      refuseSingleColumn: analysis.refuseSingleColumn,
      widthDistrust: analysis.widthDistrust,
      crossGutterRisk: analysis.crossGutterRisk,
      gridKind: classifyGridKind(items),
      mappingErrors: errors.length,
      crossGutterJoin: joined,
      tableFlattened: isTableLikeGrid(items) && page.index !== "skipped",
      textChars: page.text.length,
    };
    layoutRows.push(row);

    const spec = MANUAL[file]?.find((entry) => entry.page === page.pageNumber);
    if (spec) {
      const actual = page.index === "skipped" ? "skipped" : page.readingOrder;
      manualAudit.push({
        file,
        page: page.pageNumber,
        expected: spec.expected,
        actual,
        expectedOk: expectedOk(spec.expected, actual),
        crossGutterJoin: joined ? "yes" : "no",
        tableFlattened: isTableLikeGrid(items) && page.index !== "skipped" ? "yes" : "no",
        mappingValid: errors.length === 0 ? "yes" : "no",
        note: spec.note,
      });
    }

    if (file === "attention.pdf") attentionAudit.push(row);
    if (file === "bert.pdf") bertAudit.push(row);
    if (file === "resnet.pdf") resnetAudit.push(row);
    if (file === "tracemonkey.pdf") tmAudit.push(row);
    if (file === "cs229-notes.pdf") {
      cs229Audit.push({
        ...row,
        hypothesis: structure.pages.find((entry) => entry.pageNumber === page.pageNumber)?.diagnostics.gridMath.hypothesis,
      });
    }
    if (analysis.gridKind !== "none" || before?.index === "skipped") {
      gridMathAudit.push({
        file,
        page: page.pageNumber,
        gridKind: analysis.gridKind,
        afterIndex: page.index,
        beforeIndex: before?.index ?? null,
        denseGeometric: structure.pages.find((entry) => entry.pageNumber === page.pageNumber)?.diagnostics.denseGrid ?? false,
      });
    }
  }
}

const over200 = perFileChunks.filter((row) => row.after > 200);
const largest5 = [...perFileChunks].sort((a, b) => b.after - a.after).slice(0, 5);
const beforeTotal = Object.values(FROZEN_CHUNKS).reduce((sum, n) => sum + n, 0);

const layoutBeforeAfter = {
  phase: "4A.9.2",
  generatedAt: new Date().toISOString(),
  normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
  structureVersion: DOCUMENT_STRUCTURE_VERSION,
  frozen91: {
    readyPages: 326,
    uncertain: 242,
    singleColumn: 70,
    twoColumn: 14,
    isolated: 187,
    skipped: 55,
    full: 84,
    chunks: 7616,
  },
  after: totals,
  gates: {
    mappingErrorCount,
    structureErrorCount,
    crossGutterJoins,
    falseSingleColumnOnAttentionRisk: falseSingle,
    tableFlattened,
  },
  pages: layoutRows,
};

const chunkReport = {
  phase: "4A.9.2",
  note: "Chunk rules unchanged. Counts may move because page.text / readingOrder changed.",
  beforeTotal,
  afterTotal: totals.chunks,
  isolatedShare: totals.chunks ? totals.isolatedChunks / totals.chunks : 0,
  perFile: perFileChunks,
  pdfsOver200: over200.map((row) => row.file),
  largest5: largest5.map((row) => ({ file: row.file, chunks: row.after })),
  largest5Sum: largest5.reduce((sum, row) => sum + row.after, 0),
  contextCap: 800,
};

writeFileSync(`${OUT}/layout-before-after.json`, `${JSON.stringify(layoutBeforeAfter, null, 2)}\n`);
writeFileSync(`${OUT}/attention-audit.json`, `${JSON.stringify(attentionAudit, null, 2)}\n`);
writeFileSync(`${OUT}/bert-audit.json`, `${JSON.stringify(bertAudit, null, 2)}\n`);
writeFileSync(`${OUT}/resnet-audit.json`, `${JSON.stringify(resnetAudit, null, 2)}\n`);
writeFileSync(`${OUT}/tracemonkey-audit.json`, `${JSON.stringify(tmAudit, null, 2)}\n`);
writeFileSync(`${OUT}/cs229-audit.json`, `${JSON.stringify(cs229Audit, null, 2)}\n`);
writeFileSync(`${OUT}/grid-math-audit.json`, `${JSON.stringify(gridMathAudit, null, 2)}\n`);
writeFileSync(`${OUT}/chunk-impact.json`, `${JSON.stringify(chunkReport, null, 2)}\n`);
writeFileSync(`${OUT}/manual-audit.json`, `${JSON.stringify(manualAudit, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      totals,
      gates: layoutBeforeAfter.gates,
      chunks: { before: beforeTotal, after: totals.chunks, over200: over200.length, largest5Sum: chunkReport.largest5Sum },
      cs229skipped: cs229Audit.filter((row) => row.afterIndex === "skipped").length,
      attentionSingle: attentionAudit.filter((row) => row.afterReadingOrder === "single-column").length,
      bertTwo: bertAudit.filter((row) => row.afterReadingOrder === "two-column").length,
      resnetTwo: resnetAudit.filter((row) => row.afterReadingOrder === "two-column").length,
      tmTwo: tmAudit.filter((row) => row.afterReadingOrder === "two-column").length,
    },
    null,
    2,
  ),
);
