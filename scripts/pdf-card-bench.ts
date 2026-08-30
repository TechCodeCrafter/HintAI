/**
 * Phase 4A.4 PDF Card benchmark. Fail-closed spoken Cards only.
 *
 * node --experimental-strip-types scripts/pdf-card-bench.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildDocumentChunks } from "../src/lib/document/chunk.ts";
import { EVAL_PDF_FIXTURES } from "../src/lib/document/pdf/eval-fixtures.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import { reconstructSourceText } from "../src/lib/document/source-text.ts";
import type { NormalizedDocument } from "../src/lib/document/types.ts";
import type { RepoPack } from "../src/lib/repo/types.ts";
import { isDocumentHit } from "../src/lib/repo/types.ts";
import { citationText } from "../src/lib/search/cite.ts";
import { lastDocumentCardTimings } from "../src/lib/search/document-card.ts";
import { verifyClaim } from "../src/lib/search/evidence.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { retrieve } from "../src/lib/search/retrieve.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}.eval/phase4a/`;
const ARTIFACT = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) ?? "card-bench.json";
const labels = JSON.parse(readFileSync(`${OUT}card-labels.json`, "utf8")) as {
  questions: Array<{
    id: string;
    q: string;
    answerable: boolean;
    sourcePath?: string;
    page?: number;
    spans?: string[];
    shape?: string;
  }>;
};

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

function flat(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function spanHit(say: string, support: string, spans: string[] = []): boolean {
  const spoken = flat(say);
  const body = flat(support);
  return spans.some((span) => {
    const needle = flat(span);
    return spoken.includes(needle) || body.includes(needle);
  });
}

async function parseNamed(path: string, bytes: Uint8Array): Promise<NormalizedDocument> {
  const result = await parsePdf({
    contextId: "card-bench",
    sourceId: path,
    path,
    contentHash: path,
    blob: blobFrom(bytes),
  });
  return result.document;
}

const PACK: RepoPack = { id: "pdf-card-bench", name: "pdf-card-bench", description: "pdf", files: [], commits: [] };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const documents = new Map<string, NormalizedDocument>();
  const irReadMs: Record<string, number> = {};
  for (const [path, bytes] of Object.entries(EVAL_PDF_FIXTURES)) {
    if (["grid.pdf", "scanned.pdf", "unreadable.pdf", "refused.pdf"].includes(path)) continue;
    const started = performance.now();
    const document = await parseNamed(path, bytes);
    irReadMs[path] = performance.now() - started;
    documents.set(path, document);
  }
  const chunks = [...documents.values()].flatMap(buildDocumentChunks);
  const lookup = {
    document: (sourceId: string) => documents.get(sourceId),
    documents: [...documents.values()],
  };

  const rows = [];
  const cardTimes: number[] = [];
  const mapTimes: number[] = [];
  const supportTimes: number[] = [];
  let wrongIntent = 0;
  let unsupported = 0;
  let fabricated = 0;
  let pageCiteOk = 0;
  let locationOk = 0;
  let spoken = 0;
  let answerable = 0;
  let answerableHit = 0;
  let falseSilence = 0;

  for (const item of labels.questions) {
    if (item.answerable) answerable += 1;
    const retrieveHits = retrieve(item.q, chunks);
    const started = performance.now();
    const card = localCard(item.q, retrieveHits, PACK, 0, null, lookup);
    const totalMs = performance.now() - started;
    cardTimes.push(totalMs);
    const timings = lastDocumentCardTimings();
    if (timings) {
      mapTimes.push(timings.mapMs);
      supportTimes.push(timings.supportMs);
    }

    const evidence = card.evidence?.[0];
    const documentEvidence = evidence?.kind === "document" ? evidence : null;
    const document = documentEvidence ? documents.get(documentEvidence.sourceId) : undefined;
    const reconstructed =
      documentEvidence && document ? reconstructSourceText(document, documentEvidence.itemRanges) : null;
    const supported = card.say && documentEvidence ? verifyClaim(card.say, [documentEvidence]).ok : false;
    const locationAccurate = Boolean(
      documentEvidence && reconstructed !== null && reconstructed === documentEvidence.sourceText,
    );
    const pageAccurate = Boolean(
      documentEvidence &&
        card.citations[0]?.kind === "document" &&
        card.citations[0].page === documentEvidence.page &&
        documentEvidence.itemRanges.every((range) => range.page === documentEvidence.page),
    );
    const matchedSpan = Boolean(
      card.say && documentEvidence && spanHit(card.say, documentEvidence.supportText, item.spans),
    );
    const intentWrong = Boolean(
      card.say && (!item.answerable || (item.answerable && !matchedSpan)),
    );

    if (card.say) {
      spoken += 1;
      if (intentWrong) wrongIntent += 1;
      if (!supported) unsupported += 1;
      if (!locationAccurate) fabricated += 1;
      if (pageAccurate) pageCiteOk += 1;
      if (locationAccurate) locationOk += 1;
    }
    if (item.answerable && card.say && !intentWrong) answerableHit += 1;
    if (item.answerable && !card.say) falseSilence += 1;

    const top = retrieveHits[0];
    rows.push({
      id: item.id,
      q: item.q,
      answerable: item.answerable,
      expectedPath: item.sourcePath ?? null,
      expectedPage: item.page ?? null,
      spoke: Boolean(card.say),
      say: card.say,
      reason: card.reason ?? null,
      evidenceKind: evidence?.kind ?? null,
      cited: card.citations[0] ? citationText(card.citations[0]) : null,
      citedPage: documentEvidence?.page ?? null,
      citedPath: documentEvidence?.path ?? null,
      matchedSpan,
      supported,
      locationAccurate,
      pageAccurate,
      intentWrong,
      topKind: top?.kind ?? null,
      topPath: top && "path" in top ? top.path : null,
      topPage: top && isDocumentHit(top) ? top.page : null,
      rankFallback:
        item.id === "bullets-list"
          ? {
              top1Path: top && "path" in top ? top.path : null,
              top1Spoke: Boolean(
                card.say && documentEvidence && top && "path" in top && documentEvidence.path === top.path,
              ),
              spokePath: documentEvidence?.path ?? null,
            }
          : undefined,
      timings: timings
        ? {
            extractMs: timings.extractMs,
            mapMs: timings.mapMs,
            currentMs: timings.currentMs,
            supportMs: timings.supportMs,
            totalMs: timings.totalMs,
            wallMs: totalMs,
          }
        : { wallMs: totalMs },
    });
  }

  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  const report = {
    phase: ARTIFACT.includes("4a41") ? "4A.4.1" : "4A.4",
    generatedAt: new Date().toISOString(),
    metrics: {
      questions: labels.questions.length,
      answerable,
      spoken,
      wrongIntent: labels.questions.length ? wrongIntent / labels.questions.length : 0,
      wrongIntentCount: `${wrongIntent}/${labels.questions.length}`,
      unsupported: spoken ? unsupported / spoken : 0,
      unsupportedCount: `${unsupported}/${spoken}`,
      fabricatedProvenance: fabricated,
      pageCitationAccuracy: spoken ? pageCiteOk / spoken : 1,
      pageCitationCount: `${pageCiteOk}/${spoken}`,
      evidenceLocationAccuracy: spoken ? locationOk / spoken : 1,
      evidenceLocationCount: `${locationOk}/${spoken}`,
      answerableHitRate: answerable ? answerableHit / answerable : 0,
      answerableHitCount: `${answerableHit}/${answerable}`,
      falseSilence: answerable ? falseSilence / answerable : 0,
      falseSilenceCount: `${falseSilence}/${answerable}`,
    },
    isolationLevelsFallback: rows.find((row) => row.id === "bullets-list")?.rankFallback ?? null,
    timings: {
      irReadMs,
      meanCardMs: mean(cardTimes),
      meanMapMs: mean(mapTimes),
      meanSupportMs: mean(supportTimes),
      note: "Warm Card uses cached NormalizedDocument. It does not load the PDF Blob.",
    },
    rows,
  };
  writeFileSync(`${OUT}${ARTIFACT}`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.metrics, null, 2));
  console.log("isolation-levels", report.isolationLevelsFallback);
  console.log("timings", report.timings);
}

await main();
