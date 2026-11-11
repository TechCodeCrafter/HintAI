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

export type LocatorKind = "handler" | "value" | "route" | "list" | "field";

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
  /** Verbatim pieces a list answer was joined from (one per entry line). */
  parts?: string[];
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

/** "Which providers are supported?", "what models are available?", "list the X". */
const LIST_Q =
  /^\s*(?:which|what)\b(?:\s+[\w-]+){1,3}\s+(?:are|is)\s+(?:supported|available|there|allowed|included|configured|offered)\b|^\s*(?:which|what)\s+(?:[\w-]+\s+){0,2}(?:do|does|can)\s+(?:we|you|it|i)\s+(?:support|offer|allow)\b|\blist (?:the|all|every)\b/i;

/** `export const PROVIDERS = {` or `= [` opening a multi-line collection. */
const COLLECTION_OPEN = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([[{])\s*$/;
/** An entry: `openai: { label: "OpenAI", ... },` or `"OpenAI",`. */
const ENTRY_KEY = /^\s*["']?([A-Za-z_$][\w$-]*)["']?\s*:\s*\{(.*)\}\s*,?\s*$/;
const ENTRY_STRING = /^\s*["'`]([^"'`\n]{1,60})["'`]\s*,?\s*$/;
/** `field: "value"` or `field: 12` pairs inside a one-line object. */
const FIELD_PAIR = /([A-Za-z_$][\w$]*)\s*:\s*(["'`][^"'`\n]{1,80}["'`]|-?\d[\d_.]*)/g;
/** Fields whose value is the display name of an entry. */
const LABEL_FIELDS = ["label", "name", "title", "displayName"];

/** A one-line comment directly above a line: `/** ... *\/`, `// ...`, `# ...`. */
const LINE_DOC = /^\s*(?:\/\*\*?\s*(.+?)\s*\*\/|\/\/\s*(.+?)|#\s*(.+?))\s*$/;

/** Words the templates below add. Listed once so the support check can see them. */
const TEMPLATE_WORDS = ["that's", "current", "value", "route", "function", "class", "calls", "then", "lists"];

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
    // A prefix counts when the rest is a suffix ("install" ~ "installation"),
    // not a different word ("author" is not "authorization").
    return words.some(
      (w) =>
        w === t ||
        (t.length >= 4 && w.length >= 4 && Math.abs(w.length - t.length) <= 6 && (w.startsWith(t) || t.startsWith(w))),
    );
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

/** Source files only: README and docs hits are read by doc-section.ts and must not use up the four slots. */
function isSourceHit(hit: FileHit): boolean {
  return hit.kind === "code" && !/\.(md|mdx|markdown|txt|rst|adoc)$/i.test(hit.path);
}

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
    .filter(isSourceHit)
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
        if (scalar) {
          // `methods: '...'` inside `var defaults = {` answers "what methods by default?".
          const owner = enclosingName(lines, i);
          const ownerCover = owner ? covers(identWords(owner), terms) : 0;
          push("value", scalar[1], covers(identWords(scalar[1]), terms) + ownerCover);
        }
      });
    });

  const collection = locateCollection(canonical, terms, hits, fileContent);
  const field = locateField(terms, hits, fileContent);
  const structured = [collection, field]
    .filter((row): row is CodeLocation => row !== null)
    .sort((a, b) => b.score - a.score)[0];

  const usable = candidates.filter((c) => c.score >= 1);
  if (usable.length === 0) return structured ?? null;
  // Value questions want a value; everything else wants the thing that does it.
  const preferKind = (c: Candidate) =>
    wantsValue ? (c.kind === "value" ? 2 : 0) : c.kind === "handler" ? 1 : c.kind === "route" ? 0.5 : 0;
  const best = usable.reduce((a, b) => {
    const sa = a.score + preferKind(a) - a.rank * 0.25;
    const sb = b.score + preferKind(b) - b.rank * 0.25;
    return sb > sa ? b : a;
  });
  // A list or a field read straight from the data beats a name that merely
  // matches the question.
  if (structured && structured.score >= best.score) return structured;
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

function offsetsOfLine(content: string, at: number): { start: number; end: number; text: string } {
  const lineStart = content.lastIndexOf("\n", at - 1) + 1;
  const rawEnd = content.indexOf("\n", at);
  const lineEnd = rawEnd < 0 ? content.length : rawEnd;
  const text = content.slice(lineStart, lineEnd);
  return { start: lineStart + (text.length - text.trimStart().length), end: lineStart + text.trimEnd().length, text };
}

function spanOfLine(hit: FileHit, content: string, start: number, end: number): TextEvidence | null {
  return textEvidence({
    path: hit.path,
    content,
    start,
    end,
    normalizedText: content.slice(start, end).replace(/\s+/g, " ").trim(),
    sourceId: hit.sourceId,
  });
}

function unquote(value: string): string {
  return value.replace(/^["'`]|["'`]$/g, "");
}

/** "A, B and C". */
function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * "Which AI providers are supported?" answered from the collection that
 * enumerates them: `export const PROVIDERS = { openai: { label: "OpenAI" }, ... }`
 * becomes "`PROVIDERS` lists OpenAI, Anthropic, xAI (Grok) and Groq." Each
 * entry is read from its own line, and that line is its evidence. Only for
 * list-shaped questions, and only when the collection's name is a question term.
 */
function locateCollection(
  canonical: string,
  terms: string[],
  hits: FileHit[],
  fileContent: (path: string) => string | undefined,
): CodeLocation | null {
  if (!LIST_Q.test(canonical)) return null;
  const seen = new Set<string>();
  for (const hit of hits.filter(isSourceHit).slice(0, 4)) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    const content = fileContent(hit.path);
    if (!content) continue;
    const lines = content.split("\n");
    let offset = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const lineStart = offset;
      offset += lines[i]!.length + 1;
      const open = COLLECTION_OPEN.exec(lines[i]!);
      if (!open) continue;
      const nameCover = covers(identWords(open[1]!), terms);
      if (nameCover === 0) continue;
      const closer = open[2] === "{" ? "}" : "]";
      const names: string[] = [];
      const entrySpans: TextEvidence[] = [];
      let at = offset;
      let closed = false;
      for (let j = i + 1; j < lines.length && j <= i + 40; j += 1) {
        const line = lines[j]!;
        const here = at;
        at += line.length + 1;
        if (new RegExp(`^\\s*\\${closer}`).test(line)) {
          closed = true;
          break;
        }
        if (!line.trim() || /^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;
        let label: string | null = null;
        const keyed = ENTRY_KEY.exec(line);
        if (keyed) {
          const fields = new Map([...keyed[2]!.matchAll(FIELD_PAIR)].map((m) => [m[1]!, unquote(m[2]!)]));
          label = LABEL_FIELDS.map((f) => fields.get(f)).find(Boolean) ?? keyed[1]!;
        } else {
          label = ENTRY_STRING.exec(line)?.[1] ?? null;
        }
        if (!label) {
          names.length = 0;
          break;
        }
        const row = offsetsOfLine(content, here);
        const span = spanOfLine(hit, content, row.start, row.end);
        if (!span) continue;
        names.push(label);
        entrySpans.push(span);
      }
      if (!closed || names.length < 2 || names.length > 12) continue;
      const head = spanOfLine(hit, content, lineStart + (lines[i]!.length - lines[i]!.trimStart().length), lineStart + lines[i]!.trimEnd().length);
      if (!head) continue;
      return {
        kind: "list",
        name: open[1]!,
        say: `\`${open[1]}\` lists ${joinNames(names)}.`,
        span: head,
        spans: [head, ...entrySpans],
        hit,
        // Naming the collection and enumerating it answers the whole question.
        score: nameCover + 1,
        structural: [...TEMPLATE_WORDS, open[1]!.toLowerCase()],
        parts: [open[1]!, ...names],
      };
    }
  }
  return null;
}

/**
 * "What model does the OpenAI provider use?" answered from the entry for it:
 * `openai: { ..., model: "gpt-5-mini" }` becomes "The `openai` model is
 * `gpt-5-mini`." Both the entry key and the field name must be question terms.
 */
function locateField(
  terms: string[],
  hits: FileHit[],
  fileContent: (path: string) => string | undefined,
): CodeLocation | null {
  let best: CodeLocation | null = null;
  const seen = new Set<string>();
  for (const hit of hits.filter(isSourceHit).slice(0, 4)) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    const content = fileContent(hit.path);
    if (!content) continue;
    let offset = 0;
    for (const line of content.split("\n")) {
      const here = offset;
      offset += line.length + 1;
      if (line.length > 240) continue;
      const keyed = ENTRY_KEY.exec(line);
      if (!keyed) continue;
      const keyCover = covers(identWords(keyed[1]!), terms);
      if (keyCover === 0) continue;
      for (const m of keyed[2]!.matchAll(FIELD_PAIR)) {
        const fieldName = m[1]!;
        if (LABEL_FIELDS.includes(fieldName)) continue;
        const fieldCover = covers(identWords(fieldName), terms);
        if (fieldCover === 0) continue;
        // "the OpenAI provider" prefers providers.ts over stt.ts's openai entry.
        const fileCover = covers(identWords(hit.path.split("/").pop()!.replace(/\.\w+$/, "")), terms);
        const score = keyCover + fieldCover + 0.5 + fileCover * 0.5;
        if (best && best.score >= score) continue;
        const row = offsetsOfLine(content, here);
        const span = spanOfLine(hit, content, row.start, row.end);
        if (!span) continue;
        const value = unquote(m[2]!);
        best = {
          kind: "field",
          name: `${keyed[1]}.${fieldName}`,
          say: `The \`${keyed[1]}\` ${identWords(fieldName)} is \`${value}\`.`,
          span,
          spans: [span],
          hit,
          score,
          structural: [...TEMPLATE_WORDS, keyed[1]!.toLowerCase(), fieldName.toLowerCase()],
        };
      }
    }
  }
  return best;
}

/** The name of the object literal a line sits directly inside, if any. */
function enclosingName(lines: string[], index: number): string | null {
  const indent = (lines[index]!.match(/^\s*/)?.[0] ?? "").length;
  for (let j = index - 1; j >= 0 && j >= index - 30; j -= 1) {
    const line = lines[j]!;
    if (!line.trim()) continue;
    const lead = (line.match(/^\s*/)?.[0] ?? "").length;
    if (lead >= indent) continue;
    const open = /^\s*(?:export\s+)?(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*(?::[^=]+)?[:=]\s*\{\s*$/.exec(line);
    return open ? open[1]! : null;
  }
  return null;
}
