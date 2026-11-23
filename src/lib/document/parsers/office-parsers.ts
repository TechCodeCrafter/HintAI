import { toMarkdown as pptToMarkdown } from "@mdgate/ppt";
import { strFromU8, unzipSync } from "fflate";
import mammoth from "mammoth";
import readXlsxFile, { readSheetNames } from "read-excel-file";

export const OFFICE_EXT = new Set(["docx", "xlsx", "csv", "ppt", "pptx"]);

export function isOfficeExt(ext: string): boolean {
  return OFFICE_EXT.has(ext.toLowerCase());
}

/** Word/Excel owner-lock temps (`~$Guide.docx`). Never parse; never toast. */
export function isOfficeLockName(name: string): boolean {
  const base = name.split(/[/\\]/).pop() ?? name;
  return /^~\$/.test(base);
}

export function officeReadError(names: string[]): string | null {
  const real = names.filter((name) => !isOfficeLockName(name));
  if (real.length === 0) return null;
  if (real.length === 1) {
    return `Could not read ${real[0]}. It may be corrupted or password-protected.`;
  }
  return `Could not read ${real.join(", ")}. They may be corrupted or password-protected.`;
}

/**
 * Parse DOCX to text that keeps the document's structure.
 *
 * A Word heading becomes a `#` line with one `#` per level, a list item a
 * `- ` or `1. ` line, and a table one line per row with ` | ` between cells.
 * Paragraphs are separated by a blank line. The chunker cuts the document at
 * the `#` lines, so a section is found under its heading.
 *
 * Raw text extraction, which this used before, drops all of that: a heading
 * reads as one more paragraph and every table cell lands on a line of its own.
 * It is still the fallback when the structured pass gives nothing.
 */
export async function parseDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  // Browser mammoth reads `arrayBuffer`. Node mammoth reads `buffer`.
  const input: { arrayBuffer: ArrayBuffer; buffer?: Buffer } = { arrayBuffer };
  if (typeof Buffer !== "undefined") input.buffer = Buffer.from(arrayBuffer);
  try {
    const html = await mammoth.convertToHtml(input, {
      // Word's Title style is the top of the outline. Mammoth has no rule for it.
      styleMap: ["p[style-name='Title'] => h1:fresh"],
      // Pictures are not text. Without this each one is base64 encoded into the HTML.
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
    });
    const text = officeHtmlToText(html.value ?? "");
    if (text.trim()) return text;
  } catch {
    // Fall through: the plain pass reports a file that cannot be read at all.
  }
  const result = await mammoth.extractRawText(input);
  return result.value ?? "";
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * The HTML mammoth writes for a Word document, as plain text lines. Only the
 * tags mammoth emits are handled: headings, paragraphs, lists, tables and line
 * breaks. Inline tags (bold, links, images) are dropped and their text kept.
 */
export function officeHtmlToText(html: string): string {
  const out: string[] = [];
  let lastKind = "";
  let text = "";
  let heading = 0;
  const lists: Array<{ ordered: boolean; count: number }> = [];
  const tables: Array<{ row: string[] | null; cell: string[] | null }> = [];

  const take = (): string => {
    const value = text.replace(/\s+/g, " ").trim();
    text = "";
    return value;
  };
  const push = (kind: "heading" | "paragraph" | "item" | "row", line: string) => {
    // List items and table rows sit on consecutive lines; everything else is
    // set off by a blank line.
    const tight = kind === lastKind && (kind === "item" || kind === "row");
    if (out.length > 0 && !tight) out.push("");
    out.push(line);
    lastKind = kind;
  };
  const flush = () => {
    const value = take();
    if (!value) return;
    const table = tables[tables.length - 1];
    if (table?.cell) {
      table.cell.push(value);
    } else if (heading > 0) {
      push("heading", `${"#".repeat(heading)} ${value}`);
    } else if (lists.length > 0) {
      const list = lists[lists.length - 1];
      list.count += 1;
      push("item", `${"  ".repeat(lists.length - 1)}${list.ordered ? `${list.count}. ` : "- "}${value}`);
    } else {
      push("paragraph", value);
    }
  };

  let cursor = 0;
  for (const tag of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    text += decodeHtmlText(html.slice(cursor, tag.index));
    cursor = tag.index + tag[0].length;
    const closing = tag[1] === "/";
    const name = tag[2].toLowerCase();
    const table = tables[tables.length - 1];
    if (/^h[1-6]$/.test(name)) {
      flush();
      heading = closing ? 0 : Number(name[1]);
    } else if (name === "p" || name === "li") {
      flush();
    } else if (name === "ul" || name === "ol") {
      flush();
      if (closing) lists.pop();
      else lists.push({ ordered: name === "ol", count: 0 });
    } else if (name === "table") {
      flush();
      if (closing) tables.pop();
      else tables.push({ row: null, cell: null });
    } else if (name === "tr" && table) {
      if (closing) {
        if (table.row && table.row.some(Boolean)) push("row", table.row.join(" | "));
        table.row = null;
      } else {
        table.row = [];
      }
    } else if ((name === "td" || name === "th") && table) {
      if (closing) {
        flush();
        table.row?.push((table.cell ?? []).join(" "));
        table.cell = null;
      } else {
        take();
        table.cell = [];
      }
    } else if (name === "br") {
      text += " ";
    }
  }
  text += decodeHtmlText(html.slice(cursor));
  flush();
  return out.join("\n");
}

function formatSpreadsheetRows(rows: unknown[][]): string {
  const lines: string[] = [];
  for (const row of rows) {
    const line = row.map((cell) => (cell === undefined || cell === null ? "" : String(cell))).join(" | ");
    if (line.trim()) lines.push(line);
  }
  return lines.join("\n");
}

/** Parse XLSX or CSV to structured text. Uses read-excel-file (not legacy xlsx). */
export async function parseXlsx(arrayBuffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(arrayBuffer);
  const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    return parseCsvText(new TextDecoder().decode(bytes));
  }
  // Node (tests/SSR) has no DOMParser, which the read-excel-file browser
  // build needs — and its /node entry drags fs/stream/unzipper into the
  // browser bundle. So under Node we parse sheet XML directly with the same
  // fflate + regex stack the PPTX parser already uses. Browsers keep the
  // richer read-excel-file path (typed dates, etc.).
  if (typeof DOMParser === "undefined") {
    return parseXlsxWithoutDom(bytes);
  }
  const parts: string[] = [];
  for (const sheetName of await readSheetNames(arrayBuffer)) {
    const rows = await readXlsxFile(arrayBuffer, { sheet: sheetName });
    if (rows.length === 0) continue;
    parts.push(`--- Sheet: ${sheetName} ---`, formatSpreadsheetRows(rows));
  }
  return parts.join("\n");
}

export function parseCsvText(text: string): string {
  return formatSpreadsheetRows(splitCsvRows(text));
}

/** Quote-aware CSV split: commas inside "quoted" cells are not separators. */
function splitCsvRows(text: string): unknown[][] {
  const rows: unknown[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
        continue;
      }
      if (ch === "," && !quoted) {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    cells.push(current.trim());
    rows.push(cells);
  }
  return rows;
}

/** XLSX sheet parsing without a DOM: shared strings + inline values only. */
function parseXlsxWithoutDom(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Could not unzip xlsx payload.");
  }
  const byName = (suffix: string): Uint8Array | undefined => {
    const key = Object.keys(files).find((name) => name.toLowerCase().endsWith(suffix));
    return key ? files[key] : undefined;
  };
  const shared: string[] = [];
  const sharedXml = byName("xl/sharedstrings.xml");
  if (sharedXml) {
    const xml = strFromU8(sharedXml);
    for (const item of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const text = [...(item[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
        .map((part) => decodeXmlText(part[1] ?? ""))
        .join("");
      shared.push(text);
    }
  }
  const sheetOrder = ((): string[] => {
    const workbook = byName("xl/workbook.xml");
    if (workbook) {
      const names = [...strFromU8(workbook).matchAll(/<sheet\b[^>]*\/>/g)].length;
      if (names > 0) {
        return Array.from({ length: names }, (_, i) => `xl/worksheets/sheet${i + 1}.xml`);
      }
    }
    return Object.keys(files)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
      .sort((a, b) => Number(a.match(/sheet(\d+)/i)?.[1] ?? 0) - Number(b.match(/sheet(\d+)/i)?.[1] ?? 0));
  })();
  const parts: string[] = [];
  sheetOrder.forEach((entry, index) => {
    const data = files[entry];
    if (!data) return;
    const rows = parseXlsxSheetRows(strFromU8(data), shared);
    if (rows.length === 0) return;
    parts.push(`--- Sheet: Sheet${index + 1} ---`, formatSpreadsheetRows(rows));
  });
  // Fall back to real sheet names when workbook.xml names exist.
  const workbook = byName("xl/workbook.xml");
  if (workbook) {
    const names = [...strFromU8(workbook).matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*\/>/g)].map(
      (match) => decodeXmlText(match[1] ?? ""),
    );
    let seen = 0;
    for (let i = 0; i < parts.length; i += 2) {
      if (names[seen]) parts[i] = `--- Sheet: ${names[seen]} ---`;
      seen += 1;
    }
  }
  return parts.join("\n");
}

function parseXlsxSheetRows(xml: string, shared: string[]): unknown[][] {
  const rows: unknown[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cell[1] ?? "";
      const body = cell[2] ?? "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      if (type === "inlineStr") {
        const text = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
          .map((part) => decodeXmlText(part[1] ?? ""))
          .join("");
        cells.push(text);
        continue;
      }
      const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]?.trim() ?? "";
      if (type === "s") {
        const index = Number(value);
        cells.push(Number.isInteger(index) && shared[index] !== undefined ? shared[index] : value);
      } else if (type === "b") {
        cells.push(value === "1" ? "TRUE" : value === "0" ? "FALSE" : value);
      } else {
        cells.push(decodeXmlText(value));
      }
    }
    if (cells.some((cell) => cell.trim())) rows.push(cells);
  }
  return rows;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * The text of each paragraph in a piece of DrawingML, one string per
 * paragraph. The runs of a paragraph are joined with nothing between them:
 * PowerPoint splits a run wherever the formatting or the spelling changed,
 * often inside a word, and each run carries its own spaces.
 */
function drawingParagraphs(xml: string): string[] {
  const out: string[] = [];
  for (const paragraph of xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
    const text = [...paragraph[0].replace(/<a:br\b[^>]*\/?>/g, "<a:t> </a:t>").matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map((run) => decodeXmlText(run[1] ?? ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push(text);
  }
  return out;
}

/** Placeholders that hold a page number or a date, not something the author wrote. */
const SLIDE_FURNITURE = new Set(["sldNum", "dt"]);

function placeholderType(shape: string): string {
  return /<p:ph\b[^>]*\btype="([^"]+)"/.exec(shape)?.[1] ?? "";
}

/**
 * One slide as a title and its lines. The title is the text of the title
 * placeholder, wherever that shape sits in the file. Every other paragraph is
 * a line, in file order, and a table is one line per row.
 */
function slideContent(xml: string): { title: string; lines: string[] } {
  let title = "";
  const rest = xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (shape) => {
    const type = placeholderType(shape);
    if (SLIDE_FURNITURE.has(type)) return "";
    if (!title && (type === "title" || type === "ctrTitle")) {
      title = drawingParagraphs(shape).join(" ");
      if (title) return "";
    }
    return shape;
  });
  const lines: string[] = [];
  for (const block of rest.matchAll(/<a:tbl\b[\s\S]*?<\/a:tbl>|<a:p\b[\s\S]*?<\/a:p>/g)) {
    if (!block[0].startsWith("<a:tbl")) {
      lines.push(...drawingParagraphs(block[0]));
      continue;
    }
    for (const row of block[0].matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)) {
      const cells = [...row[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((cell) => drawingParagraphs(cell[0]).join(" "));
      if (cells.some(Boolean)) lines.push(cells.join(" | "));
    }
  }
  return { title, lines };
}

/** Pull visible text runs from Office Open XML (DrawingML + WordprocessingML). */
function extractXmlTextRuns(xml: string): string {
  const runs = [
    ...xml.matchAll(/<(?:a|w):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:a|w):t>/g),
  ]
    .map((match) => decodeXmlText(match[1] ?? "").trim())
    .filter(Boolean);
  return runs.join(" ").replace(/\s+/g, " ").trim();
}

/** Sweep layout/master/notes parts when slide bodies are empty placeholders. */
function extractSupplementalPptxText(files: Record<string, Uint8Array>, skip: Set<string>): string {
  const parts: string[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    if (skip.has(name)) continue;
    if (!/^ppt\/(slideLayouts|slideMasters|notesSlides|diagrams\/data)\/.+\.xml$/i.test(name)) continue;
    const text = extractXmlTextRuns(strFromU8(bytes));
    if (text) parts.push(text);
  }
  return parts.join("\n").trim();
}

function sortedSlideXml(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)/i)?.[1] ?? 0);
      return na - nb;
    });
}

function findPart(files: Record<string, Uint8Array>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return Object.keys(files).find((key) => key.toLowerCase() === wanted);
}

/** A relationship target, resolved against the folder of the part that names it. */
function resolvePart(folder: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = folder.split("/").filter(Boolean);
  for (const step of target.split("/")) {
    if (step === "..") parts.pop();
    else if (step && step !== ".") parts.push(step);
  }
  return parts.join("/");
}

function relationships(xml: string): Array<{ id: string; type: string; target: string }> {
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((tag) => ({
    id: /\bId="([^"]*)"/.exec(tag[0])?.[1] ?? "",
    type: /\bType="([^"]*)"/.exec(tag[0])?.[1] ?? "",
    target: /\bTarget="([^"]*)"/.exec(tag[0])?.[1] ?? "",
  }));
}

/**
 * Slide parts with the number the deck shows for each.
 *
 * `slide7.xml` is not slide 7 once a deck has been reordered: the order is
 * the slide list in `presentation.xml`. That list is used when it accounts
 * for every slide part. When it is missing, or names a part that is not
 * there, the number in the file name is used, as before.
 */
function slidesInDeckOrder(files: Record<string, Uint8Array>): Array<{ key: string; number: string }> {
  const byName = sortedSlideXml(files).map((key, index) => ({
    key,
    number: key.match(/slide(\d+)/i)?.[1] ?? String(index + 1),
  }));
  const presentation = findPart(files, "ppt/presentation.xml");
  const rels = findPart(files, "ppt/_rels/presentation.xml.rels");
  if (!presentation || !rels) return byName;
  const targets = new Map(relationships(strFromU8(files[rels]!)).map((rel) => [rel.id, rel.target]));
  const list = /<p:sldIdLst\b[\s\S]*?<\/p:sldIdLst>/.exec(strFromU8(files[presentation]!))?.[0] ?? "";
  const ordered: string[] = [];
  for (const entry of list.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    const target = targets.get(entry[1]);
    const key = target ? findPart(files, resolvePart("ppt", target)) : undefined;
    if (!key || ordered.includes(key)) return byName;
    ordered.push(key);
  }
  if (ordered.length !== byName.length || byName.some((slide) => !ordered.includes(slide.key))) return byName;
  return ordered.map((key, index) => ({ key, number: String(index + 1) }));
}

/** The notes part for a slide: the one its relationships name, else the one with its file number. */
function notesPartFor(files: Record<string, Uint8Array>, slideKey: string): string | undefined {
  const name = slideKey.split("/").pop() ?? "";
  const rels = findPart(files, `ppt/slides/_rels/${name}.rels`);
  if (rels) {
    const notes = relationships(strFromU8(files[rels]!)).find((rel) => /\/notesSlide$/.test(rel.type));
    if (notes) return findPart(files, resolvePart("ppt/slides", notes.target));
  }
  const fileNumber = name.match(/slide(\d+)/i)?.[1];
  return fileNumber ? findPart(files, `ppt/notesSlides/notesSlide${fileNumber}.xml`) : undefined;
}

function noteTextForSlide(files: Record<string, Uint8Array>, slideKey: string): { key: string; text: string } | null {
  const key = notesPartFor(files, slideKey);
  if (!key) return null;
  const notes = slideContent(strFromU8(files[key]!));
  const text = [notes.title, ...notes.lines].filter(Boolean).join(" ");
  return text ? { key, text } : null;
}

function isZipArchive(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isOleCompound(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  );
}

/**
 * Strip inline markdown from mdgate output. Heading lines keep their `#`: a
 * legacy deck has no slide markers, and its headings are the only boundaries
 * the chunker has to cut on.
 */
export function normalizeOfficeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    // Bullets first: a `* ` bullet is otherwise read as the start of emphasis.
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Parse legacy PowerPoint 97–2003 (.ppt) to plain text. */
export async function parsePpt(arrayBuffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(arrayBuffer);
  if (isZipArchive(bytes)) return parsePptx(arrayBuffer);
  if (!isOleCompound(bytes)) throw new Error("Invalid PPT file");

  const markdown = await pptToMarkdown(bytes, { path: "deck.ppt" });
  const body = normalizeOfficeMarkdown(markdown);
  if (!body) throw new Error("PPT slides contain no extractable text");
  return body;
}

/**
 * Parse PPTX (Office Open XML) to plain text with slide boundaries.
 *
 * Each slide is a `--- Slide 3: Title ---` line (`--- Slide 3 ---` when the
 * slide has no title shape), then one line per paragraph, then a `Notes:`
 * line with the speaker notes. The chunker makes one chunk per slide from
 * those lines.
 */
export function parsePptx(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("Invalid PPTX archive");
  }
  const files = unzipSync(bytes);
  const slides = slidesInDeckOrder(files);
  if (slides.length === 0) throw new Error("PPTX has no slides");

  const parts: string[] = [];
  const usedKeys = new Set<string>();
  for (const slide of slides) {
    usedKeys.add(slide.key);
    const { title, lines } = slideContent(strFromU8(files[slide.key]!));
    if (!title && lines.length === 0) continue;
    parts.push(title ? `--- Slide ${slide.number}: ${title} ---` : `--- Slide ${slide.number} ---`, ...lines);
    const notes = noteTextForSlide(files, slide.key);
    if (notes && notes.text !== [title, ...lines].filter(Boolean).join(" ")) {
      parts.push(`Notes: ${notes.text}`);
      usedKeys.add(notes.key);
    }
  }

  let body = parts.join("\n").trim();
  if (!body) {
    const supplemental = extractSupplementalPptxText(files, usedKeys);
    if (supplemental) body = supplemental;
  }
  if (!body) throw new Error("PPTX slides contain no extractable text");
  return body;
}

export async function parsePowerPointBuffer(arrayBuffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(arrayBuffer);
  if (isZipArchive(bytes)) return parsePptx(arrayBuffer);
  return parsePpt(arrayBuffer);
}

export async function parseOfficeBuffer(ext: string, arrayBuffer: ArrayBuffer): Promise<string> {
  const kind = ext.toLowerCase();
  if (kind === "docx") return parseDocx(arrayBuffer);
  if (kind === "xlsx") {
    if (!isZipArchive(new Uint8Array(arrayBuffer))) throw new Error("Invalid XLSX archive");
    return parseXlsx(arrayBuffer);
  }
  if (kind === "csv") return parseXlsx(arrayBuffer);
  if (kind === "ppt" || kind === "pptx") return parsePowerPointBuffer(arrayBuffer);
  throw new Error(`Unsupported office type: .${kind}`);
}
