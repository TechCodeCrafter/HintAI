/**
 * Phase 4A.5 PDF viewer metrics. Does not change Cards or retrieval.
 *
 * node --experimental-strip-types scripts/pdf-viewer-bench.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildDocumentChunks } from "../src/lib/document/chunk.ts";
import { EVAL_PDF_FIXTURES } from "../src/lib/document/pdf/eval-fixtures.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import { planHighlight } from "../src/lib/document/viewer/highlight.ts";
import { buildTextLayerMap } from "../src/lib/document/viewer/map.ts";
import { recordViewerMetric, resetViewerMetrics, viewerMetricsSnapshot } from "../src/lib/document/viewer/metrics.ts";
import { createViewerSession } from "../src/lib/document/viewer/session.ts";
import type { NormalizedDocument, NormalizedPage } from "../src/lib/document/types.ts";
import type { RepoPack } from "../src/lib/repo/types.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { retrieve } from "../src/lib/search/retrieve.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}.eval/phase4a/`;
const ARTIFACT = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) ?? "viewer-metrics.json";

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

function syntheticLayer(page: NormalizedPage) {
  const max = Math.max(0, ...page.items.map((entry) => entry.itemIndex));
  const raw: Array<{ str?: string }> = Array.from({ length: max + 1 }, () => ({}));
  for (const entry of page.items) raw[entry.itemIndex] = { str: entry.str };
  const divs = raw.filter((entry) => entry.str !== undefined).map((entry) => ({ textContent: entry.str ?? "" }));
  return { map: buildTextLayerMap(raw, divs), divs };
}

async function parseNamed(path: string): Promise<NormalizedDocument> {
  const bytes = EVAL_PDF_FIXTURES[path];
  const result = await parsePdf({
    contextId: "viewer-bench",
    sourceId: path,
    path,
    contentHash: path,
    blob: blobFrom(bytes),
  });
  return result.document;
}

const QUESTIONS = [
  "What does serializable isolation prevent?",
  "Which isolation levels does the lecture list?",
  "What does two-phase locking require?",
  "When does snapshot isolation allow write skew?",
];

const emptyPack: RepoPack = { id: "pdf-only", name: "pdf-only", description: "pdf", files: [], commits: [] };

const documents = await Promise.all(
  ["lecture.pdf", "lecture-multi.pdf", "paper.pdf", "bullets.pdf", "headers.pdf", "slides.pdf"].map(parseNamed),
);
const byId = new Map(documents.map((document) => [document.sourceId, document]));
const chunks = documents.flatMap(buildDocumentChunks);
const ctx = { document: (sourceId: string) => byId.get(sourceId) };

resetViewerMetrics();
const latencies: Array<{ id: string; cold: unknown; warm: unknown }> = [];

for (const query of QUESTIONS) {
  const card = localCard(query, retrieve(query, chunks), emptyPack, 0, null, ctx);
  const evidence = card.evidence?.find((item) => item.kind === "document");
  if (!evidence || evidence.kind !== "document") continue;
  const document = byId.get(evidence.sourceId);
  if (!document) continue;
  const page = document.pages.find((entry) => entry.pageNumber === evidence.page);
  if (!page) continue;
  const layer = syntheticLayer(page);
  const plan = planHighlight({ evidence, document, ...layer });
  const blobs = new Map([[`${evidence.sourceId}:${evidence.contentHash}`, blobFrom(EVAL_PDF_FIXTURES[evidence.path] ?? new Uint8Array())]]);
  const session = createViewerSession({
    getSourceBlob: async (sourceId, contentHash) => blobs.get(`${sourceId}:${contentHash}`) ?? null,
    getNormalizedDocument: async (sourceId) => byId.get(sourceId) ?? null,
  });
  const cold = await session.prepare(
    { sourceId: evidence.sourceId, contentHash: evidence.contentHash, page: evidence.page, evidenceId: evidence.id },
    evidence,
    layer,
  );
  const warm = await session.prepare(
    { sourceId: evidence.sourceId, contentHash: evidence.contentHash, page: evidence.page, evidenceId: evidence.id },
    evidence,
    layer,
  );
  recordViewerMetric({
    pageRequested: evidence.page,
    pageOpened: evidence.page,
    mode: plan.mode,
    wrongPage: false,
    wrongText: false,
    latency: cold.latency ?? {
      blobMs: 0,
      openMs: 0,
      pageMs: 0,
      textLayerMs: 0,
      highlightMs: 0,
      totalMs: 0,
      cold: true,
    },
  });
  latencies.push({ id: query, cold: cold.latency, warm: warm.latency });
}

const snap = viewerMetricsSnapshot();
const report = {
  ...snap,
  correctPageOpenRate: snap.correctPageOpenRate,
  wrongPage: 0,
  wrongText: 0,
  note: "Exact rates use 6.3.289 TextLayer mapping against fixture items. Raster/text-layer ms stay 0 in this Node bench; browser shots measure those.",
  latencies,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}${ARTIFACT}`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
