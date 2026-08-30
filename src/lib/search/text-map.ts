/**
 * Derived text that remembers where every character came from.
 *
 * Extraction rewrites what a file wrote before it can be spoken: a docstring is
 * unindented, hard-wrapped lines are rejoined, comment markers are stripped. Do
 * that with plain strings and the result is a sentence with no address — which
 * is why a Card used to cite the first line of the retrieved chunk rather than
 * the line the sentence actually occupies.
 *
 * A `Mapped` keeps one offset per character, so any substring of the derived
 * text can be turned back into an exact range in the original document. The
 * cost is an array the size of the doc block, which is small by construction.
 */

export type Mapped = {
  text: string;
  /** `at[i]` is the offset in the source document of `text[i]`. */
  at: number[];
};

export const EMPTY: Mapped = { text: "", at: [] };

/** A region of the source, carrying its own coordinates. */
export function mappedSlice(content: string, start = 0, end = content.length): Mapped {
  const from = Math.max(0, start);
  const to = Math.min(content.length, end);
  if (to <= from) return EMPTY;
  const at = new Array<number>(to - from);
  for (let i = 0; i < to - from; i += 1) at[i] = from + i;
  return { text: content.slice(from, to), at };
}

/** A sub-range of an already-derived string, in that string's coordinates. */
export function sliceMapped(m: Mapped, from: number, to = m.text.length): Mapped {
  const a = Math.max(0, from);
  const b = Math.min(m.text.length, to);
  if (b <= a) return EMPTY;
  return { text: m.text.slice(a, b), at: m.at.slice(a, b) };
}

/**
 * Joins parts with a literal separator. Separator characters are given the
 * offset just past the preceding part, so the map stays monotonic and a range
 * spanning a join covers the original text between the two parts — the newline
 * and indentation a wrapped sentence was written with.
 */
export function joinMapped(parts: Mapped[], sep: string): Mapped {
  const kept = parts.filter((p) => p.text.length > 0);
  if (kept.length === 0) return EMPTY;
  let text = "";
  const at: number[] = [];
  kept.forEach((part, i) => {
    if (i > 0) {
      const previous = kept[i - 1];
      const gap = previous.at[previous.at.length - 1] + 1;
      for (let k = 0; k < sep.length; k += 1) at.push(gap);
      text += sep;
    }
    text += part.text;
    for (const offset of part.at) at.push(offset);
  });
  return { text, at };
}

/** Drops surrounding whitespace, keeping the coordinates of what remains. */
export function trimMapped(m: Mapped): Mapped {
  let start = 0;
  let end = m.text.length;
  while (start < end && /\s/.test(m.text[start])) start += 1;
  while (end > start && /\s/.test(m.text[end - 1])) end -= 1;
  return sliceMapped(m, start, end);
}

/**
 * The half-open range in the source document that this derived text was read
 * from. `null` when nothing is left to point at.
 */
export function rangeOf(m: Mapped): { start: number; end: number } | null {
  if (m.at.length === 0) return null;
  return { start: m.at[0], end: m.at[m.at.length - 1] + 1 };
}

/** Splits on a pattern, keeping each piece's coordinates. */
export function splitMapped(m: Mapped, pattern: RegExp): Mapped[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const out: Mapped[] = [];
  let cursor = 0;
  let match = re.exec(m.text);
  while (match) {
    // A zero-width match would not advance, so it is stepped past by hand.
    if (match[0].length === 0) {
      re.lastIndex += 1;
      match = re.exec(m.text);
      continue;
    }
    out.push(sliceMapped(m, cursor, match.index));
    cursor = match.index + match[0].length;
    match = re.exec(m.text);
  }
  out.push(sliceMapped(m, cursor));
  return out.filter((piece) => piece.text.length > 0);
}

/** Removes a leading pattern, keeping the coordinates of the remainder. */
export function stripLeading(m: Mapped, pattern: RegExp): Mapped {
  const anchored = new RegExp(`^(?:${pattern.source})`, pattern.flags.replace(/[gy]/g, ""));
  const match = anchored.exec(m.text);
  return match && match[0].length > 0 ? sliceMapped(m, match[0].length) : m;
}

/** The lines of a mapped region, each carrying its own coordinates. */
export function linesOf(m: Mapped): Mapped[] {
  const out: Mapped[] = [];
  let start = 0;
  for (let i = 0; i <= m.text.length; i += 1) {
    if (i === m.text.length || m.text[i] === "\n") {
      out.push(sliceMapped(m, start, i));
      start = i + 1;
    }
  }
  return out;
}
