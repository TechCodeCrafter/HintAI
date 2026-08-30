import type { PdfTextItem } from "../types.ts";

export function isMeaningfulText(str: string): boolean {
  const trimmed = str.trim();
  if (!trimmed) return false;
  if (/[A-Za-z]{2,}/.test(trimmed)) return true;
  return trimmed.length >= 3;
}

export function usefulItemCount(items: PdfTextItem[]): number {
  return items.filter((item) => isMeaningfulText(item.str)).length;
}

export function itemX(item: PdfTextItem): number {
  return item.transform[4];
}

export function itemY(item: PdfTextItem): number {
  return item.transform[5];
}

export function itemRight(item: PdfTextItem): number {
  const width = item.width > 0 ? item.width : Math.max(item.str.length, 1) * Math.max(item.height, 8) * 0.5;
  return itemX(item) + width;
}

export function isPdfTextItem(entry: unknown): entry is {
  str: string;
  transform: number[];
  width: number;
  height: number;
} {
  return Boolean(entry && typeof entry === "object" && "str" in entry && typeof (entry as { str: unknown }).str === "string");
}

export function extractPdfItems(raw: unknown[]): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  raw.forEach((entry, itemIndex) => {
    if (!isPdfTextItem(entry)) return;
    const transform = entry.transform;
    if (!Array.isArray(transform) || transform.length < 6) return;
    items.push({
      itemIndex,
      str: entry.str,
      transform: [transform[0], transform[1], transform[2], transform[3], transform[4], transform[5]],
      width: Number(entry.width) || 0,
      height: Number(entry.height) || 0,
    });
  });
  return items;
}
