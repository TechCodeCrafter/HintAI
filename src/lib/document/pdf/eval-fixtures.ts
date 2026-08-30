import { buildPdfBytes, encryptedPdfBytes, type FixturePage } from "./build-fixture.ts";

/** Shared 4A.3/4A.4 PDF bytes. Do not retune layout — retrieval numbers are frozen. */
export function wrapFixtureText(text: string, x: number, startY: number): FixturePage["items"] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 62) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.map((str, index) => ({ str, x, y: startY - index * 16 }));
}

export const EVAL_PDF_FIXTURES: Record<string, Uint8Array> = {
  "lecture.pdf": buildPdfBytes({
    pages: [
      {
        items: wrapFixtureText(
          "Serializable isolation prevents lost outcomes when concurrent transactions write the same row. The lecture treats this as the strongest ANSI level.",
          72,
          700,
        ),
      },
    ],
  }),
  "lecture-multi.pdf": buildPdfBytes({
    pages: [
      { items: wrapFixtureText("Lecture one introduces transactions and schedules.", 72, 700) },
      { items: wrapFixtureText("Lecture two covers lock modes and deadlock detection.", 72, 700) },
      {
        items: wrapFixtureText(
          "Predicate locks protect phantoms by locking the logical query rather than a single row identity.",
          72,
          700,
        ),
      },
    ],
  }),
  "paper.pdf": buildPdfBytes({
    pages: [
      {
        items: [
          ...wrapFixtureText("Two-phase locking requires waits on conflicting writes before the lock point.", 72, 700),
          ...wrapFixtureText("Snapshot isolation allows write skew unless extra checks are added.", 340, 700),
        ],
      },
    ],
  }),
  "bullets.pdf": buildPdfBytes({
    pages: [
      {
        items: [
          { str: "The isolation levels are:", x: 72, y: 700 },
          { str: "read uncommitted", x: 90, y: 680 },
          { str: "read committed", x: 90, y: 662 },
          { str: "repeatable read", x: 90, y: 644 },
          { str: "serializable", x: 90, y: 626 },
        ],
      },
    ],
  }),
  "headers.pdf": buildPdfBytes({
    pages: [
      {
        items: [
          { str: "CS 186 · Fall", x: 72, y: 760 },
          { str: "1", x: 300, y: 40 },
          ...wrapFixtureText("Locking is the default concurrency mechanism in this course.", 72, 700),
        ],
      },
      {
        items: [
          { str: "CS 186 · Fall", x: 72, y: 760 },
          { str: "2", x: 300, y: 40 },
          ...wrapFixtureText("Write skew creates an integrity anomaly under snapshot isolation.", 72, 700),
        ],
      },
    ],
  }),
  "slides.pdf": buildPdfBytes({
    pages: [
      { items: [{ str: "Phantoms", x: 72, y: 400, size: 28 }] },
      { items: wrapFixtureText("A phantom read sees new rows that match a prior predicate.", 72, 400) },
    ],
  }),
  "grid.pdf": buildPdfBytes({
    pages: [
      {
        items: Array.from({ length: 16 }, (_, index) => ({
          str: `c${index}`,
          x: 72 + (index % 4) * 80,
          y: 700 - Math.floor(index / 4) * 24,
        })),
      },
    ],
  }),
  "scanned.pdf": buildPdfBytes({ pages: [{ items: [] }] }),
  "unreadable.pdf": encryptedPdfBytes(),
  "refused.pdf": buildPdfBytes({
    pages: Array.from({ length: 81 }, () => ({ items: [{ str: "page", x: 72, y: 700 }] })),
  }),
};
