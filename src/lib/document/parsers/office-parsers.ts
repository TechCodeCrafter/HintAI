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

/** Parse DOCX to plain text. */
export async function parseDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  // Browser mammoth reads `arrayBuffer`. Node mammoth reads `buffer`.
  const input: { arrayBuffer: ArrayBuffer; buffer?: Buffer } = { arrayBuffer };
  if (typeof Buffer !== "undefined") input.buffer = Buffer.from(arrayBuffer);
  const result = await mammoth.extractRawText(input);
  return result.value ?? "";
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
    return formatSpreadsheetRows(splitCsvRows(new TextDecoder().decode(bytes)));
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

function noteTextForSlide(files: Record<string, Uint8Array>, slideNum: string): string | null {
  const key = `ppt/notesSlides/notesSlide${slideNum}.xml`;
  const match = Object.keys(files).find((name) => name.toLowerCase() === key.toLowerCase());
  if (!match) return null;
  const noteText = extractXmlTextRuns(strFromU8(files[match]!));
  return noteText || null;
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

/** Strip lightweight markdown from mdgate output while keeping slide boundaries. */
function normalizeOfficeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "- ")
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

/** Parse PPTX (Office Open XML) to plain text with slide boundaries. */
export function parsePptx(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("Invalid PPTX archive");
  }
  const files = unzipSync(bytes);
  const slideKeys = sortedSlideXml(files);
  if (slideKeys.length === 0) throw new Error("PPTX has no slides");

  const parts: string[] = [];
  const usedKeys = new Set<string>();
  slideKeys.forEach((key, index) => {
    usedKeys.add(key);
    const slideText = extractXmlTextRuns(strFromU8(files[key]!));
    if (!slideText) return;
    const slideNum = key.match(/slide(\d+)/i)?.[1] ?? String(index + 1);
    parts.push(`--- Slide ${slideNum} ---`, slideText);
    const noteText = noteTextForSlide(files, slideNum);
    if (noteText && noteText !== slideText) {
      parts.push(`Notes: ${noteText}`);
      usedKeys.add(`ppt/notesSlides/notesSlide${slideNum}.xml`);
    }
  });

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
  if (kind === "xlsx" || kind === "csv") return await parseXlsx(arrayBuffer);
  if (kind === "ppt" || kind === "pptx") return parsePowerPointBuffer(arrayBuffer);
  throw new Error(`Unsupported office type: .${kind}`);
}
