/**
 * Phase 4A.8 diagnosis. Reads frozen 4A.7 artifacts. Writes only under .eval/phase4a/4a8/.
 * Does not modify production code or .eval/phase4a/release/.
 *
 * node --experimental-strip-types scripts/pdf-4a8-analyze.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildDocumentChunks } from "../src/lib/document/chunk.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import type { NormalizedDocument } from "../src/lib/document/types.ts";
import { isDocumentHit } from "../src/lib/repo/types.ts";
import { documentFitsShape } from "../src/lib/search/document-card.ts";
import {
  documentClaimAdmissible,
  documentCorpusCoversQuestion,
  documentMentions,
  documentSubjectTerms,
} from "../src/lib/search/document-subject.ts";
import { shapeOf } from "../src/lib/search/intent.ts";
import { retrieve } from "../src/lib/search/retrieve.ts";
import { contentWords, normalizeSpokenQuestion } from "../src/lib/search/spoken.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const RELEASE = `${ROOT}.eval/phase4a/release/`;
const OUT = `${ROOT}.eval/phase4a/4a8/`;
const CORPUS = `${RELEASE}corpus`;

type Row = {
  id: string;
  q: string;
  answerable: boolean;
  expectedPath: string | null;
  expectedPage: number | null;
  spoke: boolean;
  say: string | null;
  citedPage: number | null;
  citedPath: string | null;
  intentWrong: boolean;
  retrievePaths: string[];
  reason: string | null;
};

const run = JSON.parse(readFileSync(`${RELEASE}card-run.json`, "utf8")) as {
  metrics: Record<string, unknown>;
  corpus: Array<{
    file: string;
    pageCount: number;
    chunksIfReady: number;
    readiness: string;
    layout: {
      singleColumn: number;
      twoColumn: number;
      uncertain: number;
      skipped: number;
      isolated: number;
      full: number;
    };
  }>;
  rows: Row[];
};

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

function sourceSelector(q: string): { raw: string; kind: string } | null {
  const lower = q.toLowerCase();
  if (/\bscanned pdf\b/.test(lower)) return { raw: "scanned PDF", kind: "document-type" };
  if (/\bencrypted pdf\b/.test(lower)) return { raw: "encrypted PDF", kind: "document-type" };
  if (/\bpublication 15\b|\birs\b/.test(lower)) return { raw: "Publication 15", kind: "document-title" };
  if (/\bsp 800-63b\b|\b800-63b\b/.test(lower)) return { raw: "800-63B", kind: "document-title" };
  if (/\bbert paper\b|\bthe bert\b|\bbert\b/.test(lower) && /\bpaper|pretrain|glue|devlin|phone\b/.test(lower)) {
    return { raw: "BERT", kind: "document-title" };
  }
  if (/\btransformer paper\b|\battention paper\b/.test(lower)) return { raw: "Attention paper", kind: "document-title" };
  if (/\bthe lecture\b|\bthe professor\b/.test(lower)) return { raw: "the lecture/professor", kind: "document-type" };
  if (/\bthe (ransomware )?guide\b/.test(lower)) return { raw: "the guide", kind: "document-type" };
  if (/\bthe policy\b/.test(lower)) return { raw: "the policy", kind: "document-type" };
  if (/\bnist\b/.test(lower) && /\bdefine|cloud|hybrid|sla\b/.test(lower)) return { raw: "NIST", kind: "document-title" };
  if (/\bomb\b/.test(lower)) return { raw: "OMB", kind: "document-title" };
  if (/\bcisa\b/.test(lower)) return { raw: "CISA", kind: "document-title" };
  if (/\bsatoshi\b/.test(lower)) return { raw: "Satoshi", kind: "author" };
  if (/\btracemonkey\b|\bfirefox\b/.test(lower)) return { raw: "TraceMonkey/Firefox", kind: "document-title" };
  if (/\blora authors\b|\blora\b/.test(lower) && /\bsalary|authors\b/.test(lower)) return { raw: "LoRA", kind: "author" };
  if (/\bjacob devlin\b/.test(lower)) return { raw: "Jacob Devlin", kind: "author" };
  return null;
}

function predicateOf(q: string): { predicate: string; terms: string[] } | null {
  const lower = q.toLowerCase();
  if (/\bcost|price|budget|charge|pay|salary|sla\b/.test(lower)) return { predicate: "cost/price", terms: ["cost", "price", "budget", "pay", "salary", "charge"] };
  if (/\brecommend|vendor|mandate|should we buy\b/.test(lower)) return { predicate: "recommendation", terms: ["recommend", "vendor", "mandate"] };
  if (/\bstored|store|location|where\b/.test(lower)) return { predicate: "location", terms: ["stored", "store", "located", "where"] };
  if (/\bown|owns|owner|ownership\b/.test(lower)) return { predicate: "ownership", terms: ["own", "owns", "owner", "ownership"] };
  if (/\bphone number|ssn|api key|password opens\b/.test(lower)) return { predicate: "secret/identifier", terms: ["phone", "ssn", "password", "key"] };
  if (/\bgrowth rate|cagr|market share\b/.test(lower)) return { predicate: "quantity-rate", terms: ["growth", "rate", "share", "cagr"] };
  if (/\bwhy\b/.test(lower)) return { predicate: "rationale", terms: ["because", "reason", "rationale"] };
  if (/\bhow much|how many|how long|how quickly\b/.test(lower)) return { predicate: "quantity", terms: ["much", "many", "long"] };
  if (/\bwhat happens\b/.test(lower)) return { predicate: "failure-outcome", terms: ["happens", "fail", "when"] };
  return null;
}

function answerExpectation(q: string): string {
  const lower = q.toLowerCase();
  if (/\bwho\b/.test(lower) || /\bphone number|ssn|home address\b/.test(lower)) return "person";
  if (/\bwhere\b/.test(lower) || /\bstored\b/.test(lower)) return "location";
  if (/\bwhy\b/.test(lower)) return "explanation";
  if (/\bhow much|how many|how long|how quickly|grade|salary|cost|budget|growth rate|market share|cagr\b/.test(lower)) {
    return "quantity";
  }
  if (/\bwhich (three|models|levels|pillars|vendor|gpu)\b/.test(lower) || /\bthe (two|three|five) \b/.test(lower) || /\bwhat are the (two|three|five)\b/.test(lower)) {
    return "enumeration";
  }
  if (/\bhow\b/.test(lower)) return "procedure";
  return "definition";
}

function claimHasRelation(say: string, pred: { terms: string[] } | null): boolean {
  if (!pred) return true;
  const body = say.toLowerCase();
  return pred.terms.some((term) => body.includes(term));
}

function smashed(say: string): boolean {
  return /[a-z][A-Z]/.test(say) || /\b[A-Z][a-z]{1,3}\b [a-z]{2,}\b/.test(say) && /\bTion\b|\bTrace-\s*Monkey\b/.test(say);
}

function layerOf(row: Row, selector: { raw: string; kind: string } | null, pred: { predicate: string; terms: string[] } | null, expectation: string, say: string): string {
  if (selector && row.citedPath) {
    const cited = row.citedPath.toLowerCase();
    const raw = selector.raw.toLowerCase();
    const mismatch =
      (raw.includes("bert") && !cited.includes("bert")) ||
      (raw.includes("lora") && !cited.includes("lora")) ||
      (raw.includes("800-63") && !cited.includes("63b")) ||
      (raw.includes("guide") && !cited.includes("cisa")) ||
      (raw.includes("lecture") && !cited.includes("cs229")) ||
      (raw.includes("professor") && !cited.includes("cs229")) ||
      (raw.includes("nist") && !cited.includes("nist")) ||
      (raw.includes("omb") && !cited.includes("omb")) ||
      (raw.includes("cisa") && !cited.includes("cisa")) ||
      (raw.includes("satoshi") && !cited.includes("bitcoin")) ||
      (raw.includes("tracemonkey") && !cited.includes("tracemonkey")) ||
      (raw.includes("scanned") && !cited.includes("scanned")) ||
      (raw.includes("encrypted") && !cited.includes("encrypted")) ||
      (raw.includes("publication 15") && !cited.includes("irs"));
    if (mismatch) return "A-source-reference";
  }
  if (row.answerable && /\b(so |and the other|again)\b/i.test(row.q)) return "G-thread-reference";
  if (expectation === "enumeration" && !/\n|•|, .+, /.test(say)) return "F-enumeration";
  if (["quantity", "person", "location"].includes(expectation) && !claimHasRelation(say, pred)) return "D-answer-type";
  if (pred && !claimHasRelation(say, pred)) return "C-predicate-relation";
  if (row.answerable && row.expectedPath && row.citedPath && row.citedPath !== row.expectedPath) {
    if (selector) return "A-source-reference";
    return "E-shared-vocabulary";
  }
  if (!row.answerable && pred && !claimHasRelation(say, pred)) return "C-predicate-relation";
  if (!row.answerable && ["quantity", "person", "location"].includes(expectation)) return "D-answer-type";
  if (smashed(say)) return "H-parser-damage";
  if (row.answerable && row.citedPath === row.expectedPath) return "C-predicate-relation";
  return "E-shared-vocabulary";
}

function gateThatShouldReject(layer: string): string {
  switch (layer) {
    case "A-source-reference":
      return "source-selector: cited sourceId is not the resolved document";
    case "B-subject":
      return "subject match: claim does not establish the question subject";
    case "C-predicate-relation":
      return "predicate/relation: claim lacks the requested relation terms";
    case "D-answer-type":
      return "answer-expectation: claim is not a quantity/person/location/enumeration answer";
    case "E-shared-vocabulary":
      return "subject+predicate together: overlapping tokens are not the asked subject";
    case "F-enumeration":
      return "enumeration contract: no list/category established";
    case "G-thread-reference":
      return "thread source selector: follow-up should stay on the prior document";
    case "H-parser-damage":
      return "presentation gate: smashed/unusable extract should silence";
    default:
      return "question-contract admission";
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const rows = run.rows;
  const answerable = rows.filter((row) => row.answerable);
  const answerableSpoke = answerable.filter((row) => row.spoke);
  const answerableHit = answerableSpoke.filter((row) => !row.intentWrong);
  const answerableWrong = answerableSpoke.filter((row) => row.intentWrong);
  const unanswerable = rows.filter((row) => !row.answerable);
  const unanswerableSpoke = unanswerable.filter((row) => row.spoke);
  const wrong = rows.filter((row) => row.spoke && row.intentWrong);

  const accounting = {
    questions: rows.length,
    answerable: answerable.length,
    answerableSilences: answerable.filter((row) => !row.spoke).length,
    answerableSpoke: answerableSpoke.length,
    answerableHits: answerableHit.length,
    answerableWrong: answerableWrong.length,
    unanswerable: unanswerable.length,
    unanswerableSpoke: unanswerableSpoke.length,
    unanswerableSilent: unanswerable.filter((row) => !row.spoke).length,
    wrongIntent: wrong.length,
    expected: { answerableWrong: 48, unanswerableSpoke: 20, wrongIntent: 68 },
    reconciled:
      answerableWrong.length === 48 && unanswerableSpoke.length === 20 && wrong.length === 68,
  };

  const documents = new Map<string, NormalizedDocument>();
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".pdf"))) {
    const bytes = new Uint8Array(readFileSync(`${CORPUS}/${file}`));
    const result = await parsePdf({
      contextId: "4a8-diag",
      sourceId: file,
      path: file,
      contentHash: file,
      blob: blobFrom(bytes),
    });
    documents.set(file, result.document);
  }
  const ready = [...documents.values()].filter((document) => document.readiness === "ready");
  const chunks = ready.flatMap(buildDocumentChunks);
  const chunkByPage = new Map<string, number>();
  const maxByDoc = new Map<string, number>();
  for (const chunk of chunks) {
    const key = `${chunk.path}#${chunk.page}`;
    chunkByPage.set(key, (chunkByPage.get(key) ?? 0) + 1);
  }
  const explosion = ready.map((document) => {
    const docChunks = chunks.filter((chunk) => chunk.path === document.path);
    const perPage: Record<number, number> = {};
    for (const chunk of docChunks) perPage[chunk.page] = (perPage[chunk.page] ?? 0) + 1;
    const counts = Object.values(perPage);
    const max = counts.length ? Math.max(...counts) : 0;
    maxByDoc.set(document.path, max);
    const pages = document.pages;
    return {
      file: document.path,
      pages: document.pageCount,
      readiness: document.readiness,
      full: pages.filter((page) => page.index === "full").length,
      isolated: pages.filter((page) => page.index === "isolated-lines").length,
      skipped: pages.filter((page) => page.index === "skipped").length,
      singleColumn: pages.filter((page) => page.readingOrder === "single-column").length,
      twoColumn: pages.filter((page) => page.readingOrder === "two-column").length,
      uncertain: pages.filter((page) => page.readingOrder === "uncertain").length,
      chunks: docChunks.length,
      averageChunksPerIndexedPage: counts.length ? docChunks.length / counts.length : 0,
      maxChunksPerPage: max,
      wouldRefuse200: docChunks.length > 200,
    };
  });

  const cases = [];
  for (const row of wrong) {
    const canonical = normalizeSpokenQuestion(row.q).canonical;
    const terms = contentWords(canonical);
    const shape = shapeOf(canonical);
    const hits = retrieve(row.q, chunks).filter(isDocumentHit);
    const docsForSubject = uniqueDocs(hits, documents);
    const subject = documentSubjectTerms(terms, docsForSubject);
    const covered = documentCorpusCoversQuestion(terms, docsForSubject);
    const say = row.say ?? "";
    const rarest = rarestTerms(subject, docsForSubject);
    const admittedBecause = rarest.filter((term) => documentMentions(say, term));
    const selector = sourceSelector(row.q);
    const pred = predicateOf(row.q);
    const expectation = answerExpectation(row.q);
    const layer = layerOf(row, selector, pred, expectation, say);
    const expectedInTop6 = Boolean(
      row.expectedPath && row.retrievePaths.some((entry) => entry.startsWith(`${row.expectedPath}#`)),
    );
    const expectedPageInTop6 = Boolean(
      row.expectedPath &&
        row.expectedPage &&
        row.retrievePaths.some((entry) => entry === `${row.expectedPath}#${row.expectedPage}`),
    );
    const expectedDoc = row.expectedPath ? documents.get(row.expectedPath) : undefined;
    const expectedPage = expectedDoc?.pages.find((page) => page.pageNumber === row.expectedPage);
    const parserBlocked = Boolean(
      row.answerable &&
        expectedDoc &&
        (expectedDoc.readiness !== "ready" ||
          expectedPage?.index === "skipped" ||
          (expectedPage && !chunks.some((chunk) => chunk.path === row.expectedPath && chunk.page === row.expectedPage))),
    );
    let track = "ADMISSION_FAILURE";
    if (row.answerable && parserBlocked && !expectedInTop6) track = "SOURCE_PARSER_FAILURE";
    else if (row.answerable && !expectedInTop6) track = "RETRIEVAL_FAILURE";
    else if (!row.answerable) track = "ADMISSION_FAILURE";

    const topHit = hits[0];
    cases.push({
      id: row.id,
      question: row.q,
      answerable: row.answerable,
      expectedDocument: row.expectedPath,
      expectedPage: row.expectedPage,
      retrievedRanks: row.retrievePaths.slice(0, 6),
      winningChunk: topHit
        ? { path: topHit.path, page: topHit.page, score: topHit.score, text: topHit.text.slice(0, 240) }
        : null,
      winningDocument: row.citedPath,
      spokenText: say,
      questionShape: shape,
      extractedSubject: subject,
      subjectTokens: terms,
      candidateSubjectTokens: subject.filter((term) => documentMentions(say, term)),
      sourceSelector: selector,
      answerExpectation: expectation,
      predicate: pred?.predicate ?? null,
      corpusCoversQuestion: covered,
      rarestSubjectTerms: rarest,
      rarestPresentInClaim: admittedBecause,
      claimAdmissible: subject.length > 0 && documentClaimAdmissible(say, subject, docsForSubject),
      shapeFit: documentFitsShape(shape, say),
      relationPresentInClaim: claimHasRelation(say, pred),
      whyAdmitted: `documentCorpusCoversQuestion=${covered}; subject=${subject.join(",") || "none"}; rarest-in-claim=${admittedBecause.join(",") || "none"}; shape=${shape} fit=${documentFitsShape(shape, say)}; support last-line passed; first speaking hit wins`,
      earliestLayer: layer,
      gateThatShouldReject: gateThatShouldReject(layer),
      track,
      expectedInTop6,
      expectedPageInTop6,
      parserBlocked,
    });
  }

  const layerCounts = countBy(cases.map((item) => item.earliestLayer));
  const trackCounts = countBy(cases.map((item) => item.track));
  const unans = cases.filter((item) => !item.answerable);
  const ansWrong = cases.filter((item) => item.answerable);

  const fortyEight = ansWrong.map((item) => {
    const top1Correct = Boolean(item.expectedDocument && item.retrievedRanks[0]?.startsWith(`${item.expectedDocument}#`));
    const inTop6 = item.expectedInTop6;
    let kind = "F-other";
    if (item.parserBlocked && !inTop6) kind = "D-parser-chunking";
    else if (item.sourceSelector && item.winningDocument !== item.expectedDocument) kind = "E-source-label";
    else if (top1Correct && item.winningDocument === item.expectedDocument) kind = "A-top1-wrong-extract";
    else if (!top1Correct && inTop6) kind = "B-top2-6-wrong-higher-admitted";
    else if (!inTop6 && !item.parserBlocked) kind = "C-not-in-top6";
    else if (item.parserBlocked) kind = "D-parser-chunking";
    return { id: item.id, kind, expectedInTop6: inTop6, top1Correct, parserBlocked: item.parserBlocked };
  });

  const summary = {
    accounting,
    layerCounts,
    layerPct: Object.fromEntries(
      Object.entries(layerCounts).map(([key, value]) => [key, `${value}/${cases.length} (${((value / cases.length) * 100).toFixed(1)}%)`]),
    ),
    trackCounts,
    answerable48: countBy(fortyEight.map((item) => item.kind)),
    unanswerable20Layers: countBy(unans.map((item) => item.earliestLayer)),
    correctEvidenceInTop6Among68: cases.filter((item) => item.answerable && item.expectedInTop6).length,
    correctEvidenceInTop6Among48: ansWrong.filter((item) => item.expectedInTop6).length,
    admissionFailures: cases.filter((item) => item.track === "ADMISSION_FAILURE").length,
    retrievalFailures: cases.filter((item) => item.track === "RETRIEVAL_FAILURE").length,
    parserFailures: cases.filter((item) => item.track === "SOURCE_PARSER_FAILURE").length,
    sourceReference: cases.filter((item) => item.earliestLayer === "A-source-reference").length,
    predicateRelation: cases.filter((item) => item.earliestLayer === "C-predicate-relation").length,
    answerType: cases.filter((item) => item.earliestLayer === "D-answer-type").length,
    enumeration: cases.filter((item) => item.earliestLayer === "F-enumeration").length,
  };

  writeFileSync(`${OUT}accounting.json`, `${JSON.stringify(accounting, null, 2)}\n`);
  writeFileSync(`${OUT}wrong-intent-68.json`, `${JSON.stringify(cases, null, 2)}\n`);
  writeFileSync(`${OUT}unanswerable-20.json`, `${JSON.stringify(unans, null, 2)}\n`);
  writeFileSync(`${OUT}answerable-wrong-48.json`, `${JSON.stringify(ansWrong, null, 2)}\n`);
  writeFileSync(`${OUT}answerable-48-kinds.json`, `${JSON.stringify(fortyEight, null, 2)}\n`);
  writeFileSync(`${OUT}chunk-explosion.json`, `${JSON.stringify(explosion, null, 2)}\n`);
  writeFileSync(`${OUT}summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

function uniqueDocs(
  hits: Array<{ sourceId: string }>,
  documents: Map<string, NormalizedDocument>,
): NormalizedDocument[] {
  const seen = new Set<string>();
  const out: NormalizedDocument[] = [];
  for (const hit of hits) {
    if (seen.has(hit.sourceId)) continue;
    const document = documents.get(hit.sourceId);
    if (!document) continue;
    seen.add(hit.sourceId);
    out.push(document);
  }
  return out;
}

function rarestTerms(subject: string[], documents: NormalizedDocument[]): string[] {
  if (subject.length === 0) return [];
  const texts = documents.flatMap((document) => document.pages.map((page) => page.text.toLowerCase()));
  const dfs = subject.map((term) => texts.filter((text) => documentMentions(text, term)).length);
  const min = Math.min(...dfs);
  return subject.filter((_, index) => dfs[index] === min);
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

await main();
