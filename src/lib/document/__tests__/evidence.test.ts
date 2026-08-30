import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../../context/index-versions.ts";
import { reconstructSourceText } from "../source-text.ts";
import type { NormalizedDocument, PdfTextItem } from "../types.ts";
import { documentEvidenceFromRange, documentEvidenceId } from "../evidence.ts";
import { normalizePage } from "../pdf/normalize.ts";
import { documentIsCurrent, verifyClaim } from "../../search/evidence.ts";

function item(index: number, str: string, x: number, y: number, width = 50, height = 12): PdfTextItem {
  return { itemIndex: index, str, transform: [1, 0, 0, 1, x, y], width, height };
}

function documentOf(
  page: ReturnType<typeof normalizePage>,
  extras: Partial<NormalizedDocument> = {},
): NormalizedDocument {
  return {
    contextId: "ctx",
    sourceId: extras.sourceId ?? "src-1",
    path: extras.path ?? "Lecture-08.pdf",
    contentHash: extras.contentHash ?? "hash-1",
    type: "pdf",
    parserVersion: extras.parserVersion ?? PDF_PARSER_VERSION,
    normalizerVersion: extras.normalizerVersion ?? DOCUMENT_NORMALIZER_VERSION,
    pageCount: 1,
    outline: extras.outline ?? [],
    pages: extras.pages ?? [page],
    readiness: "ready",
    ...extras,
  };
}

test("exact range maps to itemRanges, sourceText, and supportText", () => {
  const page = normalizePage({
    pageNumber: 18,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable", 72, 700, 80), item(1, "isolation", 170, 700, 60)],
  });
  const start = page.text.indexOf("Serializable");
  const end = page.text.indexOf("isolation") + "isolation".length;
  const document = documentOf(page, { outline: [{ title: "Isolation Levels", page: 18 }] });
  const evidence = documentEvidenceFromRange({
    document,
    page: 18,
    normStart: start,
    normEnd: end,
    spokenText: "Serializable isolation",
  });
  assert.ok(evidence);
  assert.equal(evidence.supportText, page.text.slice(start, end));
  assert.equal(evidence.supportText, "Serializable isolation");
  assert.equal(evidence.sourceText, "Serializableisolation");
  assert.equal(reconstructSourceText(document, evidence.itemRanges), evidence.sourceText);
  assert.deepEqual(evidence.itemRanges, [
    { page: 18, itemIndex: 0, charStart: 0, charEnd: 12 },
    { page: 18, itemIndex: 1, charStart: 0, charEnd: 9 },
  ]);
  assert.equal(evidence.heading, "Isolation Levels");
  assert.equal(
    evidence.id,
    documentEvidenceId(document.sourceId, document.contentHash, 18, start, end),
  );
});

test("inserted space may appear in support and spoken but not in sourceText", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "serializable", 72, 700, 70), item(1, "isolation", 200, 700, 50)],
  });
  const document = documentOf(page);
  const evidence = documentEvidenceFromRange({
    document,
    page: 1,
    normStart: 0,
    normEnd: page.text.length,
    spokenText: "serializable isolation",
  });
  assert.ok(evidence);
  assert.equal(evidence.supportText, "serializable isolation");
  assert.equal(evidence.sourceText, "serializableisolation");
  assert.equal(evidence.sourceText.includes(" "), false);
  assert.equal(verifyClaim(evidence.spokenText, [evidence]).ok, true);
});

test("dehyphenation is in supportText while sourceText stays item slices", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [
      item(0, "Safe", 72, 720, 30),
      item(1, "serial-", 72, 700, 40),
      item(2, "izable", 72, 684, 40),
      item(3, "isolation", 72, 668, 50),
      item(4, "prevents", 72, 652, 50),
      item(5, "lost", 72, 636, 30),
      item(6, "outcomes.", 72, 620, 60),
    ],
  });
  const document = documentOf(page);
  const start = page.text.indexOf("serializable");
  assert.ok(start >= 0, page.text);
  const end = page.text.indexOf("outcomes.") + "outcomes.".length;
  const spoken = "serializable isolation prevents lost outcomes.";
  const evidence = documentEvidenceFromRange({
    document,
    page: 1,
    normStart: start,
    normEnd: end,
    spokenText: spoken,
  });
  assert.ok(evidence, page.text);
  assert.match(evidence.supportText, /serializable/);
  assert.equal(evidence.supportText.includes("serial-"), false);
  assert.equal(page.items[1].str, "serial-");
  assert.equal(page.items[2].str, "izable");
  assert.equal(reconstructSourceText(document, evidence.itemRanges), evidence.sourceText);
  assert.equal(evidence.sourceText.includes("serializable") || evidence.sourceText.includes("serial"), true);
  assert.equal(documentIsCurrent(evidence, document), true);
  assert.equal(verifyClaim(spoken, [evidence]).ok, true);
});

test("invalid normalized range produces no evidence", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Hello world today now.", 72, 700, 120)],
  });
  const document = documentOf(page);
  assert.equal(
    documentEvidenceFromRange({ document, page: 1, normStart: -1, normEnd: 4, spokenText: "Hello" }),
    null,
  );
  assert.equal(
    documentEvidenceFromRange({
      document,
      page: 1,
      normStart: 0,
      normEnd: page.text.length + 1,
      spokenText: "Hello",
    }),
    null,
  );
  assert.equal(
    documentEvidenceFromRange({ document, page: 9, normStart: 0, normEnd: 4, spokenText: "Hello" }),
    null,
  );
});

test("stale hash, versions, missing document, and invalid itemRanges fail currentness", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 200)],
  });
  const document = documentOf(page);
  const evidence = documentEvidenceFromRange({
    document,
    page: 1,
    normStart: 0,
    normEnd: page.text.length,
    spokenText: "Serializable isolation prevents lost outcomes.",
  });
  assert.ok(evidence);
  assert.equal(documentIsCurrent(evidence, document), true);
  assert.equal(documentIsCurrent(evidence, undefined), false);
  assert.equal(documentIsCurrent({ ...evidence, contentHash: "other" }, document), false);
  assert.equal(documentIsCurrent({ ...evidence, parserVersion: PDF_PARSER_VERSION + 1 }, document), false);
  assert.equal(
    documentIsCurrent({ ...evidence, normalizerVersion: DOCUMENT_NORMALIZER_VERSION + 1 }, document),
    false,
  );
  assert.equal(documentIsCurrent({ ...evidence, itemRanges: [] }, document), false);
  assert.equal(
    documentIsCurrent(
      {
        ...evidence,
        itemRanges: [{ page: 1, itemIndex: 99, charStart: 0, charEnd: 4 }],
      },
      document,
    ),
    false,
  );
  assert.equal(
    documentIsCurrent({ ...evidence, sourceId: "" }, { ...document, sourceId: "" }),
    false,
  );
});
