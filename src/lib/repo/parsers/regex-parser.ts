/**
 * Phase 4A: a regex CodeParser. Naive, language-by-extension, and allowed to
 * fail closed — the caller then windows the file. Never throws to the indexer.
 */
import {
  type CodeParser,
  type ParsedDocstring,
  type ParsedSymbol,
  type ParserLanguage,
  type SymbolKind,
  languageFromPath,
  lineOfOffset,
} from "../parser.ts";

type Decl = {
  name: string;
  kind: SymbolKind;
  start: number;
  headerEnd: number;
};

const PAIRS: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
const OPENERS = new Set(Object.keys(PAIRS));
const CLOSERS = new Set(Object.values(PAIRS));

export function createRegexParser(): CodeParser {
  return {
    name: "regex",
    supportedLanguages: ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "kt"],
    parse(file) {
      try {
        const lang = languageFromPath(file.path);
        if (!lang) return null;
        const symbols = parseFile(file.content, lang, file.path);
        return symbols && symbols.length > 0 ? symbols : null;
      } catch {
        return null;
      }
    },
  };
}

function parseFile(content: string, lang: ParserLanguage, path: string): ParsedSymbol[] | null {
  const decls = collectDeclarations(content, lang);
  if (decls.length === 0) {
    const header = fileHeaderDoc(content, lang, content.length);
    return header ? [commentSymbol(header, path)] : null;
  }

  const symbols: ParsedSymbol[] = [];
  let unmatched = 0;
  for (const decl of decls) {
    const end = lang === "py" ? pythonBodyEnd(content, decl.start) : bracedBodyEnd(content, decl.start);
    if (end === null || end <= decl.start) {
      unmatched += 1;
      continue;
    }
    const leading = leadingDoc(content, decl.start, lang);
    const inner = lang === "py" ? pythonInnerDoc(content, decl.headerEnd, end) : undefined;
    const docstring = leading ?? inner;
    symbols.push(spanSymbol(decl, content, end, docstring));
  }

  if (symbols.length === 0) return null;
  if (unmatched > 0 && unmatched === decls.length) return null;

  const header = fileHeaderDoc(content, lang, symbols[0].startOffset);
  if (header && !overlapsDoc(header, symbols[0].docstring)) {
    symbols.unshift(commentSymbol(header, path));
  }
  return symbols;
}

function spanSymbol(
  decl: Decl,
  content: string,
  end: number,
  docstring: ParsedDocstring | undefined,
): ParsedSymbol {
  return {
    name: decl.name,
    kind: decl.kind,
    startLine: lineOfOffset(content, decl.start),
    endLine: lineOfOffset(content, Math.max(decl.start, end - 1)),
    startOffset: decl.start,
    endOffset: end,
    docstring,
  };
}

function commentSymbol(doc: ParsedDocstring, path: string): ParsedSymbol {
  const base = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "module";
  return {
    name: base,
    kind: "comment",
    startLine: doc.startLine,
    endLine: doc.endLine,
    startOffset: doc.startOffset,
    endOffset: doc.endOffset,
    docstring: doc,
  };
}

function overlapsDoc(a: ParsedDocstring, b: ParsedDocstring | undefined): boolean {
  return Boolean(b && a.startOffset === b.startOffset && a.endOffset === b.endOffset);
}

function collectDeclarations(content: string, lang: ParserLanguage): Decl[] {
  const found: Decl[] = [];
  const seen = new Set<number>();
  for (const pattern of patternsFor(lang)) {
    pattern.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.re.exec(content))) {
      const start = match.index;
      if (seen.has(start) || inLineComment(content, start)) continue;
      const name = match[pattern.name] ?? "";
      if (!name) continue;
      seen.add(start);
      found.push({
        name,
        kind: pattern.kind(match, content, start),
        start,
        headerEnd: start + match[0].length,
      });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

function inLineComment(content: string, offset: number): boolean {
  const lineStart = content.lastIndexOf("\n", offset - 1) + 1;
  const prefix = content.slice(lineStart, offset);
  return /^\s*(\/\/|#)/.test(prefix);
}

type Pattern = {
  re: RegExp;
  name: number;
  kind: (match: RegExpExecArray, content: string, start: number) => SymbolKind;
};

function patternsFor(lang: ParserLanguage): Pattern[] {
  if (lang === "py") {
    return [
      {
        re: /^[ \t]*(async[ \t]+)?def[ \t]+([A-Za-z_]\w*)/gm,
        name: 2,
        kind: (_m, content, start) => (lineIndent(content, start) > 0 ? "method" : "function"),
      },
      {
        re: /^[ \t]*class[ \t]+([A-Za-z_]\w*)/gm,
        name: 1,
        kind: () => "class",
      },
    ];
  }
  if (lang === "go") {
    return [
      {
        re: /^[ \t]*func[ \t]+(?:\([^)]*\)[ \t]+)?([A-Za-z_]\w*)/gm,
        name: 1,
        kind: (match) => (/\bfunc[ \t]+\(/.test(match[0]) ? "method" : "function"),
      },
      {
        re: /^[ \t]*type[ \t]+([A-Za-z_]\w*)[ \t]+(?:struct|interface)/gm,
        name: 1,
        kind: (match) => (/\binterface\b/.test(match[0]) ? "interface" : "type"),
      },
    ];
  }
  if (lang === "rs") {
    return [
      {
        re: /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?fn[ \t]+([A-Za-z_]\w*)/gm,
        name: 1,
        kind: (_m, content, start) => (lineIndent(content, start) > 0 ? "method" : "function"),
      },
      {
        re: /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:struct|enum|trait)[ \t]+([A-Za-z_]\w*)/gm,
        name: 1,
        kind: () => "type",
      },
      {
        re: /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?impl(?:[ \t]<[^>]+>)?[ \t]+(?:[A-Za-z_]\w*[ \t]+for[ \t]+)?([A-Za-z_]\w*)/gm,
        name: 1,
        kind: () => "type",
      },
    ];
  }
  if (lang === "java" || lang === "kt") {
    return [
      {
        re: /^[ \t]*(?:(?:public|private|protected|internal|open|data|sealed|abstract|final)[ \t]+)*(?:class|interface|enum|object)[ \t]+([A-Za-z_]\w*)/gm,
        name: 1,
        kind: (match) => (/\binterface\b/.test(match[0]) ? "interface" : "class"),
      },
      {
        re: /^[ \t]*(?:(?:public|private|protected|internal|open|override|suspend)[ \t]+)+(?:(?:static|final|abstract|open)[ \t]+)*(?:[\w.<>,\[\]?]+[ \t]+)?([A-Za-z_]\w*)[ \t]*\(/gm,
        name: 1,
        kind: () => "method",
      },
      {
        re: /^[ \t]*(?:(?:public|private|protected|internal|open|override|suspend)[ \t]+)*fun[ \t]+([A-Za-z_]\w*)/gm,
        name: 1,
        kind: () => "function",
      },
    ];
  }
  // ts / js
  return [
    {
      re: /^[ \t]*(export[ \t]+)?(async[ \t]+)?function[ \t]+([A-Za-z_$][\w$]*)/gm,
      name: 3,
      kind: () => "function",
    },
    {
      re: /^[ \t]*(export[ \t]+)?class[ \t]+([A-Za-z_$][\w$]*)/gm,
      name: 2,
      kind: () => "class",
    },
    {
      re: /^[ \t]*(export[ \t]+)?interface[ \t]+([A-Za-z_$][\w$]*)/gm,
      name: 2,
      kind: () => "interface",
    },
    {
      re: /^[ \t]*(export[ \t]+)?type[ \t]+([A-Za-z_$][\w$]*)/gm,
      name: 2,
      kind: () => "type",
    },
    {
      re: /^[ \t]*(export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)/gm,
      name: 2,
      kind: (match) => (match[1] ? "export" : "unknown"),
    },
  ];
}

function lineIndent(content: string, offset: number): number {
  const lineStart = content.lastIndexOf("\n", offset - 1) + 1;
  let n = 0;
  for (let i = lineStart; i < content.length; i += 1) {
    if (content[i] === " ") n += 1;
    else if (content[i] === "\t") n += 2;
    else break;
  }
  return n;
}

/**
 * Brace / bracket / paren match from the first opener on the declaration.
 * Strings and comments are skipped so a `{` in a string cannot unbalance us.
 * Returns null when the construct never closes.
 */
function bracedBodyEnd(content: string, start: number): number | null {
  const stack: string[] = [];
  let i = start;
  let mode: "code" | "s" | "d" | "t" | "line" | "block" = "code";
  let opened = false;
  let sawAssign = false;

  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (mode === "line") {
      if (ch === "\n") mode = "code";
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && next === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (mode === "s" || mode === "d" || mode === "t") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if ((mode === "s" && ch === "'") || (mode === "d" && ch === '"') || (mode === "t" && ch === "`")) {
        mode = "code";
      }
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      mode = "line";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      mode = "block";
      i += 2;
      continue;
    }
    if (ch === "'") {
      mode = "s";
      i += 1;
      continue;
    }
    if (ch === '"') {
      mode = "d";
      i += 1;
      continue;
    }
    if (ch === "`") {
      mode = "t";
      i += 1;
      continue;
    }

    if (ch === "=" && stack.length === 0) sawAssign = true;

    if (OPENERS.has(ch)) {
      // Generics (`foo<T>`) and signatures (`foo()`) are not the body unless
      // this is an assignment (`const x = (` / `= {` / `= [`).
      const isBodyOpener = ch === "{" || ch === "[" || (ch === "(" && sawAssign);
      if (stack.length === 0 && !isBodyOpener && (ch === "(" || ch === "<")) {
        // Still track `(` so we can skip the parameter list; `<` is ignored.
        if (ch === "(") stack.push(")");
        i += 1;
        continue;
      }
      if (ch !== "<") {
        stack.push(PAIRS[ch]);
        opened = true;
      }
      i += 1;
      continue;
    }

    if (CLOSERS.has(ch)) {
      if (stack.length === 0) {
        return opened ? i : null;
      }
      if (stack[stack.length - 1] !== ch) {
        // Mismatched closer — skip this symbol rather than invent a range.
        return null;
      }
      stack.pop();
      if (opened && stack.length === 0) return i + 1;
      i += 1;
      continue;
    }

    if (stack.length === 0 && ch === ";") return i + 1;

    if (stack.length === 0 && ch === "\n" && !opened) {
      // One-line declaration with no block. Keep going if the line continues.
      const prev = content[i - 1];
      if (prev !== "\\" && prev !== "," && prev !== "=" && prev !== ":") return i;
    }

    i += 1;
  }

  return opened && stack.length === 0 ? content.length : opened ? null : content.length;
}

function pythonBodyEnd(content: string, start: number): number {
  const indent = lineIndent(content, start);
  let lineStart = content.indexOf("\n", start);
  if (lineStart < 0) return content.length;
  lineStart += 1;
  let end = content.length;
  while (lineStart < content.length) {
    const nextNl = content.indexOf("\n", lineStart);
    const lineEnd = nextNl < 0 ? content.length : nextNl;
    const line = content.slice(lineStart, lineEnd);
    if (line.trim().length === 0) {
      end = lineEnd;
      if (nextNl < 0) break;
      lineStart = nextNl + 1;
      continue;
    }
    if (lineIndent(content, lineStart) <= indent) break;
    end = lineEnd;
    if (nextNl < 0) break;
    lineStart = nextNl + 1;
  }
  return Math.max(end, start + 1);
}

function leadingDoc(content: string, offset: number, lang: ParserLanguage): ParsedDocstring | undefined {
  let i = offset;
  while (i > 0 && /[ \t]/.test(content[i - 1])) i -= 1;
  if (i > 0 && content[i - 1] === "\n") i -= 1;
  while (i > 0 && /[ \t]/.test(content[i - 1])) i -= 1;

  if (lang === "py") return collectHashBlock(content, i) ?? undefined;
  if (lang === "go") return collectSlashBlock(content, i, false) ?? undefined;
  if (lang === "rs") return collectSlashBlock(content, i, true) ?? undefined;
  return collectBlockComment(content, i) ?? collectSlashBlock(content, i, false) ?? undefined;
}

function fileHeaderDoc(content: string, lang: ParserLanguage, before: number): ParsedDocstring | undefined {
  let i = 0;
  if (content.startsWith("#!")) {
    const nl = content.indexOf("\n");
    i = nl < 0 ? content.length : nl + 1;
  }
  while (i < content.length && /[ \t\r\n]/.test(content[i])) i += 1;
  if (i >= before) return undefined;

  if (lang === "py" && (content.startsWith('"""', i) || content.startsWith("'''", i))) {
    const quote = content.slice(i, i + 3);
    const close = content.indexOf(quote, i + 3);
    if (close < 0 || close + 3 > before) return undefined;
    return makeDoc(content, i, close + 3);
  }
  if (content.startsWith("/**", i) || content.startsWith("/*", i)) {
    const close = content.indexOf("*/", i + 2);
    if (close < 0 || close + 2 > before) return undefined;
    return makeDoc(content, i, close + 2);
  }
  if (lang === "rs" && content.startsWith("///", i)) {
    return collectSlashRun(content, i, true, before);
  }
  if ((lang === "go" || lang === "ts" || lang === "js") && content.startsWith("//", i)) {
    return collectSlashRun(content, i, false, before);
  }
  return undefined;
}

function pythonInnerDoc(content: string, from: number, to: number): ParsedDocstring | undefined {
  let i = from;
  while (i < to && /[ \t\r\n:()]/.test(content[i])) i += 1;
  if (i >= to) return undefined;
  if (content.startsWith('"""', i) || content.startsWith("'''", i)) {
    const quote = content.slice(i, i + 3);
    const close = content.indexOf(quote, i + 3);
    if (close < 0 || close + 3 > to) return undefined;
    return makeDoc(content, i, close + 3);
  }
  return undefined;
}

function collectBlockComment(content: string, end: number): ParsedDocstring | undefined {
  if (end < 2 || content.slice(end - 2, end) !== "*/") return undefined;
  const start = content.lastIndexOf("/*", end - 2);
  if (start < 0) return undefined;
  const between = content.slice(end, skipWsForward(content, end));
  if (between.trim().length > 0) return undefined;
  return makeDoc(content, start, end);
}

function collectSlashBlock(content: string, end: number, rust: boolean): ParsedDocstring | undefined {
  const lineStart = content.lastIndexOf("\n", end - 1) + 1;
  const line = content.slice(lineStart, end);
  const mark = rust ? "///" : "//";
  if (!line.trimStart().startsWith(mark)) return undefined;
  let start = lineStart;
  let cursor = lineStart;
  while (cursor > 0) {
    const prevNl = content.lastIndexOf("\n", cursor - 2);
    const prevStart = prevNl < 0 ? 0 : prevNl + 1;
    const prev = content.slice(prevStart, cursor).trim();
    if (!prev) break;
    if (!prev.startsWith(mark)) break;
    start = prevStart;
    cursor = prevStart;
  }
  return makeDoc(content, start, end);
}

function collectSlashRun(
  content: string,
  start: number,
  rust: boolean,
  before: number,
): ParsedDocstring | undefined {
  const mark = rust ? "///" : "//";
  let i = start;
  let end = start;
  while (i < before) {
    while (i < before && /[ \t]/.test(content[i])) i += 1;
    if (!content.startsWith(mark, i)) break;
    const nl = content.indexOf("\n", i);
    const lineEnd = nl < 0 || nl > before ? before : nl;
    end = lineEnd;
    i = lineEnd + 1;
    if (nl < 0) break;
  }
  if (end <= start) return undefined;
  return makeDoc(content, start, end);
}

function collectHashBlock(content: string, end: number): ParsedDocstring | undefined {
  const lineStart = content.lastIndexOf("\n", end - 1) + 1;
  if (!content.slice(lineStart, end).trimStart().startsWith("#")) return undefined;
  let start = lineStart;
  let cursor = lineStart;
  while (cursor > 0) {
    const prevNl = content.lastIndexOf("\n", cursor - 2);
    const prevStart = prevNl < 0 ? 0 : prevNl + 1;
    const prev = content.slice(prevStart, cursor).trim();
    if (!prev.startsWith("#")) break;
    start = prevStart;
    cursor = prevStart;
  }
  return makeDoc(content, start, end);
}

function skipWsForward(content: string, i: number): number {
  while (i < content.length && /\s/.test(content[i])) i += 1;
  return i;
}

function makeDoc(content: string, start: number, end: number): ParsedDocstring {
  return {
    startLine: lineOfOffset(content, start),
    endLine: lineOfOffset(content, Math.max(start, end - 1)),
    startOffset: start,
    endOffset: end,
    text: content.slice(start, end),
  };
}
