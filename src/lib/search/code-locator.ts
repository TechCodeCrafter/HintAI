/**
 * Code locator: the answer when the code itself is the evidence.
 *
 * Most questions in a meeting are about where something lives or what a value
 * is: "how do we send the billing email?", "what's the rate limit on checkout?".
 * Code often answers those without a comment anyone would read out. The prose
 * path stays silent there, which is honest but leaves the room with nothing.
 *
 * A locator answer points at the code instead of paraphrasing it. It only ever
 * says three kinds of things:
 *   - a declaration name, copied from the line that declares it;
 *   - a configuration line, copied verbatim, with the comment above it.
 * The file and line go on the citation chip, never into the sentence.
 * The connecting words ("That's the ... function", "The current value is") come from
 * a fixed list passed to the support check as structural vocabulary, so every
 * other word must still be found in the cited line. Nothing is inferred.
 */
import type { FileHit } from "../repo/types.ts";
import { type TextEvidence, textEvidence } from "./evidence.ts";

export type LocatorKind = "handler" | "value" | "route";

export type CodeLocation = {
  kind: LocatorKind;
  /** The declaration, route or key the answer points at. */
  name: string;
  say: string;
  /** The line the citation chip points at. */
  span: TextEvidence;
  /** Every span the sentence is read from, the cited one first. */
  spans: TextEvidence[];
  hit: FileHit;
  /** Query terms the located name or line covers. */
  score: number;
  /** Words the locator template adds, for the support check. */
  structural: string[];
};

const DECLS: RegExp[] = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*[(<]/,
  /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
  /^\s*(?:(?:public|private|protected|static|async|override|final)\s+)+[\w<>[\],\s]*?\b([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\{/,
];

const ROUTE = /^\s*(?:router|app|server|api|bp)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/;
const PY_ROUTE = /^\s*@(?:app|router|bp|api)\.(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)['"]/;

/** `checkout: { requests: 10, windowSeconds: 60 },` */
const OBJECT_VALUE = /^\s*([A-Za-z_]\w*)\s*:\s*\{[^{}\n]{3,100}\}\s*,?\s*$/;
/** `export const MAX_RETRIES = 4;`, `timeout: 30_000,`, `RETRY_DELAY_MS = 2_000` */
const SCALAR_VALUE =
  /^\s*(?:export\s+)?(?:const\s+|let\s+|var\s+)?([A-Za-z_][\w.]*)\s*(?::\s*[\w<>[\]| ]+)?\s*[:=]\s*(-?\d[\d_.]*(?:\s*[*x]\s*\d[\d_.]*)*|true|false|['"`][^'"`\n]{1,60}['"`])\s*[,;]?\s*(?:\/\/.*|#.*)?$/;

const NOT_NAME = new Set(["if", "for", "while", "switch", "catch", "return", "function", "else", "constructor", "super", "new", "await"]);

const VALUE_Q =
  /\b(?:what|which)\b[^?]*\b(?:values?|rates?|limits?|timeouts?|delays?|ttl|ports?|urls?|versions?|thresholds?|max(?:imum)?|min(?:imum)?|codes?|errors?|intervals?|sizes?|defaults?|numbers?|counts?)\b|\bhow (?:many|much|long|often)\b|\brate.?limit\b|\btimeout\b|\bthreshold\b/i;

/** `const RETRYABLE_CODES = new Set(["card_declined", ...]);` on one line. */
const LIST_VALUE =
  /^\s*(?:export\s+)?(?:const|let|var)?\s*([A-Za-z_][\w.]*)\s*(?::[^=]+)?=\s*(?:new\s+Set\(\s*|frozenset\(\s*|\(\s*)?\[[^\[\]\n]{3,160}\]\s*\)?\s*(?:as\s+const)?\s*[,;]?\s*$/;

/** A one-line comment directly above a line: `/** ... *\/`, `// ...`, `# ...`. */
const LINE_DOC = /^\s*(?:\/\*\*?\s*(.+?)\s*\*\/|\/\/\s*(.+?)|#\s*(.+?))\s*$/;

/** Words the templates below add. Listed once so the support check can see them. */
const TEMPLATE_WORDS = ["that's", "current", "value", "route", "function", "class", "calls", "then"];

export function identWords(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_$.]+/g, " ")
    .toLowerCase();
}

function stem(word: string): string {
  return word
    .toLowerCase()
    .replace(/(?:ies|ied)$/, "y")
    .replace(/(?:able|ing|ed|es|s)$/, "")
    .replace(/(.)\1$/, "$1");
}

/** Query terms a text covers, matching word stems (retried ~ retry, fails ~ failed). */
export function covers(text: string, terms: string[]): number {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map(stem);
  return terms.filter((term) => {
    const t = stem(term);
    return words.some((w) => w === t || (t.length >= 4 && w.length >= 4 && (w.startsWith(t) || t.startsWith(w))));
  }).length;
}

type Candidate = {
  kind: LocatorKind;
  hit: FileHit;
  rank: number;
  /** Offsets of the matched line in the file. */
  start: number;
  end: number;
  lineText: string;
  name: string;
  score: number;
  /** A one-line comment directly above, when there is one. */
  doc?: { text: string; start: number };
};

function lineOffsets(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") out.push(i + 1);
  return out;
}

/**
 * The best line to point at across the ranked code hits, or null when no
 * declaration or value line is named by the question.
 */
export function locateInCode(
  canonical: string,
  terms: string[],
  hits: FileHit[],
  fileContent: (path: string) => string | undefined,
): CodeLocation | null {
  if (terms.length === 0) return null;
  const wantsValue = VALUE_Q.test(canonical);
  const candidates: Candidate[] = [];

  hits
    .filter((hit) => hit.kind === "code")
    .slice(0, 4)
    .forEach((hit, rank) => {
      const content = fileContent(hit.path);
      if (!content || content.slice(hit.startOffset, hit.startOffset + hit.text.length) !== hit.text) return;
      const starts = lineOffsets(hit.text);
      const lines = hit.text.split("\n");
      lines.forEach((line, i) => {
        if (/^\s*(import|from|require|#include|using)\b/.test(line)) return;
        const start = hit.startOffset + starts[i] + (line.length - line.trimStart().length);
        const end = hit.startOffset + starts[i] + line.trimEnd().length;
        if (end <= start) return;
        const above = i > 0 ? LINE_DOC.exec(lines[i - 1]) : null;
        const docText = above ? (above[1] ?? above[2] ?? above[3] ?? "").trim() : "";
        const doc = docText
          ? { text: docText, start: hit.startOffset + starts[i - 1] + (lines[i - 1].length - lines[i - 1].trimStart().length) }
          : undefined;
        const push = (kind: LocatorKind, name: string, nameScore: number) =>
          candidates.push({
            kind, hit, rank, start, end, lineText: line.trim(), name, doc,
            score: nameScore + (doc ? covers(doc.text, terms) * 0.5 : 0),
          });

        const route = ROUTE.exec(line) ?? PY_ROUTE.exec(line);
        if (route) {
          push("route", `${route[1].toUpperCase()} ${route[2]}`, covers(route[2].replace(/[/:{}-]+/g, " "), terms));
          return;
        }
        for (const re of DECLS) {
          const m = re.exec(line);
          if (m?.[1] && !NOT_NAME.has(m[1])) {
            push("handler", m[1], covers(identWords(m[1]), terms));
            return;
          }
        }
        if (!wantsValue) return;
        const obj = OBJECT_VALUE.exec(line);
        if (obj && /\d/.test(line)) {
          push("value", obj[1], covers(identWords(obj[1]), terms) + 0.5);
          return;
        }
        const scalar = SCALAR_VALUE.exec(line) ?? LIST_VALUE.exec(line);
        if (scalar) push("value", scalar[1], covers(identWords(scalar[1]), terms));
      });
    });

  const usable = candidates.filter((c) => c.score >= 1);
  if (usable.length === 0) return null;
  // Value questions want a value; everything else wants the thing that does it.
  const preferKind = (c: Candidate) =>
    wantsValue ? (c.kind === "value" ? 2 : 0) : c.kind === "handler" ? 1 : c.kind === "route" ? 0.5 : 0;
  const best = usable.reduce((a, b) => {
    const sa = a.score + preferKind(a) - a.rank * 0.25;
    const sb = b.score + preferKind(b) - b.rank * 0.25;
    return sb > sa ? b : a;
  });
  if (wantsValue && best.kind !== "value") {
    // A value question answered with a function name is a different answer.
    // Fall back to the handler only when it covers the question better.
    if (best.score < 2) return null;
  }

  const content = fileContent(best.hit.path)!;
  // A value reads better with the comment that says what it is for, so the
  // span covers both lines and the sentence quotes both.
  const lead = best.kind === "value" && best.doc && /[a-z]{3,}\s+[a-z]{3,}/i.test(best.doc.text)
    ? best.doc.text.replace(/\s*\*\/\s*$/, "").replace(/([^.!?])$/, "$1.")
    : "";
  const start = lead && best.doc ? best.doc.start : best.start;
  // A route is described by what its handler calls, read from its own body.
  const body = best.kind === "route" ? routeBody(content, best.start) : null;
  const end = best.end;
  const span = textEvidence({
    path: best.hit.path,
    content,
    start,
    end,
    normalizedText: content.slice(start, end).replace(/\s+/g, " ").trim(),
    sourceId: best.hit.sourceId,
  });
  if (!span) return null;

  // The sentence states what the code is; where it lives is the citation
  // chip's job. A spoken number must be one the cited code contains, so no
  // line numbers in the sentence either.
  const code = best.lineText
    .replace(/\s*(?:\/\/|#).*$/, "")
    .replace(/[,;]\s*$/, "")
    .replace(/^export\s+/, "")
    .replace(/^(?:const|let|var)\s+/, "");
  const noun = best.kind === "route" ? "route" : /\bclass\s/.test(best.lineText) ? "class" : "function";
  // Each call is backed by the line it is made on, not by the whole body: the
  // body also holds status codes and literals the sentence does not repeat.
  const callSpans = (body?.calls ?? [])
    .map((call) =>
      textEvidence({
        path: best.hit.path,
        content,
        start: call.start,
        end: call.end,
        normalizedText: content.slice(call.start, call.end).trim(),
        sourceId: best.hit.sourceId,
      }),
    )
    .filter((row): row is TextEvidence => row !== null);
  const calls = callSpans.length === (body?.calls.length ?? 0) ? (body?.calls ?? []).map((call) => call.name) : [];
  const say =
    best.kind === "value"
      ? `${lead ? `${lead} ` : ""}The current value is \`${code}\`.`
      : calls.length > 0
        ? `The \`${best.name}\` route calls ${listCode(calls)}.`
        : `That's the \`${best.name}\` ${noun}.`;
  return {
    kind: best.kind,
    name: best.name,
    say,
    span,
    spans: calls.length > 0 ? [span, ...callSpans] : [span],
    hit: best.hit,
    score: best.score,
    structural: [...TEMPLATE_WORDS, best.name.toLowerCase()],
  };
}

const NOT_CALL = new Set([
  ...NOT_NAME,
  "require", "json", "send", "status", "next", "res", "req", "parseInt", "parseFloat", "String", "Number", "Boolean",
  "Object", "Array", "Promise", "JSON", "Math", "Date", "console", "fetch", "setTimeout", "typeof",
]);

/** The handler body that starts on the route line, and the named calls in it with their lines. */
function routeBody(
  content: string,
  from: number,
): { calls: Array<{ name: string; start: number; end: number }> } | null {
  const open = content.indexOf("{", from);
  if (open < 0 || content.slice(from, open).includes("\n\n")) return null;
  let depth = 0;
  let close = -1;
  for (let i = open; i < content.length && i < open + 4000; i += 1) {
    const ch = content[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return null;
  const calls: Array<{ name: string; start: number; end: number }> = [];
  for (const m of content.slice(open, close).matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (NOT_CALL.has(name) || calls.some((call) => call.name === name)) continue;
    const at = open + (m.index ?? 0);
    const lineStart = content.lastIndexOf("\n", at) + 1;
    const lineEndRaw = content.indexOf("\n", at);
    const lineEnd = lineEndRaw < 0 ? content.length : lineEndRaw;
    const text = content.slice(lineStart, lineEnd);
    const start = lineStart + (text.length - text.trimStart().length);
    const end = lineStart + text.trimEnd().length;
    if (end > start) calls.push({ name, start, end });
    if (calls.length === 3) break;
  }
  return { calls };
}

/** "`a`, then `b`, then `c`": one clause per call, each backed by its own line. */
function listCode(names: string[]): string {
  return names.map((name) => `\`${name}\``).join(", then ");
}
