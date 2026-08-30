import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../context/index-versions.ts";
import { documentEvidenceFromRange } from "../document/evidence.ts";
import type { NormalizedDocument } from "../document/types.ts";
import type { Card, DocumentHit } from "../repo/types.ts";
import type { DocumentEvidence, SourceLookup } from "./evidence.ts";
import { evidenceIsCurrent, verifyClaim } from "./evidence.ts";
import { type Shape, evidenceFitsShape, shapeGap, shapeOf } from "./intent.ts";
import { type RejectCode, closeDecision, noteAttempt, overrideDecision } from "./claim-trace.ts";
import { contentWords } from "./spoken.ts";
import { sayable } from "./say.ts";
import { documentClaimAdmissible, documentSubjectTerms } from "./document-subject.ts";
import { mentions } from "./subject.ts";
import {
  type QuestionContract,
  claimFitsContract,
  sourceHitEligible,
} from "./question-contract.ts";

export type DocumentCardTimings = {
  extractMs: number;
  mapMs: number;
  currentMs: number;
  supportMs: number;
  totalMs: number;
};

let lastTimings: DocumentCardTimings | null = null;

export function lastDocumentCardTimings(): DocumentCardTimings | null {
  return lastTimings;
}

const DOC_RATIONALE =
  /\b(because|since|so that|in order to|to avoid|to prevent|the reason|rationale|due to|owing to)\b/i;

const DOC_WHERE =
  /\b(located|lives in|stored in|found in|in the|on the|inside the|within the|under the)\b/i;

const OWNERSHIP =
  /\b(owned|owner|owners|ownership|maintained|maintainer|maintainers|authored|responsible for|on-call|oncall|codeowner|codeowners)\b/i;

/**
 * Conservative document shape. Does not treat page number as "where"
 * or a name in prose as "who".
 */
export function documentFitsShape(shape: Shape, claim: string): boolean {
  switch (shape) {
    case "absence":
      return false;
    case "who":
      return OWNERSHIP.test(claim);
    case "why":
      return DOC_RATIONALE.test(claim);
    case "where":
      return DOC_WHERE.test(claim);
    case "failure":
    case "how":
    case "what":
      return evidenceFitsShape(shape, claim, false, false);
    default:
      return false;
  }
}

export function documentCard(
  query: string,
  hit: DocumentHit,
  document: NormalizedDocument | undefined,
  documents: NormalizedDocument[],
  latencyMs: number,
  contract?: QuestionContract,
): Card {
  const started = nowMs();
  const timings: DocumentCardTimings = {
    extractMs: 0,
    mapMs: 0,
    currentMs: 0,
    supportMs: 0,
    totalMs: 0,
  };
  const silent = (reason: string, reject: RejectCode): Card => {
    timings.totalMs = nowMs() - started;
    lastTimings = timings;
    noteAttempt({
      query,
      path: hit.path,
      line: hit.page,
      origin: "span",
      candidate: "",
      generic: false,
      relevance: 0,
      score: hit.score,
      accepted: false,
      reject,
    });
    closeDecision(query, false);
    return {
      say: null,
      reason,
      citations: [],
      query,
      latencyMs,
      source: "local",
    };
  };

  const canonical = query;
  const shape = shapeOf(canonical);
  if (shape === "absence") {
    overrideDecision(query, "WRONG_SHAPE");
    return silent(shapeGap("absence"), "WRONG_SHAPE");
  }
  if (!document || document.sourceId !== hit.sourceId || document.contentHash !== hit.contentHash) {
    return silent("That material is no longer available.", "STALE_EVIDENCE");
  }
  if (document.parserVersion !== PDF_PARSER_VERSION || document.normalizerVersion !== DOCUMENT_NORMALIZER_VERSION) {
    return silent("That material changed since I read it.", "STALE_EVIDENCE");
  }
  const page = document.pages.find((entry) => entry.pageNumber === hit.page);
  if (!page) return silent("Nothing in this pack cites that.", "NO_EVIDENCE_SPAN");
  if (page.text.slice(hit.startOffset, hit.endOffset) !== hit.text) {
    return silent("That material changed since I read it.", "STALE_EVIDENCE");
  }

  if (contract && !sourceHitEligible(hit.sourceId, contract)) {
    return silent("Nothing loaded answers that.", "NO_SUBJECT_COVERAGE");
  }

  const extractStart = nowMs();
  const terms = contentWords(canonical);
  const subject = documentSubjectTerms(terms, documents);
  const claim = extractDocumentClaim(hit.text, terms, subject, documents, contract);
  timings.extractMs = nowMs() - extractStart;
  if (!claim) return silent("Nothing in it I would say out loud.", "NO_SPEAKABLE_SENTENCE");
  if (contract) {
    if (!claimFitsContract(claim.text, contract)) {
      return silent("Nothing loaded answers that.", "NO_SUBJECT_COVERAGE");
    }
  } else if (!documentClaimAdmissible(claim.text, subject, documents)) {
    return silent("Nothing loaded answers that.", "NO_SUBJECT_COVERAGE");
  }
  if (!documentFitsShape(shape, claim.text)) {
    overrideDecision(query, "WRONG_SHAPE");
    return silent(shapeGap(shape), "WRONG_SHAPE");
  }

  const spoken = sayable(claim.text);
  if (!spoken) return silent("Nothing in it I would say out loud.", "NO_SPEAKABLE_SENTENCE");

  const normStart = hit.startOffset + claim.start;
  const normEnd = hit.startOffset + claim.end;
  const mapStart = nowMs();
  const evidence = documentEvidenceFromRange({
    document,
    page: hit.page,
    normStart,
    normEnd,
    spokenText: spoken,
  });
  timings.mapMs = nowMs() - mapStart;
  if (!evidence) return silent("Nothing in this pack cites that.", "NO_EVIDENCE_SPAN");

  const currentStart = nowMs();
  const current = evidenceIsCurrent(evidence, lookupOf(document));
  timings.currentMs = nowMs() - currentStart;
  if (!current) return silent("That material changed since I read it.", "STALE_EVIDENCE");

  const supportStart = nowMs();
  const support = verifyClaim(spoken, [evidence]);
  timings.supportMs = nowMs() - supportStart;
  if (!support.ok) return silent("I could not back every word of that from the file.", "UNSUPPORTED_CLAIM");

  timings.totalMs = nowMs() - started;
  lastTimings = timings;
  closeDecision(query, true);
  return {
    say: spoken,
    citations: [citationFrom(evidence)],
    evidence: [evidence],
    query,
    latencyMs,
    source: "local",
  };
}

export function extractDocumentClaim(
  chunkText: string,
  terms: string[],
  subject: string[],
  documents: NormalizedDocument[],
  contract?: QuestionContract,
): { text: string; start: number; end: number } | null {
  const admissible = (text: string) =>
    contract ? claimFitsContract(text, contract) : documentClaimAdmissible(text, subject, documents);
  const list = listingClaim(chunkText, terms);
  if (list && !isSmashed(list.text) && admissible(list.text)) return list;
  const parts = sentenceRanges(chunkText).flatMap(splitSmashed);
  const scored = parts
    .map((part) => ({
      ...part,
      score: terms.filter((term) => mentions(part.text.toLowerCase(), term)).length,
    }))
    .filter((part) => looksDocumentSpoken(part.text));
  scored.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  for (const part of scored) {
    if (part.score <= 0) continue;
    if (isSmashed(part.text)) continue;
    if (admissible(part.text)) return part;
  }
  if (chunkText.length <= 260 && looksDocumentSpoken(chunkText) && !isSmashed(chunkText) && admissible(chunkText)) {
    return { text: chunkText, start: 0, end: chunkText.length };
  }
  return null;
}

function listingClaim(chunkText: string, terms: string[]): { text: string; start: number; end: number } | null {
  const listing = terms.some((term) => /^(which|list|levels|kinds|types)$/.test(term));
  if (!listing || !chunkText.includes("\n")) return null;
  const lines = splitLines(chunkText);
  if (lines.length < 2) return null;
  const lead = lines.find((line) => /:\s*$/.test(line.text) || /\bare\b/i.test(line.text));
  if (!lead) return null;
  const after = lines.filter((line) => line.start >= lead.start);
  if (after.length < 2) return null;
  const end = after[after.length - 1].end;
  return { text: chunkText.slice(lead.start, end), start: lead.start, end };
}

function sentenceRanges(text: string): Array<{ text: string; start: number; end: number }> {
  const parts: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\n" || ((ch === "." || ch === "!" || ch === "?") && (i + 1 === text.length || /\s/.test(text[i + 1] ?? "")))) {
      let end = i + 1;
      while (end < text.length && /\s/.test(text[end] ?? "")) end += 1;
      const slice = text.slice(start, Math.min(end, text.length)).trimEnd();
      if (slice.trim()) parts.push({ text: slice, start, end: start + slice.length });
      start = end;
    }
  }
  if (start < text.length) {
    const slice = text.slice(start);
    if (slice.trim()) parts.push({ text: slice, start, end: text.length });
  }
  return parts;
}

function splitLines(text: string): Array<{ text: string; start: number; end: number }> {
  const parts: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i < text.length && text[i] !== "\n") continue;
    if (i > start) parts.push({ text: text.slice(start, i), start, end: i });
    start = i + 1;
  }
  return parts;
}

/** Mid-word lowercase→Uppercase is a two-column smash, not a sentence. */
function isSmashed(text: string): boolean {
  return /[a-z][A-Z]/.test(text);
}

function splitSmashed(part: { text: string; start: number; end: number }): Array<{ text: string; start: number; end: number }> {
  const smash = part.text.search(/[a-z][A-Z]/);
  if (smash < 0) return [part];
  const leftEnd = smash + 1;
  const rightStart = smash + 1;
  const left = part.text.slice(0, leftEnd).trimEnd();
  const right = part.text.slice(rightStart);
  const out: Array<{ text: string; start: number; end: number }> = [];
  if (left.trim()) out.push({ text: left, start: part.start, end: part.start + left.length });
  if (right.trim()) out.push({ text: right, start: part.start + rightStart, end: part.end });
  return out.flatMap((item) => (isSmashed(item.text) ? splitSmashed(item) : [item]));
}

function looksDocumentSpoken(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  if (/[=;{}<>]|^\s*(def |class |const |function |import )/.test(text)) return false;
  return /[A-Za-z]/.test(text);
}

function citationFrom(evidence: DocumentEvidence) {
  return {
    kind: "document" as const,
    sourceId: evidence.sourceId,
    path: evidence.path,
    page: evidence.page,
    heading: evidence.heading,
    evidenceId: evidence.id,
    label: evidence.heading ?? "",
  };
}

function lookupOf(document: NormalizedDocument): SourceLookup {
  return {
    file: () => undefined,
    commit: () => undefined,
    document: (sourceId) => (sourceId === document.sourceId ? document : undefined),
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
