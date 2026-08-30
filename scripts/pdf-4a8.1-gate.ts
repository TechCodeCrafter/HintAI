/**
 * Phase 4A.8.1 development regression on the frozen 4A.7 corpus.
 * Reads .eval/phase4a/release/ (frozen). Writes only .eval/phase4a/4a8.1/.
 *
 * node --experimental-strip-types scripts/pdf-4a8.1-gate.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildDocumentChunks } from "../src/lib/document/chunk.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import { reconstructSourceText } from "../src/lib/document/source-text.ts";
import type { NormalizedDocument } from "../src/lib/document/types.ts";
import type { RepoPack } from "../src/lib/repo/types.ts";
import { isDocumentHit } from "../src/lib/repo/types.ts";
import { citationText } from "../src/lib/search/cite.ts";
import { lastDocumentCardTimings } from "../src/lib/search/document-card.ts";
import { verifyClaim } from "../src/lib/search/evidence.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { lastContractTimings } from "../src/lib/search/question-contract.ts";
import { retrieve } from "../src/lib/search/retrieve.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const RELEASE = `${ROOT}.eval/phase4a/release/`;
const OUT_ARG = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6);
const OUT = OUT_ARG
  ? OUT_ARG.startsWith("/")
    ? OUT_ARG.endsWith("/")
      ? OUT_ARG
      : `${OUT_ARG}/`
    : `${ROOT}${OUT_ARG.endsWith("/") ? OUT_ARG : `${OUT_ARG}/`}`
  : `${ROOT}.eval/phase4a/4a8.1/`;
const CORPUS = `${RELEASE}corpus`;
const EVAL_SPAN_I = new Set([
  "attn-arch",
  "attn-bleu-de",
  "resnet-error",
  "tm-what",
  "tm-name",
  "nist145-counts",
  "nist145-hybrid",
  "63b-aal1",
]);

const labels = JSON.parse(readFileSync(`${RELEASE}labels.json`, "utf8")) as {
  questions: Array<{
    id: string;
    q: string;
    answerable: boolean;
    sourcePath?: string;
    page?: number;
    spans?: string[];
  }>;
};

const reviewed = JSON.parse(readFileSync(`${ROOT}.eval/phase4a/4a8/reviewed-68.json`, "utf8")) as {
  cases: Array<{ id: string; bucket: string; layer: string; track: string }>;
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
    return Boolean(needle) && (spoken.includes(needle) || body.includes(needle));
  });
}

const PACK: RepoPack = { id: "4a81", name: "4a81", description: "4A.8.1", files: [], commits: [] };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const documents = new Map<string, NormalizedDocument>();
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".pdf")).sort()) {
    const bytes = new Uint8Array(readFileSync(`${CORPUS}/${file}`));
    const result = await parsePdf({
      contextId: "4a8.1",
      sourceId: file,
      path: file,
      contentHash: file,
      blob: blobFrom(bytes),
    });
    documents.set(file, result.document);
  }
  const allDocs = [...documents.values()];
  const chunks = allDocs.filter((document) => document.readiness === "ready").flatMap(buildDocumentChunks);
  const lookup = {
    document: (sourceId: string) => documents.get(sourceId),
    documents: allDocs,
  };

  const constructMs: number[] = [];
  const admitMs: number[] = [];
  const cardMs: number[] = [];
  const rows = [];
  let wrongIntent = 0;
  let unsupported = 0;
  let fabricated = 0;
  let pageCiteOk = 0;
  let locationOk = 0;
  let spoken = 0;
  let answerable = 0;
  let answerableHit = 0;
  let falseSilence = 0;
  let unanswerableSpoke = 0;

  for (const item of labels.questions) {
    if (item.answerable) answerable += 1;
    const retrieveHits = retrieve(item.q, chunks);
    const started = performance.now();
    const card = localCard(item.q, retrieveHits, PACK, 0, null, lookup);
    cardMs.push(performance.now() - started);
    const timings = lastContractTimings();
    constructMs.push(timings.constructMs);
    admitMs.push(timings.admitMs);
    void lastDocumentCardTimings();

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
      if (!item.answerable) unanswerableSpoke += 1;
      if (!supported) unsupported += 1;
      if (!locationAccurate) fabricated += 1;
      if (pageAccurate) pageCiteOk += 1;
      if (locationAccurate) locationOk += 1;
    }
    if (item.answerable && card.say && !intentWrong) answerableHit += 1;
    if (item.answerable && !card.say) falseSilence += 1;

    const prior = reviewed.cases.find((entry) => entry.id === item.id);
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
      citedPath: documentEvidence?.path ?? null,
      citedPage: documentEvidence?.page ?? null,
      matchedSpan,
      supported,
      locationAccurate,
      pageAccurate,
      intentWrong,
      evalSpanI: EVAL_SPAN_I.has(item.id),
      priorLayer: prior?.layer ?? null,
      priorTrack: prior?.track ?? null,
      retrievePaths: retrieveHits.filter(isDocumentHit).slice(0, 6).map((hit) => `${hit.path}#${hit.page}`),
    });
  }

  const una20 = reviewed.cases.filter((entry) => entry.bucket === "unanswerable-spoke").map((entry) => {
    const row = rows.find((item) => item.id === entry.id);
    return { id: entry.id, q: row?.q, before: "spoke", after: row?.spoke ? "SPOKE" : "SILENCE", say: row?.say ?? null };
  });
  const ans48 = reviewed.cases.filter((entry) => entry.bucket === "answerable-wrong").map((entry) => {
    const row = rows.find((item) => item.id === entry.id);
    let after = "SILENCE";
    if (row?.spoke && row.matchedSpan) after = "HIT";
    else if (row?.spoke && EVAL_SPAN_I.has(entry.id)) after = "SPOKE-EVAL-SPAN-I";
    else if (row?.spoke) after = "SPOKE-WRONG";
    return { id: entry.id, q: row?.q, layer: entry.layer, after, citedPath: row?.citedPath ?? null, say: row?.say ?? null };
  });

  const surviving = rows.filter((row) => row.spoke && row.intentWrong);
  const evalSpanSpoke = rows.filter((row) => EVAL_SPAN_I.has(row.id) && row.spoke);
  const evalSpanHit = rows.filter((row) => EVAL_SPAN_I.has(row.id) && row.matchedSpan);

  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

  const report = {
    phase: "4A.8.1",
    generatedAt: new Date().toISOString(),
    frozenRelease: "not-modified",
    metrics: {
      questions: labels.questions.length,
      spoken,
      wrongIntent: labels.questions.length ? wrongIntent / labels.questions.length : 0,
      wrongIntentCount: `${wrongIntent}/${labels.questions.length}`,
      unsupported: spoken ? unsupported / spoken : 0,
      unsupportedCount: `${unsupported}/${spoken}`,
      fabricatedProvenance: fabricated,
      pageCitationAccuracy: spoken ? pageCiteOk / spoken : 1,
      evidenceLocationAccuracy: spoken ? locationOk / spoken : 1,
      answerableHitRate: answerable ? answerableHit / answerable : 0,
      answerableHitCount: `${answerableHit}/${answerable}`,
      falseSilence: answerable ? falseSilence / answerable : 0,
      falseSilenceCount: `${falseSilence}/${answerable}`,
      unanswerableSpoke,
    },
    evalSpanI: {
      ids: [...EVAL_SPAN_I],
      spoke: evalSpanSpoke.map((row) => row.id),
      strictSpanHit: evalSpanHit.map((row) => row.id),
      note: "Human-acceptable in 4A.8. Frozen labels unchanged. Strict span is the machine result.",
    },
    performance: {
      meanCardMs: mean(cardMs),
      meanContractConstructMs: mean(constructMs),
      meanClaimAdmitMs: mean(admitMs),
      maxCardMs: cardMs.length ? Math.max(...cardMs) : 0,
    },
    unanswerable20: una20,
    answerableWrong48: ans48,
    survivingWrongIntent: surviving.map((row) => ({
      id: row.id,
      q: row.q,
      say: row.say,
      citedPath: row.citedPath,
      evalSpanI: row.evalSpanI,
      priorLayer: row.priorLayer,
    })),
    rows,
  };

  const designed = JSON.parse(readFileSync(`${ROOT}.eval/phase4a/4a8/regression-set.json`, "utf8")) as {
    cases: Array<{ id: string; class: string; assert: string; why: string }>;
  };
  const regression = designed.cases.map((item) => {
    const row = rows.find((entry) => entry.id === item.id);
    const silence = !row?.spoke;
    const correctSource =
      Boolean(row?.citedPath) &&
      item.assert.toLowerCase().includes(String(row?.citedPath ?? "").toLowerCase());
    const allowSilence = /silence/i.test(item.assert);
    const allowCorrect = /correct/i.test(item.assert);
    const pass =
      (allowSilence && silence) ||
      (allowCorrect && silence) ||
      (allowCorrect && Boolean(row?.spoke) && (row?.matchedSpan || correctSource));
    return {
      id: item.id,
      class: item.class,
      assert: item.assert,
      after: silence ? "SILENCE" : row?.matchedSpan ? "HIT" : row?.evalSpanI ? "SPOKE-EVAL-SPAN-I" : "SPOKE",
      citedPath: row?.citedPath ?? null,
      pass,
    };
  });

  writeFileSync(`${OUT}card-run.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${OUT}metrics.json`, `${JSON.stringify(report.metrics, null, 2)}\n`);
  writeFileSync(`${OUT}surviving.json`, `${JSON.stringify(report.survivingWrongIntent, null, 2)}\n`);
  writeFileSync(`${OUT}unanswerable-20.json`, `${JSON.stringify(una20, null, 2)}\n`);
  writeFileSync(`${OUT}answerable-48.json`, `${JSON.stringify(ans48, null, 2)}\n`);
  writeFileSync(
    `${OUT}regression-set.json`,
    `${JSON.stringify({ phase: "4A.8.1", pass: regression.every((item) => item.pass), cases: regression }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ metrics: report.metrics, performance: report.performance, surviving: surviving.length, regressionPass: regression.every((item) => item.pass) }, null, 2));
  for (const row of surviving) {
    console.log("SURVIVE", row.id, row.evalSpanI ? "eval-I" : "", row.q, "→", row.say, row.citedPath);
  }
}

await main();
