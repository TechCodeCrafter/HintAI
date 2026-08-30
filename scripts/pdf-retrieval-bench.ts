/**
 * Phase 4A.3 PDF retrieval benchmark. Retrieval candidates only — no Cards.
 *
 * node --experimental-strip-types scripts/pdf-retrieval-bench.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { indexContext } from "../src/lib/context/chunk-index.ts";
import {
  DOCUMENT_CHUNKER_VERSION,
  DOCUMENT_NORMALIZER_VERSION,
  PDF_PARSER_VERSION,
} from "../src/lib/context/index-versions.ts";
import { createMemoryRepository } from "../src/lib/context/memory.ts";
import { isPdfSource } from "../src/lib/context/types.ts";
import { buildDocumentChunks } from "../src/lib/document/chunk.ts";
import { EVAL_PDF_FIXTURES } from "../src/lib/document/pdf/eval-fixtures.ts";
import { parseAndPersistPdf } from "../src/lib/document/pdf/ingest.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import { pdfjsDocumentOpenCount, resetPdfjsDocumentOpenCount } from "../src/lib/document/pdf/pdfjs.ts";
import type { NormalizedDocument } from "../src/lib/document/types.ts";
import { isDocumentChunk, type IndexedChunk } from "../src/lib/repo/types.ts";
import { retrieve } from "../src/lib/search/retrieve.ts";
import { retrieveTrace } from "../src/lib/search/retrieve-trace.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}.eval/phase4a/`;
const ARTIFACT = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) ?? "retrieval-bench.json";
const labels = JSON.parse(readFileSync(`${OUT}retrieval-labels.json`, "utf8")) as {
  questions: Array<{
    id: string;
    q: string;
    answerable: boolean;
    sourcePath?: string;
    page?: number;
    span?: string;
  }>;
  zeroChunk: string[];
};

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

const FIXTURES = EVAL_PDF_FIXTURES;

type Row = {
  id: string;
  q: string;
  answerable: boolean;
  expectedPage?: number;
  expectedPath?: string;
  top1: boolean;
  top3: boolean;
  top6: boolean;
  topKind?: string;
  topPage?: number;
  topScore?: number;
};

async function parseNamed(path: string, bytes: Uint8Array): Promise<NormalizedDocument> {
  const result = await parsePdf({
    contextId: "bench",
    sourceId: path,
    path,
    contentHash: path,
    blob: blobFrom(bytes),
  });
  return result.document;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const documents = new Map<string, NormalizedDocument>();
  const zero: Record<string, { readiness: string; chunks: number }> = {};
  const parseMs: Record<string, number> = {};

  for (const [path, bytes] of Object.entries(FIXTURES)) {
    const started = performance.now();
    const document = await parseNamed(path, bytes);
    parseMs[path] = performance.now() - started;
    documents.set(path, document);
    const chunks = buildDocumentChunks(document);
    if (labels.zeroChunk.includes(path) || document.readiness !== "ready") {
      zero[path] = { readiness: document.readiness, chunks: chunks.length };
    }
  }

  const allChunks: IndexedChunk[] = [];
  for (const [path, document] of documents) {
    if (labels.zeroChunk.includes(path)) continue;
    allChunks.push(...buildDocumentChunks(document));
  }

  const rows: Row[] = [];
  let top1 = 0;
  let top3 = 0;
  let top6 = 0;
  let answerable = 0;
  for (const item of labels.questions) {
    const hits = retrieve(item.q, allChunks);
    const pages = hits.filter(isDocumentChunk).map((hit) => ({ path: hit.path, page: hit.page, score: hit.score }));
    const match = (hit: (typeof pages)[number] | undefined) =>
      Boolean(item.answerable && hit && hit.path === item.sourcePath && hit.page === item.page);
    const inTop1 = match(pages[0]);
    const inTop3 = pages.slice(0, 3).some((hit) => match(hit));
    const inTop6 = pages.slice(0, 6).some((hit) => match(hit));
    if (item.answerable) {
      answerable += 1;
      if (inTop1) top1 += 1;
      if (inTop3) top3 += 1;
      if (inTop6) top6 += 1;
    }
    rows.push({
      id: item.id,
      q: item.q,
      answerable: item.answerable,
      expectedPage: item.page,
      expectedPath: item.sourcePath,
      top1: inTop1,
      top3: inTop3,
      top6: inTop6,
      topKind: hits[0]?.kind,
      topPage: hits[0] && isDocumentChunk(hits[0]) ? hits[0].page : undefined,
      topScore: hits[0]?.score,
    });
    if (item.answerable) {
      console.log(item.id, retrieveTrace(item.q, allChunks).slice(0, 6));
    }
  }

  const lecture = documents.get("lecture.pdf");
  if (!lecture) throw new Error("lecture fixture missing");
  const chunkBuildStarted = performance.now();
  const lectureChunks = buildDocumentChunks(lecture);
  const documentChunkBuildMs = performance.now() - chunkBuildStarted;

  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "pdf-bench" });
  const [source] = await repo.upsertSources(context.id, [
    { path: "lecture.pdf", kind: "pdf", blob: blobFrom(FIXTURES["lecture.pdf"]) },
  ]);
  if (!isPdfSource(source)) throw new Error("expected pdf");
  const irLookupStarted = performance.now();
  await parseAndPersistPdf(repo, context.id, source);
  const normalizedDocumentCacheMs = performance.now() - irLookupStarted;
  const writeStarted = performance.now();
  await indexContext(repo, context.id);
  const storedChunkWriteMs = performance.now() - writeStarted;

  repo.blobLoadCount = 0;
  repo.normalizedLoadCount = 0;
  resetPdfjsDocumentOpenCount();
  const warmStarted = performance.now();
  const warm = await indexContext(repo, context.id);
  const warmStoredChunkReadMs = performance.now() - warmStarted;
  const warmBlobLoads = repo.blobLoadCount;
  const warmIrLoads = repo.normalizedLoadCount;
  const warmPdfjs = pdfjsDocumentOpenCount();

  repo.blobLoadCount = 0;
  repo.normalizedLoadCount = 0;
  resetPdfjsDocumentOpenCount();
  const bumpStarted = performance.now();
  await indexContext(repo, context.id, { documentChunkerVersion: DOCUMENT_CHUNKER_VERSION + 1 });
  const chunkerRebuildMs = performance.now() - bumpStarted;
  const bumpBlobLoads = repo.blobLoadCount;
  const bumpIrLoads = repo.normalizedLoadCount;
  const bumpPdfjs = pdfjsDocumentOpenCount();

  const report = {
    phase: ARTIFACT.includes("4a41") ? "4A.4.1" : "4A.3",
    generatedAt: new Date().toISOString(),
    versions: {
      parser: PDF_PARSER_VERSION,
      normalizer: DOCUMENT_NORMALIZER_VERSION,
      documentChunker: DOCUMENT_CHUNKER_VERSION,
    },
    metrics: {
      answerable,
      top1: answerable ? top1 / answerable : 0,
      top3: answerable ? top3 / answerable : 0,
      top6: answerable ? top6 / answerable : 0,
      top1Count: `${top1}/${answerable}`,
      top3Count: `${top3}/${answerable}`,
      top6Count: `${top6}/${answerable}`,
    },
    rows,
    zeroChunk: zero,
    lectureChunks: lectureChunks.length,
    timings: {
      parseMs,
      normalizedDocumentCacheMs,
      documentChunkBuildMs,
      storedChunkWriteMs,
      warmStoredChunkReadMs,
      chunkerRebuildMs,
      warm: { blobLoads: warmBlobLoads, irLoads: warmIrLoads, pdfjsOpens: warmPdfjs, reused: warm.report.reusedSourceCount },
      chunkerBump: { blobLoads: bumpBlobLoads, irLoads: bumpIrLoads, pdfjsOpens: bumpPdfjs },
    },
  };
  writeFileSync(`${OUT}${ARTIFACT}`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.metrics, null, 2));
  console.log("zeroChunk", zero);
  console.log("timings", report.timings);
}

await main();
