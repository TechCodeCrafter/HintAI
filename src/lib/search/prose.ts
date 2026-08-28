/**
 * The single extraction boundary for spoken claims.
 *
 * Everything here is extractive: it finds prose a file already wrote about
 * itself and normalizes it for speech. It never infers sequence, causality or
 * behavior that is not written down. If the evidence does not state what
 * something does, the answer is silence, not a composed guess.
 */

/** A line that explains what the thing does, rather than merely naming it. */
const DESCRIBES =
  /\b(this (?:api|service|app|application|module|package|library|system|server|worker|script|pipeline|repo|project|tool|endpoint|route|handler|function)|provides|handles|manages|exposes|implements|serves|extracts|generates|processes|converts|orchestrates|coordinates|allows|enables|returns|accepts|validates|uploads|downloads|responsible for|used (?:to|for)|is an?|acts as)\b/i;

/** Titles, banners and separators. "FastAPI Main Application" is not a purpose. */
export function isHeading(line: string): boolean {
  if (/^#{1,6}\s/.test(line)) return true;
  if (/\.{3}$/.test(line)) return true;
  if (/^[-*=_]{3,}$/.test(line)) return true;
  const words = line.split(/\s+/).filter(Boolean).length;
  if (!/[.!?]$/.test(line) && words <= 6) return true;
  if (/^[A-Z0-9 _/-]+$/.test(line) && words <= 8) return true;
  return false;
}

/** A clipped code fragment closes brackets it never opened. */
function balanced(line: string): boolean {
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]) {
    const opens = line.split(open).length - 1;
    const closes = line.split(close).length - 1;
    if (closes > opens) return false;
  }
  return (line.split('"').length - 1) % 2 === 0;
}

function isDescriptive(line: string): boolean {
  if (line.length < 16) return false;
  if (/^[-*•]\s/.test(line)) return false;
  if (/^(https?:|\/\/|import |from |def |class |@|\$)/.test(line)) return false;
  if (/[=;{}]|\(\)|=>/.test(line)) return false;
  // A question is not a claim, and a sentence starts with a capital.
  if (/\?$/.test(line)) return false;
  if (!/^[A-Z]/.test(line)) return false;
  if (!balanced(line)) return false;
  if (isHeading(line)) return false;
  if (DESCRIBES.test(line)) return true;
  // Without a describing verb, only a full sentence carries enough to say.
  return /[.!?]$/.test(line) && line.split(/\s+/).filter(Boolean).length >= 8;
}

const BULLET = /^[-*•]\s+/;

/**
 * A docstring label like "Single Responsibility:" or "Note:" annotates the
 * sentence for a reader; it is not part of the claim.
 */
const LABEL = /^[A-Z][A-Za-z]*(?: [A-Za-z]+){0,3}:\s+(?=[A-Z])/;

/**
 * Markdown delimiters are written, not spoken — but `_` and backtick are also
 * identifier characters. Removing them by character class rewrites `_bg_index`
 * as "bgindex", a token that does not exist in the file the Card cites, which
 * breaks the one rule the Card has: the spoken claim is supported exactly by
 * the evidence. So each construct is matched as a delimiter pair, and anything
 * ambiguous is left as written. Preserving a stray underscore only reads a
 * little oddly; inventing an identifier makes the citation a lie.
 */
export function plain(text: string): string {
  const code: string[] = [];
  const spoken = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Inline code is set aside so the emphasis passes cannot reach inside it.
    .replace(/`+([^`]+)`+/g, (_all, inner: string) => `\u0000${code.push(inner) - 1}\u0000`)
    // Asterisks never occur in identifiers, so a closed run is always emphasis.
    .replace(/(\*{1,3})(?=\S)([\s\S]*?\S)\1/g, "$2")
    // Underscore emphasis spans words and, as in Markdown itself, never binds
    // inside a word — otherwise "foo_bar from some_id" reads as emphasis and
    // both identifiers are destroyed. A lone token fenced by underscores is an
    // identifier — `__init__`, `_bg_index` — so formatting also requires
    // internal whitespace and no further underscores.
    .replace(/(?<![A-Za-z0-9_])(_{1,2})(?=\S)([^_]*\s[^_]*?\S)\1(?![A-Za-z0-9_])/g, "$2")
    .replace(LABEL, "")
    .replace(/\s+/g, " ")
    .trim();
  return spoken.replace(/\u0000(\d+)\u0000/g, (_all, i: string) => code[Number(i)]);
}

/** One sentence per entry, so a dense paragraph never lands whole on the Card. */
function sentencesIn(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Rejoins hard-wrapped prose. Docstrings wrap sentences across lines, so
 * reading line-by-line would cut a claim mid-clause — "…using openpyxl and".
 * Headings, bullets and list lead-ins stay separate units.
 */
function paragraphs(block: string): string[] {
  const out: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) out.push(buffer.join(" "));
    buffer = [];
  };
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (BULLET.test(line) || line.endsWith(":") || isHeading(line)) {
      flush();
      out.push(line);
      continue;
    }
    // Only a lowercase start continues a wrapped sentence. A new capital means
    // a new comment line, and joining them would read as a run-on.
    if (buffer.length && !/^[a-z(]/.test(line)) flush();
    buffer.push(line);
  }
  flush();
  return out;
}

type Source = { path: string; content: string };

/** The prose a file carries about itself: docstring, block comment, or markdown. */
function docBlock(source: Source): string {
  if (/\.(md|mdx|rst|txt)$/i.test(source.path)) return source.content.slice(0, 4000);
  const py = source.content.match(/(?:"""|''')([\s\S]*?)(?:"""|''')/)?.[1];
  if (py) return py;
  const js = source.content.match(/\/\*\*?([\s\S]*?)\*\//)?.[1];
  if (js) return js.replace(/^\s*\*+/gm, "");
  return source.content
    .split("\n")
    .slice(0, 24)
    .filter((l) => /^\s*(#|\/\/)/.test(l))
    .map((l) => l.replace(/^\s*(#|\/\/)+\s?/, ""))
    .join("\n");
}

export type Prose = {
  /** The first written sentence that states behavior. */
  description: string;
  /** Bulleted capabilities beneath it, in the file's own words. */
  capabilities: string[];
  /** The line introducing those bullets, e.g. "This API provides endpoints for". */
  listLead: string | null;
};

/**
 * What a file says about itself. `null` when it says nothing a person could
 * read aloud — which is a valid, and preferable, outcome.
 */
export function proseOf(source: Source): Prose | null {
  const block = docBlock(source);
  if (!block.trim()) return null;
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

  const description = paragraphs(block)
    .filter((line) => !isHeading(line) && !BULLET.test(line) && !line.endsWith(":"))
    .flatMap(sentencesIn)
    .find(isDescriptive);

  const capabilities = lines
    .filter((l) => BULLET.test(l))
    .map((l) => plain(l.replace(BULLET, "")).replace(/[.,;]$/, "").trim())
    // A capability is a short phrase. Separators mean it is a nested list.
    .filter((l) => l.length > 2 && l.length < 60 && !/[·—|:]/.test(l))
    .map((l) => (/^[A-Z][a-z]/.test(l) ? `${l[0].toLowerCase()}${l.slice(1)}` : l))
    .slice(0, 6);

  // The line directly above the first bullet, when it introduces the list.
  const firstBullet = lines.findIndex((l) => BULLET.test(l));
  let listLead: string | null = null;
  if (firstBullet > 0) {
    const above = lines[firstBullet - 1];
    if (above.endsWith(":") && !isHeading(above)) {
      listLead = plain(above.replace(/:$/, ""));
    }
  }

  // Never truncate: a sentence too long to say is dropped, not clipped.
  const spoken = description ? plain(description) : "";
  const usable = spoken.length <= 240 ? spoken : "";
  if (!usable && capabilities.length < 2) return null;
  return { description: usable, capabilities, listLead };
}

const COUNT_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

export function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

/**
 * `more` means the list is truncated, so it must not close with "and" — the
 * remainder clause finishes the sentence instead.
 */
export function listWords(parts: string[], more = false): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (more) return parts.join(", ");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/** Speaks a capability list at the fidelity the file supports, and no further. */
export function capabilityList(capabilities: string[], max = 4): string {
  const shown = capabilities.slice(0, max);
  const rest = capabilities.length - shown.length;
  return `${listWords(shown, rest > 0)}${rest > 0 ? `, plus ${countWord(rest)} more` : ""}`;
}
