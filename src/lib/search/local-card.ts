import type { Card, Hit, RepoPack } from "@/lib/repo/types";
import { architectureCard } from "./architecture.ts";
import { type RejectCode, closeDecision, noteAttempt, overrideDecision } from "./claim-trace.ts";
import { provenanceLabel } from "./cite.ts";
import { evidenceFitsShape, shapeGap, shapeOf } from "./intent.ts";
import { isArchitectureQuery } from "./question.ts";
import { contentWords, normalizeSpokenQuestion } from "./spoken.ts";
import { admissible, explain, mentions, provenanceOf, subjectTerms } from "./subject.ts";
import { type Prose, capabilityList, plain, proseOf } from "./prose.ts";
import { lineInFile } from "./retrieve.ts";
import { sayable } from "./say.ts";

/**
 * A claim, and the exact place it was read from. The claim is always a sentence
 * the evidence already wrote — never a sequence this code inferred.
 */
type Claim = { say: string; path: string; line: number; generic: boolean; head: boolean };

/** A lead-in ending in a preposition flows into its list; a noun needs the colon. */
const DANGLING = /\b(for|to|of|with|including|includes|in|on|by|from|are|is|does)$/i;

/** Turns written prose into one spoken claim, or nothing. */
function claimFrom(prose: Prose): { say: string; generic: boolean } | null {
  // A capability list is the honest answer at the fidelity the file supports,
  // but it describes a whole surface — so it is the generic answer.
  if (prose.capabilities.length >= 2) {
    const list = capabilityList(prose.capabilities);
    if (prose.listLead) {
      const joiner = DANGLING.test(prose.listLead) ? " " : ": ";
      return { say: `${prose.listLead}${joiner}${list}.`, generic: true };
    }
    if (prose.description) return { say: `${trimTail(prose.description)} — ${list}.`, generic: true };
    return { say: `It manages ${list}.`, generic: true };
  }
  return prose.description ? { say: prose.description, generic: false } : null;
}

function overlap(haystack: string, terms: string[]): number {
  const body = haystack.toLowerCase();
  return terms.filter((term) => mentions(body, term)).length;
}

/**
 * The claim for a hit, read from the cited span first. A docstring often sits
 * above the matched lines, so the file head is the second try — and when the
 * claim comes from there, the citation moves to line 1 so it points at the
 * sentence actually spoken.
 */
function claimsFor(hit: Hit, pack: RepoPack, query: string): Claim[] {
  const out: Claim[] = [];
  const file = pack.files.find((f) => f.path === hit.path);

  const consider = (
    source: { path: string; content: string } | null,
    origin: "span" | "head",
    line: number,
    duplicateOf?: string,
  ) => {
    if (!source) return;
    const prose = proseOf(source);
    const claim = prose ? claimFrom(prose) : null;
    const note = (reject: RejectCode | null, candidate = claim?.say ?? "") =>
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
    if (!prose) return note("NO_PROSE");
    if (!claim) return note("NO_SPEAKABLE_SENTENCE");
    if (duplicateOf !== undefined && claim.say === duplicateOf) return note("DUPLICATE");
    if (!looksSpoken(claim.say)) {
      return note(claim.say.split(/\s+/).filter(Boolean).length < 4 ? "TOO_SHORT" : "STRUCTURAL_ONLY");
    }
    out.push({ ...claim, path: source.path, line, head: origin === "head" });
  };

  consider({ path: hit.path, content: hit.text }, "span", hit.startLine);
  const fromSpan = out[0]?.say;
  consider(file ?? null, "head", 1, fromSpan);
  return out;
}

/**
 * Of the speakable claims in the ranked evidence, the one that answers *this*
 * question: the file it came from should be on topic, and a description of one
 * behavior beats a whole-surface capability list.
 */
function bestClaim(
  ordered: Hit[],
  pack: RepoPack,
  query: string,
  canonical: string,
): { claim: Claim; hit: Hit } | null {
  // Subject selection reads the canonical question: filler is rare in code and
  // would otherwise look like the most discriminating word in the sentence.
  const terms = contentWords(canonical);
  const subject = subjectTerms(terms, pack);
  const eligible: Array<{ claim: Claim; hit: Hit; relevance: number; score: number }> = [];
  for (const hit of ordered) {
    for (const claim of claimsFor(hit, pack, query)) {
      const relevance = overlap(claim.path, terms) * 3 + overlap(claim.say, terms);
      // A module docstring describes the whole thing; a docstring buried
      // mid-file describes one function. Prefer purpose when they tie.
      const score = relevance - (claim.generic ? 2 : 0) + (claim.head ? 1 : 0);
      // Ranking may use every signal, path included. Admission may not: a claim
      // whose only tie to the question is a low-information word is evidence
      // that sits somewhere relevant and says nothing relevant.
      const provenance = provenanceOf(terms, subject, claim.say, claim.path);
      if (!admissible(provenance)) {
        noteAttempt({
          query, path: claim.path, line: claim.line, origin: claim.head ? "head" : "span",
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
        query, path: item.claim.path, line: item.claim.line,
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
      query, path: item.claim.path, line: item.claim.line,
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

function hitFromFile(file: { path: string; content: string }): Hit {
  return {
    id: `${file.path}:1`,
    kind: "code",
    path: file.path,
    startLine: 1,
    endLine: Math.min(28, file.content.split("\n").length),
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
  hits: Hit[],
  pack: RepoPack,
  latencyMs: number,
  openFile?: string | null,
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

  const ordered = [preferred, ...codeHits, ...seeded].filter(Boolean) as Hit[];
  const picked = bestClaim(ordered, pack, query, canonical);
  const claim = picked?.claim ?? null;
  const code = picked?.hit ?? ordered[0];

  let say = claim ? sayable(twoSentences(claim.say) ?? "") : "";
  if (claim && !say) {
    // The claim was chosen and then lost on the way to being spoken: either it
    // could not be cut at a sentence boundary, or it was pure filler.
    noteAttempt({
      query, path: claim.path, line: claim.line, origin: claim.head ? "head" : "span",
      candidate: claim.say, generic: claim.generic, relevance: 0, score: 0,
      accepted: false, reject: twoSentences(claim.say) ? "NO_SPEAKABLE_SENTENCE" : "TOO_LONG",
    });
  }
  // A commit or ADR message is written evidence too, and it states the change.
  if (!say && why?.message) {
    const message = plain(why.message);
    if (looksSpoken(message)) say = sayable(twoSentences(message) ?? "");
  }
  if (!say) {
    closeDecision(query, false);
    return {
      say: null,
      reason: "Found the file, but nothing in it I would say out loud.",
      citations: [
        { path: code.path, line: code.startLine, sha: code.sha, pr: code.pr, label: provenanceLabel(code) },
      ],
      query,
      latencyMs,
      source: "local",
    };
  }
  // The first citation points at the sentence that was spoken.
  const citations = [
    {
      path: claim?.path ?? code.path,
      line: claim?.line ?? code.startLine,
      sha: code.sha,
      pr: code.pr,
      label: provenanceLabel(code),
    },
  ];
  // No second citation. The spoken line was read from one file, so any other
  // file on the Card is a chip the room can click and find nothing behind —
  // provenance for a claim it does not carry. Corroboration would have to be
  // proven, not assumed, and a single exact citation is the stronger promise.
  closeDecision(query, true);
  return {
    say,
    citations,
    query,
    latencyMs,
    source: "local",
  };
}

/** True when retrieval actually ranked something under one of these paths. */
function supported(hits: Hit[], ...paths: string[]): boolean {
  return hits.some((hit) => paths.some((path) => hit.path === path || hit.path.startsWith(path)));
}

function northstarCard(query: string, hits: Hit[], pack: RepoPack, latencyMs: number): Card {
  const q = query.toLowerCase();
  const auth = hits.find((h) => h.path.includes("auth") || (h.message ?? "").toLowerCase().includes("auth"));
  const format = hits.find((h) => h.path.includes("format"));
  const quiet: Card = { say: null, citations: [], query, latencyMs, source: "local" };

  if (/five|5 times|raise/.test(q) && /retry|retries|gateway|timeout/.test(q)) {
    if (!supported(hits, "src/exporter/retry.ts", "docs/adr/0007-exporter-retries.md")) return quiet;
    return {
      say: "Raising it to five would not fix gateway stalls — we fail to the dead-letter queue after three, on purpose.",
      citations: [
        {
          path: "docs/adr/0007-exporter-retries.md",
          line: 18,
          sha: "a3f91c2",
          pr: "842",
          label: "ADR 0007 · PR #842",
        },
      ],
      query,
      latencyMs,
      source: "local",
    };
  }

  if (/\bretry|three|3 times|attempts|backoff/.test(q)) {
    if (!supported(hits, "src/exporter/retry.ts", "docs/adr/0007-exporter-retries.md")) return quiet;
    const why = pack.commits.find((c) => c.pr === "842") ?? pack.commits[0];
    const line = lineInFile(pack, "src/exporter/retry.ts", "MAX_ATTEMPTS = 3");
    return {
      say: "Three on purpose — we capped it after payment gateway timeouts in March, not a generic backoff.",
      citations: [
        {
          path: "src/exporter/retry.ts",
          line,
          sha: why.sha,
          pr: why.pr,
          label: `PR #${why.pr} · ${why.sha}`,
        },
        {
          path: "docs/adr/0007-exporter-retries.md",
          line: 1,
          sha: why.sha,
          pr: why.pr,
          label: "ADR 0007 · PAY-219",
        },
      ],
      query,
      latencyMs,
      source: "local",
    };
  }

  if (/exporter|settlement|csv|column/.test(q)) {
    if (!supported(hits, "src/exporter")) return quiet;
    const commit = pack.commits.find((c) => c.files.some((f) => f.includes("exporter"))) ?? pack.commits[0];
    const path = format?.path ?? "src/exporter/format.ts";
    return {
      say: "We locked the settlement CSV columns and capped exporter retries after the March timeouts.",
      citations: [
        {
          path,
          line: format?.startLine ?? lineInFile(pack, path, "SETTLEMENT_COLUMNS"),
          sha: commit.sha,
          pr: commit.pr,
          label: commit.pr ? `PR #${commit.pr}` : commit.sha,
        },
      ],
      query,
      latencyMs,
      source: "local",
    };
  }

  if (/auth|cookie|session|who touched/.test(q) && (auth || q.includes("auth"))) {
    if (!supported(hits, "src/auth")) return quiet;
    const commit =
      pack.commits.find((c) => c.pr === "640") ?? pack.commits.find((c) => c.files.some((f) => f.includes("auth")));
    return {
      say: "Jordan Lee last moved the auth flow — session cookies rotate in edge middleware.",
      citations: [
        {
          path: "src/auth/flow.ts",
          line: 1,
          sha: commit?.sha,
          pr: commit?.pr,
          label: `${commit?.author ?? "Jordan Lee"} · PR #${commit?.pr ?? "640"}`,
        },
      ],
      query,
      latencyMs,
      source: "local",
    };
  }

  if (hits.length === 0) {
    return { say: null, citations: [], query, latencyMs, source: "local" };
  }

  const top = hits[0];
  return {
    say: null,
    reason: "No citation I would say out loud.",
    citations: [
      {
        path: top.path,
        line: top.startLine,
        sha: top.sha,
        pr: top.pr,
        label: provenanceLabel(top),
      },
    ],
    query,
    latencyMs,
    source: "local",
  };
}

export function questionChips(pack: RepoPack): string[] {
  if (pack.id === "northstar-payments") {
    return [
      "What is the architecture of this application?",
      "What did we change in the exporter?",
      "Why does that retry three times?",
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
function holdToShape(card: Card, hits: Hit[], canonical: string): Card {
  if (!card.say) return card;
  const shape = shapeOf(canonical);
  const citedWhy = hits.some(
    (hit) => hit.kind === "why" && card.citations.some((cite) => cite.path === hit.path),
  );
  if (evidenceFitsShape(shape, card.say, citedWhy)) return card;
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
  if (shapeOf(canonical) === "absence") {
    overrideDecision(query, "WRONG_SHAPE");
    const top = hits[0];
    return {
      say: null,
      reason: shapeGap("absence"),
      citations: top
        ? [{ path: top.path, line: top.startLine, sha: top.sha, pr: top.pr, label: provenanceLabel(top) }]
        : [],
      query,
      latencyMs,
      source: "local",
    };
  }
  return holdToShape(compose(query, canonical, hits, pack, latencyMs, openFile), hits, canonical);
}

function compose(
  query: string,
  canonical: string,
  hits: Hit[],
  pack: RepoPack,
  latencyMs: number,
  openFile?: string | null,
): Card {
  if (pack.id === "northstar-payments") {
    const scripted = northstarCard(query, hits, pack, latencyMs);
    if (scripted.say) return scripted;
  }
  if (isArchitectureQuery(canonical)) {
    const structural = architectureCard(pack, query, latencyMs, hits);
    if (structural.say) return structural;
  }
  return genericLocalCard(query, canonical, hits, pack, latencyMs, openFile);
}
