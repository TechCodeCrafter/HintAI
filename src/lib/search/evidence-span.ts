/**
 * Exact coordinates of a file-backed claim.
 *
 * A citation may only quote these numbers. They are counted in the source
 * document — never from a retrieved chunk window, never from normalized text.
 * PDF pages stay on DocumentEvidence; this type is the file/markdown/text span.
 */
export type EvidenceSourceType =
  | "code"
  | "markdown"
  | "text"
  | "pdf"
  | "document"
  | "docx"
  | "pptx"
  | "xlsx";

export type EvidenceSpan = {
  id: string;
  sourceId: string;
  sourceType: EvidenceSourceType;
  path: string;
  page?: number;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  /** `source.content.slice(startOffset, endOffset)` — verbatim, not spoken. */
  text: string;
  normalizedText: string;
  contentHash: string;
  heading?: string;
  symbol?: string;
};

export type EvidenceSpanFailure = "STALE" | "OUT_OF_BOUNDS" | "TEXT_MISMATCH" | "LINE_MISMATCH";

/** Newlines before `offset`. Line number is this + 1. */
export function countLines(text: string, offset: number): number {
  const upto = Math.max(0, Math.min(offset, text.length));
  let count = 0;
  for (let i = 0; i < upto; i += 1) {
    if (text[i] === "\n") count += 1;
  }
  return count;
}

export function inferSourceType(path: string): EvidenceSourceType {
  if (/\.(md|mdx|rst)$/i.test(path)) return "markdown";
  if (/\.(txt|log)$/i.test(path)) return "text";
  if (/\.pdf$/i.test(path)) return "pdf";
  return "code";
}

/** Deterministic span id. Not cryptographic. */
export function hashEvidence(path: string, start: number, end: number, hash: string): string {
  const raw = `${path}:${start}-${end}:${hash}`;
  try {
    return btoa(raw).slice(0, 32);
  } catch {
    return raw.slice(0, 32);
  }
}

export function verifyEvidenceSpan(
  span: EvidenceSpan,
  source: { content: string; contentHash: string },
): { ok: true } | { ok: false; reason: EvidenceSpanFailure } {
  if (span.contentHash !== source.contentHash) return { ok: false, reason: "STALE" };
  if (span.startOffset < 0 || span.endOffset > source.content.length || span.startOffset >= span.endOffset) {
    return { ok: false, reason: "OUT_OF_BOUNDS" };
  }
  const actual = source.content.slice(span.startOffset, span.endOffset);
  if (actual !== span.text) return { ok: false, reason: "TEXT_MISMATCH" };
  const computedStart = countLines(source.content, span.startOffset) + 1;
  if (computedStart !== span.startLine) return { ok: false, reason: "LINE_MISMATCH" };
  return { ok: true };
}

/** Build a span from a measured half-open range. Lines are counted, never estimated. */
export function createEvidenceSpan(args: {
  path: string;
  content: string;
  start: number;
  end: number;
  contentHash: string;
  normalizedText: string;
  sourceId?: string;
  sourceType?: EvidenceSourceType;
  symbol?: string;
  heading?: string;
}): EvidenceSpan | null {
  const { path, content, normalizedText, contentHash } = args;
  if (args.start < 0 || args.end > content.length || args.start >= args.end) return null;
  const text = content.slice(args.start, args.end);
  const startLine = countLines(content, args.start) + 1;
  const last = Math.max(args.start, args.end - 1);
  const endLine = countLines(content, last) + 1;
  const span: EvidenceSpan = {
    id: hashEvidence(path, args.start, args.end, contentHash),
    sourceId: args.sourceId ?? path,
    sourceType: args.sourceType ?? inferSourceType(path),
    path,
    startLine,
    endLine,
    startOffset: args.start,
    endOffset: args.end,
    text,
    normalizedText,
    contentHash,
    heading: args.heading,
    symbol: args.symbol,
  };
  return verifyEvidenceSpan(span, { content, contentHash }).ok ? span : null;
}
