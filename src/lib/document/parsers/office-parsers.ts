import mammoth from "mammoth";
import * as XLSX from "xlsx";

export const OFFICE_EXT = new Set(["docx", "xlsx", "csv"]);

export function isOfficeExt(ext: string): boolean {
  return OFFICE_EXT.has(ext.toLowerCase());
}

export function officeReadError(names: string[]): string {
  if (names.length === 1) {
    return `Could not read ${names[0]}. It may be corrupted or password-protected.`;
  }
  return `Could not read ${names.join(", ")}. They may be corrupted or password-protected.`;
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

export async function parseOfficeBuffer(ext: string, arrayBuffer: ArrayBuffer): Promise<string> {
  const kind = ext.toLowerCase();
  if (kind === "docx") return parseDocx(arrayBuffer);
  if (kind === "xlsx" || kind === "csv") return parseXlsx(arrayBuffer);
  throw new Error(`Unsupported office type: .${kind}`);
}
