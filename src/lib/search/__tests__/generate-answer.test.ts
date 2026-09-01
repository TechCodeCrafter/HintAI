import assert from "node:assert/strict";
import { test } from "node:test";

import type { FileHit } from "../../repo/types.ts";
import {
  buildAnswerPrompt,
  citationsFromHits,
  generateAnswer,
  hitsGroundAnswer,
} from "../generate-answer.ts";

function hit(over: Partial<FileHit> & Pick<FileHit, "score" | "path" | "text">): FileHit {
  return {
    id: over.id ?? `${over.path}:1-8`,
    kind: "code",
    startLine: 4,
    endLine: 12,
    startOffset: 0,
    ...over,
  };
}

test("strong retrieval counts as evidence", () => {
  assert.equal(hitsGroundAnswer([]), false);
  assert.equal(hitsGroundAnswer([hit({ score: 2.5, path: "a.ts", text: "x" })]), false);
  assert.equal(hitsGroundAnswer([hit({ score: 4, path: "a.ts", text: "x" })]), true);
});

test("two hits in the same file become one citation", () => {
  const cites = citationsFromHits([
    hit({ score: 8, path: "src/exporter/retry.ts", text: "MAX_ATTEMPTS = 3", startLine: 12 }),
    hit({ score: 6, path: "src/exporter/retry.ts", text: "export retries", startLine: 4 }),
  ]);
  assert.equal(cites.length, 1);
  if (cites[0]?.kind === "file") {
    assert.equal(cites[0].path, "src/exporter/retry.ts");
    assert.equal(cites[0].line, 12);
  }
});

test("citations come from the top hits, not invented paths", () => {
  const cites = citationsFromHits([
    hit({ score: 8, path: "src/exporter/retry.ts", text: "MAX_ATTEMPTS = 3", startLine: 12 }),
    hit({ score: 5, path: "docs/adr.md", text: "retries", startLine: 8 }),
  ]);
  assert.equal(cites.length, 2);
  assert.equal(cites[0]?.kind, "file");
  if (cites[0]?.kind === "file") {
    assert.equal(cites[0].path, "src/exporter/retry.ts");
    assert.equal(cites[0].line, 12);
  }
});

test("generateAnswer sends query and prompt, not a raw hit payload", async () => {
  let seen: { query: string; instruction: string; task: string } | undefined;
  const result = await generateAnswer(
    "Tell me about your experience",
    [hit({ score: 8, path: "resume.md", text: "Backend engineer, five years.", startLine: 2 })],
    [],
    performance.now(),
    {
      ask: async (payload) => {
        seen = { query: payload.query, instruction: payload.instruction, task: payload.task };
        return { say: "I have spent five years as a backend engineer." };
      },
    },
  );
  assert.ok(result?.say);
  assert.ok(seen);
  assert.equal(seen.query, "Tell me about your experience");
  assert.equal(seen.task, "answer");
  assert.match(seen.instruction, /resume\.md/);
  assert.match(seen.instruction, /Backend engineer/);
});

test("generateAnswer speaks from the ask function, not from local evidence extraction", async () => {
  const result = await generateAnswer(
    "Why Python and not TypeScript?",
    [hit({ score: 8, path: "docs/stack.md", text: "The API stays Python because of the ML pipeline.", startLine: 3 })],
    [],
    performance.now(),
    {
      ask: async () => ({
        say: "We're on Python for the ML pipeline, and TypeScript stays on the frontend.",
      }),
    },
  );
  assert.ok(result?.say);
  assert.match(result.say, /Python/);
  assert.equal(result.usedEvidence, true);
  assert.equal(result.citations[0] && result.citations[0].kind === "file" ? result.citations[0].path : "", "docs/stack.md");
});

test("a missing API key is flagged instead of a silent miss", async () => {
  const result = await generateAnswer("What is MeetHint?", [], [], performance.now(), {
    modelId: "gpt-4o-mini",
    ask: async () => ({ say: null, reason: "Add API key" }),
  });
  assert.equal(result?.say, null);
  assert.equal(result?.missingKey, true);
  assert.equal(result?.modelName, "GPT-4o Mini");
});

test("timeouts are not treated as a missing key", async () => {
  const result = await generateAnswer("What is MeetHint?", [], [], performance.now(), {
    ask: async () => ({ say: null, reason: "timeout" }),
  });
  assert.equal(result?.missingKey, false);
});

test("generated answers carry the selected model name", async () => {
  const result = await generateAnswer(
    "What is MeetHint?",
    [],
    [],
    performance.now(),
    {
      modelId: "gpt-4o",
      ask: async (payload) => {
        assert.equal(payload.modelId, "gpt-4o");
        return { say: "MeetHint is a live meeting copilot." };
      },
    },
  );
  assert.equal(result?.say, "MeetHint is a live meeting copilot.");
  assert.equal(result?.modelName, "GPT-4o");
});

test("the answer prompt includes the question and retrieved files", () => {
  const prompt = buildAnswerPrompt(
    "Why does that retry three times?",
    [hit({ score: 8, path: "src/exporter/retry.ts", text: "Attempts are capped at three.", startLine: 4 })],
    ["Why does export fail?"],
  );
  assert.match(prompt, /Why does that retry three times/);
  assert.match(prompt, /src\/exporter\/retry\.ts:4/);
  assert.match(prompt, /Attempts are capped at three/);
  assert.match(prompt, /Why does export fail/);
  assert.match(prompt, /staff engineer/i);
  assert.match(prompt, /paraphrase/i);
  assert.match(prompt, /RETRIEVED FILES/);
  assert.match(prompt, /concrete component/);
});

test("lambda paths are listed as workers in the answer prompt", () => {
  const prompt = buildAnswerPrompt(
    "Why seven lambdas?",
    [
      hit({
        score: 8,
        path: "container-lambdas/bda-ingest-worker/app/lambda_function.py",
        text: "Consumes SQS from S3 ObjectCreated.",
        startLine: 1,
      }),
    ],
    [],
  );
  assert.match(prompt, /WORKERS IN THESE PATHS: bda-ingest-worker/);
  assert.match(prompt, /numbered list inside one function is not the fleet/);
});
