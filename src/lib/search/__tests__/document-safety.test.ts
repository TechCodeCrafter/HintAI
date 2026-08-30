import assert from "node:assert/strict";
import { test } from "node:test";

import type { DocumentChunk } from "../../document/types.ts";
import type { Card, Hit, RepoPack } from "../../repo/types.ts";
import { localCard } from "../local-card.ts";
import { refinePayload, shouldRefine } from "../refine-payload.ts";

const PACK: RepoPack = {
  id: "mixed",
  name: "mixed",
  description: "mixed",
  commits: [
    {
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      date: "2024-01-01",
      author: "Ada",
      message: "Touch the auth flow",
      files: ["src/auth/flow.ts"],
      pr: "12",
    },
  ],
  files: [
    {
      path: "src/retry.ts",
      language: "ts",
      content: "/** Renew the quorum lease. */\nexport const RETRIES = 3\n",
    },
  ],
};

function documentHit(overrides: Partial<DocumentChunk> & { score?: number } = {}): Hit {
  const chunk: DocumentChunk = {
    kind: "document",
    id: "src-doc:p1:0-40:hash-doc",
    sourceId: "src-doc",
    path: "Lecture-08.pdf",
    page: 1,
    startOffset: 0,
    endOffset: 40,
    text: "Serializable isolation prevents lost outcomes.",
    contentHash: "hash-doc",
    readingOrder: "single-column",
    heading: "Isolation",
  };
  return { ...chunk, score: 9, ...overrides };
}

function codeHit(): Hit {
  return {
    id: "src/retry.ts:1-2",
    kind: "code",
    path: "src/retry.ts",
    startLine: 1,
    endLine: 2,
    startOffset: 0,
    text: "/** Renew the quorum lease. */\nexport const RETRIES = 3\n",
    score: 4,
  };
}

test("document hits cannot become TextEvidence or CommitEvidence", () => {
  const card = localCard("What does serializable isolation prevent?", [documentHit()], PACK, 0);
  assert.equal(card.say, null);
  const evidence = card.evidence ?? [];
  assert.equal(evidence.some((item) => item.kind === "text"), false);
  assert.equal(evidence.some((item) => item.kind === "commit"), false);
  assert.equal(evidence.some((item) => item.kind === "document"), false);
});

test("document-only hits stay silent without NormalizedDocument", () => {
  const card = localCard("What is serializable isolation?", [documentHit(), documentHit({ page: 2, id: "p2" })], PACK, 0);
  assert.equal(card.say, null);
  assert.equal((card.evidence ?? []).length, 0);
  assert.equal(card.citations.some((cite) => cite.kind === "document"), false);
});

test("DocumentChunk text never enters the craftCard payload", () => {
  const doc = documentHit();
  const payload = refinePayload([doc, codeHit()]);
  const blob = JSON.stringify(payload);
  assert.equal(blob.includes(doc.text), false);
  assert.equal(blob.includes("Lecture-08.pdf"), false);
  assert.equal(payload.every((row) => row.kind === "code" || row.kind === "why"), true);
});

test("document-only retrieval cannot trigger unrelated refinement", () => {
  assert.equal(shouldRefine([documentHit()]), false);
  assert.equal(shouldRefine([documentHit(), documentHit({ id: "p2", page: 2 })]), false);
  assert.equal(shouldRefine([documentHit({ score: 12 }), codeHit()]), false);
  assert.equal(shouldRefine([codeHit(), documentHit()]), true);
  assert.deepEqual(refinePayload([documentHit()]), []);
});

test("a winning DocumentEvidence card skips refine even when code hits remain", () => {
  const card = {
    say: "Serializable isolation prevents lost outcomes.",
    citations: [],
    evidence: [{ kind: "document" as const, sourceId: "src-doc" }],
    query: "What does serializable isolation prevent?",
    latencyMs: 0,
    source: "local" as const,
  } as unknown as Card;
  assert.equal(shouldRefine([codeHit(), documentHit()], card), false);
  assert.equal(shouldRefine([documentHit(), codeHit()], card), false);
});
