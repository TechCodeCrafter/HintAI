import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENT_NORMALIZER_VERSION } from "../../../context/index-versions.ts";
import { documentIsCurrent } from "../../../search/evidence.ts";
import { documentEvidenceFromRange } from "../../evidence.ts";
import type { PdfTextItem } from "../../types.ts";
import { detectReadingOrder, findDominantProseRegions, isTableLikeGrid, itemProseMass } from "../layout.ts";
import { assertMappedCoverage, mappingErrors } from "../map.ts";
import { normalizePage } from "../normalize.ts";

function item(index: number, str: string, x: number, y: number, width = 40, height = 12): PdfTextItem {
  return { itemIndex: index, str, transform: [1, 0, 0, 1, x, y], width, height };
}

function bertLikeItems(): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  let index = 0;
  for (let row = 0; row < 8; row += 1) {
    items.push(item(index, "The pretraining objective uses bidirectional context in every layer.", 72, 700 - row * 16, 200));
    index += 1;
    items.push(item(index, "Fine-tuning then reuses the same parameters for each downstream task.", 320, 700 - row * 16, 200));
    index += 1;
  }
  items.push(item(index, "See appendix C for the ablation details.", 190, 690, 90));
  items.push(item(index + 1, "More appendix notes sit in this gutter.", 190, 674, 90));
  items.push(item(index + 2, "Cited as Devlin et al. in the margin.", 430, 690, 90));
  items.push(item(index + 3, "Second margin cite continues the same rail.", 430, 674, 90));
  return items;
}

function resnetLikeItems(): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  let index = 0;
  for (let row = 0; row < 8; row += 1) {
    items.push(item(index, "Residual connections let stacked layers learn residual functions.", 53, 700 - row * 16, 220));
    index += 1;
    items.push(item(index, "Identity shortcuts keep the optimization landscape well behaved.", 308, 700 - row * 16, 220));
    index += 1;
  }
  items.push(item(index, "Table 1 reports top-1 error.", 180, 560, 120));
  items.push(item(index + 1, "Fig. 2 shows the residual block.", 400, 560, 140));
  return items;
}

test("prose mass is alphabetic characters, not overflowing width", () => {
  const overflowing = item(0, "Short left", 108, 700, 396);
  const right = item(1, "Right column prose sits here with several words.", 340, 680, 180);
  assert.equal(itemProseMass(overflowing), 9);
  assert.ok(itemProseMass(right) > itemProseMass(overflowing));
  const analysis = findDominantProseRegions([overflowing, right], 612);
  assert.equal(analysis.widthDistrust, true);
});

test("more than two x clusters with two dominant prose regions is two-column", () => {
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items: bertLikeItems() });
  assert.equal(page.readingOrder, "two-column");
  assert.equal(page.index, "full");
  const analysis = findDominantProseRegions(bertLikeItems(), 612);
  assert.equal(analysis.twoDominantProse, true);
  assert.ok(analysis.extraClusterCount >= 1);
  assert.ok(typeof page.columnBreakOffset === "number");
  const left = page.text.slice(0, page.columnBreakOffset);
  const right = page.text.slice((page.columnBreakOffset ?? 0) + 1);
  assert.match(left, /pretraining objective/);
  assert.match(right, /Fine-tuning then reuses/);
  assert.equal(left.includes("Fine-tuning then reuses"), false);
  assert.equal(mappingErrors(page).length, 0);
  assertMappedCoverage(page);
});

test("title and author leftover clusters do not prevent two-column", () => {
  const items = [
    item(0, "BERT: Pre-training of Deep Bidirectional Transformers", 72, 760, 400),
    item(1, "Jacob Devlin Ming-Wei Chang Kenton Lee Kristina Toutanova", 72, 740, 400),
    ...bertLikeItems().map((entry, index) => item(index + 2, entry.str, itemX(entry), itemY(entry) - 80, entry.width)),
  ];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.equal(page.readingOrder, "two-column");
  assertMappedCoverage(page);
});

function itemX(entry: PdfTextItem): number {
  return entry.transform[4];
}

function itemY(entry: PdfTextItem): number {
  return entry.transform[5];
}

test("ResNet-like extra clusters classify as two-column", () => {
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items: resnetLikeItems() });
  assert.equal(page.readingOrder, "two-column");
  assertMappedCoverage(page);
});

test("overflow-width left item and right-region item on the same y never share a line", () => {
  const items = [
    item(0, "Recurrent models typically factor computation along the input", 108, 700, 396, 10),
    item(1, "Attention replaces recurrence with weighted memory access.", 340, 700, 180, 10),
    item(2, "The encoder stack reads the source sequence from left to right.", 108, 680, 396, 10),
    item(3, "The decoder stack then emits target tokens auto-regressively.", 340, 680, 180, 10),
  ];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.notEqual(page.readingOrder, "single-column");
  assert.equal(page.text.includes("input Attention"), false);
  assert.equal(page.text.includes("inputAttention"), false);
  const layout = detectReadingOrder(items, 612);
  for (const line of [...layout.left, ...layout.right, ...layout.lines]) {
    const origins = line.items.map((entry) => entry.transform[4]);
    const hasLeft = origins.some((x) => x < 200);
    const hasRight = origins.some((x) => x > 300);
    assert.equal(hasLeft && hasRight, false);
  }
  assert.equal(mappingErrors(page).length, 0);
  assertMappedCoverage(page);
});

test("cross-gutter risk never becomes false single-column", () => {
  const items = [
    item(0, "Recurrent models typically factor computation along the input", 108, 700, 396, 10),
    item(1, "decoder stack.", 340, 700, 80, 10),
  ];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  const analysis = findDominantProseRegions(items, 612);
  assert.equal(analysis.crossGutterRisk, true);
  assert.equal(analysis.refuseSingleColumn, true);
  assert.notEqual(page.readingOrder, "single-column");
});

test("indented bullets stay single-column", () => {
  const items = [
    item(0, "The isolation levels are:", 72, 700, 160),
    item(1, "read uncommitted", 90, 680, 100),
    item(2, "read committed", 90, 662, 100),
    item(3, "repeatable read", 90, 644, 100),
    item(4, "serializable", 90, 626, 80),
  ];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.equal(page.readingOrder, "single-column");
});

test("one prose region plus equation indents is not fake two-column", () => {
  const items = [
    item(0, "Gradient descent updates each parameter using the residual of the fit.", 72, 700, 280),
    item(1, "The update rule for a single example is written as follows.", 72, 682, 280),
    item(2, "θ", 200, 650, 8),
    item(3, ":=", 214, 650, 10),
    item(4, "θ", 230, 650, 8),
    item(5, "−", 244, 650, 8),
    item(6, "α", 256, 650, 8),
    item(7, "∇", 270, 650, 8),
    item(8, "J", 284, 650, 8),
    item(9, "Those symbols sit inside one lecture column, not a second body.", 72, 620, 280),
  ];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.notEqual(page.readingOrder, "two-column");
  assert.ok(page.readingOrder === "single-column" || page.readingOrder === "uncertain");
});

test("stable dense grid stays skipped", () => {
  const items: PdfTextItem[] = [];
  let index = 0;
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      items.push(item(index, `c${row}${col}`, 80 + col * 80, 700 - row * 20, 24));
      index += 1;
    }
  }
  assert.equal(isTableLikeGrid(items), true);
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.equal(page.index, "skipped");
  assert.equal(page.text, "");
  assert.notEqual(page.readingOrder, "two-column");
});

test("aligned lecture equations plus prose are not automatically dense-grid", () => {
  const items: PdfTextItem[] = [];
  let index = 0;
  for (let row = 0; row < 5; row += 1) {
    items.push(item(index, "x", 200, 700 - row * 18, 8));
    index += 1;
    items.push(item(index, "=", 220, 700 - row * 18, 8));
    index += 1;
    items.push(item(index, `${row}`, 240, 700 - row * 18, 8));
    index += 1;
  }
  const lecture = [
    "Supervised learning estimates a hypothesis from labeled examples.",
    "The training set contains input output pairs drawn from a distribution.",
    "Empirical risk minimization then chooses parameters that fit those pairs.",
    "Gradient descent updates each weight using the residual of the current fit.",
    "Feature scaling keeps the level sets of the objective closer to circular.",
    "Regularization shrinks the weights so the hypothesis does not chase noise.",
    "Cross validation selects the penalty that generalizes to unseen examples.",
    "Those sentences are lecture prose sitting beside aligned notation.",
  ];
  lecture.forEach((text, offset) => {
    items.push(item(index + offset, text, 72, 580 - offset * 16, 300));
  });
  assert.equal(isTableLikeGrid(items), false);
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.notEqual(page.index, "skipped");
  assert.ok(page.text.includes("Supervised learning"));
});

test("changed two-column pages keep exact mapped coverage", () => {
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items: bertLikeItems() });
  assert.equal(page.readingOrder, "two-column");
  assert.equal(mappingErrors(page).length, 0);
  assertMappedCoverage(page);
});

test("DOCUMENT_NORMALIZER_VERSION bump invalidates old IR", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 240)],
  });
  const document = {
    contextId: "v",
    sourceId: "lecture.pdf",
    path: "lecture.pdf",
    contentHash: "h",
    type: "pdf" as const,
    parserVersion: 1,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 1,
    outline: [],
    pages: [page],
    readiness: "ready" as const,
  };
  const evidence = documentEvidenceFromRange({
    document,
    page: 1,
    normStart: 0,
    normEnd: page.text.length,
    spokenText: page.text,
  });
  assert.ok(evidence);
  assert.equal(documentIsCurrent(evidence, document), true);
  assert.equal(documentIsCurrent(evidence, { ...document, normalizerVersion: DOCUMENT_NORMALIZER_VERSION - 1 }), false);
  assert.equal(DOCUMENT_NORMALIZER_VERSION, 3);
});
