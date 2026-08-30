import type { VisualLine } from "./layout.ts";
import { visualLineText } from "./layout.ts";

export type HeaderFooterKey = {
  band: "header" | "footer";
  text: string;
};

const BAND = 72;

export function lineBand(line: VisualLine, pageHeight: number): "header" | "footer" | "body" {
  if (line.y >= pageHeight - BAND) return "header";
  if (line.y <= BAND) return "footer";
  return "body";
}

/**
 * Same normalized visual-line text, same top/bottom band, on >= 50% of pages.
 * Body sentences at other y positions are never removed.
 */
export function detectRepeatedBands(
  pages: Array<{ height: number; lines: VisualLine[] }>,
): Set<string> {
  const skip = new Set<string>();
  if (pages.length < 2) return skip;
  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.lines) {
      const band = lineBand(line, page.height);
      if (band === "body") continue;
      const text = visualLineText(line);
      if (!text) continue;
      const key = `${band}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = pages.length * 0.5;
  for (const [key, count] of counts) {
    if (count >= threshold && count >= 2) skip.add(key);
  }
  return skip;
}

export function bandKey(line: VisualLine, pageHeight: number): string | null {
  const band = lineBand(line, pageHeight);
  if (band === "body") return null;
  const text = visualLineText(line);
  if (!text) return null;
  return `${band}:${text}`;
}
