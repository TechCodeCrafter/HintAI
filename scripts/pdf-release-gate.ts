/**
 * Phase 4A.7 real-world PDF release gate.
 * Blind run: do not tune product code against this corpus.
 *
 * node --experimental-strip-types scripts/pdf-release-gate.ts
 * node --experimental-strip-types scripts/pdf-release-gate.ts --baseline
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildDocumentChunks } from "../src/lib/document/chunk.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import { pdfjsDocumentOpenCount, resetPdfjsDocumentOpenCount } from "../src/lib/document/pdf/pdfjs.ts";
import { reconstructSourceText } from "../src/lib/document/source-text.ts";
import type { NormalizedDocument } from "../src/lib/document/types.ts";
import { planHighlight } from "../src/lib/document/viewer/highlight.ts";
import { buildTextLayerMap } from "../src/lib/document/viewer/map.ts";
import type { RepoPack } from "../src/lib/repo/types.ts";
import { isDocumentHit } from "../src/lib/repo/types.ts";
import { citationText } from "../src/lib/search/cite.ts";
import { verifyClaim } from "../src/lib/search/evidence.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { shouldRefine } from "../src/lib/search/refine-payload.ts";
import { retrieve } from "../src/lib/search/retrieve.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const RELEASE = `${ROOT}.eval/phase4a/release/`;
const BASELINE = `${ROOT}.eval/phase4a/release-baseline/`;
const CORPUS = `${RELEASE}corpus`;
const writeBaseline = process.argv.includes("--baseline");

const labels = JSON.parse(readFileSync(`${RELEASE}labels.json`, "utf8")) as {
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
    if (!needle) return false;
    return spoken.includes(needle) || body.includes(needle);
  });
}

function syntheticLayer(document: NormalizedDocument, pageNumber: number) {
  const page = document.pages.find((entry) => entry.pageNumber === pageNumber);
  if (!page) return { map: undefined, divs: undefined };
  const max = Math.max(0, ...page.items.map((entry) => entry.itemIndex));
  const raw: Array<{ str?: string }> = Array.from({ length: max + 1 }, () => ({}));
  for (const entry of page.items) raw[entry.itemIndex] = { str: entry.str };
  const divs = raw.filter((entry) => entry.str !== undefined).map((entry) => ({ textContent: entry.str ?? "" }));
  return { map: buildTextLayerMap(raw, divs), divs };
}

/** Presentation quality only — not support. Flags extraction-damaged spoken Hints. */
function readableHint(say: string): { ok: boolean; reason: string | null } {
  const text = say.trim();
  if (text.length < 12) return { ok: false, reason: "too-short" };
  if (/[A-Za-z] [A-Za-z] [A-Za-z] [A-Za-z] [A-Za-z] [A-Za-z]/.test(text) && text.replace(/[^A-Za-z]/g, "").length < 40) {
    return { ok: false, reason: "spaced-letters" };
  }
  if (/\b(tlp:clear page\s*\|)/i.test(text) && text.length < 80) return { ok: false, reason: "header-only" };
  if (/\b\w{1,2}\b(?: \b\w{1,2}\b){8,}/.test(text)) return { ok: false, reason: "fragment-run" };
  if (/[a-z][A-Z]{4,}[a-z]/.test(text) && /unless extra|ch added|thethe/.test(text)) {
    return { ok: false, reason: "smashed" };
  }
  return { ok: true, reason: null };
}

function missCategory(row: {
  answerable: boolean;
  spoke: boolean;
  intentWrong: boolean;
  supported: boolean;
  readiness?: string;
  topPath: string | null;
  expectedPath: string | null;
  reason: string | null;
}): string {
  if (!row.answerable && !row.spoke) return "unsupported-correct-silence";
  if (!row.answerable && row.spoke) return row.intentWrong ? "wrong-intent" : "unsupported-spoke";
  if (row.answerable && row.spoke && !row.intentWrong) return "answerable-hit";
  if (row.readiness && row.readiness !== "ready") return row.readiness;
  if (row.answerable && !row.spoke) {
    if (row.topPath && row.expectedPath && row.topPath !== row.expectedPath) return "retrieval-miss";
    if (row.reason?.includes("shape") || row.reason?.includes("intent")) return "shape-rejection";
    if (row.reason?.includes("subject")) return "subject-mismatch";
    if (row.reason?.includes("support") || row.reason?.includes("evidence")) return "safe-support-rejection";
    return "false-silence";
  }
  return "other";
}

const PACK: RepoPack = { id: "pdf-release", name: "pdf-release", description: "4A.7", files: [], commits: [] };

async function main() {
  mkdirSync(RELEASE, { recursive: true });
  resetPdfjsDocumentOpenCount();
  const files = readdirSync(CORPUS).filter((name) => name.endsWith(".pdf")).sort();
  const documents = new Map<string, NormalizedDocument>();
  const classifications: Array<Record<string, unknown>> = [];
  const parseMs: Record<string, number> = {};

  for (const file of files) {
    const bytes = new Uint8Array(readFileSync(`${CORPUS}/${file}`));
    const started = performance.now();
    const result = await parsePdf({
      contextId: "release-4a7",
      sourceId: file,
      path: file,
      contentHash: file,
      blob: blobFrom(bytes),
    });
    parseMs[file] = performance.now() - started;
    documents.set(file, result.document);
    const pages = result.document.pages;
    const layout = {
      singleColumn: pages.filter((page) => page.readingOrder === "single-column").length,
      twoColumn: pages.filter((page) => page.readingOrder === "two-column").length,
      uncertain: pages.filter((page) => page.readingOrder === "uncertain").length,
      skipped: pages.filter((page) => page.index === "skipped").length,
      isolated: pages.filter((page) => page.index === "isolated-lines").length,
      full: pages.filter((page) => page.index === "full").length,
    };
    classifications.push({
      file,
      readiness: result.readiness,
      readinessNote: result.readinessNote,
      pageCount: result.pageCount,
      extractedChars: result.extractedChars,
      chunksIfReady: result.readiness === "ready" ? buildDocumentChunks(result.document).length : 0,
      layout,
      parseMs: parseMs[file],
    });
  }

  const readyDocs = [...documents.values()].filter((document) => document.readiness === "ready");
  const chunks = readyDocs.flatMap(buildDocumentChunks);
  const lookup = { document: (sourceId: string) => documents.get(sourceId) };

  let wrongIntent = 0;
  let unsupported = 0;
  let fabricated = 0;
  let pageCiteOk = 0;
  let locationOk = 0;
  let spoken = 0;
  let answerable = 0;
  let answerableHit = 0;
  let falseSilence = 0;
  let top1 = 0;
  let top3 = 0;
  let top6 = 0;
  let retrieveN = 0;
  let refineLeak = 0;
  let readableOk = 0;
  let readableN = 0;
  let viewerWrongPage = 0;
  let viewerWrongText = 0;
  let exactN = 0;
  let itemBoxN = 0;
  let captionN = 0;
  let viewerN = 0;
  const rows: Array<Record<string, unknown>> = [];
  const taxonomy: Record<string, number> = {};

  for (const item of labels.questions) {
    if (item.answerable) answerable += 1;
    const retrieveHits = retrieve(item.q, chunks);
    const card = localCard(item.q, retrieveHits, PACK, 0, null, lookup);
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
      card.say && documentEvidence && spanHit(card.say, documentEvidence.supportText, item.spans ?? []),
    );
    const intentWrong = Boolean(card.say && (!item.answerable || (item.answerable && !matchedSpan)));

    if (card.say) {
      spoken += 1;
      if (intentWrong) wrongIntent += 1;
      if (!supported) unsupported += 1;
      if (!locationAccurate) fabricated += 1;
      if (pageAccurate) pageCiteOk += 1;
      if (locationAccurate) locationOk += 1;
      const hint = readableHint(card.say);
      readableN += 1;
      if (hint.ok) readableOk += 1;
      if (shouldRefine(retrieveHits, card)) refineLeak += 1;
    }
    if (item.answerable && card.say && !intentWrong) answerableHit += 1;
    if (item.answerable && !card.say) falseSilence += 1;

    const top = retrieveHits[0];
    const topPath = top && "path" in top ? top.path : null;
    if (item.answerable && item.sourcePath) {
      retrieveN += 1;
      const paths = retrieveHits.filter(isDocumentHit).map((hit) => hit.path);
      if (paths[0] === item.sourcePath) top1 += 1;
      if (paths.slice(0, 3).includes(item.sourcePath)) top3 += 1;
      if (paths.slice(0, 6).includes(item.sourcePath)) top6 += 1;
    }

    let highlightMode: string | null = null;
    if (card.say && documentEvidence && document) {
      viewerN += 1;
      const layer = syntheticLayer(document, documentEvidence.page);
      const plan = planHighlight({ evidence: documentEvidence, document, ...layer });
      highlightMode = plan.mode;
      if (plan.mode === "exact") exactN += 1;
      else if (plan.mode === "item-box") itemBoxN += 1;
      else captionN += 1;
      if (plan.page !== documentEvidence.page) viewerWrongPage += 1;
      if (item.answerable && item.page && documentEvidence.page !== item.page && matchedSpan) {
        viewerWrongPage += 1;
      }
      if (plan.mode === "exact") {
        const reconstructedHighlight = reconstructSourceText(document, documentEvidence.itemRanges);
        if (reconstructedHighlight !== documentEvidence.sourceText) viewerWrongText += 1;
      }
    }

    const expectedDoc = item.sourcePath ? documents.get(item.sourcePath) : undefined;
    const category = missCategory({
      answerable: item.answerable,
      spoke: Boolean(card.say),
      intentWrong,
      supported: Boolean(supported),
      readiness: expectedDoc?.readiness,
      topPath,
      expectedPath: item.sourcePath ?? null,
      reason: card.reason ?? null,
    });
    taxonomy[category] = (taxonomy[category] ?? 0) + 1;

    rows.push({
      id: item.id,
      q: item.q,
      answerable: item.answerable,
      expectedPath: item.sourcePath ?? null,
      expectedPage: item.page ?? null,
      spoke: Boolean(card.say),
      say: card.say,
      reason: card.reason ?? null,
      cited: card.citations[0] ? citationText(card.citations[0]) : null,
      citedPage: documentEvidence?.page ?? null,
      citedPath: documentEvidence?.path ?? null,
      matchedSpan,
      supported,
      locationAccurate,
      pageAccurate,
      intentWrong,
      highlightMode,
      readable: card.say ? readableHint(card.say) : null,
      topKind: top?.kind ?? null,
      topPath,
      topPage: top && isDocumentHit(top) ? top.page : null,
      retrievePaths: retrieveHits.filter(isDocumentHit).slice(0, 6).map((hit) => `${hit.path}#${hit.page}`),
      category,
      shouldRefine: shouldRefine(retrieveHits, card),
    });
  }

  const safetyFail = rows.filter(
    (row) => row.spoke && (row.intentWrong || !row.supported || !row.locationAccurate || !row.pageAccurate),
  );

  const report = {
    phase: "4A.7",
    generatedAt: new Date().toISOString(),
    blind: true,
    corpus: classifications,
    chunkCount: chunks.length,
    pdfjsDocumentOpenCount: pdfjsDocumentOpenCount(),
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
      readableHintRate: readableN ? readableOk / readableN : 1,
      readableHintCount: `${readableOk}/${readableN}`,
      top1: retrieveN ? top1 / retrieveN : 0,
      top3: retrieveN ? top3 / retrieveN : 0,
      top6: retrieveN ? top6 / retrieveN : 0,
      retrieveCount: `${top1}/${top3}/${top6} of ${retrieveN}`,
      viewerWrongPage,
      viewerWrongText,
      exactHighlightRate: viewerN ? exactN / viewerN : 0,
      itemBoxRate: viewerN ? itemBoxN / viewerN : 0,
      captionOnlyRate: viewerN ? captionN / viewerN : 0,
      highlightModes: { exact: exactN, itemBox: itemBoxN, captionOnly: captionN, spokenViewer: viewerN },
      craftCardLeaks: refineLeak,
    },
    taxonomy,
    parseMs,
    safetyFail,
    rows,
  };

  writeFileSync(`${RELEASE}card-run.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${RELEASE}classifications.json`, `${JSON.stringify(classifications, null, 2)}\n`);
  writeFileSync(`${RELEASE}taxonomy.json`, `${JSON.stringify(taxonomy, null, 2)}\n`);
  writeFileSync(
    `${RELEASE}retrieval.json`,
    `${JSON.stringify(
      {
        top1: report.metrics.top1,
        top3: report.metrics.top3,
        top6: report.metrics.top6,
        rows: rows.map((row) => ({
          id: row.id,
          expectedPath: row.expectedPath,
          retrievePaths: row.retrievePaths,
        })),
      },
      null,
      2,
    )}\n`,
  );

  if (writeBaseline) {
    mkdirSync(BASELINE, { recursive: true });
    for (const name of ["card-run.json", "classifications.json", "taxonomy.json", "retrieval.json", "labels.json"]) {
      const from = name === "labels.json" ? `${RELEASE}labels.json` : `${RELEASE}${name}`;
      if (existsSync(from)) cpSync(from, `${BASELINE}${name}`);
    }
    if (existsSync(`${CORPUS}/manifest.json`)) cpSync(`${CORPUS}/manifest.json`, `${BASELINE}manifest.json`);
  }

  console.log(JSON.stringify(report.metrics, null, 2));
  console.log("taxonomy", taxonomy);
  console.log("safetyFail", safetyFail.length);
  if (safetyFail.length) {
    for (const row of safetyFail.slice(0, 12)) {
      console.log("FAIL", row.id, row.q, row.say, row.cited, row.category);
    }
  }
}

await main();
