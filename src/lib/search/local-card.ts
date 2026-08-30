import type { Card, Citation, FileHit, Hit, RepoPack } from "@/lib/repo/types";
import { isDocumentHit, isFileHit } from "../repo/types.ts";
import type { NormalizedDocument } from "../document/types.ts";
import { documentCard, documentFitsShape } from "./document-card.ts";
import { buildQuestionContract, contractBlocksAll, sourceHitEligible } from "./question-contract.ts";
import type { ThreadContext } from "./thread.ts";
import { architectureCard } from "./architecture.ts";
import { type RejectCode, closeDecision, noteAttempt, overrideDecision } from "./claim-trace.ts";
import { provenanceLabel } from "./cite.ts";
import {
  type Evidence,
  type TextEvidence,
  commitEvidence,
  establishesAuthorship,
  evidenceIsCurrent,
  hashText,
  textEvidence,
  verifyClaim,
} from "./evidence.ts";
import { verifyEvidenceSpan } from "./evidence-span.ts";
import { evidenceFitsShape, shapeGap, shapeOf } from "./intent.ts";
import { isArchitectureQuery } from "./question.ts";
import { contentWords, normalizeSpokenQuestion } from "./spoken.ts";
import { admissible, explain, mentions, provenanceOf, subjectTerms } from "./subject.ts";
import { type Prose, type ProseSpan, capabilityList, plain, proseOf } from "./prose.ts";
import { sayable } from "./say.ts";

/**
 * A claim, and the exact evidence it was read from. The claim is always a
 * sentence the evidence already wrote — never a sequence this code inferred —
 * and the span is how that is proven rather than asserted.
 */
type Claim = { say: string; span: TextEvidence; generic: boolean; head: boolean };

/** A lead-in ending in a preposition flows into its list; a noun needs the colon. */
const DANGLING = /\b(for|to|of|with|including|includes|in|on|by|from|are|is|does)$/i;

/** The range covering every piece of prose a composed sentence drew on. */
function bounds(pieces: ProseSpan[]): { start: number; end: number } {
  return {
    start: Math.min(...pieces.map((p) => p.start)),
    end: Math.max(...pieces.map((p) => p.end)),
  };
}

/** How many capabilities `capabilityList` actually speaks. */
const SPOKEN_CAPABILITIES = 4;

/**
 * Turns written prose into one spoken claim, or nothing.
 *
 * The returned range covers every piece that contributed words, so the evidence
 * behind a capability list is the lead-in and the bullets themselves — not just
 * the first of them.
 */
function claimFrom(
  prose: Prose,
): { say: string; generic: boolean; start: number; end: number } | null {
  // A capability list is the honest answer at the fidelity the file supports,
  // but it describes a whole surface — so it is the generic answer.
  if (prose.capabilities.length >= 2) {
    const spoken = prose.capabilities.slice(0, SPOKEN_CAPABILITIES);
    const list = capabilityList(prose.capabilities.map((c) => c.text));
    if (prose.listLead) {
      const joiner = DANGLING.test(prose.listLead.text) ? " " : ": ";
      return {
        say: `${prose.listLead.text}${joiner}${list}.`,
        generic: true,
        ...bounds([prose.listLead, ...spoken]),
      };
    }
    if (prose.description) {
      return {
        say: `${trimTail(prose.description.text)} — ${list}.`,
        generic: true,
        ...bounds([prose.description, ...spoken]),
      };
    }
    return { say: `It manages ${list}.`, generic: true, ...bounds(spoken) };
  }
  return prose.description
    ? {
        say: prose.description.text,
        generic: false,
        start: prose.description.start,
        end: prose.description.end,
      }
    : null;
}

function overlap(haystack: string, terms: string[]): number {
  const body = haystack.toLowerCase();
  return terms.filter((term) => mentions(body, term)).length;
}

/**
 * The claims for a hit, read from the retrieved span first and then from the
 * file's own head, because a docstring often sits above the matched lines.
 *
 * Both are located against the whole file. Extraction from the retrieved span
 * yields offsets in chunk coordinates, which `hit.startOffset` shifts into the
 * file — so a sentence found on the twelfth line of the fourth chunk cites the
 * line it occupies, not the line the chunk happens to begin on. The file head
 * is likewise cited where its docstring actually starts, which is rarely line 1.
 */
function claimsFor(hit: FileHit, pack: RepoPack, query: string): Claim[] {
  const out: Claim[] = [];
  const file = pack.files.find((f) => f.path === hit.path);

  const consider = (
    source: { path: string; content: string } | null,
    origin: "span" | "head",
    base: number,
    duplicateOf?: string,
  ) => {
    if (!source) return;
    const prose = proseOf(source);
    const claim = prose ? claimFrom(prose) : null;
    const note = (reject: RejectCode | null, line: number, candidate = claim?.say ?? "") =>
      noteAttempt({
        query,
        path: source.path,
        line,
        origin,
        candidate,
        generic: claim?.generic ?? false,
        relevance: 0,
        score: 0,
        accepted: false,
        reject,
      });
    const fallbackLine = origin === "head" ? 1 : hit.startLine;
    if (!prose) return note("NO_PROSE", fallbackLine);
    if (!claim) return note("NO_SPEAKABLE_SENTENCE", fallbackLine);
    if (duplicateOf !== undefined && claim.say === duplicateOf) return note("DUPLICATE", fallbackLine);
    if (!looksSpoken(claim.say)) {
      return note(
        claim.say.split(/\s+/).filter(Boolean).length < 4 ? "TOO_SHORT" : "STRUCTURAL_ONLY",
        fallbackLine,
      );
    }
    // Located against the file, never against the chunk: a citation is only
    // meaningful in the coordinates of the document the room will open.
    if (!file) return note("NO_EVIDENCE_SPAN", fallbackLine);
    const fileStart = base + claim.start;
    const fileEnd = base + claim.end;
    const span = textEvidence({
      path: file.path,
      content: file.content,
      start: fileStart,
      end: fileEnd,
      normalizedText: claim.say,
    });
    if (!span) return note("NO_EVIDENCE_SPAN", fallbackLine);
    const verified = verifyEvidenceSpan(span, {
      content: file.content,
      contentHash: hashText(file.content),
    });
    if (!verified.ok) {
      return note(verified.reason === "STALE" ? "STALE_EVIDENCE" : "NO_EVIDENCE_SPAN", span.startLine);
    }
    out.push({ say: claim.say, generic: claim.generic, span, head: origin === "head" });
  };

  consider({ path: hit.path, content: hit.text }, "span", hit.startOffset);
  const fromSpan = out[0]?.say;
  consider(file ?? null, "head", 0, fromSpan);
  return out;
}

/**
 * Of the speakable claims in the ranked evidence, the one that answers *this*
 * question: the file it came from should be on topic, and a description of one
 * behavior beats a whole-surface capability list.
 */
function bestClaim(
  ordered: FileHit[],
  pack: RepoPack,
  query: string,
  canonical: string,
): { claim: Claim; hit: FileHit } | null {
  // Subject selection reads the canonical question: filler is rare in code and
  // would otherwise look like the most discriminating word in the sentence.
  const terms = contentWords(canonical);
  const subject = subjectTerms(terms, pack);
  const eligible: Array<{ claim: Claim; hit: FileHit; relevance: number; score: number }> = [];
  for (const hit of ordered) {
    for (const claim of claimsFor(hit, pack, query)) {
      const path = claim.span.path ?? hit.path;
      const relevance = overlap(path, terms) * 3 + overlap(claim.say, terms);
      // A module docstring describes the whole thing; a docstring buried
      // mid-file describes one function. Prefer purpose when they tie.
      const score = relevance - (claim.generic ? 2 : 0) + (claim.head ? 1 : 0);
      // Ranking may use every signal, path included. Admission may not: a claim
      // whose only tie to the question is a low-information word is evidence
      // that sits somewhere relevant and says nothing relevant.
      const provenance = provenanceOf(terms, subject, claim.say, path);
      if (!admissible(provenance)) {
        noteAttempt({
          query, path, line: claim.span.startLine ?? 1, origin: claim.head ? "head" : "span",
          candidate: claim.say, generic: claim.generic, relevance, score,
          accepted: false,
          reject: relevance === 0 ? "LOW_OVERLAP" : "NO_SUBJECT_COVERAGE",
          provenance: explain(provenance),
        });
        continue;
      }
      eligible.push({ claim, hit, relevance, score });
    }
  }
  if (eligible.length === 0) return null;
  const winner = eligible.reduce((a, b) => (b.score > a.score ? b : a));
  // Admission needs a positive score, not merely a positive relevance. This is
  // the long-standing rule, kept deliberately: relaxing it to admit score-zero
  // claims raised coverage by one legitimate answer and one wrong one, which is
  // not a trade worth making while question shape is still unchecked.
  if (winner.score <= 0) {
    for (const item of eligible) {
      noteAttempt({
        query, path: item.claim.span.path ?? "", line: item.claim.span.startLine ?? 1,
        origin: item.claim.head ? "head" : "span",
        candidate: item.claim.say, generic: item.claim.generic,
        relevance: item.relevance, score: item.score,
        accepted: false, reject: "SCORE_FLOOR",
      });
    }
    return null;
  }
  for (const item of eligible) {
    noteAttempt({
      query, path: item.claim.span.path ?? "", line: item.claim.span.startLine ?? 1,
      origin: item.claim.head ? "head" : "span",
      candidate: item.claim.say, generic: item.claim.generic,
      relevance: item.relevance, score: item.score,
      accepted: item === winner,
      reject: item === winner ? null : "NOT_PREFERRED",
    });
  }
  return { claim: winner.claim, hit: winner.hit };
}

function fileFromQuery(query: string, pack: RepoPack, openFile?: string | null) {
  const named = query.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? [];
  for (const name of named) {
    const needle = name.toLowerCase();
    const hit = pack.files.find(
      (f) => f.path.toLowerCase() === needle || f.path.toLowerCase().endsWith(`/${needle}`) || f.path.toLowerCase().endsWith(needle),
    );
    if (hit) return hit;
  }
  if (/\b(this|that) (file|one|module|class|function)?\b/i.test(query) || /\bwhat does this\b/i.test(query)) {
    const open = openFile ? pack.files.find((f) => f.path === openFile) : undefined;
    if (open) return open;
  }
  if (/\bapi\b|endpoint|fastapi/i.test(query)) {
    return pack.files.find((f) =>
      /(?:^|\/)(main|app|api|server|router)\.[a-z]+$/i.test(f.path) || /\/api\//i.test(f.path),
    );
  }
  return undefined;
}

function hitFromFile(file: { path: string; content: string }): FileHit {
  return {
    id: `${file.path}:1`,
    kind: "code",
    path: file.path,
    startLine: 1,
    endLine: Math.min(28, file.content.split("\n").length),
    startOffset: 0,
    text: file.content.split("\n").slice(0, 28).join("\n"),
    score: 8,
  };
}

function looksSpoken(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  if (/[=;{}<>]|^\s*(def |class |const |function |import )/.test(text)) return false;
  return /[a-z]/.test(text);
}

function trimTail(text: string): string {
  return text.replace(/[.!?\s]+$/, "");
}

/**
 * Two sentences is the whole budget. Anything longer is not a spoken answer, so
 * it is cut at a sentence boundary or dropped — never truncated mid-clause.
 */
function twoSentences(text: string): string | null {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  for (const take of [2, 1]) {
    const candidate = sentences.slice(0, take).join(" ");
    if (candidate && candidate.length <= 260) return candidate;
  }
  return null;
}

function genericLocalCard(
  query: string,
  canonical: string,
  hits: FileHit[],
  pack: RepoPack,
  latencyMs: number,
  openFile?: string | null,
  context?: LocalCardContext,
): Card {
  const named = fileFromQuery(canonical, pack, openFile);
  const usable = hits.filter((h) => !/(site-packages|dist-packages|\.venv|\/venv\/)/i.test(h.path));
  const seeded = usable.length === 0 && named ? [hitFromFile(named)] : usable;
  const top = seeded[0];
  if (seeded.length === 0 || (!named && (top?.score ?? 0) < 4)) {
    noteAttempt({
      query,
      path: top?.path ?? "",
      line: top?.startLine ?? 0,
      origin: "span",
      candidate: "",
      generic: false,
      relevance: 0,
      score: top?.score ?? 0,
      accepted: false,
      reject: "NO_EVIDENCE",
    });
    closeDecision(query, false);
    return {
      say: null,
      reason: "Nothing in this pack cites that.",
      citations: [],
      query,
      latencyMs,
      source: "local",
    };
  }
  const codeHits = seeded.filter((h) => h.kind === "code");
  const preferred = named ? codeHits.find((h) => h.path === named.path) : undefined;
  const why = seeded.find((h) => h.kind === "why");

  const ordered = [preferred, ...codeHits, ...seeded].filter(Boolean) as FileHit[];
  const picked = bestClaim(ordered, pack, query, canonical);
  const claim = picked?.claim ?? null;
  const code = picked?.hit ?? ordered[0];

  let say = claim ? sayable(twoSentences(claim.say) ?? "") : "";
  let evidence: Evidence[] = claim && say ? [claim.span] : [];
  if (claim && !say) {
    // The claim was chosen and then lost on the way to being spoken: either it
    // could not be cut at a sentence boundary, or it was pure filler.
    noteAttempt({
      query, path: claim.span.path, line: claim.span.startLine,
      origin: claim.head ? "head" : "span",
      candidate: claim.say, generic: claim.generic, relevance: 0, score: 0,
      accepted: false, reject: twoSentences(claim.say) ? "NO_SPEAKABLE_SENTENCE" : "TOO_LONG",
    });
  }

  // "Who touched this?" is answered by history or not at all. A docstring says
  // what a file does and never who wrote it, so whatever prose won above is the
  // wrong kind of evidence here and is discarded rather than spoken — this is
  // the failure that used to answer an authorship question with a description
  // of behaviour. The author is a field on the commit, so the commit is the
  // evidence and the spoken line names them from it.
  if (shapeOf(canonical) === "who") {
    const authored = seeded.find((hit) => hit.kind === "why" && hit.author?.trim() && hit.message);
    const spoken = authored ? authorshipLine(authored) : null;
    if (!spoken || !authored) {
      // Silent for a reason the room can act on: the material was found, it
      // simply does not record who. "Nothing in it I would say out loud" would
      // blame the prose for not answering a question prose cannot answer.
      overrideDecision(query, "WRONG_SHAPE");
      closeDecision(query, false);
      return {
        say: null,
        reason: shapeGap("who"),
        citations: [citationOfHit(code)],
        query,
        latencyMs,
        source: "local",
      };
    }
    say = spoken;
    evidence = [commitFrom(authored, spoken)];
  } else if (!say && why?.message) {
    // A commit or ADR message is written evidence too, and it states the change.
    // Its evidence is the message, so the Card cites the commit rather than the
    // code chunk that happened to rank alongside it — that chunk does not
    // contain the sentence, and citing it was a claim the file could not back.
    const message = plain(why.message);
    if (looksSpoken(message)) {
      const spoken = sayable(twoSentences(message) ?? "");
      if (spoken) {
        say = spoken;
        evidence = [commitFrom(why, spoken)];
      }
    }
  }

  const fallback = citationOfHit(code);
  if (!say) {
    closeDecision(query, false);
    return {
      say: null,
      reason: "Found the file, but nothing in it I would say out loud.",
      citations: [fallback],
      query,
      latencyMs,
      source: "local",
    };
  }

  const checked = admitEvidence(query, say, evidence, pack, context);
  if (!checked.ok) {
    return {
      say: null,
      reason: checked.reason,
      citations: citationsFor(evidence, code) ?? [fallback],
      query,
      latencyMs,
      source: "local",
    };
  }

  // The citation points at the sentence that was spoken, at the line it
  // occupies in the file — derived from the evidence rather than from the
  // 28-line window retrieval happened to return it in.
  //
  // No second citation. The spoken line was read from one place, so any other
  // file on the Card is a chip the room can click and find nothing behind —
  // provenance for a claim it does not carry. Corroboration would have to be
  // proven, not assumed, and a single exact citation is the stronger promise.
  closeDecision(query, true);
  return {
    say,
    citations: citationsFor(evidence, code) ?? [fallback],
    evidence,
    query,
    latencyMs,
    source: "local",
  };
}

/**
 * Where MeetHint looked, for a chip on a Card that is not speaking.
 *
 * Even a "nothing here" citation states coordinates the evidence actually has.
 * A history chunk is stored against `commit.files[0]` at line 1 so retrieval has
 * somewhere to hang it, and that line is an artefact of indexing rather than a
 * position in the file — so a commit is cited as a commit here too.
 */
function citationOfHit(hit: Hit): Citation {
  if (hit.kind === "document") {
    return {
      kind: "document",
      sourceId: hit.sourceId,
      path: hit.path,
      page: hit.page,
      heading: hit.heading,
      label: hit.heading ?? "",
    };
  }
  if (hit.kind === "why" && hit.sha) {
    return {
      kind: "commit",
      sha: hit.sha,
      shortSha: hit.sha.slice(0, 7),
      pr: hit.pr,
      author: hit.author,
      date: hit.date,
      label: [hit.author, hit.date].filter(Boolean).join(" · "),
    };
  }
  return {
    kind: "file",
    path: hit.path,
    line: hit.startLine,
    sha: hit.sha,
    pr: hit.pr,
    label: provenanceLabel(hit),
  };
}

/**
 * Commit evidence from a ranked history hit, carrying the provenance the hit
 * already knows. `sha` falls back to the chunk id only so evidence always has
 * an identity; everything displayed comes from the commit's own fields.
 */
function commitFrom(hit: FileHit, spoken: string) {
  return commitEvidence(
    {
      sha: hit.sha ?? hit.id,
      message: hit.message ?? hit.text,
      author: hit.author,
      date: hit.date,
      pr: hit.pr,
      files: hit.path ? [hit.path] : undefined,
    },
    spoken,
  );
}

/**
 * The one sentence a commit can answer "who" with.
 *
 * Every word of it is a recorded field — the author, the PR or the short sha,
 * and the message — so it passes the same support check as extracted prose
 * without a structural allowance. Nothing here is inferred: if the commit does
 * not name an author there is no line to build.
 */
function authorshipLine(hit: FileHit): string | null {
  const author = hit.author?.trim();
  const message = plain(hit.message ?? "");
  if (!author || !message) return null;
  const where = hit.pr ? `PR #${hit.pr}` : `commit ${(hit.sha ?? "").slice(0, 7)}`;
  return sayable(`${author}, in ${where}: ${twoSentences(message) ?? message}`);
}

/**
 * The last gate before anything is spoken from extracted prose.
 *
 * Two things have to hold, and neither was checked at runtime before: the
 * evidence must still match the material as loaded, and every content word
 * about to be said must appear in that evidence. The second is the check the
 * offline harness has always run on a handful of questions; here it runs on
 * every Card, which is the only place it can actually prevent one.
 */
function admitEvidence(
  query: string,
  say: string,
  evidence: Evidence[],
  pack: RepoPack,
  context?: LocalCardContext,
): { ok: true } | { ok: false; reason: string } {
  const where = (item: Evidence) => {
    if (item.kind === "text") return { path: item.path, line: item.startLine };
    if (item.kind === "document") return { path: item.path, line: item.page };
    return { path: item.sha, line: 0 };
  };

  if (evidence.length === 0) {
    noteAttempt({
      query, path: "", line: 0, origin: "span", candidate: say, generic: false,
      relevance: 0, score: 0, accepted: false, reject: "NO_EVIDENCE_SPAN",
    });
    closeDecision(query, false);
    return { ok: false, reason: "No evidence I could point at for that." };
  }

  // Each kind is checked against its own source: a file against the file as
  // loaded, a commit against the message history still records. Neither is
  // exempt, and neither is checked against the other's.
  for (const item of evidence) {
    if (item.kind !== "text") continue;
    const source = pack.files.find((file) => file.path === item.path);
    if (!source) {
      noteAttempt({
        query, path: item.path, line: item.startLine, origin: "span",
        candidate: say, generic: false, relevance: 0, score: 0,
        accepted: false, reject: "NO_EVIDENCE_SPAN",
      });
      closeDecision(query, false);
      return { ok: false, reason: "No evidence I could point at for that." };
    }
    const verified = verifyEvidenceSpan(item, {
      content: source.content,
      contentHash: hashText(source.content),
    });
    if (!verified.ok) {
      noteAttempt({
        query, path: item.path, line: item.startLine, origin: "span",
        candidate: say, generic: false, relevance: 0, score: 0,
        accepted: false, reject: verified.reason === "STALE" ? "STALE_EVIDENCE" : "NO_EVIDENCE_SPAN",
      });
      closeDecision(query, false);
      return { ok: false, reason: "That material changed since I read it." };
    }
  }

  const stale = evidence.find((item) => !evidenceIsCurrent(item, sourcesOf(pack, context)));
  if (stale) {
    noteAttempt({
      query, ...where(stale), origin: "span",
      candidate: say, generic: false, relevance: 0, score: 0,
      accepted: false, reject: "STALE_EVIDENCE",
    });
    closeDecision(query, false);
    return { ok: false, reason: "That material changed since I read it." };
  }

  const support = verifyClaim(say, evidence);
  if (!support.ok) {
    noteAttempt({
      query, ...where(evidence[0]), origin: "span",
      candidate: say, generic: false, relevance: 0, score: 0,
      accepted: false, reject: "UNSUPPORTED_CLAIM",
    });
    closeDecision(query, false);
    return { ok: false, reason: "I could not back every word of that from the file." };
  }
  return { ok: true };
}

/** The loaded material, as the evidence model asks about it. */
export type LocalCardContext = {
  document?: (sourceId: string) => NormalizedDocument | undefined;
  /** All loaded PDFs, including scanned / refused / empty. Used for source resolution. */
  documents?: NormalizedDocument[];
  thread?: ThreadContext | null;
};

function sourcesOf(pack: RepoPack, context?: LocalCardContext) {
  return {
    file: (path: string) => pack.files.find((f) => f.path === path)?.content,
    commit: (sha: string) => pack.commits.find((c) => c.sha === sha),
    document: (sourceId: string) => context?.document?.(sourceId),
  };
}

/**
 * Citations built from evidence, so what is quoted is what was read.
 *
 * File evidence quotes its line range. Commit evidence quotes the commit, and
 * that is the whole of it — there is no file line to fall back to, because the
 * sentence is not in a file. The chip that used to read `src/auth/flow.ts:1`
 * for a commit message was pointing at a line that did not contain a word of
 * what was being said.
 */
function citationsFor(evidence: Evidence[], provenance: FileHit): Citation[] | null {
  const cites: Citation[] = evidence.map((item) => {
    if (item.kind === "text") {
      // Lines come from the verified EvidenceSpan, never the retrieved chunk.
      return {
        kind: "file" as const,
        path: item.path,
        line: item.startLine,
        endLine: item.endLine,
        evidenceId: item.id,
        sha: provenance.path === item.path ? provenance.sha : undefined,
        pr: provenance.path === item.path ? provenance.pr : undefined,
        label: provenance.path === item.path ? provenanceLabel(provenance) : "",
      };
    }
    if (item.kind === "document") {
      return {
        kind: "document" as const,
        sourceId: item.sourceId,
        path: item.path,
        page: item.page,
        heading: item.heading,
        evidenceId: item.id,
        label: item.heading ?? "",
      };
    }
    return {
      kind: "commit" as const,
      sha: item.sha,
      shortSha: item.shortSha,
      pr: item.pr,
      author: item.author,
      date: item.date,
      evidenceId: item.id,
      label: [item.author, item.date].filter(Boolean).join(" · "),
    };
  });
  return cites.length > 0 ? cites : null;
}

export function questionChips(pack: RepoPack): string[] {
  if (pack.id === "northstar-payments") {
    return [
      "What is the architecture of this application?",
      "What did we change in the exporter?",
      "Why does that retry three times?",
      // Answered from commit authorship, so the four chips between them
      // demonstrate both kinds of evidence and both kinds of citation.
      "Who touched the auth flow?",
    ];
  }
  const files = pack.files.filter((f) => !/(__init__|__main__|\.md$)/i.test(f.path));
  const chips = ["What is the architecture of this application?", "What does this API do?"];
  for (const file of files.slice(0, 2)) {
    chips.push(`What does ${file.path} do?`);
  }
  return chips.slice(0, 3);
}

/**
 * Holds the claim to the shape of the question, whatever produced it.
 *
 * Deliberately the last thing that happens to a Card, and applied to every
 * compose path rather than inside one of them: a well-cited description of
 * behaviour is not an answer to "why", and a future compose path must not be
 * able to reintroduce that by not knowing about this rule. Citations survive so
 * the room still sees where GROUND looked and why it declined.
 */
function holdToShape(card: Card, hits: FileHit[], canonical: string): Card {
  if (!card.say) return card;
  const shape = shapeOf(canonical);
  if ((card.evidence ?? []).some((item) => item.kind === "document")) {
    if (documentFitsShape(shape, card.say)) return card;
    overrideDecision(card.query, "WRONG_SHAPE");
    return { ...card, say: null, reason: shapeGap(shape), citations: card.citations };
  }
  // Rationale evidence is now identifiable from the evidence itself: a commit
  // exists to record why a change was made. This used to be inferred by matching
  // a why-chunk's path against a file citation, which was true only when the
  // commit's first file happened to be the file that ranked alongside it.
  const citedWhy = (card.evidence ?? []).some((item) => item.kind === "commit");
  // Authorship counts only when the evidence names a person *and* the spoken
  // line is that person. A commit satisfies "who" because it records an author,
  // not because it is a commit — quoting its message while saying nothing about
  // who wrote it is still an answer to a different question.
  const said = card.say.toLowerCase();
  const authored = (card.evidence ?? []).some(
    (item) =>
      establishesAuthorship(item) &&
      item.kind === "commit" &&
      said.includes((item.author ?? "").trim().toLowerCase()),
  );
  if (evidenceFitsShape(shape, card.say, citedWhy, authored)) return card;
  overrideDecision(card.query, "WRONG_SHAPE");
  return { ...card, say: null, reason: shapeGap(shape), citations: card.citations };
}

/**
 * Retrieval has already run by the time this is called, and every path here
 * either cites a ranked hit or falls through. Specific answers are tried before
 * structural ones, so a broad phrasing cannot outrank real evidence.
 */
export function localCard(
  query: string,
  hits: Hit[],
  pack: RepoPack,
  latencyMs: number,
  openFile?: string | null,
  context?: LocalCardContext,
): Card {
  // An absence question is unanswerable from retrieved prose whatever the prose
  // says, so composing one is wasted work that also produces the wrong
  // explanation — "nothing I would say out loud" blames the file when the honest
  // answer is that nothing here settles it. The citation stays: the room should
  // still see where GROUND looked before declining.
  // Conversational framing is stripped before anything classifies or selects on
  // the words, and only for that: `query` stays raw so the Card, the transcript
  // and the utterance's identity remain exactly what the room said.
  const canonical = normalizeSpokenQuestion(query).canonical;
  const composeHits = hits.filter(isFileHit);
  if (shapeOf(canonical) === "absence") {
    overrideDecision(query, "WRONG_SHAPE");
    const top = composeHits[0] ?? hits[0];
    return {
      say: null,
      reason: shapeGap("absence"),
      citations: top && isFileHit(top) ? [citationOfHit(top)] : [],
      query,
      latencyMs,
      source: "local",
    };
  }
  const documents = context?.documents?.length ? context.documents : uniqueDocuments(hits, context);
  if (hits.some(isDocumentHit)) {
    const contract = buildQuestionContract(canonical, documents, context?.thread);
    const blocked = contractBlocksAll(contract);
    if (blocked) {
      return {
        say: null,
        reason: blocked,
        citations: [],
        query,
        latencyMs,
        source: "local",
      };
    }
    let fileCard: Card | null = null;
    for (const hit of hits) {
      if (isDocumentHit(hit)) {
        if (!sourceHitEligible(hit.sourceId, contract)) continue;
        const card = documentCard(canonical, hit, context?.document?.(hit.sourceId), documents, latencyMs, contract);
        if (card.say) return holdToShape({ ...card, query }, composeHits, canonical);
        continue;
      }
      if (fileCard) continue;
      fileCard = compose(query, canonical, composeHits, pack, latencyMs, openFile, context);
      if (fileCard.say) return holdToShape(fileCard, composeHits, canonical);
    }
    if (fileCard) return holdToShape(fileCard, composeHits, canonical);
    return {
      say: null,
      reason: "Nothing in this pack cites that.",
      citations: [],
      query,
      latencyMs,
      source: "local",
    };
  }
  return holdToShape(compose(query, canonical, composeHits, pack, latencyMs, openFile, context), composeHits, canonical);
}

function uniqueDocuments(hits: Hit[], context?: LocalCardContext): NormalizedDocument[] {
  const seen = new Set<string>();
  const documents: NormalizedDocument[] = [];
  for (const hit of hits) {
    if (!isDocumentHit(hit) || seen.has(hit.sourceId)) continue;
    const document = context?.document?.(hit.sourceId);
    if (!document) continue;
    seen.add(hit.sourceId);
    documents.push(document);
  }
  return documents;
}

function compose(
  query: string,
  canonical: string,
  hits: FileHit[],
  pack: RepoPack,
  latencyMs: number,
  openFile?: string | null,
  context?: LocalCardContext,
): Card {
  if (isArchitectureQuery(canonical)) {
    const structural = architectureCard(pack, query, latencyMs);
    if (structural.say) return structural;
  }
  return genericLocalCard(query, canonical, hits, pack, latencyMs, openFile, context);
}
