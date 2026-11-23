/**
 * What the Word and PowerPoint parsers keep of a document's structure. The
 * chunker cuts on these lines, so they are the contract between the two.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { strToU8, unzipSync, zipSync } from "fflate";

import { buildDocx, buildPptx, DECK_SLIDES, roadmapPptx, runbookDocx } from "../../../search/__tests__/fixtures/formats.ts";
import { normalizeOfficeMarkdown, officeHtmlToText, parseDocx, parsePowerPointBuffer, parsePptx } from "../office-parsers.ts";

test("a Word heading becomes a # line at its level, and the Title style is the top level", async () => {
  const text = await parseDocx(runbookDocx());
  const headings = text.split("\n").filter((line) => line.startsWith("#"));
  assert.deepEqual(headings, [
    "# Settlement Export Runbook",
    "# Overview",
    "# Retry Policy",
    "# Escalation",
    "## Paging",
    "## Vendor Contacts",
    "# Rollback",
    "# Data Retention",
    "# Ownership",
  ]);
});

test("paragraphs are set off by a blank line; list items and table rows are one line each", async () => {
  const text = await parseDocx(
    buildDocx([
      { kind: "heading", level: 1, text: "Rollback" },
      { kind: "p", text: "Work through these steps:" },
      { kind: "bullet", text: "Freeze the drop." },
      { kind: "bullet", text: "Restore the batch." },
      { kind: "p", text: "Then tell the bank." },
      { kind: "table", rows: [["Vendor", "Hours"], ["Corvid Clearing", "24 hours"]] },
      { kind: "heading", level: 3, text: "Notes & <caveats>" },
      { kind: "p", text: "Costs are in USD & exclude tax." },
    ]),
  );
  assert.equal(
    text,
    [
      "# Rollback",
      "",
      "Work through these steps:",
      "",
      "- Freeze the drop.",
      "- Restore the batch.",
      "",
      "Then tell the bank.",
      "",
      "Vendor | Hours",
      "Corvid Clearing | 24 hours",
      "",
      "### Notes & <caveats>",
      "",
      "Costs are in USD & exclude tax.",
    ].join("\n"),
  );
});

test("a document with no heading styles still reads as its paragraphs", async () => {
  const text = await parseDocx(buildDocx([{ kind: "p", text: "First paragraph." }, { kind: "p", text: "Second paragraph." }]));
  assert.equal(text, "First paragraph.\n\nSecond paragraph.");
});

test("officeHtmlToText numbers ordered lists, indents nested ones, and drops inline tags and pictures", () => {
  const html =
    "<h2>Steps &amp; checks</h2><ol><li>Stop the <strong>worker</strong>.</li><li>Drain the queue.<ul><li>Check depth</li><li>Check age</li></ul></li><li>Restart.</li></ol>" +
    '<p>See <a href="https://example.test/x">the guide</a>.<br />It is short.</p><p><img src="" alt="chart" /></p><p>caf&#233; &#x2603; &nbsp;&lt;ok&gt;</p>' +
    "<table><tr><th><p>Name</p></th><th><p>Role</p></th></tr><tr><td><p>Alice</p><p>Smith</p></td><td></td></tr></table>";
  assert.equal(
    officeHtmlToText(html),
    [
      "## Steps & checks",
      "",
      "1. Stop the worker.",
      "2. Drain the queue.",
      "  - Check depth",
      "  - Check age",
      "3. Restart.",
      "",
      "See the guide. It is short.",
      "",
      "café ☃ <ok>",
      "",
      "Name | Role",
      "Alice Smith | ",
    ].join("\n"),
  );
  assert.equal(officeHtmlToText(""), "");
});

test("a slide's title placeholder becomes the slide line, wherever the shape sits in the file", () => {
  const lines = parsePptx(roadmapPptx()).split("\n");
  assert.deepEqual(
    lines.filter((line) => line.startsWith("--- Slide")),
    [
      "--- Slide 1: Payments Platform: Third Quarter Plan ---",
      // Written after the body shape in the file.
      "--- Slide 2: Ledger Migration ---",
      "--- Slide 3: Fraud Scoring ---",
      "--- Slide 4: Mobile Checkout ---",
      // No title shape.
      "--- Slide 5 ---",
      "--- Slide 6: Risks ---",
      "--- Slide 7: Hiring Plan ---",
    ],
  );
  // The title is not repeated as a body line.
  assert.equal(lines.filter((line) => line === "Ledger Migration").length, 0);
});

test("each paragraph of a slide is its own line, and runs split inside a word are joined", () => {
  const text = parsePptx(roadmapPptx());
  const start = text.indexOf("--- Slide 2: Ledger Migration ---");
  const slide = text.slice(start, text.indexOf("--- Slide 3"));
  assert.equal(
    slide,
    [
      "--- Slide 2: Ledger Migration ---",
      "Move the double-entry ledger from Postgres 13 to the Cobalt cluster.",
      "Cutover is planned for the week of 14 October.",
      "Read traffic moves first, writes follow two days later.",
      // The slide number field on the notes page is not part of the notes.
      "Notes: Finance asked for a freeze on schema changes during cutover week.",
      "",
    ].join("\n"),
  );
});

test("slides are numbered in the order the deck shows them, not by file name", () => {
  // slide3.xml is shown first, then slide1.xml, then slide2.xml.
  const slides = DECK_SLIDES.slice(1, 4);
  const text = parsePptx(buildPptx(slides, { deckOrder: [3, 1, 2] }));
  assert.deepEqual(
    text.split("\n").filter((line) => line.startsWith("--- Slide") || line.startsWith("Notes:")),
    [
      "--- Slide 1: Mobile Checkout ---",
      // Notes come from the part the slide's relationships name.
      "Notes: The iOS team is waiting on the tokenization vendor.",
      "--- Slide 2: Ledger Migration ---",
      "Notes: Finance asked for a freeze on schema changes during cutover week.",
      "--- Slide 3: Fraud Scoring ---",
    ],
  );
});

test("a slide list that does not account for every slide part falls back to file order", () => {
  const slides = DECK_SLIDES.slice(1, 4);
  const text = parsePptx(buildPptx(slides, { deckOrder: [3, 1] }));
  assert.deepEqual(
    text.split("\n").filter((line) => line.startsWith("--- Slide")),
    ["--- Slide 1: Ledger Migration ---", "--- Slide 2: Fraud Scoring ---", "--- Slide 3: Mobile Checkout ---"],
  );
});

test("a table on a slide is one line per row", () => {
  const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const cell = (value: string) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${value}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
  const row = (cells: string[]) => `<a:tr h="1">${cells.map(cell).join("")}</a:tr>`;
  const slide = `<p:sld ${ns}><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Owners</a:t></a:r></a:p></p:txBody></p:sp>
    <p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tblGrid/>${row(["Service", "Owner"])}${row(["ledger-api", "Tidewater"])}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld type="slidenum"><a:t>4</a:t></a:fld></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:p><a:r><a:t>Line one</a:t></a:r><a:br/><a:r><a:t>line two</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:sld>`;
  const text = parsePptx(deckWithSlide(slide));
  assert.equal(text, ["--- Slide 1: Owners ---", "Service | Owner", "ledger-api | Tidewater", "Line one line two"].join("\n"));
});

test("a .pptx saved with a .ppt name is read as slides", async () => {
  const text = await parsePowerPointBuffer(roadmapPptx());
  assert.match(text, /^--- Slide 1: Payments Platform: Third Quarter Plan ---$/m);
});

function deckWithSlide(slideXml: string): ArrayBuffer {
  const bytes = zipSync({ "ppt/slides/slide1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>${slideXml}`) });
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

test("legacy deck text keeps its heading lines and loses inline markdown", () => {
  assert.equal(
    normalizeOfficeMarkdown("## Ledger **Migration**\r\n* Move the *ledger* to Cobalt.\r\n\r\n\r\n\r\nNext slide.\r\n"),
    "## Ledger Migration\n- Move the ledger to Cobalt.\n\nNext slide.",
  );
});

test("the fixture deck is a real zip with one part per slide", () => {
  const files = unzipSync(new Uint8Array(roadmapPptx()));
  assert.equal(Object.keys(files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, DECK_SLIDES.length);
});
