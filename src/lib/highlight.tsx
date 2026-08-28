import type { ReactNode } from "react";

const KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "const",
  "let",
  "var",
  "function",
  "async",
  "await",
  "return",
  "if",
  "else",
  "elif",
  "for",
  "while",
  "of",
  "in",
  "is",
  "and",
  "or",
  "not",
  "def",
  "class",
  "type",
  "interface",
  "new",
  "typeof",
  "as",
  "void",
  "never",
  "unknown",
  "extends",
  "implements",
  "public",
  "private",
  "readonly",
  "try",
  "catch",
  "except",
  "finally",
  "throw",
  "raise",
  "break",
  "continue",
  "switch",
  "case",
  "default",
  "true",
  "false",
  "null",
  "undefined",
  "True",
  "False",
  "None",
  "this",
  "self",
  "pass",
  "with",
  "lambda",
  "yield",
  "number",
  "string",
  "boolean",
]);

const TOKEN =
  /#.*$|\/\/.*$|\/\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[^\s]/g;

function kind(token: string, next: string): string | null {
  if (
    token.startsWith("#") ||
    token.startsWith("//") ||
    token.startsWith("/*") ||
    token.startsWith("*")
  ) {
    return "cmt";
  }
  if (
    token.startsWith("\"") ||
    token.startsWith("'") ||
    token.startsWith("`") ||
    token.startsWith('"""') ||
    token.startsWith("'''")
  ) {
    return "str";
  }
  if (/^\d/.test(token)) return "num";
  if (KEYWORDS.has(token)) return "kw";
  if (/^[A-Z][A-Z0-9_]+$/.test(token)) return "const";
  if (/^[A-Za-z_$]/.test(token) && next === "(") return "fn";
  return null;
}

export function highlightLine(line: string): ReactNode {
  if (!line) return " ";
  const parts: ReactNode[] = [];
  const list = [...line.matchAll(TOKEN)];
  let cursor = 0;
  let i = 0;
  for (const match of list) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push(line.slice(cursor, start));
    const token = match[0];
    const next = line[start + token.length] ?? "";
    const tone = kind(token, next);
    parts.push(
      tone ? (
        <span key={`${start}-${i}`} className={`syn-${tone}`}>
          {token}
        </span>
      ) : (
        <span key={`${start}-${i}`}>{token}</span>
      ),
    );
    cursor = start + token.length;
    i += 1;
  }
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts.length ? parts : line;
}
