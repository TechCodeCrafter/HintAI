import assert from "node:assert/strict";
import { test } from "node:test";

import type { Card, IndexedChunk, RepoPack } from "../../repo/types.ts";
import { isFileHit } from "../../repo/types.ts";
import { routeSearchAnswer } from "../answer-route.ts";
import { PROMPT_TURNS, buildSynthesisPrompt, buildWeakEvidencePrompt, historyBlock } from "../generate-answer.ts";
import { localCard } from "../local-card.ts";
import {
  FOLLOW_UP_WINDOW_MS,
  MEMORY_TURNS,
  type MemoryTurn,
  THREAD_HIT_FLOOR,
  expandThread,
  followUpQuery,
  isThreadFollowUp,
  leansOnThread,
  memoryForPrompt,
  rememberTurn,
  threadChunks,
  withdrawRepeat,
} from "../meeting-memory.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

const EXPORT = `/**
 * Retries a failed export up to three times with exponential backoff.
 */
export function retryExport(job: Job) {
  return schedule(job, 3);
}

/**
 * Error handling for exports: a timeout is retried, and a validation error fails the job at once.
 */
export function classifyError(error: ExportError) {
  return error.kind === "timeout" ? "retry" : "fail";
}
`;

const AUTH = `/**
 * Error handling for sign-in: a bad password locks the account after five attempts.
 */
export function onSignInError(user: User) {
  return lockout.bump(user);
}

/**
 * Sessions are stored in an encrypted cookie that expires after twelve hours.
 */
export function issueSession(user: User) {
  return cookie.seal(user);
}
`;

const pack: RepoPack = {
  id: "memory",
  name: "memory",
  description: "",
  commits: [],
  files: [
    { path: "src/export/retry.ts", language: "ts", content: EXPORT },
    { path: "src/auth/session.ts", language: "ts", content: AUTH },
  ],
};
const chunks = buildChunks(pack);

function compose(question: string, from: IndexedChunk[] = chunks): Card {
  return localCard(question, retrieve(question, from).filter(isFileHit), pack, 1, null);
}

function spoken(question: string, at = 1_000): MemoryTurn[] {
  const card = compose(question);
  assert.ok(card.say, question);
  return rememberTurn([], { query: question, canonical: question, card, at });
}

/** The store's thread lookup, with the real retrieval and the real route. */
function expand(question: string, turns: MemoryTurn[], opts: { resolved?: boolean; now?: number } = {}) {
  let modelCalls = 0;
  return expandThread({
    canonical: question,
    turns,
    chunks,
    resolved: opts.resolved,
    now: opts.now ?? 2_000,
    retrieve: (query, scoped) => retrieve(query, scoped),
    answer: (hits) =>
      routeSearchAnswer(question, hits, 0, {
        pack,
        localOnly: "thread",
        ask: async () => {
          modelCalls += 1;
          return { text: "INSUFFICIENT" };
        },
      }),
  }).then((result) => ({ result, modelCalls }));
}

test("only an answer that was spoken is remembered, newest first, three at most", () => {
  const silent: Card = { say: null, reason: "Nothing.", citations: [], query: "q", latencyMs: 0, source: "local" };
  assert.deepEqual(rememberTurn([], { query: "q", canonical: "q", card: silent }), []);

  let turns: MemoryTurn[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const card: Card = {
      say: `Answer ${i}.`,
      citations: [{ kind: "file", path: `src/f${i}.ts`, line: 1, label: "" }],
      query: `Question ${i}?`,
      latencyMs: 0,
      source: "local",
    };
    turns = rememberTurn(turns, { query: card.query, canonical: card.query, card, at: i });
  }
  assert.equal(turns.length, MEMORY_TURNS);
  assert.deepEqual(turns.map((t) => t.question), ["Question 5?", "Question 4?", "Question 3?"]);
  assert.deepEqual(turns[0].files, ["src/f5.ts"]);
  assert.equal(turns[0].answer, "Answer 5.");
});

test("the same question answered the same way again is one turn, moved to the front", () => {
  const card = (n: number, say = `Answer ${n}.`): Card => ({
    say,
    citations: [{ kind: "file", path: `src/f${n}.ts`, line: 1, label: "" }],
    query: `Question ${n}?`,
    latencyMs: 0,
    source: "local",
  });
  let turns: MemoryTurn[] = [];
  for (const n of [1, 2, 3]) turns = rememberTurn(turns, { query: `Question ${n}?`, canonical: `Question ${n}?`, card: card(n), at: n });
  // Asked again, in different capitals: nothing is pushed out.
  turns = rememberTurn(turns, { query: "question 2?", canonical: "question 2?", card: card(2), at: 4 });
  assert.deepEqual(turns.map((t) => [t.canonical, t.at]), [["question 2?", 4], ["Question 3?", 3], ["Question 1?", 1]]);
  // The same question with a different answer is a new turn.
  turns = rememberTurn(turns, { query: "Question 2?", canonical: "Question 2?", card: card(2, "A different answer."), at: 5 });
  assert.deepEqual(turns.map((t) => t.answer), ["A different answer.", "Answer 2.", "Answer 3."]);
});

test("the model is shown the last three questions with their answers, marked as not evidence", () => {
  let turns: MemoryTurn[] = [];
  for (let i = 1; i <= 4; i += 1) {
    const card: Card = { say: `Answer ${i}.`, citations: [], query: `Question ${i}?`, latencyMs: 0, source: "local" };
    turns = rememberTurn(turns, { query: card.query, canonical: card.query, card, at: i });
  }
  const context = memoryForPrompt(turns);
  assert.equal(PROMPT_TURNS, 3);
  assert.deepEqual(context, [
    { question: "Question 2?", answer: "Answer 2." },
    { question: "Question 3?", answer: "Answer 3." },
    { question: "Question 4?", answer: "Answer 4." },
  ]);
  const block = historyBlock(undefined, context);
  assert.match(block, /Not evidence/);
  assert.match(block, /Q: Question 4\?\nA: Answer 4\./);
  assert.ok(!block.includes("Question 1?"));
  // Oldest first, so the newest turn sits nearest the question.
  assert.ok(block.indexOf("Question 2?") < block.indexOf("Question 4?"));

  const hits = retrieve("How many times is a failed export retried?", chunks);
  assert.match(buildSynthesisPrompt("And the error handling?", hits, undefined, context), /Q: Question 3\?/);
  assert.match(buildWeakEvidencePrompt("And the error handling?", hits, [], undefined, context), /A: Answer 3\./);
  // With nothing remembered the grounded prompt is exactly what it was.
  assert.equal(
    buildSynthesisPrompt("How many?", hits, undefined, []),
    buildSynthesisPrompt("How many?", hits),
  );
});

test("the questions-only fallback is held to three as well", () => {
  const block = historyBlock(["q1", "q2", "q3", "q4"]);
  assert.ok(block.includes("- q3"));
  assert.ok(!block.includes("- q4"));
});

test("a follow-up is wording that leans on the thread, while the thread is recent", () => {
  const turns = spoken("How many times is a failed export retried?", 1_000);
  assert.equal(leansOnThread("What about the error handling?"), true);
  assert.equal(leansOnThread("and the error handling"), true);
  assert.equal(leansOnThread("So how about timeouts?"), true);
  assert.equal(leansOnThread("When does a session cookie expire?"), false);
  assert.equal(leansOnThread("And when does a session cookie expire?"), false);

  assert.equal(isThreadFollowUp("What about the error handling?", turns, { now: 2_000 }), true);
  assert.equal(isThreadFollowUp("When does a session cookie expire?", turns, { now: 2_000 }), false);
  // The gate already resolved a pointer against the thread.
  assert.equal(isThreadFollowUp("what happens after export retried", turns, { now: 2_000, resolved: true }), true);
  // Nothing remembered, or the last answer is too old to lean on.
  assert.equal(isThreadFollowUp("What about the error handling?", [], { now: 2_000 }), false);
  assert.equal(
    isThreadFollowUp("What about the error handling?", turns, { now: 1_000 + FOLLOW_UP_WINDOW_MS + 1 }),
    false,
  );
  // "What about that?" has no words of its own to look up.
  assert.equal(isThreadFollowUp("What about that?", turns, { now: 2_000 }), false);
  assert.equal(followUpQuery("What about the error handling?"), "the error handling?");
  assert.equal(followUpQuery("and the error handling"), "the error handling");
});

test("the thread's chunks are the chunks of the files it cited", () => {
  const turns = spoken("How many times is a failed export retried?");
  const scoped = threadChunks(chunks, turns);
  assert.ok(scoped.length > 0);
  assert.ok(scoped.length < chunks.length);
  assert.ok(scoped.every((chunk) => chunk.path === "src/export/retry.ts"));
  assert.deepEqual(threadChunks(chunks, []), []);
});

test("a follow-up is answered from the file the thread cited, not from the best match anywhere", async () => {
  const turns = spoken("How many times is a failed export retried?");
  const { result, modelCalls } = await expand("What about the error handling?", turns);
  assert.ok(result, "the thread's file answers it");
  assert.equal(modelCalls, 0);
  assert.match(result.answered.card.say ?? "", /a timeout is retried/);
  assert.ok(result.hits.every((hit) => hit.path === "src/export/retry.ts"));
  assert.ok(
    result.answered.card.citations.every((c) => c.kind === "file" && c.path === "src/export/retry.ts"),
  );
  assert.equal(result.query, "the error handling?");

  // The same words after a sign-in question stay with sign-in.
  const authTurns = spoken("When does a session cookie expire?");
  const auth = await expand("What about the error handling?", authTurns);
  assert.ok(auth.result);
  assert.match(auth.result.answered.card.say ?? "", /bad password/);
  // Searched from scratch, the same words land on whichever file ranks first.
  assert.match(compose("What about the error handling?").say ?? "", /a timeout is retried/);
});

test("a follow-up points at the newest turn first, and at an older turn only when the newest has nothing", async () => {
  // The meeting moved from exports to sign-in.
  const moved = [...spoken("When does a session cookie expire?", 1_500), ...spoken("How many times is a failed export retried?")];
  assert.deepEqual(moved.map((turn) => turn.files), [["src/auth/session.ts"], ["src/export/retry.ts"]]);

  const about = await expand("What about the error handling?", moved);
  assert.match(about.result?.answered.card.say ?? "", /bad password/, "both files write about error handling; the newest turn's file answers");
  assert.ok(about.result?.hits.every((hit) => hit.path === "src/auth/session.ts"));

  // Sign-in says nothing about timeouts, so the turn before is looked at.
  const older = await expand("What about a validation error that fails the job?", moved);
  assert.match(older.result?.answered.card.say ?? "", /a timeout is retried/);
  assert.ok(older.result?.hits.every((hit) => hit.path === "src/export/retry.ts"));

  // A line any remembered turn already spoke is not spoken again from the thread.
  assert.equal(compose("the exponential backoff for a failed export?").say, moved[1].answer);
  const heard = await expand("What about the exponential backoff for a failed export?", moved);
  assert.equal(heard.result, null);
  assert.equal(heard.modelCalls, 0);
});

test("a question that is not a follow-up is left to the full search", async () => {
  const turns = spoken("How many times is a failed export retried?");
  const { result } = await expand("When does a session cookie expire?", turns);
  assert.equal(result, null);
});

test("a follow-up the thread's files do not cover falls through to the full search", async () => {
  const turns = spoken("How many times is a failed export retried?");
  // Sessions are in the auth file, which this thread never cited.
  const { result, modelCalls } = await expand("What about the session cookie?", turns);
  assert.equal(result, null);
  assert.equal(modelCalls, 0);
  // The full search still answers it.
  assert.match(compose("What about the session cookie?").say ?? "", /encrypted cookie/);
});

test("a follow-up that would repeat the last answer is not taken from the thread", async () => {
  const turns = spoken("How many times is a failed export retried?");
  // The thread's file ranks strongly for it and the composer has a line, so
  // only the repeat check stands between the room and the same sentence.
  const question = "What about the failed export retries and backoff?";
  const scoped = threadChunks(chunks, turns);
  const hits = retrieve(followUpQuery(question), scoped);
  assert.ok((hits[0]?.score ?? 0) >= THREAD_HIT_FLOOR, `thread hit scored ${hits[0]?.score}`);
  assert.equal(compose(question, scoped).say, turns[0].answer);

  const { result } = await expand(question, turns);
  assert.equal(result, null);
});

test("a repeated line is withdrawn with a reason, and a new line is kept", () => {
  const turns = spoken("How many times is a failed export retried?");
  const same: Card = { say: turns[0].answer, citations: [], query: "q", latencyMs: 0, source: "local" };
  const withdrawn = withdrawRepeat(same, turns);
  assert.equal(withdrawn.say, null);
  assert.equal(withdrawn.reason, "That is the same answer I just gave. Nothing loaded takes it further.");
  const fresh: Card = { ...same, say: "A timeout is retried." };
  assert.equal(withdrawRepeat(fresh, turns), fresh);
  assert.equal(withdrawRepeat(same, []), same);
});

test("a thread older than the follow-up window is not expanded", async () => {
  const turns = spoken("How many times is a failed export retried?", 1_000);
  const { result } = await expand("What about the error handling?", turns, { now: 1_000 + FOLLOW_UP_WINDOW_MS + 5 });
  assert.equal(result, null);
});
