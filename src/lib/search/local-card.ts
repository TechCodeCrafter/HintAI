import type { Card, Citation, FileHit, Hit, RepoPack } from "@/lib/repo/types";
import type { SpaceMaterialView } from "../context/material-view.ts";
import { enrichFileCitation, fileInMaterial } from "../context/material-view.ts";
import { isDocumentHit, isFileHit } from "../repo/types.ts";
import { tryMultiSourceCard } from "./multi-source-compose.ts";
import type { NormalizedDocument } from "../document/types.ts";
import { documentCard, documentFitsShape } from "./document-card.ts";
import { buildQuestionContract, contractBlocksAll, sourceHitEligible } from "./question-contract.ts";
import type { ThreadContext } from "./thread.ts";
import { architectureCard, readmeOverviewCard } from "./architecture.ts";
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
import { evidenceFitsShape, shapeGap, shapeOf, statesCause } from "./intent.ts";
import { SILENCE, type Silence, notStated, silent, unknownTerms } from "./silence.ts";
import { withConsidered } from "./considered.ts";
import { asksAboutWholeApp, isArchitectureQuery, isProjectOverviewQuery } from "./question.ts";
import { FAST_PATH_MIN_SCORE } from "./answer-fast-path.ts";
import { isTestEvidencePath } from "./retrieve.ts";
import { contentWords, normalizeSpokenQuestion } from "./spoken.ts";
import { admissible, explain, fileFrequency, mentions, provenanceOf, subjectTerms } from "./subject.ts";
import { type Prose, type ProseSpan, capabilityList, plain, proseOf } from "./prose.ts";
import { sayable } from "./say.ts";
import { covers, identWords as nameWords, locateInCode } from "./code-locator.ts";
import { quotesWholeSentences, unwrapEvidenceText } from "./claim-verify.ts";
import { type SectionAnswer, sectionAnswer } from "./doc-section.ts";

/**
 * A claim, and the exact evidence it was read from. The claim is always a
 * sentence the evidence already wrote — never a sequence this code inferred —
 * and the span is how that is proven rather than asserted.
 */
type Claim = {
  say: string;
  span: TextEvidence;
  generic: boolean;
  head: boolean;
  /** The function, class or constant the comment documents, when it sits directly above one. */
  decl?: string;
  /** A later sentence of its comment rather than the opening one. */
  follow?: boolean;
};

/** A doc comment in a file, in file offsets, and the declaration it documents. */
type DocBlock = { start: number; end: number; decl: string | null };

const DECL_PATTERNS: RegExp[] = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^\s*(?:(?:public|private|protected|static|async|readonly|override)\s+)+([A-Za-z_$][\w$]*)\s*[(=:<]/,
];
const NOT_DECL = new Set(["if", "for", "while", "switch", "catch", "return", "else", "new", "await"]);

function declOn(line: string | undefined): string | null {
  if (!line) return null;
  for (const re of DECL_PATTERNS) {
    const m = re.exec(line);
    if (m?.[1] && !NOT_DECL.has(m[1])) return m[1];
  }
  return null;
}

/** Splits an identifier into the words it is made of: chargeWithRetry -> "charge with retry". */
function identWords(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_$]+/g, " ")
    .toLowerCase();
}

/**
 * Every doc comment that overlaps [from, to] in a file: JSDoc blocks, Python
 * docstrings and runs of line comments. `proseOf` only reads the first block of
 * whatever it is handed, so a function's own docstring further down a file used
 * to be invisible — the answer to "how does X work" sat one comment below the
 * one that got spoken.
 */
function docBlocksNear(content: string, from: number, to: number): DocBlock[] {
  const lo = Math.max(0, from);
  const hi = Math.min(content.length, to);
  const blocks: DocBlock[] = [];
  const lineAfter = (end: number) =>
    content
      .slice(end)
      .split("\n")
      .slice(1)
      .find((line) => line.trim().length > 0);
  const lineBefore = (start: number) => {
    const head = content.slice(0, start).split("\n");
    head.pop();
    for (let i = head.length - 1; i >= 0; i -= 1) if (head[i].trim()) return head[i];
    return undefined;
  };
  for (const m of content.matchAll(/\/\*\*?[\s\S]*?\*\//g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (end < lo || start > hi) continue;
    blocks.push({ start, end, decl: declOn(lineAfter(end)) });
  }
  for (const m of content.matchAll(/("""|''')[\s\S]*?\1/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (end < lo || start > hi) continue;
    blocks.push({ start, end, decl: declOn(lineBefore(start)) });
  }
  // Runs of // or # comments, at most six lines each.
  const lines = content.split("\n");
  let offset = 0;
  let runStart = -1;
  let runEnd = -1;
  let runLines = 0;
  const flush = (nextLine: string | undefined) => {
    if (runStart >= 0 && runEnd >= lo && runStart <= hi) {
      blocks.push({ start: runStart, end: runEnd, decl: declOn(nextLine) });
    }
    runStart = -1;
    runLines = 0;
  };
  for (const line of lines) {
    const isComment = /^\s*(\/\/(?!\/)|#(?![!\[]|include\b))/.test(line);
    if (isComment && runLines < 6) {
      if (runStart < 0) runStart = offset;
      runEnd = offset + line.length;
      runLines += 1;
    } else if (runStart >= 0) {
      flush(isComment ? undefined : line);
      if (isComment) {
        runStart = offset;
        runEnd = offset + line.length;
        runLines = 1;
      }
    }
    offset += line.length + 1;
  }
  flush(undefined);
  return blocks.sort((a, b) => a.start - b.start);
}

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
function claimsFor(hit: FileHit, pack: RepoPack, query: string, material?: SpaceMaterialView): Claim[] {
  const out: Claim[] = [];
  const file = material?.filesByPath.get(hit.path) ?? pack.files.find((f) => f.path === hit.path);
  const sourceId = hit.sourceId ?? (material ? fileInMaterial(material, hit.path)?.sourceId : undefined);

  const consider = (
    source: { path: string; content: string } | null,
    origin: "span" | "head",
    base: number,
    duplicateOf?: string,
    decl?: string | null,
  ) => {
    if (!source) return;
    const prose = proseOf(source);
    const first = prose ? claimFrom(prose) : null;
    // Later sentences of the same comment compete too: "what happens after the
    // last retry" is answered by the second line of a docstring, not the first.
    const later = (prose?.more ?? [])
      .map((sentence) => claimFrom({ description: sentence, capabilities: [], listLead: null }))
      .filter((c): c is NonNullable<typeof c> => Boolean(c) && !c!.generic);
    if (!prose || !first) return take(source, origin, base, duplicateOf, decl, prose, first);
    take(source, origin, base, duplicateOf, decl, prose, first);
    for (const claim of later) take(source, origin, base, duplicateOf, decl, prose, claim, true);
  };

  const take = (
    source: { path: string; content: string },
    origin: "span" | "head",
    base: number,
    duplicateOf: string | undefined,
    decl: string | null | undefined,
    prose: ReturnType<typeof proseOf>,
    claim: ReturnType<typeof claimFrom> | null,
    follow = false,
  ) => {
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
      sourceId,
    });
    if (!span) return note("NO_EVIDENCE_SPAN", fallbackLine);
    const verified = verifyEvidenceSpan(span, {
      content: file.content,
      contentHash: hashText(file.content),
    });
    if (!verified.ok) {
      return note(verified.reason === "STALE" ? "STALE_EVIDENCE" : "NO_EVIDENCE_SPAN", span.startLine);
    }
    if (out.some((c) => c.say === claim.say && c.span.startLine === span.startLine)) return;
    out.push({ say: claim.say, generic: claim.generic, span, head: origin === "head", decl: decl ?? undefined, follow });
  };

  consider({ path: hit.path, content: hit.text }, "span", hit.startOffset);
  const fromSpan = out[0]?.say;
  consider(file ?? null, "head", 0, fromSpan);
  // Every other doc comment in or just above the retrieved lines, each with the
  // declaration it documents, so a function's own docstring can compete.
  // Only when the hit still matches the file: offsets from a stale index point
  // at different text, and reading around them would speak unindexed material.
  const current = file ? file.content.slice(hit.startOffset, hit.startOffset + hit.text.length) === hit.text : false;
  if (file && current && hit.kind === "code") {
    const from = hit.startOffset - 600;
    const to = hit.startOffset + hit.text.length;
    for (const block of docBlocksNear(file.content, from, to)) {
      consider(
        { path: file.path, content: file.content.slice(block.start, block.end) },
        "span",
        block.start,
        undefined,
        block.decl,
      );
    }
  }
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
  material?: SpaceMaterialView,
): { claim: Claim; hit: FileHit } | null {
  // Subject selection reads the canonical question: filler is rare in code and
  // would otherwise look like the most discriminating word in the sentence.
  const terms = contentWords(canonical);
  const subject = subjectTerms(terms, pack);
  const eligible: Array<{ claim: Claim; hit: FileHit; relevance: number; score: number }> = [];
  for (const hit of ordered) {
    for (const claim of claimsFor(hit, pack, query, material)) {
      const path = claim.span.path ?? hit.path;
      const relevance = overlap(path, terms) * 3 + overlap(claim.say, terms);
      // A module docstring describes the whole thing; a docstring buried
      // mid-file describes one function. Prefer purpose when they tie.
      let score = relevance - (claim.generic ? 2 : 0) + (claim.head ? 1 : 0);
      // A docstring on a declaration whose name matches the question describes
      // the thing that was asked about, not a neighbour of it.
      if (claim.decl) score += Math.min(2, overlap(identWords(claim.decl), terms)) * 1.5;
      // Inflections the substring match misses ("fails" vs "failed attempts").
      score += Math.max(0, covers(claim.say, terms) - overlap(claim.say, terms)) * 0.5;
      // "What happens after/when/if X" is answered by a sentence about that moment.
      if (/\bwhat happens\b|\b(?:after|once|when|if)\b/i.test(canonical) && /^(?:after|once|when|if)\b/i.test(claim.say)) {
        score += 1.5;
      }
      // The opening sentence states purpose; a later one has to earn its place.
      if (claim.follow) score -= 0.75;
      // Defense in depth for the test-file bias: even when retrieval ranked a
      // test file first, its claim describes what the suite *covers*, not what
      // the system *does*. A test claim may only win when it is the sole source
      // of evidence — never over a real source file.
      if (isTestEvidencePath(path)) {
        score -= 6;
      }
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
  const best = eligible.reduce((a, b) => (b.score > a.score ? b : a));
  // "Why" is answered only by a sentence that states a reason: the shape gate
  // withdraws anything else. So a sentence that gives its cause outright is
  // taken ahead of a description that scores higher, provided it covers as
  // much of the question as that description does. Otherwise the description
  // stands and the shape gate says what was missing.
  const causes =
    shapeOf(canonical) === "why"
      ? eligible.filter(
          (item) => item.score > 0 && item.relevance >= best.relevance && statesCause(item.claim.say),
        )
      : [];
  const winner = causes.length > 0 ? causes.reduce((a, b) => (b.score > a.score ? b : a)) : best;
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

/**
 * The support check for a doc answer. A lead-in joined to the block after it
 * ("They're read only on the server: A, B and C.") is stitched from verbatim
 * pieces, which the paraphrase heuristics (ordering, negation) misread as
 * reworded prose. It passes when every spoken word is in the cited spans and
 * every piece appears word for word in them. Lists from the code locator are
 * held to the same rule, one entry line per piece.
 */
function supportedByParts(answer: {
  say: string;
  spans: TextEvidence[];
  structural: string[];
  parts?: string[];
  /** Doc answers only: they have their own relevance gate, so a whole quoted sentence stands. */
  quoteOk?: boolean;
}): boolean {
  const check = verifyClaim(answer.say, answer.spans, answer.structural);
  if (check.ok) return true;
  const semanticOnly = check.missing.every((tag) => tag === "negation" || tag === "phrase_order");
  if (!semanticOnly) return false;
  if (answer.quoteOk && quotesWholeSentences(answer.say, answer.spans.map((span) => span.text).join("\n"))) return true;
  if (!answer.parts?.length) return false;
  const flat = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  // Markdown links and emphasis are read as their text, as the parts were.
  const corpus = answer.spans.map((span) => `${flat(span.text)}\n${flat(plain(span.text))}`).join("\n");
  return answer.parts.every((part) => corpus.includes(flat(part)));
}

function docSupported(doc: SectionAnswer): boolean {
  return supportedByParts({ ...doc, quoteOk: true });
}

/**
 * "Index of the recent question this one duplicates, or -1." documents what a
 * function returns. It answers "what does findDuplicate return?", not "how are
 * duplicates handled?", so on a tie the README's description of the behaviour wins.
 */
function describesReturnValue(say: string): boolean {
  return /^\s*(?:returns?\b|index of\b|true (?:if|when)\b|whether\b|the (?:index|number|count|list|set|map) of\b|\d+\.\.\d+\b)/i.test(say);
}

const WORD_CACHE = new WeakMap<RepoPack, Map<string, boolean>>();

/**
 * Question terms the material never uses as a word. Substring counts are too
 * generous here: "board" is inside "dashboard", "leave" inside "cleave". A term
 * that starts no word anywhere in the pack is what the question is about and
 * the material is not.
 */
/** Whether the unknown terms outweigh what the answer covers. */
function strangersWin(strangers: string[], covered: number): boolean {
  return strangers.length > 0 && strangers.length >= covered;
}

/** Generic words a question can use without the pack ever naming them. */
const FILLER_TERMS = new Set([
  "time", "times", "way", "ways", "thing", "things", "stuff", "kind", "kinds",
  "part", "parts", "lot", "lots", "case", "cases", "actually", "exactly", "really",
  "basically", "currently", "right", "work", "works", "working", "happen", "happens",
  "touch", "touched", "touches", "change", "changed", "changes", "wrote", "written",
  "write", "added", "made", "make", "makes", "built", "build", "handle", "handled",
  "handles", "used", "uses", "using", "done", "last", "first", "after", "before",
  // Generic software vocabulary a correct answer often paraphrases.
  "export", "exports", "logic", "flow", "flows", "feature", "features", "code",
  "function", "functions", "module", "modules", "system", "process", "implemented",
  "implementation", "mechanism", "behavior", "behaviour",
]);

/** The word stem a question term should meet at the start of some pack word. */
function termStem(term: string): string {
  const bare = term.replace(/(?:ing|ed|es|s)$/, "");
  const stem = bare.length >= 4 ? bare : term;
  return stem.length >= 6 ? stem.slice(0, Math.max(5, stem.length - 2)) : stem;
}

function strangerTerms(terms: string[], pack: RepoPack): string[] {
  let cache = WORD_CACHE.get(pack);
  if (!cache) {
    cache = new Map();
    WORD_CACHE.set(pack, cache);
  }
  const known = cache;
  return terms.filter((term) => {
    if (term.length < 4 || FILLER_TERMS.has(term)) return false;
    let seen = known.get(term);
    if (seen === undefined) {
      const stem = termStem(term);
      const re = new RegExp(`(?:^|[^a-z0-9])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      seen =
        pack.files.some((file) => re.test(file.path) || re.test(file.content)) ||
        pack.commits.some((commit) => re.test(commit.message) || re.test(commit.author ?? ""));
      known.set(term, seen);
    }
    return !seen;
  });
}

/** A Card spoken from a README or docs section (see doc-section.ts). */
function docSectionCard(
  query: string,
  doc: SectionAnswer,
  latencyMs: number,
  material: SpaceMaterialView | undefined,
  terms: string[],
  pack: RepoPack,
): Card | null {
  // "What is the vacation policy?" against a README that mentions a retry
  // policy: the word the question is about appears nowhere in the material, so
  // the line that matched the rest of it is about something else.
  const unknown = strangerTerms(terms, pack);
  // A section titled after the covered term ("## License" for "what license
  // is it under?") is about it, whatever the filler word was.
  if (!doc.headingMatch && strangersWin(unknown, doc.coverage)) return null;
  if (!docSupported(doc)) return null;
  noteAttempt({
    query, path: doc.spans[0]!.path, line: doc.spans[0]!.startLine, origin: "span",
    candidate: doc.say, generic: false, relevance: doc.coverage, score: doc.coverage, accepted: true, reject: null,
  });
  closeDecision(query, true);
  return {
    say: doc.say,
    citations: citationsFor([doc.spans[0]!], doc.hit, material) ?? [citationOfHit(doc.hit, material)],
    evidence: doc.spans,
    query,
    latencyMs,
    source: "local",
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

const MARKDOWN_PATH = /\.(?:md|mdx|markdown)$/i;

function isDocumentPackFile(path: string): boolean {
  return /\.(docx|pptx|ppt|xlsx|csv|md|mdx|txt|rst|adoc)$/i.test(path);
}

function minEvidenceScore(pack: RepoPack): number {
  if (pack.files.length > 0 && pack.files.every((file) => isDocumentPackFile(file.path))) {
    return 2;
  }
  return FAST_PATH_MIN_SCORE;
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
  const material = context?.material;
  const named = fileFromQuery(canonical, pack, openFile);
  const usable = hits.filter((h) => !/(site-packages|dist-packages|\.venv|\/venv\/)/i.test(h.path));
  const seeded = usable.length === 0 && named ? [hitFromFile(named)] : usable;
  const top = seeded[0];
  const minScore = minEvidenceScore(pack);
  if (seeded.length > 0 && !named && (top?.score ?? 0) < minScore && shapeOf(canonical) !== "why" && shapeOf(canonical) !== "who") {
    // Retrieval ranked the README low, but a section titled after the question
    // ("## Self-host" for "how do I self-host it?") is still the answer.
    const files = new Map(pack.files.map((file) => [file.path, file.content]));
    const doc = sectionAnswer(canonical, contentWords(canonical), seeded, (path) => files.get(path));
    if (doc?.headingMatch) {
      const card = docSectionCard(query, doc, latencyMs, material, contentWords(canonical), pack);
      if (card) return card;
    }
  }
  if (seeded.length === 0 || (!named && (top?.score ?? 0) < minScore)) {
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
      // No hit at all and hits below the evidence floor are different facts
      // about the files: one is "not there", the other is "not close enough".
      ...silent(seeded.length === 0 ? SILENCE.noMatch : SILENCE.weakMatch),
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
  const sourceIdsInHits = new Set(
    seeded.map((hit) => hit.sourceId ?? material?.filesByPath.get(hit.path)?.sourceId).filter(Boolean),
  );
  if (material && sourceIdsInHits.size >= 2) {
    const multi = tryMultiSourceCard(query, canonical, seeded, pack, material, latencyMs, context);
    if (multi?.say) return multi;
  }

  const picked = bestClaim(ordered, pack, query, canonical, material);
  const claim = picked?.claim ?? null;
  const code = picked?.hit ?? ordered[0];

  // A test file is never the answer to what a component *does*. When the only
  // admissible claim comes from a test/fixture, the honest output is silence:
  // the suite describes what it covers, and speaking it tells the room what the
  // tests assert rather than what the system is. Behavior questions only — a
  // question explicitly about the tests still resolves through the normal path.
  const behaviorShape = ["what", "how", "where"].includes(shapeOf(canonical));
  if (behaviorShape && claim && isTestEvidencePath(claim.span.path ?? code?.path ?? "")) {
    // The winning claim came from a test/fixture. A test docstring asserts what
    // the suite covers; it never states what the component does. Speaking it is
    // the confident-wrong-answer defect, so prefer silence. A question that is
    // genuinely about the tests ("how do we test X?") is the "absence"/"how"
    // shape against a test subject and resolves through the normal path.
    noteAttempt({
      query, path: claim.span.path, line: claim.span.startLine,
      origin: claim.head ? "head" : "span",
      candidate: claim.say, generic: claim.generic, relevance: 0, score: 0,
      accepted: false, reject: "WRONG_SHAPE",
    });
    overrideDecision(query, "WRONG_SHAPE");
    closeDecision(query, false);
    return {
      say: null,
      ...silent(SILENCE.testsOnly),
      citations: [citationOfHit(code, material)],
      query,
      latencyMs,
      source: "local",
    };
  }

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
  // True while the spoken line is still the sentence read from the file.
  let fromProse = Boolean(claim && say && !claim.generic);

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
        ...silent(notStated(shapeGap("who"))),
        citations: [citationOfHit(code, material)],
        query,
        latencyMs,
        source: "local",
      };
    }
    say = spoken;
    evidence = [commitFrom(authored, spoken)];
    fromProse = false;
  } else if (!say && why?.message) {
    // A commit or ADR message is written evidence too, and it states the change.
    // Its evidence is the message, so the Card cites the commit rather than the
    // code chunk that happened to rank alongside it — that chunk does not
    // contain the sentence, and citing it was a claim the file could not back.
    const message = plain(why.message);
    // The message has to be about the question. Ranking next to a hit is not
    // enough: "What is our parental leave policy?" used to be answered with
    // an unrelated ADR commit title.
    const onTopic = covers(message, contentWords(canonical)) > 0;
    if (onTopic && looksSpoken(message)) {
      const spoken = sayable(twoSentences(message) ?? "");
      if (spoken) {
        say = spoken;
        evidence = [commitFrom(why, spoken)];
        fromProse = false;
      }
    }
  }

  // Code as the answer. When the prose is silent, or the question asks for a
  // value the comment only describes, answer from the code itself: the name or
  // line is copied from the file, and the support check sees only the template
  // words as extra vocabulary. The file and line stay on the citation chip.
  if (shapeOf(canonical) !== "who" && shapeOf(canonical) !== "why") {
    const terms = contentWords(canonical);
    const files = new Map(pack.files.map((file) => [file.path, file.content]));
    const located = locateInCode(canonical, terms, codeHits, (path) => files.get(path));
    // A value question wants the value; the locator quotes the comment with it.
    // "Where is X implemented?" wants the thing that implements X, when its
    // name covers the question better than the comment that won.
    const whereNamed = Boolean(
      located &&
        located.kind !== "value" &&
        shapeOf(canonical) === "where" &&
        located.score >= 2 &&
        claim?.decl !== located.name &&
        covers(claim?.say ?? "", terms) < located.score,
    );
    // A list or field is read from the data itself; it answers by construction.
    // A setting found only because the file is configuration fills a silence;
    // it does not displace a sentence someone wrote.
    const readsData =
      (located?.kind === "value" && !located.inferred) || located?.kind === "list" || located?.kind === "field";
    const better = located && (!say || readsData || whereNamed);
    // README and docs: a section whose heading or lines cover the question
    // better than the code comment that won. Product questions ("how do I
    // self-host it?", "what license?") live there, not in docstrings.
    const doc = sectionAnswer(canonical, terms, seeded, (path) => files.get(path));
    const claimCover = say ? covers(say, terms) : -1;
    // The top-ranked file speaks first. A heading earns its section credit for
    // the question words in it, and a file name does the same for the code
    // under it. So when the claim was read from the source file retrieval put
    // first, a document further down has to cover more of the question than
    // the sentence, its path and its declaration put together.
    const claimPath = claim && say && evidence[0] === claim.span ? claim.span.path : null;
    const claimLeads = Boolean(
      doc && claimPath && !MARKDOWN_PATH.test(claimPath) && seeded[0]?.path === claimPath && doc.hit.path !== claimPath,
    );
    const claimReach =
      claimLeads && claimPath
        ? covers(`${say} ${nameWords(claimPath.replace(/\.\w+$/, ""))} ${nameWords(claim?.decl ?? "")}`, terms)
        : claimCover;
    const locatorWins = Boolean(
      located && better && (!doc || located.score > doc.coverage || (readsData && located.score >= doc.coverage)),
    );
    const docWins =
      doc &&
      !locatorWins &&
      (claimLeads
        ? doc.coverage > claimReach
        : doc.coverage > claimCover ||
          (doc.coverage === claimCover &&
            (doc.headingMatch ||
              Boolean(claim?.decl) ||
              Boolean(claim?.generic) ||
              (describesReturnValue(say ?? "") && !/\breturns?\b/i.test(canonical)))));
    if (doc && docWins) {
      const card = docSectionCard(query, doc, latencyMs, material, contentWords(canonical), pack);
      if (card) return card;
    }
    if (located && better && locatorWins && supportedByParts(located)) {
      noteAttempt({
        query, path: located.span.path, line: located.span.startLine, origin: "span",
        candidate: located.say, generic: false, relevance: located.score, score: located.score, accepted: true, reject: null,
      });
      closeDecision(query, true);
      return {
        say: located.say,
        citations: citationsFor([located.span], located.hit, material) ?? [citationOfHit(located.hit, material)],
        evidence: located.spans,
        query,
        latencyMs,
        source: "local",
      };
    }
  }

  const fallback = citationOfHit(code, material);
  if (!say) {
    closeDecision(query, false);
    return {
      say: null,
      ...silent(SILENCE.noSentence),
      citations: [fallback],
      query,
      latencyMs,
      source: "local",
    };
  }

  // "When is the next board meeting?" matched a sentence about meetings, but
  // "board" is not a word anywhere in the material: it is about something else.
  // Silent when the question is mostly about things the pack never names
  // ("next board meeting" only meets "dashboard"). Filler words such as
  // "times" in "retry three times" never count as unknown.
  const askedTerms = contentWords(canonical);
  const strangers = strangerTerms(askedTerms, pack);
  if (strangersWin(strangers, covers(say, askedTerms))) {
    overrideDecision(query, "NO_EVIDENCE");
    closeDecision(query, false);
    return {
      say: null,
      ...silent(unknownTerms(strangers)),
      citations: [],
      query,
      latencyMs,
      source: "local",
    };
  }

  const checked = admitEvidence(query, say, evidence, pack, context, fromProse);
  if (!checked.ok) {
    return {
      say: null,
      ...silent(checked.why),
      citations: citationsFor(evidence, code, material) ?? [fallback],
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
    citations: citationsFor(evidence, code, material) ?? [fallback],
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
function citationOfHit(hit: Hit, material?: SpaceMaterialView): Citation {
  if (hit.kind === "document") {
    const ref = material?.sources.find((row) => row.sourceId === hit.sourceId);
    return {
      kind: "document",
      sourceId: hit.sourceId,
      path: hit.path,
      page: hit.page,
      heading: hit.heading,
      displayName: ref?.displayName,
      contextId: ref?.contextId,
      label: hit.heading ?? ref?.displayName ?? "",
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
  return enrichFileCitation(
    {
      kind: "file",
      path: hit.path,
      line: hit.startLine,
      endLine: hit.endLine > hit.startLine ? hit.endLine : undefined,
      sha: hit.sha,
      pr: hit.pr,
      label: provenanceLabel(hit),
      sourceId: hit.sourceId,
    },
    material,
    hit.sourceId,
  );
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
  /** The line is a sentence read whole from a file, not one a template built. */
  fromProse = false,
): { ok: true } | { ok: false; why: Silence } {
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
    return { ok: false, why: SILENCE.noSpan };
  }

  // Each kind is checked against its own source: a file against the file as
  // loaded, a commit against the message history still records. Neither is
  // exempt, and neither is checked against the other's.
  for (const item of evidence) {
    if (item.kind !== "text") continue;
    const source =
      context?.material?.filesByPath.get(item.path) ?? pack.files.find((file) => file.path === item.path);
    if (!source) {
      noteAttempt({
        query, path: item.path, line: item.startLine, origin: "span",
        candidate: say, generic: false, relevance: 0, score: 0,
        accepted: false, reject: "NO_EVIDENCE_SPAN",
      });
      closeDecision(query, false);
      return { ok: false, why: SILENCE.noSpan };
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
      return { ok: false, why: SILENCE.stale };
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
    return { ok: false, why: SILENCE.stale };
  }

  const support = verifyClaim(say, evidence);
  if (!support.ok && !(fromProse && quotedWhole(say, evidence, support.missing))) {
    noteAttempt({
      query, ...where(evidence[0]), origin: "span",
      candidate: say, generic: false, relevance: 0, score: 0,
      accepted: false, reject: "UNSUPPORTED_CLAIM",
    });
    closeDecision(query, false);
    return { ok: false, why: SILENCE.unsupported };
  }
  return { ok: true };
}

/**
 * A sentence quoted whole cannot be turned around by quoting it. The negation
 * and ordering checks compare one clause of the claim with the whole evidence
 * sentence, so "rank chunks, not files, so each is asked for everything" fails
 * against itself: its first clause has no "not" and the sentence does. Those
 * two checks, and only those, are waived when every spoken sentence is a
 * complete sentence of the cited lines. A missing word is never waived, and a
 * fragment never qualifies.
 */
function quotedWhole(say: string, evidence: Evidence[], failed: string[]): boolean {
  if (failed.length === 0 || !failed.every((tag) => tag === "negation" || tag === "phrase_order")) return false;
  const lines: string[] = [];
  for (const item of evidence) {
    if (item.kind !== "text") return false;
    lines.push(unwrapEvidenceText(item.text));
  }
  return quotesWholeSentences(say, lines.join("\n"));
}

/** The loaded material, as the evidence model asks about it. */
export type LocalCardContext = {
  material?: SpaceMaterialView;
  document?: (sourceId: string) => NormalizedDocument | undefined;
  /** All loaded PDFs, including scanned / refused / empty. Used for source resolution. */
  documents?: NormalizedDocument[];
  thread?: ThreadContext | null;
};

function sourcesOf(pack: RepoPack, context?: LocalCardContext) {
  const material = context?.material;
  return {
    file: (path: string) =>
      material?.filesByPath.get(path)?.content ?? pack.files.find((f) => f.path === path)?.content,
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
function citationsFor(
  evidence: Evidence[],
  provenance: FileHit,
  material?: SpaceMaterialView,
): Citation[] | null {
  const cites: Citation[] = evidence.map((item) => {
    if (item.kind === "text") {
      const samePath = provenance.path === item.path;
      const sameSource = !provenance.sourceId || provenance.sourceId === item.sourceId;
      return enrichFileCitation(
        {
          kind: "file" as const,
          path: item.path,
          line: item.startLine,
          endLine: item.endLine,
          evidenceId: item.id,
          sha: samePath && sameSource ? provenance.sha : undefined,
          pr: samePath && sameSource ? provenance.pr : undefined,
          label: samePath && sameSource ? provenanceLabel(provenance) : "",
          sourceId: item.sourceId,
          contentHash: item.contentHash,
        },
        material,
        item.sourceId,
      );
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
  if (!pack.files.length) return [];
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
    return { ...card, say: null, ...silent(notStated(shapeGap(shape))), citations: card.citations };
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
  return { ...card, say: null, ...silent(notStated(shapeGap(shape))), citations: card.citations };
}

/**
 * Retrieval has already run by the time this is called, and every path here
 * either cites a ranked hit or falls through. Specific answers are tried before
 * structural ones, so a broad phrasing cannot outrank real evidence.
 */
/**
 * The offline composer's Card, with the other loaded files retrieval ranked
 * for the question attached. The list is built here, after composition, so no
 * compose path can forget it and none can mistake it for evidence.
 */
export function localCard(
  query: string,
  hits: Hit[],
  pack: RepoPack,
  latencyMs: number,
  openFile?: string | null,
  context?: LocalCardContext,
): Card {
  const card = composeLocalCard(query, hits, pack, latencyMs, openFile, context);
  return withConsidered(card, hits, { pack, material: context?.material, document: context?.document });
}

function composeLocalCard(
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
    // Retrieved prose cannot settle "is there X?" by mentioning X nearby. A
    // README line that names every part of the question can ("No login, no
    // database, no history"; "the app doesn't connect to GitHub at all"), so
    // that one case is answered, from markdown only, and quoted as written.
    const files = new Map(pack.files.map((file) => [file.path, file.content]));
    const stated = sectionAnswer(canonical, contentWords(canonical), composeHits, (path) => files.get(path), {
      requireAll: true,
    });
    const card = stated ? docSectionCard(query, stated, latencyMs, context?.material, contentWords(canonical), pack) : null;
    if (card) return card;
    overrideDecision(query, "WRONG_SHAPE");
    const top = composeHits[0] ?? hits[0];
    return {
      say: null,
      ...silent(notStated(shapeGap("absence"))),
      citations: top && isFileHit(top) ? [citationOfHit(top, context?.material)] : [],
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
        ...silent(blocked),
        citations: [],
        query,
        latencyMs,
        source: "local",
      };
    }
    let fileCard: Card | null = null;
    // The best-ranked document hit that stayed silent. Its reason is what the
    // room reads if nothing else speaks: it says what was wrong with the
    // closest passage (stale, off subject, not stated).
    let closest: Card | null = null;
    for (const hit of hits) {
      if (isDocumentHit(hit)) {
        if (!sourceHitEligible(hit.sourceId, contract)) continue;
        const card = documentCard(canonical, hit, context?.document?.(hit.sourceId), documents, latencyMs, contract);
        if (card.say) return holdToShape({ ...card, query }, composeHits, canonical);
        closest ??= card;
        continue;
      }
      if (fileCard) continue;
      fileCard = compose(query, canonical, composeHits, pack, latencyMs, openFile, context);
      if (fileCard.say) return holdToShape(fileCard, composeHits, canonical);
    }
    if (fileCard) return holdToShape(fileCard, composeHits, canonical);
    return {
      say: null,
      ...silent(
        closest?.reason
          ? { kind: closest.silence ?? "not-stated", reason: closest.reason }
          : SILENCE.notStated,
      ),
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
  if (isProjectOverviewQuery(canonical)) {
    return readmeOverviewCard(pack, query, latencyMs);
  }
  // The structural card reads the README and shallow entry points, and takes no
  // hits. That is right for "how does this app work" and wrong for "how does the
  // app retry failed exports", which used to get the README's purpose line
  // because it contains "the app". A question with its own subject is answered
  // from what retrieval ranked.
  if (isArchitectureQuery(canonical) && asksAboutWholeApp(canonical, [pack.name])) {
    const structural = architectureCard(pack, query, latencyMs);
    if (structural.say) return structural;
  }
  return genericLocalCard(query, canonical, hits, pack, latencyMs, openFile, context);
}
