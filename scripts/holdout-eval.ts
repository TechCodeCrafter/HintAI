/**
 * Natural-language holdout evaluation.
 *
 * The benchmark that drove the last three passes is written in clean question
 * grammar, and that is exactly why it read 0% wrong-intent while a live call
 * leaked: "How are we testing the application?" and "We're not testing this at
 * all, right?" are the same question and score differently, because filler
 * changes the term statistics. This set is spoken English — fillers, tags,
 * negation, hesitation, pronouns, follow-ups, repeats, self-correction and ASR
 * punctuation drift — and it is a holdout: nothing here was used to build or
 * tune the gate, the subject rule, retrieval or the composer.
 *
 * Read-only. It mirrors the live path (gate, then retrieve, then compose) so a
 * follow-up resolves against its thread the way it does on a call.
 *
 * node --experimental-strip-types scripts/holdout-eval.ts
 */
import { readFileSync } from "node:fs";
import type { Card, RepoPack } from "../src/lib/repo/types.ts";
import { claimDecisions, closeDecision, traceClaims } from "../src/lib/search/claim-trace.ts";
import { shapeOf } from "../src/lib/search/intent.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { gateNewest } from "../src/lib/search/question.ts";
import { buildChunks, packVocabulary, retrieve } from "../src/lib/search/retrieve.ts";
import { contentWords, normalizeSpokenQuestion } from "../src/lib/search/spoken.ts";
import { threadFrom, withdrawReplay, type ThreadContext } from "../src/lib/search/thread.ts";
import { subjectTerms } from "../src/lib/search/subject.ts";

const pack: RepoPack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));
const chunks = buildChunks(pack);
const vocab = packVocabulary(chunks);

/**
 * `context` is what the room said before this line, oldest first, so follow-ups
 * and pronouns resolve as they do live. `answerable` is set by reading the repo,
 * not by watching what GROUND does — it is the denominator for coverage and must
 * never be inferred from the composer's own behaviour.
 */
type Probe = {
  q: string;
  note: string;
  context?: string[];
  answerable: boolean;
};

const HOLDOUT: Probe[] = [
  // --- negation + confirmation tag (the live failure family) -----------------
  { q: "So we're not actually testing this anywhere, right?", note: "negation + tag + filler", answerable: false },
  { q: "Wait, this isn't persisted anywhere?", note: "hesitation + negation + pronoun", answerable: false },
  { q: "Do we even have tests around this?", note: "existence + 'even'", answerable: false },
  { q: "there's no retry logic here is there", note: "no punctuation, negation, tag", answerable: false },

  // --- failure / error path --------------------------------------------------
  { q: "Okay, so what happens when that thing blows up?", note: "filler + slang failure", answerable: false },
  {
    q: "Right, but what happens if that fails halfway through?",
    note: "filler + conditional failure",
    answerable: false,
  },
  { q: "and if the upload times out?", note: "elliptical failure follow-up", context: ["Where are we actually doing the upload?"], answerable: false },

  // --- why / rationale ------------------------------------------------------
  { q: "So why did we do it this way?", note: "filler + rationale + pronoun", answerable: false },
  { q: "why is that in a container though", note: "rationale, no punctuation", answerable: false },

  // --- where / location -----------------------------------------------------
  { q: "Where are we actually doing the upload?", note: "filler 'actually'", answerable: true },
  { q: "So where does the Excel actually get written?", note: "filler + where", answerable: true },
  { q: "Basically, what owns this flow?", note: "filler 'basically' + pronoun", answerable: true },

  // --- what / how, conversational -------------------------------------------
  { q: "So this service is doing all of it?", note: "confirmation, no negation", answerable: true },
  { q: "Okay so what does the BDA worker actually do?", note: "filler + real subject", answerable: true },
  { q: "what's the ingest worker for", note: "no punctuation, 'for'", answerable: true },
  { q: "So how does the Excel export actually work?", note: "filler + how", answerable: true },
  { q: "how do we pull the attributes out", note: "colloquial phrasing", answerable: true },
  { q: "Um, what does the session service do again?", note: "hesitation + 'again'", answerable: true },
  { q: "So the in-memory repo — what's that for?", note: "dash aside", answerable: true },
  { q: "what does document_processing_service.py do", note: "spoken filename", answerable: true },

  // --- self-correction ------------------------------------------------------
  {
    q: "So how does the upload — sorry, how does the extraction work?",
    note: "self-correction mid-sentence",
    answerable: true,
  },
  {
    q: "Where's the config — I mean the template config?",
    note: "self-correction",
    answerable: true,
  },

  // --- follow-ups and pronouns ---------------------------------------------
  {
    q: "And after that?",
    note: "bare follow-up",
    context: ["Okay so what does the BDA worker actually do?"],
    answerable: false,
  },
  {
    q: "So where is that stored?",
    note: "pronoun follow-up",
    context: ["So how does the Excel export actually work?"],
    answerable: true,
  },
  { q: "Why though?", note: "terse rationale follow-up", context: ["So this service is doing all of it?"], answerable: false },

  // --- repeats --------------------------------------------------------------
  {
    q: "So how does the Excel export actually work?",
    note: "repeat of an earlier question",
    context: ["So how does the Excel export actually work?", "Okay."],
    answerable: true,
  },

  // --- ASR punctuation drift on a good question ----------------------------
  { q: "so how does the excel export actually work", note: "lowercase, unpunctuated", answerable: true },
  { q: "What does the ec2 bridge do?!", note: "doubled terminal punctuation", answerable: true },

  // --- chatter and off-topic controls --------------------------------------
  { q: "Can you hear me okay?", note: "chatter control", answerable: false },
  { q: "So what's the weather like over there?", note: "off-topic control", answerable: false },
];

/** Every spoken word must exist in the cited material. Strict, as in the bench. */
function supportedBy(card: Card): boolean {
  if (!card.say) return true;
  if (!card.citations.length) return false;
  const cited = [
    ...card.citations.map((c) => pack.files.find((f) => f.path === c.path)?.content ?? ""),
    pack.files.map((f) => f.path.replace(/[/_.-]/g, " ")).join(" "),
    pack.name,
  ]
    .join("\n")
    .toLowerCase();
  const words = card.say
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9_]+|[^a-z0-9_]+$/g, ""))
    .filter((w) => w.length > 3);
  const GLUE =
    /^(this|that|these|those|with|from|into|plus|more|also|which|their|there|then|when|about|manages|split|across|work|one|two|three|four|five|six|seven|eight|nine)$/;
  return words.filter((w) => !cited.includes(w) && !GLUE.test(w)).length === 0;
}

/**
 * How much of the spoken line each citation could account for. Reported rather
 * than thresholded: judging "does this chip earn its place" is the reviewer's
 * call, and a low number on a multi-clause claim can still be legitimate.
 */
function citationOverlap(card: Card): string {
  if (!card.say) return "n/a";
  const claimWords = contentWords(card.say);
  return card.citations
    .map((cite) => {
      const body = (pack.files.find((f) => f.path === cite.path)?.content ?? "").toLowerCase();
      const hit = claimWords.filter((w) => body.includes(w)).length;
      return `${cite.path.split("/").pop()} ${hit}/${claimWords.length}`;
    })
    .join("  ");
}

traceClaims(true);

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

type Row = Probe & {
  asked: string | null;
  verdict: string;
  shape: string;
  subject: string[];
  evidence: string;
  admission: string;
  card: Card | null;
  supported: boolean;
};

const rows: Row[] = [];

console.log("=".repeat(112));
console.log("NATURAL-LANGUAGE HOLDOUT   real repo: rdb-labsai-backend   (read-only)");
console.log("=".repeat(112));

/**
 * Runs one utterance exactly as the store does: gate, then retrieve and compose
 * on the canonical question, then the replay guard. Returned so the harness can
 * play a probe's context through the same path and arrive at the thread the live
 * app would be holding.
 */
function run(text: string, context: string[], thread: ThreadContext | null) {
  const decision = gateNewest({ id: text, text }, context, {
    vocab,
    threadOpen: Boolean(thread),
    thread,
  });
  const asked = decision.question;
  if (!asked) return { decision, asked, canonical: null, shape: "-", subject: [] as string[], hits: [], card: null };
  const canonical = normalizeSpokenQuestion(asked).canonical;
  const shape = shapeOf(canonical);
  const subject = subjectTerms(contentWords(canonical), pack);
  const hits = retrieve(canonical, chunks);
  const composed = localCard(asked, hits, pack, 0, null);
  const card = withdrawReplay(composed, thread, decision.verdict === "follow-up");
  return { decision, asked, canonical, shape, subject, hits, card };
}

/** The thread the room would be holding by the time this probe is spoken. */
function threadFor(context: string[]): ThreadContext | null {
  let thread: ThreadContext | null = null;
  for (const line of context) {
    const step = run(line, [], thread);
    if (!step.asked || !step.canonical) continue;
    if (step.card?.say) {
      thread =
        threadFrom({
          utteranceId: line,
          canonical: step.canonical,
          shape: step.shape as ReturnType<typeof shapeOf>,
          subject: step.subject,
          card: step.card,
        }) ?? thread;
    } else if (step.decision.verdict === "question") {
      // A self-contained question that answered nothing ends the thread.
      thread = null;
    }
  }
  return thread;
}

for (const probe of HOLDOUT) {
  const context = probe.context ?? [];
  // The thread is built by replaying the context through the real pipeline, so a
  // pointer resolves against an answer that was actually produced.
  const thread = threadFor(context);
  const { decision } = run(probe.q, context, thread);
  const asked = decision.question;

  let shape = "-";
  let subject: string[] = [];
  let evidence = "none";
  let admission = "gate stopped it";
  let card: Card | null = null;

  const spoken = asked ? normalizeSpokenQuestion(asked) : null;
  if (asked && spoken) {
    const step = run(probe.q, context, thread);
    shape = step.shape;
    subject = step.subject;
    const top = step.hits[0];
    evidence = top ? `${top.path}:${top.startLine} (${top.score.toFixed(1)})` : "none";
    card = step.card;
    const traced = claimDecisions().at(-1);
    const mine = traced?.query === asked ? traced : closeDecision(asked, Boolean(card?.say));
    admission = card?.say ? "admitted" : (card?.reason?.includes("same answer") ? "REPLAY WITHDRAWN" : mine?.reason ?? "silent");
  }

  const supported = card ? supportedBy(card) : true;
  rows.push({ ...probe, asked, verdict: decision.verdict, shape, subject, evidence, admission, card, supported });

  console.log(`\nRAW         "${probe.q}"`);
  console.log(`  note        ${probe.note}`);
  console.log(`  gate        ${decision.verdict}${asked && asked !== probe.q ? ` -> "${asked}"` : ""}`);
  if (spoken) {
    console.log(`  CANONICAL   "${spoken.canonical}"`);
    if (spoken.removed.length) console.log(`  removed     [${spoken.removed.join(", ")}]`);
    if (spoken.repairs.length) console.log(`  repaired    ${spoken.repairs.join(" | ")}`);
  }
  // Reference resolution, so a "that" or "this service" can be audited.
  if (thread) console.log(`  thread      subject [${thread.subject.join(", ")}] entities [${thread.entities.join(", ")}]`);
  const resolution = decision.resolution;
  if (resolution?.reference) {
    console.log(`  reference   "${resolution.reference}" (${resolution.kind})`);
    console.log(`  resolved    ${resolution.resolved ? `"${resolution.resolved}"` : "UNRESOLVED"} — ${resolution.reason}`);
    if (resolution.question) console.log(`  QUESTION    "${resolution.question}"`);
  }
  console.log(`  shape       ${shape}`);
  console.log(`  subject     ${subject.length ? subject.join(", ") : "none"}`);
  console.log(`  retrieval   ${spoken ? `"${spoken.canonical}"` : "-"}`);
  console.log(`  evidence    ${evidence}`);
  console.log(`  admission   ${admission}`);
  if (card?.say) {
    console.log(`  CARD        "${card.say}"`);
    console.log(`  citations   ${card.citations.map((c) => `${c.path}:${c.line}`).join(", ")}`);
    console.log(`  cite cover  ${citationOverlap(card)}`);
    console.log(`  supported   ${supported ? "yes" : "NO — UNSUPPORTED"}`);
  } else {
    console.log(`  SILENT      ${card?.reason ?? "(no card)"}`);
    if (card?.citations.length) {
      console.log(`  looked at   ${card.citations.map((c) => `${c.path}:${c.line}`).join(", ")}`);
    }
  }
}

const spoke = rows.filter((r) => r.card?.say);
const answerable = rows.filter((r) => r.answerable);
const unanswerable = rows.filter((r) => !r.answerable);
const rate = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`);

console.log(`\n${"=".repeat(112)}`);
console.log("HOLDOUT SUMMARY");
console.log("=".repeat(112));
console.log(`  total utterances                    ${rows.length}`);
console.log(`  reached retrieval                   ${rows.filter((r) => r.asked).length}`);
console.log(`  answerable from the material        ${answerable.length}`);
console.log(`  cards produced                      ${spoke.length}`);
console.log("");
const leaks = unanswerable.filter((r) => r.card?.say);
const unsupported = spoke.filter((r) => !r.supported);
const falseSilence = answerable.filter((r) => !r.card?.say);
console.log(`  WRONG-INTENT CARD RATE              ${rate(leaks.length, unanswerable.length)}  (${leaks.length}/${unanswerable.length})`);
console.log(`  UNSUPPORTED CARD RATE               ${rate(unsupported.length, spoke.length)}  (${unsupported.length}/${spoke.length})`);
console.log(`  FALSE-SILENCE RATE                  ${rate(falseSilence.length, answerable.length)}  (${falseSilence.length}/${answerable.length})`);
console.log(`  SUPPORTED-OPPORTUNITY HIT RATE      ${rate(answerable.length - falseSilence.length, answerable.length)}`);

if (leaks.length) {
  console.log(`\n  WRONG-INTENT LEAKS`);
  for (const r of leaks) {
    console.log(`    [${r.shape}] "${r.q}"`);
    console.log(`         -> "${r.card?.say}"`);
  }
}
if (unsupported.length) {
  console.log(`\n  UNSUPPORTED CARDS`);
  for (const r of unsupported) console.log(`    "${r.q}" -> "${r.card?.say}"`);
}
if (falseSilence.length) {
  console.log(`\n  SILENT BUT ANSWERABLE  (candidates for false silence)`);
  for (const r of falseSilence) {
    console.log(`    [${pad(r.admission, 20)}] "${r.q}"`);
    console.log(`         gate ${r.verdict} | shape ${r.shape} | subject ${r.subject.join(",") || "none"} | ${r.evidence}`);
  }
}

const byStage = new Map<string, number>();
for (const r of rows) {
  const stage = !r.asked
    ? r.answerable
      ? "INTENT (gate stopped a real question)"
      : "LEGITIMATE SILENCE (gate)"
    : r.card?.say
      ? r.answerable
        ? "OK (answered)"
        : "INTENT or SUBJECT ADMISSION (wrong-intent leak)"
      : r.answerable
        ? `FALSE SILENCE via ${r.admission}`
        : "LEGITIMATE SILENCE";
  byStage.set(stage, (byStage.get(stage) ?? 0) + 1);
}
console.log(`\n  STAGE DISTRIBUTION`);
for (const [stage, n] of [...byStage].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${pad(stage, 46)} ${n}`);
}
