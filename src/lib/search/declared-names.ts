/**
 * The names a piece of source code declares: functions, classes, types,
 * methods, and top-level constants. Regex only, no parser, so it runs on any
 * chunk of any language the loader accepts and needs nothing downloaded.
 *
 * Ranking uses it to tell the chunk that defines "backoff" (`function
 * retryBackoff`, `const BACKOFF_MS`) from the chunks that only call or mention
 * it. It is a ranking signal and nothing else: no name found here is ever
 * spoken, cited, or used to decide whether an answer is supported.
 *
 * It errs on the side of missing a declaration. A local variable is not a
 * declaration, a call is not a declaration, and `if (x) {` is not a method.
 */
import { symbolParts } from "./query-symbols.ts";

const MODIFIERS =
  "(?:(?:export|default|declare|public|private|protected|internal|static|final|abstract|async|override|open|suspend|readonly|pub(?:\\([^)\\n]*\\))?)[ \\t]+)*";
const KEYWORDS =
  "(?:function\\*?|class|interface|type|enum|namespace|module|def|fn|func(?:[ \\t]*\\([^)\\n]*\\))?|struct|trait|object|fun)";
const VARIABLES = "(?:const|let|var|val|static)";
const NAME = "([A-Za-z_$][\\w$]*)";

const FORMS = [
  // function verifyClaim, class VerifyClaim, def verify_claim, func (s *Store) Save
  new RegExp(`^[ \\t]*${MODIFIERS}${KEYWORDS}[ \\t]+${NAME}`, "gm"),
  // export const MAX_PER_FILE, at the top level only. Indented, it is a local.
  new RegExp(`^${MODIFIERS}${VARIABLES}[ \\t]+(?:mut[ \\t]+)?${NAME}`, "gm"),
  // verifyClaim(say, evidence) {    public boolean verifyClaim(String say) {
  new RegExp(
    `^[ \\t]*${MODIFIERS}(?:[\\w.<>,\\[\\]?]+[ \\t]+)?${NAME}[ \\t]*(?:<[^>\\n]*>)?\\([^)\\n]*\\)[ \\t]*(?::[^{;\\n]+)?\\{`,
    "gm",
  ),
  // verifyClaim: (say) => ...    this.verifyClaim = function
  new RegExp(
    `^[ \\t]*(?:(?:this|exports|module\\.exports)\\.)?${NAME}[ \\t]*[:=][ \\t]*(?:async[ \\t]+)?(?:function\\b|\\([^)\\n]*\\)[ \\t]*(?::[^=\\n]+)?=>|[A-Za-z_$][\\w$]*[ \\t]*=>)`,
    "gm",
  ),
];

/** Words the method form would otherwise read as a name: `if (x) {`, `} catch (e) {`. */
const NOT_A_NAME = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "catch", "try", "finally", "return", "throw", "new",
  "await", "yield", "with", "function", "class", "typeof", "delete", "void", "in", "of", "and", "or", "not",
  "elif", "except", "match", "when", "unless", "until", "loop", "select", "defer", "go", "using", "lock",
  "foreach", "synchronized", "constructor", "super", "this", "self", "get", "set", "static", "async",
]);

const MAX_NAMES = 40;

/** Declared names in `text`, in order of appearance, each once. */
export function declaredNames(text: string): string[] {
  const found = new Map<string, number>();
  for (const form of FORMS) {
    form.lastIndex = 0;
    for (let match = form.exec(text); match; match = form.exec(text)) {
      const name = match[1];
      if (!name || name.length < 3 || NOT_A_NAME.has(name.toLowerCase())) continue;
      if (!found.has(name)) found.set(name, match.index);
    }
  }
  return [...found.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_NAMES)
    .map(([name]) => name);
}

/** Lower-case words of the declared names: "retryBackoff" gives "retry", "backoff". */
export function declaredWords(text: string, extra: string[] = []): string[] {
  const out: string[] = [];
  for (const name of [...declaredNames(text), ...extra]) {
    for (const part of symbolParts(name)) if (part.length > 1) out.push(part);
  }
  return out;
}
