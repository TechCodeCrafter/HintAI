import type { SpaceMaterialView } from "../context/material-view.ts";
import { enrichFileCitation, fileInMaterial } from "../context/material-view.ts";
import type { Card, Citation, FileHit, RepoPack } from "../repo/types.ts";
import { provenanceLabel } from "./cite.ts";
import { evidenceIsCurrent, textEvidence, verifyClaim, type Evidence, type TextEvidence } from "./evidence.ts";
import { contentWords } from "./spoken.ts";
import { admissible, explain, mentions, provenanceOf, subjectTerms } from "./subject.ts";
import { closeDecision, noteAttempt } from "./claim-trace.ts";
import type { LocalCardContext } from "./local-card.ts";
import { sayable } from "./say.ts";

type SpanClaim = { say: string; span: TextEvidence; generic: boolean; head: boolean };

function overlap(haystack: string, terms: string[]): number {
  const body = haystack.toLowerCase();
  return terms.filter((term) => mentions(body, term)).length;
}

function resolveFile(view: SpaceMaterialView, pack: RepoPack, path: string, sourceId?: string) {
  return fileInMaterial(view, path, sourceId) ?? pack.files.find((row) => row.path === path);
}

function claimFromHit(
  hit: FileHit,
  pack: RepoPack,
  view: SpaceMaterialView,
  query: string,
  sourceId: string,
): SpanClaim | null {
  const resolved = resolveFile(view, pack, hit.path, sourceId);
  if (!resolved) return null;
  const content = resolved.content;
  const sentence = hit.text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((row) => row.replace(/\s+/g, " ").trim())
    .find((row) => row.length >= 12);
  if (!sentence) return null;
  const start = content.indexOf(sentence);
  if (start < 0) return null;
  const span = textEvidence({
    path: hit.path,
    content,
    start,
    end: start + sentence.length,
    normalizedText: sentence,
    sourceId: hit.sourceId ?? sourceId,
  });
  if (!span) {
    noteAttempt({
      query,
      path: hit.path,
      line: hit.startLine,
      origin: "span",
      candidate: sentence,
      generic: false,
      relevance: 0,
      score: 0,
      accepted: false,
      reject: "NO_EVIDENCE_SPAN",
    });
    return null;
  }
  return { say: sentence, span, generic: false, head: false };
}

function bestClaimForSource(
  hit: FileHit,
  pack: RepoPack,
  view: SpaceMaterialView,
  query: string,
  canonical: string,
  sourceId: string,
): SpanClaim | null {
  const terms = contentWords(canonical);
  const subject = subjectTerms(terms, pack);
  const claim = claimFromHit(hit, pack, view, query, sourceId);
  if (!claim) return null;
  const path = claim.span.path ?? hit.path;
  const relevance = overlap(path, terms) * 3 + overlap(claim.say, terms);
  const score = relevance - (claim.generic ? 2 : 0);
  const provenance = provenanceOf(terms, subject, claim.say, path);
  if (!admissible(provenance) || score <= 0) {
    noteAttempt({
      query,
      path,
      line: claim.span.startLine ?? 1,
      origin: "span",
      candidate: claim.say,
      generic: claim.generic,
      relevance,
      score,
      accepted: false,
      reject: relevance === 0 ? "LOW_OVERLAP" : "NO_SUBJECT_COVERAGE",
      provenance: explain(provenance),
    });
    return null;
  }
  noteAttempt({
    query,
    path,
    line: claim.span.startLine ?? 1,
    origin: "span",
    candidate: claim.say,
    generic: claim.generic,
    relevance,
    score,
    accepted: true,
    reject: null,
  });
  return claim;
}

function citationsFromEvidence(evidence: Evidence[], hits: FileHit[], view: SpaceMaterialView): Citation[] {
  return evidence.map((item) => {
    if (item.kind !== "text") return { kind: "file" as const, path: "", line: 1, label: "" };
    const hit =
      hits.find((row) => row.path === item.path && row.sourceId === item.sourceId) ??
      hits.find((row) => row.path === item.path);
    return enrichFileCitation(
      {
        kind: "file" as const,
        path: item.path,
        line: item.startLine,
        endLine: item.endLine > item.startLine ? item.endLine : undefined,
        evidenceId: item.id,
        sha: hit?.sha,
        pr: hit?.pr,
        label: hit ? provenanceLabel(hit) : "",
        sourceId: item.sourceId,
      },
      view,
      item.sourceId,
    );
  });
}

/**
 * When ranked hits span multiple authorized sources and no single claim covers the
 * question, combine admissible per-source claims into one verified answer.
 */
export function tryMultiSourceCard(
  query: string,
  canonical: string,
  hits: FileHit[],
  pack: RepoPack,
  view: SpaceMaterialView,
  latencyMs: number,
  context?: LocalCardContext,
): Card | null {
  const bySource = new Map<string, FileHit>();
  for (const hit of hits) {
    const sid = hit.sourceId ?? fileInMaterial(view, hit.path)?.sourceId;
    if (!sid || bySource.has(sid)) continue;
    bySource.set(sid, { ...hit, sourceId: sid });
  }
  if (bySource.size < 2) return null;

  const claims: Array<{ sourceId: string; claim: SpanClaim; hit: FileHit }> = [];
  for (const [sourceId, hit] of bySource) {
    const claim = bestClaimForSource(hit, pack, view, query, canonical, sourceId);
    if (claim) claims.push({ sourceId, claim, hit });
  }
  if (claims.length < 2) return null;

  const spoken = sayable(claims.map((row) => row.claim.say).join(" "));
  if (!spoken) return null;
  const evidence = claims.map((row) => row.claim.span);
  const sources = {
    file: (path: string) => view.filesByPath.get(path)?.content ?? pack.files.find((row) => row.path === path)?.content,
    commit: (sha: string) => pack.commits.find((row) => row.sha === sha),
    document: (sourceId: string) => context?.document?.(sourceId),
  };
  if (evidence.some((item) => !evidenceIsCurrent(item, sources))) {
    closeDecision(query, false);
    return null;
  }
  const support = verifyClaim(spoken, evidence);
  if (!support.ok || support.checked === 0) {
    closeDecision(query, false);
    return null;
  }

  closeDecision(query, true);
  return {
    say: spoken,
    citations: citationsFromEvidence(
      evidence,
      claims.map((row) => row.hit),
      view,
    ),
    evidence,
    query,
    latencyMs,
    source: "local",
    answerMode: "docs",
    usedEvidence: true,
  };
}
