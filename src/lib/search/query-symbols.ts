/**
 * Code the question names: an identifier ("verifyClaim", "MAX_PER_FILE",
 * "retrieve()") or a file ("retrieve.ts").
 *
 * A word only counts once the loaded material agrees with it. "TypeScript" and
 * "GitHub" are written like identifiers and "e.g." like a file name, so the
 * shape of a word is a candidate and nothing more: an identifier counts when
 * some code chunk declares it, and a file name when some chunk's path matches
 * it. Until then the question is ranked as it always was.
 *
 * Detection is by how the word is written. A spoken "verify claim" is two
 * ordinary words and is not treated as an identifier here.
 */
import type { IndexedChunk } from "../repo/types.ts";

export type NamedSymbol = {
  /** As written in the question. */
  name: string;
  /** Lower-case words of the identifier: "verifyClaim" is ["verify", "claim"]. */
  parts: string[];
  /** `parts` joined: equal for "verifyClaim", "verify_claim" and "verify-claim". */
  key: string;
  /** Matches a line that declares the identifier, in any naming convention. */
  declaration: RegExp;
};

const CAMEL = /[A-Za-z_$][A-Za-z0-9_$]*[a-z0-9][A-Z][A-Za-z0-9_$]*/g;
const SNAKE = /[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+/g;
const CALLED = /([A-Za-z_$][\w$]{2,})\(\)/g;
const QUOTED = /`([A-Za-z_$][\w$]{2,})`/g;

const MODIFIERS =
  "(?:(?:export|default|declare|public|private|protected|internal|static|final|abstract|async|override|open|suspend|readonly|pub(?:\\([^)\\n]*\\))?)[ \\t]+)*";
const KEYWORDS =
  "(?:function\\*?|class|interface|type|enum|namespace|module|def|fn|func(?:[ \\t]*\\([^)\\n]*\\))?|struct|trait|object|fun)";
/** A variable counts at the top level of a file. Indented, it is a local. */
const VARIABLES = "(?:const|let|var|val|static)";

function partsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Lower-case words of an identifier: "verifyClaim" and "verify_claim" are both ["verify", "claim"]. */
export function symbolParts(name: string): string[] {
  return partsOf(name);
}

/** The same key for an identifier and for a file stem that spells it. */
export function symbolKey(text: string): string {
  return partsOf(text).join("");
}

function declarationOf(parts: string[]): RegExp {
  // "verify_?claim" under the `i` flag: verifyClaim, VerifyClaim, verify_claim.
  const name = `${parts.join("_?")}(?![\\w$])`;
  const lead = `^[ \\t]*${MODIFIERS}`;
  return new RegExp(
    [
      // function verifyClaim, class VerifyClaim, def verify_claim, at any depth
      `${lead}${KEYWORDS}[ \\t]+${name}`,
      // export const verifyClaim, const MAX_PER_FILE, at the top level only
      `^${MODIFIERS}${VARIABLES}[ \\t]+(?:mut[ \\t]+)?${name}`,
      // verifyClaim(say, evidence) {    public boolean verifyClaim(String say) {
      `${lead}(?:[\\w.<>,\\[\\]?]+[ \\t]+)?${name}[ \\t]*(?:<[^>\\n]*>)?\\([^)\\n]*\\)[ \\t]*(?::[^{;\\n]+)?\\{`,
      // verifyClaim: (say) => ...    this.verifyClaim = function
      `^[ \\t]*(?:(?:this|exports|module\\.exports)\\.)?${name}[ \\t]*[:=][ \\t]*(?:async[ \\t]+)?(?:function\\b|\\([^)\\n]*\\)[ \\t]*(?::[^=\\n]+)?=>|[A-Za-z_$][\\w$]*[ \\t]*=>)`,
    ].join("|"),
    "im",
  );
}

/** Words in the question that are written like identifiers. Candidates only. */
export function symbolCandidates(query: string): NamedSymbol[] {
  const names = [
    ...(query.match(CAMEL) ?? []),
    ...(query.match(SNAKE) ?? []),
    ...[...query.matchAll(CALLED)].map((match) => match[1]!),
    ...[...query.matchAll(QUOTED)].map((match) => match[1]!),
  ];
  const out = new Map<string, NamedSymbol>();
  for (const name of names) {
    const parts = partsOf(name);
    const key = parts.join("");
    if (key.length < 3 || out.has(key)) continue;
    out.set(key, { name, parts, key, declaration: declarationOf(parts) });
  }
  return [...out.values()];
}

/** Source code, as opposed to prose that may quote a declaration in a fence. */
const PROSE_PATH = /\.(md|mdx|markdown|txt|rst|adoc|docx|pptx|ppt|xlsx|csv|pdf)$/i;

function isSource(chunk: IndexedChunk): boolean {
  return chunk.kind === "code" && !PROSE_PATH.test(chunk.path);
}

export type DeclaredSymbol = NamedSymbol & {
  /** The code chunks that declare it. Never empty. */
  chunks: Set<IndexedChunk>;
};

/**
 * A cheap test that rules chunks out before the declaration pattern is run on
 * their text. It may only say "no" for a chunk the pattern could not match:
 * the pattern still decides for every chunk it lets through.
 */
export type MayDeclare = (symbol: NamedSymbol) => (chunk: IndexedChunk) => boolean;

/**
 * The identifiers in the question that the material declares, each with the
 * chunks that declare it. One pass over the chunks per candidate, and no pass
 * at all for a question with no identifier-shaped word in it.
 */
export function declaredSymbols(query: string, chunks: IndexedChunk[], mayDeclare?: MayDeclare): DeclaredSymbol[] {
  const candidates = symbolCandidates(query);
  if (candidates.length === 0) return [];
  // The lexical channel, the structural channel and the debug log all ask the
  // same thing about the same question. The last answer per chunk list is kept.
  const last = LAST.get(chunks);
  if (last && last.query === query) return last.symbols;
  const symbols = scan(candidates, chunks, mayDeclare);
  LAST.set(chunks, { query, symbols });
  return symbols;
}

const LAST = new WeakMap<IndexedChunk[], { query: string; symbols: DeclaredSymbol[] }>();

function scan(candidates: NamedSymbol[], chunks: IndexedChunk[], mayDeclare?: MayDeclare): DeclaredSymbol[] {
  const out: DeclaredSymbol[] = [];
  for (const candidate of candidates) {
    const declaring = new Set<IndexedChunk>();
    const may = mayDeclare?.(candidate);
    for (const chunk of chunks) {
      if (!isSource(chunk)) continue;
      if (may && !may(chunk)) continue;
      if (candidate.declaration.test(chunk.text)) declaring.add(chunk);
    }
    if (declaring.size > 0) out.push({ ...candidate, chunks: declaring });
  }
  return out;
}
