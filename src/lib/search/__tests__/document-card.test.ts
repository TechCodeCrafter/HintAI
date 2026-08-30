import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../../context/index-versions.ts";
import { buildDocumentChunks } from "../../document/chunk.ts";
import { documentEvidenceFromRange } from "../../document/evidence.ts";
import { EVAL_PDF_FIXTURES } from "../../document/pdf/eval-fixtures.ts";
import { parsePdf } from "../../document/pdf/parse.ts";
import { reconstructSourceText } from "../../document/source-text.ts";
import type { NormalizedDocument } from "../../document/types.ts";
import { NORTHSTAR } from "../../repo/northstar.ts";
import type { Card, Hit, RepoPack } from "../../repo/types.ts";
import { citationText, citedPath } from "../cite.ts";
import { documentFitsShape } from "../document-card.ts";
import { evidenceIsCurrent, verifyClaim } from "../evidence.ts";
import { localCard } from "../local-card.ts";
import { refinePayload, shouldRefine } from "../refine-payload.ts";
import { buildChunks, retrieve } from "../retrieve.ts";
import { threadFrom, withdrawReplay } from "../thread.ts";
import { shapeOf } from "../intent.ts";
import { contentWords } from "../spoken.ts";
import { subjectTerms } from "../subject.ts";

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

async function parseNamed(path: string): Promise<NormalizedDocument> {
  const bytes = EVAL_PDF_FIXTURES[path];
  if (!bytes) throw new Error(`missing fixture ${path}`);
  const result = await parsePdf({
    contextId: "card-test",
    sourceId: path,
    path,
    contentHash: path,
    blob: blobFrom(bytes),
  });
  return result.document;
}

function contextOf(documents: NormalizedDocument[]) {
  const map = new Map(documents.map((document) => [document.sourceId, document]));
  return { document: (sourceId: string) => map.get(sourceId), documents };
}

function emptyPack(): RepoPack {
  return { id: "pdf-only", name: "pdf-only", description: "pdf", files: [], commits: [] };
}

async function loadReady() {
  const names = ["lecture.pdf", "lecture-multi.pdf", "paper.pdf", "bullets.pdf", "headers.pdf", "slides.pdf"];
  const documents = await Promise.all(names.map(parseNamed));
  const chunks = documents.flatMap(buildDocumentChunks);
  return { documents, chunks, ctx: contextOf(documents), pack: emptyPack() };
}

test("DocumentEvidence card cites path · Page N with no line numbers", async () => {
  const { chunks, ctx, pack } = await loadReady();
  const query = "What does serializable isolation prevent?";
  const card = localCard(query, retrieve(query, chunks), pack, 0, null, ctx);
  assert.ok(card.say, card.reason);
  assert.equal(card.evidence?.[0]?.kind, "document");
  assert.equal(card.citations[0]?.kind, "document");
  const rendered = citationText(card.citations[0]);
  assert.match(rendered, /lecture\.pdf · Page 1/);
  assert.doesNotMatch(rendered, /:\d+/);
  assert.equal(citedPath(card.citations[0]), null);
  assert.doesNotMatch(card.say, /Isolation Levels|Secret/);
});

test("rank #1 lecture isolation sentence is rejected for the listing question", async () => {
  const { chunks, ctx, pack } = await loadReady();
  const query = "Which isolation levels does the lecture list?";
  const hits = retrieve(query, chunks);
  assert.equal(hits[0]?.kind, "document");
  assert.equal(hits[0] && "path" in hits[0] ? hits[0].path : "", "lecture.pdf");
  const card = localCard(query, hits, pack, 0, null, ctx);
  if (card.say) {
    assert.equal(card.evidence?.[0]?.kind, "document");
    assert.ok(card.evidence[0].kind === "document");
    assert.match(card.say.toLowerCase(), /read committed|isolation levels|read uncommitted|serializable/);
    assert.notEqual(card.evidence[0].path === "lecture.pdf" && !/\n|,/.test(card.say), true);
  }
});

test("shape: why without rationale and who without ownership stay silent", async () => {
  const { chunks, ctx, pack } = await loadReady();
  const why = localCard(
    "Why does serializable isolation prevent lost outcomes?",
    retrieve("Why does serializable isolation prevent lost outcomes?", chunks),
    pack,
    0,
    null,
    ctx,
  );
  assert.equal(why.say, null);
  const who = localCard(
    "Who owns isolation?",
    retrieve("Who owns isolation?", chunks),
    pack,
    0,
    null,
    ctx,
  );
  assert.equal(who.say, null);
  const absence = localCard(
    "Do we have unit tests for isolation?",
    retrieve("Do we have unit tests for isolation?", chunks),
    pack,
    0,
    null,
    ctx,
  );
  assert.equal(absence.say, null);
  assert.equal(documentFitsShape("absence", "Serializable isolation prevents lost outcomes."), false);
  assert.equal(documentFitsShape("who", "Jordan Lee discussed isolation in 2011."), false);
  assert.equal(documentFitsShape("why", "Serializable isolation prevents lost outcomes."), false);
  assert.equal(documentFitsShape("what", "Serializable isolation prevents lost outcomes."), true);
  assert.equal(
    documentFitsShape("how", "Predicate locks protect phantoms by locking the logical query."),
    true,
  );
});

test("unsupported lexical overlap stays silent", async () => {
  const { chunks, ctx, pack } = await loadReady();
  const weather = localCard(
    "What is the weather in Tokyo?",
    retrieve("What is the weather in Tokyo?", chunks),
    pack,
    0,
    null,
    ctx,
  );
  assert.equal(weather.say, null);
  const lockTable = localCard(
    "What is the weather in the lock table?",
    retrieve("What is the weather in the lock table?", chunks),
    pack,
    0,
    null,
    ctx,
  );
  assert.equal(lockTable.say, null);
  assert.equal((lockTable.evidence ?? []).some((item) => item.kind === "document"), false);
});

test("stale or missing NormalizedDocument cannot speak", async () => {
  const lecture = await parseNamed("lecture.pdf");
  const chunks = buildDocumentChunks(lecture);
  const query = "What does serializable isolation prevent?";
  const hits = retrieve(query, chunks);
  const silent = localCard(query, hits, emptyPack(), 0, null);
  assert.equal(silent.say, null);
  const stale = { ...lecture, contentHash: "stale-hash" };
  const staleCard = localCard(query, hits, emptyPack(), 0, null, contextOf([stale]));
  assert.equal(staleCard.say, null);
  const parser = { ...lecture, parserVersion: PDF_PARSER_VERSION + 1 };
  assert.equal(localCard(query, hits, emptyPack(), 0, null, contextOf([parser])).say, null);
  const normalizer = { ...lecture, normalizerVersion: DOCUMENT_NORMALIZER_VERSION + 1 };
  assert.equal(localCard(query, hits, emptyPack(), 0, null, contextOf([normalizer])).say, null);
});

test("mixed pack: code question stays TextEvidence, PDF question stays DocumentEvidence", async () => {
  const lecture = await parseNamed("lecture.pdf");
  const pack: RepoPack = {
    ...NORTHSTAR,
    files: [
      ...NORTHSTAR.files,
      {
        path: "src/iso.ts",
        language: "ts",
        content: "/** Isolation helper for retries. */\nexport function isolateLease() {}\n",
      },
    ],
  };
  const chunks = [...buildChunks(pack), ...buildDocumentChunks(lecture)];
  const ctx = contextOf([lecture]);

  const codeQ = "Why does that retry three times?";
  const codeCard = localCard(codeQ, retrieve(codeQ, chunks), pack, 0, null, ctx);
  assert.ok(codeCard.say, codeCard.reason);
  assert.equal((codeCard.evidence ?? []).every((item) => item.kind !== "document"), true);
  assert.ok((codeCard.evidence ?? []).some((item) => item.kind === "text" || item.kind === "commit"));

  const pdfQ = "What does serializable isolation prevent?";
  const pdfCard = localCard(pdfQ, retrieve(pdfQ, chunks), pack, 0, null, ctx);
  assert.ok(pdfCard.say, pdfCard.reason);
  assert.equal(pdfCard.evidence?.[0]?.kind, "document");
  assert.equal((pdfCard.evidence ?? []).some((item) => item.kind === "text"), false);

  const overlapCode = "What does the isolation helper for retries do?";
  const overlapCodeCard = localCard(overlapCode, retrieve(overlapCode, chunks), pack, 0, null, ctx);
  if (overlapCodeCard.say) {
    assert.equal((overlapCodeCard.evidence ?? []).every((item) => item.kind !== "document"), true);
  }

  const overlapPdf = "What does serializable isolation prevent?";
  const overlapPdfCard = localCard(overlapPdf, retrieve(overlapPdf, chunks), pack, 0, null, ctx);
  if (overlapPdfCard.say) {
    assert.equal(overlapPdfCard.evidence?.[0]?.kind, "document");
  }
});

test("PDF-backed card skips refine and never puts document text in the payload", async () => {
  const { chunks, ctx, pack } = await loadReady();
  const query = "What does serializable isolation prevent?";
  const hits = retrieve(query, chunks);
  const card = localCard(query, hits, pack, 0, null, ctx);
  assert.ok(card.say);
  assert.equal(shouldRefine(hits, card), false);
  const payload = refinePayload(hits);
  const blob = JSON.stringify(payload);
  assert.equal(blob.includes("Serializable isolation"), false);
  assert.equal(blob.includes("lecture.pdf"), false);
});

test("DocumentEvidence replay identity withdraws the same line only when resolved", async () => {
  const { chunks, ctx, pack } = await loadReady();
  const query = "What does serializable isolation prevent?";
  const hits = retrieve(query, chunks);
  const first = localCard(query, hits, pack, 0, null, ctx);
  assert.ok(first.say);
  assert.ok(first.evidence?.[0] && first.evidence[0].kind === "document");
  const again = localCard(query, hits, pack, 0, null, ctx);
  assert.equal(again.evidence?.[0] && again.evidence[0].kind === "document" ? again.evidence[0].id : "", first.evidence[0].id);
  const thread = threadFrom({
    utteranceId: "e1",
    canonical: query,
    shape: shapeOf(query),
    subject: subjectTerms(contentWords(query), pack),
    card: first,
  });
  assert.ok(thread);
  assert.ok(thread.files.some((path) => path.endsWith(".pdf")));
  const replay = withdrawReplay(again, thread, true);
  assert.equal(replay.say, null);
  const secondEvent = withdrawReplay(again, thread, false);
  assert.equal(secondEvent.say, first.say);
});

test("spoken document card is current and word-supported by supportText", async () => {
  const { documents, chunks, ctx, pack } = await loadReady();
  const query = "What does serializable isolation prevent?";
  const card = localCard(query, retrieve(query, chunks), pack, 0, null, ctx);
  assert.ok(card.say);
  const evidence = card.evidence?.[0];
  assert.ok(evidence && evidence.kind === "document");
  const document = documents.find((item) => item.sourceId === evidence.sourceId);
  assert.ok(document);
  assert.equal(
    evidenceIsCurrent(evidence, {
      file: () => undefined,
      commit: () => undefined,
      document: (id) => (id === document.sourceId ? document : undefined),
    }),
    true,
  );
  assert.equal(reconstructSourceText(document, evidence.itemRanges), evidence.sourceText);
  assert.equal(verifyClaim(card.say, [evidence]).ok, true);
  assert.equal(card.say.toLowerCase().includes("isolation"), true);
});

test("chunk heading metadata is not spoken unless it is in the mapped range", async () => {
  const lecture = await parseNamed("lecture.pdf");
  const chunks = buildDocumentChunks(lecture).map((chunk) => ({ ...chunk, heading: "Secret Outline" }));
  const hits: Hit[] = retrieve("What does serializable isolation prevent?", chunks);
  const card = localCard(
    "What does serializable isolation prevent?",
    hits,
    emptyPack(),
    0,
    null,
    contextOf([lecture]),
  );
  if (card.say) {
    assert.doesNotMatch(card.say, /Secret Outline/);
    assert.equal(card.citations[0] && "heading" in card.citations[0] ? card.citations[0].heading : undefined, undefined);
  }
});

test("invalid mapped evidence is not converted to TextEvidence", async () => {
  const lecture = await parseNamed("lecture.pdf");
  const page = lecture.pages[0];
  const bogus = documentEvidenceFromRange({
    document: lecture,
    page: page.pageNumber,
    normStart: 0,
    normEnd: 0,
    spokenText: "Serializable isolation prevents lost outcomes.",
  });
  assert.equal(bogus, null);
  const query = "What does serializable isolation prevent?";
  const card = localCard(query, retrieve(query, buildDocumentChunks(lecture)), emptyPack(), 0, null);
  assert.equal(card.say, null);
  assert.equal((card.evidence ?? []).some((item) => item.kind === "text"), false);
});

function spokenCard(card: Card): void {
  assert.ok(card.say);
}
void spokenCard;
