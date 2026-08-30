import type { NormalizedDocument } from "../document/types.ts";
import type { ThreadContext } from "./thread.ts";

/**
 * Safe document identity for source-selector resolution.
 * Only signals extracted from the supplied file. No invented aliases.
 */
export type DocumentIdentity = {
  sourceId: string;
  path: string;
  stem: string;
  tokens: string[];
  titles: string[];
  firstPageText: string;
  readiness: NormalizedDocument["readiness"];
  hasSearchableText: boolean;
  types: DocumentTypeTag[];
};

export type DocumentTypeTag = "lecture" | "guide" | "policy" | "paper" | "scanned" | "encrypted" | "refused";

const TYPE_STEM: Array<[RegExp, DocumentTypeTag]> = [
  [/scanned/, "scanned"],
  [/encrypted/, "encrypted"],
  [/(^|-)(cs229|lecture|notes)(-|$)/, "lecture"],
  [/(cisa|ransomware|guide)/, "guide"],
  [/(omb|m-?22-?09|63b|policy)/, "policy"],
  [/(attention|bert|resnet|lora|bitcoin|tracemonkey|transformer)/, "paper"],
];

export function documentIdentity(document: NormalizedDocument): DocumentIdentity {
  const base = document.path.split("/").pop() ?? document.path;
  const stem = base.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  const tokens = new Set<string>(
    stem
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1),
  );
  tokens.add(stem);
  tokens.add(stem.replace(/-/g, ""));
  const titles = document.outline.map((item) => item.title.trim()).filter(Boolean);
  const first = document.pages.find((page) => page.pageNumber === 1);
  const firstPageText = (first?.text ?? "").slice(0, 1200);
  const types = new Set<DocumentTypeTag>();
  if (document.readiness === "scanned") types.add("scanned");
  if (document.readiness === "unreadable") types.add("encrypted");
  if (document.readiness === "refused") types.add("refused");
  for (const [pattern, tag] of TYPE_STEM) {
    if (pattern.test(stem)) types.add(tag);
  }
  const hasSearchableText = document.readiness === "ready" && document.pages.some((page) => page.index !== "skipped" && page.text.trim().length > 0);
  return {
    sourceId: document.sourceId,
    path: document.path,
    stem,
    tokens: [...tokens],
    titles,
    firstPageText,
    readiness: document.readiness,
    hasSearchableText,
    types: [...types],
  };
}

export function identitiesOf(documents: NormalizedDocument[]): DocumentIdentity[] {
  return documents.map(documentIdentity);
}

export function threadDocumentIds(thread: ThreadContext | null | undefined, identities: DocumentIdentity[]): string[] {
  if (!thread) return [];
  const fromField = thread.sourceIds?.filter(Boolean) ?? [];
  if (fromField.length > 0) return [...new Set(fromField)];
  const fromPath = identities.filter((item) => thread.files.includes(item.path)).map((item) => item.sourceId);
  return [...new Set(fromPath)];
}

export function identityMatchesToken(identity: DocumentIdentity, token: string): boolean {
  const needle = token.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!needle) return false;
  if (identity.tokens.some((entry) => entry.replace(/[^a-z0-9]+/g, "") === needle)) return true;
  if (identity.stem.includes(token.toLowerCase())) return true;
  if (identity.titles.some((title) => title.toLowerCase().includes(token.toLowerCase()))) return true;
  return false;
}

export function identityHasAuthor(identity: DocumentIdentity, author: string): boolean {
  const needle = author.toLowerCase().trim();
  if (needle.length < 3) return false;
  return identity.firstPageText.toLowerCase().includes(needle) || identity.titles.some((title) => title.toLowerCase().includes(needle));
}
