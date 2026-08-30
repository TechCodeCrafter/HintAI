import type { PdfOutlineItem } from "../types.ts";

type OutlineNode = {
  title?: string;
  dest?: string | unknown[] | null;
  items?: OutlineNode[];
};

type PdfjsDocument = {
  getOutline(): Promise<OutlineNode[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
};

export async function resolveOutline(doc: PdfjsDocument): Promise<PdfOutlineItem[]> {
  try {
    const tree = await doc.getOutline();
    if (!tree || tree.length === 0) return [];
    const out: PdfOutlineItem[] = [];
    await walk(doc, tree, out);
    return out;
  } catch {
    return [];
  }
}

async function walk(doc: PdfjsDocument, nodes: OutlineNode[], out: PdfOutlineItem[]) {
  for (const node of nodes) {
    const title = typeof node.title === "string" ? node.title.trim() : "";
    if (title) {
      const page = await resolveDestPage(doc, node.dest);
      out.push(page === undefined ? { title } : { title, page });
    }
    if (node.items?.length) await walk(doc, node.items, out);
  }
}

async function resolveDestPage(doc: PdfjsDocument, dest: OutlineNode["dest"]): Promise<number | undefined> {
  if (!dest) return undefined;
  try {
    const target = Array.isArray(dest) ? dest[0] : dest;
    if (target === undefined || target === null) return undefined;
    const index = await doc.getPageIndex(target);
    if (!Number.isFinite(index) || index < 0) return undefined;
    return index + 1;
  } catch {
    return undefined;
  }
}
