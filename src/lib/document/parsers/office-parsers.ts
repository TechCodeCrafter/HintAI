import { toMarkdown as pptToMarkdown } from "@mdgate/ppt";
import { strFromU8, unzipSync } from "fflate";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

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

/** Parse XLSX or CSV to structured text. */
export function parseXlsx(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  const zip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const workbook = zip
    ? XLSX.read(bytes, { type: "array" })
    : XLSX.read(new TextDecoder().decode(bytes), { type: "string" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    if (rows.length === 0) continue;
    parts.push(`--- Sheet: ${sheetName} ---`);
    for (const row of rows) {
      const line = row
        .map((cell) => (cell === undefined || cell === null ? "" : String(cell)))
        .join(" | ");
      if (line.trim()) parts.push(line);
    }
  }
  return parts.join("\n");
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Pull visible text runs from Office Open XML (Word/PowerPoint). */
function extractXmlTextRuns(xml: string): string {
  const runs = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXmlText(match[1] ?? "").trim())
    .filter(Boolean);
  return runs.join(" ").replace(/\s+/g, " ").trim();
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

  slideKeys.forEach((key, index) => {
    const slideText = extractXmlTextRuns(strFromU8(files[key]!));
    if (!slideText) return;
    const slideNum = key.match(/slide(\d+)/i)?.[1] ?? String(index + 1);
    parts.push(`--- Slide ${slideNum} ---`, slideText);
    const noteText = noteTextForSlide(files, slideNum);
    if (noteText && noteText !== slideText) parts.push(`Notes: ${noteText}`);
  });

  const body = parts.join("\n").trim();
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
  if (kind === "xlsx" || kind === "csv") return parseXlsx(arrayBuffer);
  if (kind === "ppt" || kind === "pptx") return parsePowerPointBuffer(arrayBuffer);
  throw new Error(`Unsupported office type: .${kind}`);
}
