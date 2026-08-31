/**
 * How a source file is turned into symbols. Retrieval may use those symbols as
 * chunk boundaries; it must not depend on any one parser succeeding.
 */

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "method"
  | "export"
  | "comment"
  | "unknown";

export type ParsedDocstring = {
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  text: string;
};

export type ParsedSymbol = {
  name: string;
  kind: SymbolKind;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  /** 0-based, half-open. */
  startOffset: number;
  /** 0-based, half-open. */
  endOffset: number;
  /** Docstring or leading comment block, if any. */
  docstring?: ParsedDocstring;
};

export interface CodeParser {
  readonly name: string;
  readonly supportedLanguages: string[];
  /** Returns symbols, or null if the file should fall back to window chunking. */
  parse(file: { path: string; content: string }): ParsedSymbol[] | null;
}

export type ParserLanguage = "ts" | "js" | "py" | "go" | "rs" | "java" | "kt";

const EXT_LANGUAGE: Record<string, ParserLanguage> = {
  ts: "ts",
  tsx: "ts",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  py: "py",
  go: "go",
  rs: "rs",
  java: "java",
  kt: "kt",
  kts: "kt",
};

export function languageFromPath(path: string): ParserLanguage | null {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_LANGUAGE[base.slice(dot + 1).toLowerCase()] ?? null;
}

/** Display language for a chunk. Unknown extensions stay as the extension. */
export function inferLanguage(path: string): string {
  return languageFromPath(path) ?? path.split(".").pop()?.toLowerCase() ?? "txt";
}

/** Offset of the first character of each 1-based line. */
export function computeLineOffsets(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** 1-based line containing `offset`. */
export function lineOfOffset(content: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, content.length));
  let line = 1;
  for (let i = 0; i < clamped; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}
