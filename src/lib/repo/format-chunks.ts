/**
 * Chunks for the formats that carry their own structure: Word documents, slide
 * decks, spreadsheets and XML.
 *
 * Line windows cut these in the wrong places. A 28-line window puts two slides
 * and half of a third in one chunk, drops the column names from every row
 * after the first window, and ends in the middle of an XML element. Here a
 * chunk is one slide, one headed section, one group of rows, or whole
 * elements.
 *
 * Two rules hold for every chunk this file makes:
 *
 * 1. `text` is `file.content.slice(startOffset, startOffset + text.length)`.
 *    Nothing is rewritten, joined or repeated, because a citation may only
 *    quote what is at that position in the file.
 * 2. Every non-blank line of the file is in a chunk. The file is cut at
 *    boundaries; nothing between two boundaries is left out.
 *
 * The context a chunk loses by being cut out (the section it sits under, the
 * column names, the elements around it) is kept in `heading`. That is used to
 * rank the chunk and is never quoted as evidence.
 *
 * Returning null means "this file has no structure I can use": the caller
 * falls back to line windows.
 */
import { fileChunkId, type BuildChunksOptions } from "../context/source-identity.ts";
import type { Chunk } from "./types.ts";

/**
 * The most text one chunk holds before it is split, in characters. The same
 * cap the PDF chunker uses (`DOCUMENT_CHUNK_CAP`). A section or a slide under
 * it is one chunk. A single line longer than this stays whole.
 */
export const FORMAT_CHUNK_BUDGET = 1200;
/** The most rows in one spreadsheet chunk, not counting the header row. */
export const ROW_GROUP_ROWS = 12;
/** A heading longer than this is cut, so a 60-column header cannot outweigh the rows. */
const HEADING_MAX = 240;

export const SLIDE_MARKER = /^--- Slide (\d+)(?:: (.*))? ---$/;
const SHEET_MARKER = /^--- Sheet: (.*) ---$/;
const HEADING_LINE = /^(#{1,6})[ \t]+(\S.*)$/;

export type FormatKind = "slides" | "sections" | "rows" | "xml";

/** Which structure a path's extension stands for, or null for everything else. */
export function formatKindOf(path: string): FormatKind | null {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "pptx" || ext === "ppt") return "slides";
  if (ext === "docx") return "sections";
  if (ext === "csv" || ext === "tsv" || ext === "xlsx") return "rows";
  if (ext === "xml") return "xml";
  return null;
}

/** A range of the file, in characters, and the heading it sits under. */
type Piece = { start: number; end: number; heading?: string };

type Lines = {
  text: string;
  /** Each line without its line break (and without a trailing carriage return). */
  lines: string[];
  /** Offset of the first character of each line. */
  starts: number[];
};

function readLines(text: string): Lines {
  const raw = text.split("\n");
  const starts: number[] = [];
  let cursor = 0;
  for (const line of raw) {
    starts.push(cursor);
    cursor += line.length + 1;
  }
  return { text, lines: raw.map((line) => line.replace(/\r$/, "")), starts };
}

function isBlank(line: string | undefined): boolean {
  return !line || line.trim() === "";
}

/** Lines `from` to `to`, both included, as a range of characters. */
function span(doc: Lines, from: number, to: number, heading?: string): Piece {
  return { start: doc.starts[from], end: doc.starts[to] + doc.lines[to].length, heading };
}

/**
 * Lines `from` to `to` as one piece when they fit the budget, and otherwise
 * as several. A cut is made at a blank line where there is one, so a
 * paragraph, a list or a table stays together; a block that is over the
 * budget on its own is cut between its lines.
 */
function withinBudget(doc: Lines, from: number, to: number, heading?: string): Piece[] {
  const whole = span(doc, from, to, heading);
  if (whole.end - whole.start <= FORMAT_CHUNK_BUDGET) return [whole];
  // Blocks: runs of lines with no blank line inside.
  const blocks: Array<{ from: number; to: number }> = [];
  let open = -1;
  for (let i = from; i <= to; i += 1) {
    if (isBlank(doc.lines[i])) {
      if (open >= 0) blocks.push({ from: open, to: i - 1 });
      open = -1;
    } else if (open < 0) {
      open = i;
    }
  }
  if (open >= 0) blocks.push({ from: open, to });
  // A block over the budget becomes one unit per line.
  const units = blocks.flatMap((block) => {
    const size = doc.starts[block.to] + doc.lines[block.to].length - doc.starts[block.from];
    if (size <= FORMAT_CHUNK_BUDGET) return [block];
    return Array.from({ length: block.to - block.from + 1 }, (_, i) => ({ from: block.from + i, to: block.from + i }));
  });
  const pieces: Piece[] = [];
  let first = -1;
  let last = -1;
  for (const unit of units) {
    if (first >= 0 && doc.starts[unit.to] + doc.lines[unit.to].length - doc.starts[first] > FORMAT_CHUNK_BUDGET) {
      pieces.push(span(doc, first, last, heading));
      first = -1;
    }
    if (first < 0) first = unit.from;
    last = unit.to;
  }
  if (first >= 0) pieces.push(span(doc, first, last, heading));
  return pieces;
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

/**
 * One chunk per slide. The parser writes `--- Slide 3: Title ---` above each
 * slide (`--- Slide 3 ---` when the slide has no title shape), then one line
 * per paragraph, then the speaker notes.
 */
function slidePieces(doc: Lines): Piece[] | null {
  const marks: Array<{ line: number; heading: string }> = [];
  doc.lines.forEach((line, index) => {
    const match = SLIDE_MARKER.exec(line);
    if (!match) return;
    const title = match[2]?.trim();
    marks.push({ line: index, heading: title ? `Slide ${match[1]}: ${title}` : `Slide ${match[1]}` });
  });
  if (marks.length === 0) return null;
  const pieces: Piece[] = [];
  // Text above the first slide has no slide to belong to.
  if (marks[0].line > 0) pieces.push(...withinBudget(doc, 0, marks[0].line - 1));
  marks.forEach((mark, index) => {
    const to = index + 1 < marks.length ? marks[index + 1].line - 1 : doc.lines.length - 1;
    pieces.push(...withinBudget(doc, mark.line, to, mark.heading));
  });
  return pieces;
}

// ---------------------------------------------------------------------------
// Headed sections
// ---------------------------------------------------------------------------

/**
 * One chunk per headed section. The parser writes a Word heading as a
 * `#` line, with one `#` per level. A section's heading is its path from the
 * top: "Escalation > Paging".
 *
 * A heading with no text of its own under it (a chapter title that is followed
 * straight away by its first sub-heading) is kept with the section after it,
 * so no chunk is a bare title.
 */
function sectionPieces(doc: Lines): Piece[] | null {
  type Section = { from: number; to: number; heading?: string };
  const sections: Section[] = [];
  const trail: Array<{ level: number; title: string }> = [];
  doc.lines.forEach((line, index) => {
    const match = HEADING_LINE.exec(line);
    if (!match) return;
    const level = match[1].length;
    while (trail.length > 0 && trail[trail.length - 1].level >= level) trail.pop();
    trail.push({ level, title: match[2].trim() });
    sections.push({ from: index, to: index, heading: trail.map((entry) => entry.title).join(" > ") });
  });
  if (sections.length === 0) return null;
  sections.forEach((section, index) => {
    section.to = index + 1 < sections.length ? sections[index + 1].from - 1 : doc.lines.length - 1;
  });
  const pieces: Piece[] = [];
  if (sections[0].from > 0) pieces.push(...withinBudget(doc, 0, sections[0].from - 1));
  let carried = -1;
  sections.forEach((section, index) => {
    const from = carried >= 0 ? carried : section.from;
    const hasBody = doc.lines.slice(section.from + 1, section.to + 1).some((line) => !isBlank(line));
    if (!hasBody && index + 1 < sections.length) {
      carried = from;
      return;
    }
    carried = -1;
    pieces.push(...withinBudget(doc, from, section.to, section.heading));
  });
  return pieces;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function cut(heading: string): string {
  if (heading.length <= HEADING_MAX) return heading;
  const short = heading.slice(0, HEADING_MAX);
  const at = short.lastIndexOf(" | ");
  return at > 0 ? short.slice(0, at) : short;
}

/**
 * True when a row reads as column names: at least two cells, and every cell
 * that is filled in has a letter in it and does not start with a digit. A row
 * of data nearly always has a number or a date in it. A sheet whose first row
 * fails this gets row groups with no header.
 */
export function looksLikeHeaderRow(cells: string[]): boolean {
  const filled = cells.map((cell) => cell.trim()).filter(Boolean);
  if (filled.length < 2) return false;
  return filled.every((cell) => /\p{L}/u.test(cell) && !/^[\d(+\-$€£]/.test(cell));
}

/**
 * Rows in groups of up to `ROW_GROUP_ROWS`, cut between rows. Every group of a
 * table carries the table's header row as its heading, so the rows in the
 * fifth group are still known to be "Vendor | Renewal Date | Owner".
 *
 * Spreadsheet text is one row per line with ` | ` between cells; a `.tsv` is
 * stored as it was written, with tabs. A workbook has a `--- Sheet: Name ---`
 * line above each sheet, and each sheet has its own header.
 */
function rowPieces(doc: Lines, separator: " | " | "\t"): Piece[] | null {
  const tables: Array<{ from: number; to: number; sheet?: string }> = [];
  let open: { from: number; sheet?: string } = { from: 0 };
  doc.lines.forEach((line, index) => {
    const match = separator === " | " ? SHEET_MARKER.exec(line) : null;
    if (!match) return;
    if (index > open.from) tables.push({ ...open, to: index - 1 });
    open = { from: index, sheet: match[1].trim() };
  });
  if (doc.lines.length > open.from) tables.push({ ...open, to: doc.lines.length - 1 });

  const pieces: Piece[] = [];
  for (const table of tables) {
    const rows: number[] = [];
    for (let i = table.sheet === undefined ? table.from : table.from + 1; i <= table.to; i += 1) {
      if (!isBlank(doc.lines[i])) rows.push(i);
    }
    if (rows.length === 0) {
      // A sheet line with no rows under it is still a line of the file.
      if (table.sheet !== undefined) pieces.push(span(doc, table.from, table.from, `Sheet: ${table.sheet}`));
      continue;
    }
    const first = doc.lines[rows[0]];
    const header = rows.length > 1 && looksLikeHeaderRow(first.split(separator));
    const columns = header ? first.split(separator).map((cell) => cell.trim()).join(" | ") : "";
    const heading = cut([table.sheet === undefined ? "" : `Sheet: ${table.sheet}`, columns].filter(Boolean).join(" > ")) || undefined;

    // The first group starts at the sheet line and takes the header row with it.
    let from = table.from;
    let count = 0;
    let last = header ? rows[0] : -1;
    for (const row of header ? rows.slice(1) : rows) {
      const size = doc.starts[row] + doc.lines[row].length - doc.starts[from];
      if (count > 0 && (count >= ROW_GROUP_ROWS || size > FORMAT_CHUNK_BUDGET)) {
        pieces.push(span(doc, from, last, heading));
        from = row;
        count = 0;
      }
      last = row;
      count += 1;
    }
    if (last >= from) pieces.push(span(doc, from, last, heading));
  }
  return pieces.length > 0 ? pieces : null;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

type XmlNode = {
  /** `service[name=ledger-api]`, or the tag name alone. */
  label: string;
  name: string;
  /** Where this element's share of the file begins: the end of the element before it. */
  unitStart: number;
  /** End of the opening tag. Where the first child's share begins. */
  cursor: number;
  end: number;
  children: XmlNode[];
};

const XML_NAME = /[A-Za-z_][\w.:-]*/y;
const XML_DEPTH_MAX = 200;
const XML_IDENTITY = ["id", "name", "key"].map(
  (key) => [key, new RegExp(`(?:^|[\\s:])${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)] as const,
);

/** `name[id=value]` when the tag has an `id`, `name` or `key` attribute, in that order of preference. */
function xmlLabel(name: string, attributes: string): string {
  for (const [key, pattern] of XML_IDENTITY) {
    const match = pattern.exec(attributes);
    const value = (match?.[1] ?? match?.[2] ?? "").trim();
    if (value && value.length <= 48) return `${name}[${key}=${value}]`;
  }
  return name;
}

/**
 * The element tree of an XML file, by position. Comments, CDATA, processing
 * instructions and the doctype are stepped over, so a `<` inside them is not
 * read as a tag. Anything that is not well formed (a tag left open, a closing
 * tag that does not match) gives null, and the file is windowed instead.
 */
function parseXml(text: string): XmlNode | null {
  const root: XmlNode = { label: "", name: "", unitStart: 0, cursor: 0, end: text.length, children: [] };
  const stack: XmlNode[] = [root];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break;
    const skipTo = (open: string, close: string): number => {
      if (!text.startsWith(open, lt)) return -1;
      const at = text.indexOf(close, lt + open.length);
      return at < 0 ? -2 : at + close.length;
    };
    const skipped = [skipTo("<!--", "-->"), skipTo("<![CDATA[", "]]>"), skipTo("<?", "?>")].find((at) => at !== -1);
    if (skipped !== undefined) {
      if (skipped === -2) return null;
      i = skipped;
      continue;
    }
    if (text.startsWith("<!", lt)) {
      // A doctype, which may hold a bracketed block with `>` inside it.
      let depth = 0;
      let j = lt + 2;
      for (; j < text.length; j += 1) {
        const ch = text[j];
        if (ch === "[") depth += 1;
        else if (ch === "]") depth -= 1;
        else if (ch === ">" && depth <= 0) break;
      }
      if (j >= text.length) return null;
      i = j + 1;
      continue;
    }
    const parent = stack[stack.length - 1];
    if (text[lt + 1] === "/") {
      const gt = text.indexOf(">", lt);
      if (gt < 0 || stack.length === 1 || parent.name !== text.slice(lt + 2, gt).trim()) return null;
      parent.end = gt + 1;
      stack.pop();
      stack[stack.length - 1].cursor = parent.end;
      i = gt + 1;
      continue;
    }
    XML_NAME.lastIndex = lt + 1;
    const name = XML_NAME.exec(text)?.[0];
    if (!name) return null;
    let quote = "";
    let j = lt + 1 + name.length;
    for (; j < text.length; j += 1) {
      const ch = text[j];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      } else if (ch === "<") {
        return null;
      }
    }
    if (j >= text.length) return null;
    const selfClosing = text[j - 1] === "/";
    const node: XmlNode = {
      name,
      label: xmlLabel(name, text.slice(lt + 1 + name.length, selfClosing ? j - 1 : j)),
      unitStart: parent.cursor,
      cursor: j + 1,
      end: j + 1,
      children: [],
    };
    parent.children.push(node);
    if (selfClosing) {
      parent.cursor = node.end;
    } else {
      if (stack.length >= XML_DEPTH_MAX) return null;
      stack.push(node);
    }
    i = j + 1;
  }
  if (stack.length !== 1 || root.children.length === 0) return null;
  return root;
}

function xmlHeading(path: string[], group: XmlNode[]): string {
  const labels = group.map((node) => node.label);
  const named = labels.length <= 3 ? labels.join(", ") : `${labels[0]} to ${labels[labels.length - 1]}`;
  return [...path, named].filter(Boolean).join(" > ");
}

/**
 * The pieces for one element and everything in it.
 *
 * An element that fits the budget is never cut. One that does not is cut
 * between its child elements: children are taken in order into a group until
 * the next would put the group over the budget, and a child that is over the
 * budget on its own is cut the same way, one level down. What sits between two
 * elements (a comment, white space, text) goes with the element after it, so
 * `<!-- owned by payments -->` stays with the `<service>` it describes.
 *
 * A piece's heading is the path to what it holds:
 * `deployment > services > service[name=fraud-scorer]`.
 */
function xmlPieces(node: XmlNode, path: string[], start: number, end: number): Piece[] {
  if (end - start <= FORMAT_CHUNK_BUDGET || node.children.length === 0) {
    return [{ start, end, heading: path.length > 0 ? path.join(" > ") : xmlHeading([], node.children) }];
  }
  const pieces: Piece[] = [];
  let from = start;
  let group: XmlNode[] = [];
  for (const child of node.children) {
    if (child.end - child.unitStart > FORMAT_CHUNK_BUDGET && child.children.length > 0) {
      // A group that holds no element yet is this element's opening tag. It
      // rides with the child rather than becoming a chunk of its own.
      if (group.length > 0) {
        pieces.push({ start: from, end: child.unitStart, heading: xmlHeading(path, group) });
        from = child.unitStart;
        group = [];
      }
      pieces.push(...xmlPieces(child, [...path, child.label], from, child.end));
      from = child.end;
      continue;
    }
    if (group.length > 0 && child.end - from > FORMAT_CHUNK_BUDGET) {
      pieces.push({ start: from, end: child.unitStart, heading: xmlHeading(path, group) });
      from = child.unitStart;
      group = [];
    }
    group.push(child);
  }
  // The closing tag, and anything after the last child, stays with the last piece.
  if (group.length > 0) pieces.push({ start: from, end, heading: xmlHeading(path, group) });
  else if (pieces.length > 0) pieces[pieces.length - 1].end = end;
  return pieces;
}

function lineAt(doc: Lines, offset: number): number {
  let lo = 0;
  let hi = doc.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (doc.starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function xmlFilePieces(doc: Lines): Piece[] | null {
  const root = parseXml(doc.text);
  if (!root) return null;
  return xmlPieces(root, [], 0, doc.text.length).flatMap((piece) => {
    if (piece.end - piece.start <= FORMAT_CHUNK_BUDGET) return [piece];
    // One element with no element inside it and more text than the budget.
    const from = lineAt(doc, piece.start);
    const to = lineAt(doc, Math.max(piece.start, piece.end - 1));
    if (from === to) return [piece];
    return withinBudget(doc, from, to, piece.heading).map((part, index, parts) => ({
      ...part,
      start: index === 0 ? piece.start : part.start,
      end: index === parts.length - 1 ? piece.end : part.end,
    }));
  });
}

// ---------------------------------------------------------------------------

function piecesFor(kind: FormatKind, path: string, doc: Lines): Piece[] | null {
  if (kind === "slides") return slidePieces(doc) ?? sectionPieces(doc);
  if (kind === "sections") return sectionPieces(doc);
  if (kind === "rows") return rowPieces(doc, /\.tsv$/i.test(path) ? "\t" : " | ");
  return xmlFilePieces(doc);
}

/**
 * Structure-aware chunks for one file, or null when the file is not one of
 * these formats or has no structure to cut on (a `.docx` with no headings, a
 * deck stored before slide titles were kept, XML that does not parse).
 */
export function buildFormatChunks(
  file: { path: string; content: string },
  options?: BuildChunksOptions,
): Chunk[] | null {
  const kind = formatKindOf(file.path);
  if (!kind || !file.content.trim()) return null;
  const doc = readLines(file.content);
  const pieces = piecesFor(kind, file.path, doc);
  if (!pieces || pieces.length === 0) return null;

  const chunks: Chunk[] = [];
  const keys = new Set<string>();
  for (const piece of pieces.sort((a, b) => a.start - b.start)) {
    // Drop the white space around the piece, but keep the first line's indent.
    let start = piece.start;
    let end = piece.end;
    while (start < end && /\s/.test(doc.text[start])) start += 1;
    while (end > start && /\s/.test(doc.text[end - 1])) end -= 1;
    if (end <= start) continue;
    const startLine = lineAt(doc, start);
    if (doc.starts[startLine] >= piece.start && !doc.text.slice(doc.starts[startLine], start).trim()) {
      start = doc.starts[startLine];
    }
    const endLine = lineAt(doc, end - 1);
    // Two pieces can share a line range when a file is written on one line.
    let rangeKey = `${startLine + 1}-${endLine + 1}`;
    if (keys.has(rangeKey)) rangeKey = `${rangeKey}@${start}`;
    keys.add(rangeKey);
    const heading = piece.heading?.trim();
    chunks.push({
      id: options?.chunkScope ? fileChunkId(options.chunkScope, file.path, rangeKey) : `${file.path}:${rangeKey}`,
      kind: "code",
      sourceId: options?.sourceId ?? options?.chunkScope?.sourceId,
      path: file.path,
      startLine: startLine + 1,
      endLine: endLine + 1,
      startOffset: start,
      text: doc.text.slice(start, end),
      ...(heading ? { heading } : {}),
    });
  }
  return chunks.length > 0 ? chunks : null;
}
