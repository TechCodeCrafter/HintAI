import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../../../context/index-versions.ts";
import { createMemoryRepository } from "../../../context/memory.ts";
import { hashBlob } from "../../../context/hash.ts";
import { indexContext } from "../../../context/chunk-index.ts";
import { isPdfSource } from "../../../context/types.ts";
import { documentEvidenceFromRange } from "../../evidence.ts";
import { buildPdfBytes } from "../../pdf/build-fixture.ts";
import { EVAL_PDF_FIXTURES } from "../../pdf/eval-fixtures.ts";
import { parseAndPersistPdf } from "../../pdf/ingest.ts";
import { parsePdf } from "../../pdf/parse.ts";
import { normalizePage } from "../../pdf/normalize.ts";
import type { NormalizedDocument, NormalizedPage, PdfTextItem } from "../../types.ts";
import { citedPath, citationText, isDocumentCitation, isFileCitation } from "../../../search/cite.ts";
import type { Card, DocumentCitation, FileCitation } from "../../../repo/types.ts";
import type { DocumentEvidence } from "../../../search/evidence.ts";
import { viewerAvailability } from "../currentness.ts";
import { highlightOnlyEvidenceItems, itemViewportBox, planHighlight } from "../highlight.ts";
import { buildTextLayerMap, textDivIndexForItem } from "../map.ts";
import { resetViewerMetrics, viewerMetricsSnapshot } from "../metrics.ts";
import { keepBlobHashes, retainKeysFromCard, setViewerBlobPins, syncViewerBlobPins } from "../retain.ts";
import { documentEvidenceForCitation, evidenceForOpenTarget, resolveDocumentOpen } from "../resolve.ts";
import { createViewerSession } from "../session.ts";

function item(index: number, str: string, x: number, y: number, width = 80, height = 12): PdfTextItem {
  return { itemIndex: index, str, transform: [1, 0, 0, 1, x, y], width, height };
}

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

function documentOf(page: NormalizedPage, extras: Partial<NormalizedDocument> = {}): NormalizedDocument {
  return {
    contextId: "ctx",
    sourceId: extras.sourceId ?? "src-1",
    path: extras.path ?? "notes.pdf",
    contentHash: extras.contentHash ?? "hash-1",
    type: "pdf",
    parserVersion: extras.parserVersion ?? PDF_PARSER_VERSION,
    normalizerVersion: extras.normalizerVersion ?? DOCUMENT_NORMALIZER_VERSION,
    pageCount: extras.pageCount ?? 1,
    outline: extras.outline ?? [],
    pages: extras.pages ?? [page],
    readiness: "ready",
    ...extras,
  };
}

function syntheticLayer(page: NormalizedPage) {
  const max = Math.max(0, ...page.items.map((entry) => entry.itemIndex));
  const raw: Array<{ str?: string }> = Array.from({ length: max + 1 }, () => ({}));
  for (const entry of page.items) raw[entry.itemIndex] = { str: entry.str };
  const withStr = raw.filter((entry) => entry.str !== undefined);
  const divs = withStr.map((entry) => ({ textContent: entry.str ?? "" }));
  return { raw, divs, map: buildTextLayerMap(raw, divs) };
}

function evidenceOn(document: NormalizedDocument, needle: string): DocumentEvidence {
  const page = document.pages[0];
  const start = page.text.indexOf(needle);
  assert.ok(start >= 0, `missing ${needle} in ${page.text}`);
  const built = documentEvidenceFromRange({
    document,
    page: page.pageNumber,
    normStart: start,
    normEnd: start + needle.length,
    spokenText: needle,
  });
  assert.ok(built);
  return built;
}

function cardOf(evidence: DocumentEvidence): Card {
  return {
    say: evidence.spokenText,
    citations: [
      {
        kind: "document",
        sourceId: evidence.sourceId,
        path: evidence.path,
        page: evidence.page,
        evidenceId: evidence.id,
        label: "",
      },
    ],
    evidence: [evidence],
    query: "q",
    latencyMs: 0,
    source: "local",
  };
}

test("text-layer map is not children[itemIndex]; one item is one textDiv", () => {
  const raw = [{ type: "beginMarkedContent" }, { str: "Hello" }, { str: "world" }, { type: "endMarkedContent" }];
  assert.equal(textDivIndexForItem(raw, 1), 0);
  assert.equal(textDivIndexForItem(raw, 2), 1);
  assert.equal(textDivIndexForItem(raw, 0), null);
  const divs = [{ textContent: "Hello" }, { textContent: "world" }];
  const map = buildTextLayerMap(raw, divs);
  assert.equal(map.divByItem[1], 0);
  assert.equal(map.stringsMatch, true);
  assert.notEqual(map.divByItem[2], 2);
});

test("citation resolves by sourceId + contentHash via Card evidence, not path", () => {
  const page = normalizePage({
    pageNumber: 3,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 240)],
  });
  const oldDoc = documentOf(page, { contentHash: "OLD_HASH", path: "lecture.pdf" });
  const newDoc = documentOf(
    normalizePage({
      pageNumber: 3,
      pageWidth: 612,
      pageHeight: 792,
      items: [item(0, "A newer revision says something else entirely here.", 72, 700, 240)],
    }),
    { contentHash: "NEW_HASH", path: "lecture.pdf", sourceId: "src-1" },
  );
  const oldEv = evidenceOn(oldDoc, "Serializable isolation prevents lost outcomes.");
  const cite: DocumentCitation = {
    kind: "document",
    sourceId: "src-1",
    path: "lecture.pdf",
    page: 3,
    evidenceId: oldEv.id,
    label: "",
  };
  const resolved = resolveDocumentOpen(cardOf(oldEv), cite);
  assert.ok(resolved.target);
  assert.equal(resolved.target.contentHash, "OLD_HASH");
  assert.equal(resolved.evidence.contentHash, "OLD_HASH");
  assert.equal(documentEvidenceForCitation(cardOf(evidenceOn(newDoc, "A newer revision says something else entirely here.")), cite), null);
  assert.equal(citedPath(cite), null);
});

test("manual Repo open has no evidence highlight target", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 240)],
  });
  const evidence = evidenceOn(documentOf(page), "Serializable isolation prevents lost outcomes.");
  const browse = { sourceId: evidence.sourceId, contentHash: evidence.contentHash, page: 1, evidenceId: "" };
  assert.equal(evidenceForOpenTarget(cardOf(evidence), browse), null);
});

test("citation page N is the open page", () => {
  const page = normalizePage({
    pageNumber: 18,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Predicate locks protect phantoms.", 72, 700, 200)],
  });
  const document = documentOf(page, { pageCount: 20, pages: [page] });
  const evidence = evidenceOn(document, "Predicate locks protect phantoms.");
  assert.equal(evidence.page, 18);
  const { target } = resolveDocumentOpen(cardOf(evidence), cardOf(evidence).citations[0] as DocumentCitation);
  assert.equal(target?.page, 18);
});

test("exact highlight uses only the requested character range", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable isolation prevents concurrent transactions", 72, 700, 320)],
  });
  const document = documentOf(page);
  const evidence = evidenceOn(document, "prevents concurrent transactions");
  assert.equal(evidence.itemRanges.length, 1);
  assert.equal(evidence.itemRanges[0].itemIndex, 0);
  assert.ok(evidence.itemRanges[0].charStart > 0, "must not paint the whole item");
  const layer = syntheticLayer(page);
  const plan = planHighlight({ evidence, document, ...layer });
  assert.equal(plan.mode, "exact");
  assert.deepEqual(plan.exact, [
    {
      itemIndex: 0,
      charStart: evidence.itemRanges[0].charStart,
      charEnd: evidence.itemRanges[0].charEnd,
    },
  ]);
  assert.equal(highlightOnlyEvidenceItems(plan, evidence.itemRanges), true);
});

test("multi-item evidence highlights every itemRange and no neighbor", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable isolation", 72, 700, 140), item(1, "prevents anomalies", 220, 700, 120), item(2, "Secret", 400, 700, 40)],
  });
  const document = documentOf(page);
  const evidence = evidenceOn(document, "Serializable isolation prevents anomalies");
  const plan = planHighlight({ evidence, document, ...syntheticLayer(page) });
  assert.equal(plan.mode, "exact");
  assert.equal(plan.exact.length, 2);
  assert.deepEqual(plan.exact.map((entry) => entry.itemIndex), [0, 1]);
  assert.equal(plan.exact.some((entry) => entry.itemIndex === 2), false);
});

test("dehyphenated support still highlights the two source fragments", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "serial-", 72, 700, 40), item(1, "izable", 72, 684, 40)],
  });
  const document = documentOf(page);
  const start = page.text.indexOf("serializable");
  const evidence = documentEvidenceFromRange({
    document,
    page: 1,
    normStart: start,
    normEnd: start + "serializable".length,
    spokenText: "serializable",
  });
  assert.ok(evidence);
  assert.equal(evidence.supportText, "serializable");
  assert.equal(page.items[0].str, "serial-");
  assert.equal(page.items[1].str, "izable");
  const plan = planHighlight({ evidence, document, ...syntheticLayer(page) });
  assert.equal(plan.mode, "exact");
  assert.equal(plan.exact.length, 2);
  assert.deepEqual(
    plan.exact,
    evidence.itemRanges.map((range) => ({
      itemIndex: range.itemIndex,
      charStart: range.charStart,
      charEnd: range.charEnd,
    })),
  );
  assert.equal(evidence.itemRanges[0]?.itemIndex, 0);
  assert.equal(evidence.itemRanges[1]?.itemIndex, 1);
});

test("text-layer mismatch falls back to item-box, never fuzzy search", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 240)],
  });
  const document = documentOf(page);
  const evidence = evidenceOn(document, "Serializable isolation prevents lost outcomes.");
  const raw = [{ str: "Serializable isolation prevents lost outcomes." }];
  const divs = [{ textContent: "something else entirely" }];
  const map = buildTextLayerMap(raw, divs);
  assert.equal(map.stringsMatch, false);
  const viewport = {
    convertToViewportPoint: (x: number, y: number) => [x, 792 - y],
  };
  const plan = planHighlight({ evidence, document, map, divs, viewport });
  assert.equal(plan.mode, "item-box");
  assert.equal(plan.boxes.length, 1);
  assert.equal(plan.boxes[0].itemIndex, 0);
});

test("item-box fallback paints only evidence items", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Left claim lives here.", 72, 700, 120), item(1, "Right claim lives here.", 340, 700, 120)],
  });
  const document = documentOf(page);
  const evidence = evidenceOn(document, "Left claim lives here.");
  const plan = planHighlight({
    evidence,
    document,
    viewport: { convertToViewportPoint: (x, y) => [x, y] },
    forceMode: "item-box",
  });
  assert.equal(plan.mode, "item-box");
  assert.deepEqual(plan.boxes.map((box) => box.itemIndex), [0]);
  assert.equal(highlightOnlyEvidenceItems(plan, evidence.itemRanges), true);
});

test("caption-only fallback has no highlight boxes", () => {
  const page = normalizePage({
    pageNumber: 4,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 240)],
  });
  const document = documentOf(page);
  const evidence = evidenceOn(document, "Serializable isolation prevents lost outcomes.");
  const plan = planHighlight({ evidence, document, forceMode: "caption-only" });
  assert.equal(plan.mode, "caption-only");
  assert.equal(plan.exact.length, 0);
  assert.equal(plan.boxes.length, 0);
  assert.equal(plan.page, 4);
  assert.match(plan.caption, /Serializable isolation/);
});

test("two-column left and right evidence stay in their columns", async () => {
  const parsed = await parsePdf({
    contextId: "twocol",
    sourceId: "paper",
    path: "paper.pdf",
    contentHash: "paper",
    blob: blobFrom(EVAL_PDF_FIXTURES["paper.pdf"]),
  });
  const document = parsed.document;
  const page = document.pages[0];
  const left = evidenceOn(document, "Two-phase locking requires waits");
  const right = evidenceOn(document, "Snapshot isolation allows write skew");
  const viewport = { convertToViewportPoint: (x: number, y: number) => [x, y] };
  const leftPlan = planHighlight({ evidence: left, document, viewport, forceMode: "item-box" });
  const rightPlan = planHighlight({ evidence: right, document, viewport, forceMode: "item-box" });
  assert.ok(leftPlan.boxes.length > 0);
  assert.ok(rightPlan.boxes.length > 0);
  const leftItems = new Set(left.itemRanges.map((range) => range.itemIndex));
  const rightItems = new Set(right.itemRanges.map((range) => range.itemIndex));
  for (const index of leftItems) assert.equal(rightItems.has(index), false);
  const leftOrigins = page.items.filter((entry) => leftItems.has(entry.itemIndex));
  const rightOrigins = page.items.filter((entry) => rightItems.has(entry.itemIndex));
  assert.ok(leftOrigins.length > 0);
  assert.ok(rightOrigins.length > 0);
  assert.ok(leftOrigins.every((entry) => entry.transform[4] < 200));
  assert.ok(rightOrigins.every((entry) => entry.transform[4] > 300));
  assert.ok(leftPlan.boxes.every((box) => leftItems.has(box.itemIndex)));
  assert.ok(rightPlan.boxes.every((box) => rightItems.has(box.itemIndex)));
});

test("stale revision does not open or highlight a newer blob", async () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Old revision body text is here.", 72, 700, 200)],
  });
  const evidence = evidenceOn(documentOf(page, { contentHash: "OLD_HASH" }), "Old revision body text is here.");
  const session = createViewerSession({
    getSourceBlob: async (_id, hash) => (hash === "NEW_HASH" ? new Blob(["%PDF-new"]) : null),
    getNormalizedDocument: async () => documentOf(page, { contentHash: "NEW_HASH" }),
  });
  const state = await session.prepare({ sourceId: "src-1", contentHash: "OLD_HASH", page: 1, evidenceId: evidence.id }, evidence);
  assert.equal(state.availability, "stale");
  assert.equal(state.plan, null);
  assert.match(state.message ?? "", /no longer available/);
});

test("viewer availability refuses a hash mismatch even when a blob exists", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Old revision body text is here.", 72, 700, 200)],
  });
  const evidence = evidenceOn(documentOf(page, { contentHash: "OLD_HASH" }), "Old revision body text is here.");
  assert.equal(
    viewerAvailability({
      blob: new Blob(["x"]),
      evidence,
      document: documentOf(page, { contentHash: "NEW_HASH" }),
      requestedHash: "OLD_HASH",
    }),
    "stale",
  );
});

test("late prepare A cannot replace prepare B", async () => {
  let resolveA: ((blob: Blob | null) => void) | undefined;
  const session = createViewerSession({
    getSourceBlob: async (_id, hash) => {
      if (hash === "A") {
        return await new Promise<Blob | null>((resolve) => {
          resolveA = resolve;
        });
      }
      return new Blob(["B"]);
    },
    getNormalizedDocument: async () => null,
  });
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Alpha evidence text is present.", 72, 700, 180)],
  });
  const a = evidenceOn(documentOf(page, { contentHash: "A", sourceId: "a" }), "Alpha evidence text is present.");
  const bPage = normalizePage({
    pageNumber: 2,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Beta evidence text is present.", 72, 700, 180)],
  });
  const b = evidenceOn(documentOf(bPage, { contentHash: "B", sourceId: "b", pages: [bPage] }), "Beta evidence text is present.");
  const first = session.prepare({ sourceId: "a", contentHash: "A", page: 1, evidenceId: a.id }, a);
  const second = session.prepare({ sourceId: "b", contentHash: "B", page: 2, evidenceId: b.id }, b);
  resolveA?.(new Blob(["A"]));
  await first;
  await second;
  assert.equal(session.getState().evidenceId, b.id);
  assert.notEqual(session.getState().evidenceId, a.id);
});

test("discard during a pending load drops the late result", async () => {
  let resolveBlob: ((blob: Blob | null) => void) | undefined;
  const session = createViewerSession({
    getSourceBlob: async () =>
      await new Promise<Blob | null>((resolve) => {
        resolveBlob = resolve;
      }),
    getNormalizedDocument: async () => null,
  });
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Pending evidence text is present.", 72, 700, 180)],
  });
  const evidence = evidenceOn(documentOf(page), "Pending evidence text is present.");
  const pending = session.prepare({ sourceId: "src-1", contentHash: "hash-1", page: 1, evidenceId: evidence.id }, evidence);
  session.discard();
  resolveBlob?.(new Blob(["x"]));
  await pending;
  assert.equal(session.getState().evidenceId, null);
});

test("Card and open pane pins keep a revision across GC", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const oldBlob = blobFrom(buildPdfBytes({ pages: [{ items: [{ str: "Old revision body text is here.", x: 72, y: 700 }] }] }));
  const newBlob = blobFrom(buildPdfBytes({ pages: [{ items: [{ str: "New revision body text is here.", x: 72, y: 700 }] }] }));
  const [source] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: oldBlob }]);
  assert.ok(isPdfSource(source));
  await parseAndPersistPdf(repo, context.id, source);
  const oldHash = source.contentHash;
  const page = (await repo.getNormalizedDocument(source.id, oldHash))!.pages[0];
  const evidence = evidenceOn((await repo.getNormalizedDocument(source.id, oldHash))!, page.text.slice(0, 24));
  syncViewerBlobPins(cardOf(evidence), { sourceId: source.id, contentHash: oldHash, page: 1, evidenceId: evidence.id });
  await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: newBlob }]);
  const staged = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(staged));
  await parseAndPersistPdf(repo, context.id, staged);
  await indexContext(repo, context.id);
  await repo.completeContextActivation(context.id);
  assert.ok(await repo.getSourceBlob(source.id, oldHash));
  assert.ok(await repo.getSourceBlob(source.id, await hashBlob(newBlob)));
  setViewerBlobPins([]);
});

test("viewer opening loads the blob; indexing a ready PDF does not", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const blob = blobFrom(EVAL_PDF_FIXTURES["lecture.pdf"]);
  const [source] = await repo.upsertSources(context.id, [{ path: "lecture.pdf", kind: "pdf", blob }]);
  assert.ok(isPdfSource(source));
  await parseAndPersistPdf(repo, context.id, source);
  repo.blobLoadCount = 0;
  await indexContext(repo, context.id);
  assert.equal(repo.blobLoadCount, 0);
  const document = await repo.getNormalizedDocument(source.id, source.contentHash);
  assert.ok(document);
  const before = repo.blobLoadCount;
  const loaded = await repo.getSourceBlob(source.id, source.contentHash);
  assert.ok(loaded);
  assert.equal(repo.blobLoadCount, before + 1);
});

test("FileCitation and CommitCitation behavior is unchanged", () => {
  const file: FileCitation = { kind: "file", path: "src/retry.ts", line: 8, label: "PR #1" };
  assert.equal(isFileCitation(file), true);
  assert.equal(citedPath(file), "src/retry.ts");
  assert.equal(citationText(file), "src/retry.ts:8");
  const commit = {
    kind: "commit" as const,
    sha: "c4d88aa000000000000000000000000000000000",
    shortSha: "c4d88aa",
    pr: "640",
    label: "Jordan",
  };
  assert.equal(citedPath(commit), null);
  assert.equal(isDocumentCitation(commit), false);
  assert.equal(citationText(commit), "Commit c4d88aa · PR #640");
});

test("itemViewportBox uses convertToViewportPoint, not guessed scale", () => {
  const box = itemViewportBox(item(0, "Hello", 10, 20, 40, 12), {
    convertToViewportPoint: (x, y) => [x * 2, y * 2],
  });
  assert.ok(box);
  assert.equal(box.x, 20);
  assert.equal(box.y, 40);
  assert.equal(box.w, 80);
  assert.equal(box.h, 24);
});

test("viewer metrics record exact vs fallback honestly", () => {
  resetViewerMetrics();
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 240)],
  });
  const document = documentOf(page);
  const evidence = evidenceOn(document, "Serializable isolation prevents lost outcomes.");
  const exact = planHighlight({ evidence, document, ...syntheticLayer(page) });
  assert.equal(exact.mode, "exact");
  const caption = planHighlight({ evidence, document, forceMode: "caption-only" });
  assert.equal(caption.mode, "caption-only");
  const snap = viewerMetricsSnapshot();
  assert.equal(snap.wrongPage, 0);
  assert.equal(snap.wrongText, 0);
});

test("retain keys come from Card evidence and the open target, not path", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 240)],
  });
  const evidence = evidenceOn(documentOf(page, { sourceId: "src", contentHash: "abc" }), "Serializable isolation prevents lost outcomes.");
  const keys = retainKeysFromCard(cardOf(evidence), { sourceId: "src", contentHash: "abc", page: 1, evidenceId: evidence.id });
  assert.deepEqual(keys, ["src:abc"]);
  setViewerBlobPins(keys);
  const keep = keepBlobHashes(["other:1"]);
  assert.equal(keep.has("src:abc"), true);
  setViewerBlobPins([]);
});
