import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import { bindAccountId, wipeBrowserAccountData } from "../../auth/account-boundary.ts";
import { defaultWorkspaceId } from "../../auth/workspace.ts";
import { buildSpaceMaterialView } from "../../context/material-view.ts";
import { indexSpace } from "../../context/space-index.ts";
import { createMemoryRepository } from "../../context/memory.ts";
import { persistPackAsContext, setContextRepository } from "../../context/service.ts";
import { isTextSource } from "../../context/types.ts";
import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../../context/index-versions.ts";
import { buildDocumentChunks } from "../../document/chunk.ts";
import type { NormalizedDocument } from "../../document/types.ts";
import {
  appendAnswerHistory,
  historyItemFromCard,
  telemetryFromCard,
} from "../answer-history.ts";
import { routeSearchAnswer } from "../answer-route.ts";
import { localCard } from "../local-card.ts";
import { buildChunks, retrieve } from "../retrieve.ts";
import { filterChunksForScope } from "../retrieval-scope.ts";
import { recordAnswerFlight, resetFlightSession, flightRecords } from "../../instrumentation/flight-recorder.ts";
import type { Card, FileHit, IndexedChunk, RepoPack } from "../../repo/types.ts";
import { isFileChunk, isFileHit } from "../../repo/types.ts";

function repoPack(name: string, body: string, relPath = "src/main.ts"): RepoPack {
  return {
    id: `folder-${name}`,
    name,
    description: name,
    files: [{ path: relPath, language: "ts", content: body }],
    commits: [],
  };
}

async function dualRepoSpace(
  aBody: string,
  bBody: string,
  relPath = "src/main.ts",
) {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await persistPackAsContext(repoPack("auth-service", aBody, relPath), repo);
  await repo.upsertRepoBundle(context.id, {
    displayName: "billing-service",
    files: repoPack("billing-service", bBody, relPath).files.map((file) => ({
      path: file.path,
      language: file.language,
      content: file.content,
    })),
  });
  const space = await repo.getSpace(context.id);
  assert.ok(space);
  const runtime = await indexSpace(repo, space.id, { embed: false });
  const material = buildSpaceMaterialView({
    workspaceId: defaultWorkspaceId(),
    spaceId: space.id,
    primaryContextId: space.primaryContextId,
    memberContextIds: runtime.memberContextIds,
    pack: runtime.pack,
    sources: runtime.allSources,
  });
  return { context, space, runtime, material, repo };
}

function fileCitations(card: Card) {
  return card.citations.filter((cite) => cite.kind === "file");
}

function hitsWithMarker(chunks: IndexedChunk[], markers: string[], minScore = 10): FileHit[] {
  const out: FileHit[] = [];
  for (const marker of markers) {
    const hit = chunks
      .filter(isFileChunk)
      .find((chunk) => chunk.text.includes(marker));
    if (hit) out.push({ ...hit, score: minScore });
  }
  return out;
}

afterEach(async () => {
  setContextRepository(null);
  bindAccountId(null);
  await wipeBrowserAccountData();
  delete process.env.DEBUG_FLIGHT;
});

test("grounded synthesis combines evidence from repo A and repo B", async () => {
  const { runtime, material } = await dualRepoSpace(
    `/** Auth checkout requires COMBO_TOKEN_A for every request. */\nexport const token = "COMBO_TOKEN_A";\n`,
    `/** Billing checkout expires after COMBO_TIMEOUT_B minutes of idle time. */\nexport const timeout = "COMBO_TIMEOUT_B";\n`,
  );
  const query = "What COMBO_TOKEN_A and COMBO_TIMEOUT_B govern checkout?";
  const hits = hitsWithMarker(runtime.chunks, ["COMBO_TOKEN_A", "COMBO_TIMEOUT_B"]);
  assert.equal(hits.length, 2);

  const routed = await routeSearchAnswer(query, hits, performance.now(), {
    pack: runtime.pack,
    material,
    retrieveMs: 5,
    ask: async () => ({
      text: "Checkout requires COMBO_TOKEN_A for every request. Checkout expires after COMBO_TIMEOUT_B minutes of idle time. [1][2]",
    }),
  });

  assert.ok(routed.card.say, routed.card.reason);
  const cites = fileCitations(routed.card);
  assert.ok(cites.length >= 2);
  const sourceIds = new Set(cites.map((cite) => cite.sourceId).filter(Boolean));
  assert.equal(sourceIds.size, 2);
  assert.ok(cites.some((cite) => cite.path.includes("auth-service")));
  assert.ok(cites.some((cite) => cite.path.includes("billing-service")));
});

test("same relative path in two repos produces distinct citations", async () => {
  const { runtime, material } = await dualRepoSpace(
    `export const SERVICE = "auth-service handles AUTH_ONLY_FLOW";\n`,
    `export const SERVICE = "billing-service handles BILL_ONLY_FLOW";\n`,
  );
  const hits = hitsWithMarker(runtime.chunks, ["AUTH_ONLY_FLOW", "BILL_ONLY_FLOW"]);
  assert.equal(hits.length, 2);

  const routed = await routeSearchAnswer("What do auth and billing services handle?", hits, performance.now(), {
    pack: runtime.pack,
    material,
    ask: async () => ({
      text: 'Auth handles AUTH_ONLY_FLOW and billing handles BILL_ONLY_FLOW. [1][2]',
    }),
  });

  const cites = fileCitations(routed.card);
  assert.equal(cites.length, 2);
  assert.notEqual(cites[0]!.path, cites[1]!.path);
  assert.notEqual(cites[0]!.sourceId, cites[1]!.sourceId);
  assert.match(cites[0]!.path, /auth-service\/src\/main\.ts|billing-service\/src\/main\.ts/);
});

test("irrelevant source is not cited when question targets one repo", async () => {
  const { runtime, material } = await dualRepoSpace(
    `export const note = "ALPHA_ONLY_MARKER describes auth routing";\n`,
    `export const note = "BETA_ONLY_MARKER describes billing routing";\n`,
  );
  const hits = retrieve("ALPHA_ONLY_MARKER auth routing", runtime.chunks).filter(isFileHit);
  const routed = await routeSearchAnswer("What does ALPHA_ONLY_MARKER describe?", hits, performance.now(), {
    pack: runtime.pack,
    material,
    ask: async () => ({
      text: "ALPHA_ONLY_MARKER describes auth routing. [1]",
    }),
  });
  assert.ok(routed.card.say);
  const cites = fileCitations(routed.card);
  assert.ok(cites.every((cite) => !cite.path.includes("billing-service")));
  assert.ok(cites.every((cite) => !String(routed.card.say).includes("BETA_ONLY_MARKER")));
});

test("unsupported cross-source synthesis stays silent", async () => {
  const { runtime, material } = await dualRepoSpace(
    `export const a = "ALPHA_ONLY";\n`,
    `export const b = "BETA_ONLY";\n`,
  );
  const hits = retrieve("ALPHA_ONLY BETA_ONLY", runtime.chunks);
  const routed = await routeSearchAnswer("What connects ALPHA and BETA?", hits, performance.now(), {
    pack: runtime.pack,
    material,
    ask: async () => ({ text: "They are unrelated systems with no shared protocol." }),
  });
  assert.equal(routed.card.say, null);
  assert.equal(routed.tier, "silent");
});

test("foreign workspace evidence is never admitted into answer scope", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await persistPackAsContext(
    repoPack("local", `export const secret = "FOREIGN_BLOCK_991";\n`),
    repo,
  );
  const runtime = await indexSpace(repo, context.id, { embed: false });
  const seed = runtime.chunks.find(isFileChunk);
  assert.ok(seed);
  const foreign = tagForeignChunk({ ...seed, score: 999 });
  const scoped = filterChunksForScope([...runtime.chunks, foreign], {
    workspaceId: defaultWorkspaceId(),
    spaceId: context.id,
    contextId: context.id,
    contextIds: [context.id],
    sourceIds: runtime.allSources.map((row) => row.sourceId),
  });
  assert.ok(!scoped.some((chunk) => chunk.id === foreign.id));
  const hits = retrieve("FOREIGN_BLOCK_991", scoped).filter(isFileHit);
  assert.ok(!hits.some((hit) => hit.sourceId === "foreign-source"));
  const material = buildSpaceMaterialView({
    workspaceId: defaultWorkspaceId(),
    spaceId: context.id,
    primaryContextId: context.id,
    memberContextIds: [context.id],
    pack: runtime.pack,
    sources: runtime.allSources,
  });
  const routed = await routeSearchAnswer("What is FOREIGN_BLOCK_991?", hits, performance.now(), {
    pack: runtime.pack,
    material,
    ask: async () => ({ text: "FOREIGN_BLOCK_991 is the secret. [1]" }),
  });
  for (const cite of routed.card.citations ?? []) {
    if ("sourceId" in cite && cite.sourceId) {
      assert.notEqual(cite.sourceId, "foreign-source");
    }
  }
  for (const item of routed.card.evidence ?? []) {
    if ("sourceId" in item) assert.notEqual(item.sourceId, "foreign-source");
  }
});

function tagForeignChunk(chunk: FileHit): FileHit {
  return {
    ...(chunk as FileHit),
    id: "foreign:chunk",
    sourceId: "foreign-source",
    text: `${chunk.text}\nFOREIGN_BLOCK_991`,
    score: 999,
  };
}

test("answer history records multiple source IDs", async () => {
  const card: Card = {
    say: "Combined answer.",
    citations: [
      {
        kind: "file",
        path: "auth-service/src/main.ts",
        line: 1,
        sourceId: "src-a",
        displayName: "auth-service",
        label: "",
      },
      {
        kind: "file",
        path: "billing-service/src/main.ts",
        line: 1,
        sourceId: "src-b",
        displayName: "billing-service",
        label: "",
      },
    ],
    query: "q",
    latencyMs: 1,
    source: "local",
    evidence: [],
  };
  const item = historyItemFromCard(card, Date.now(), {
    workspaceId: "ws",
    contextId: "ctx",
    spaceId: "space-1",
  });
  assert.equal(item.spaceId, "space-1");
  assert.deepEqual(item.sourceIds?.sort(), ["src-a", "src-b"]);
  assert.equal(item.evidenceCount, 2);
  const history = appendAnswerHistory([], card, { spaceId: "space-1" });
  assert.equal(history[0]?.sourceIds?.length, 2);
});

test("flight recorder records spaceId and multiple source IDs", () => {
  process.env.DEBUG_FLIGHT = "true";
  resetFlightSession();
  bindAccountId("flight-user");
  const card: Card = {
    say: "Both.",
    citations: [
      { kind: "file", path: "a/x.ts", line: 1, sourceId: "s1", label: "" },
      { kind: "file", path: "b/x.ts", line: 1, sourceId: "s2", label: "" },
    ],
    query: "q",
    latencyMs: 1,
    source: "local",
  };
  const telemetry = telemetryFromCard(card);
  recordAnswerFlight({
    query: "q",
    contextId: "ctx",
    spaceId: "space-9",
    sourceIds: telemetry.sourceIds,
    evidenceCount: telemetry.evidenceCount,
    transcriptSummary: { theyLines: 0, youLines: 0 },
    gate: null,
    retrieval: "2 hits",
    tier: "grounded",
    latency: { retrieveMs: 1, llmMs: 2, verifyMs: 1, totalMs: 4 },
    say: card.say,
    reason: null,
    citations: card.citations,
    quotaRemaining: 20,
  });
  const row = flightRecords().find((record) => record.kind === "answer");
  assert.ok(row && row.kind === "answer");
  assert.equal(row.spaceId, "space-9");
  assert.deepEqual(row.sourceIds?.sort(), ["s1", "s2"]);
  assert.equal(row.evidenceCount, 2);
});

test("local card combines two sources when neither alone is sufficient", async () => {
  const { runtime, material } = await dualRepoSpace(
    `/** Checkout requires PAIR_TOKEN for every request. */\nexport const x = 1;\n`,
    `/** Sessions expire after PAIR_MINUTES minutes of idle time. */\nexport const y = 2;\n`,
  );
  const query = "What PAIR_TOKEN and PAIR_MINUTES govern checkout sessions?";
  const hits = hitsWithMarker(runtime.chunks, ["PAIR_TOKEN", "PAIR_MINUTES"]);
  assert.equal(hits.length, 2);
  const authHit = hits.find((h) => h.path.includes("auth-service"))!;
  const billingHit = hits.find((h) => h.path.includes("billing-service"))!;
  const singleA = localCard(query, [authHit], runtime.pack, 0, null, { material });
  const singleB = localCard(query, [billingHit], runtime.pack, 0, null, { material });
  assert.ok(!singleA.say?.includes("PAIR_MINUTES"));
  assert.ok(!singleB.say?.includes("PAIR_TOKEN"));

  const combined = localCard(query, hits, runtime.pack, 0, null, { material });
  assert.ok(combined.say, combined.reason);
  assert.match(combined.say!, /PAIR_TOKEN/i);
  assert.match(combined.say!, /PAIR_MINUTES/i);
  const cites = fileCitations(combined);
  assert.equal(new Set(cites.map((cite) => cite.sourceId)).size, 2);
});

test("repo and PDF evidence can appear in one cited synthesis answer", async () => {
  const { runtime, material } = await dualRepoSpace(
    `export const policy = "Retention policy keeps logs for RETAIN_DAYS repo days";\n`,
    `export const other = "unused";\n`,
  );
  const document: NormalizedDocument = {
    sourceId: "pdf-policy",
    contextId: "ctx",
    path: "policy.pdf",
    contentHash: "hash-policy",
    type: "pdf",
    parserVersion: PDF_PARSER_VERSION,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 1,
    outline: [],
    readiness: "ready",
    pages: [
      {
        pageNumber: 1,
        text: "PDF retention window is RETAIN_DAYS calendar days for customers.",
        items: [],
        segments: [],
        readingOrder: "single-column",
        usefulItemCount: 1,
        index: "full",
      },
    ],
  };
  const docChunks = buildDocumentChunks(document);
  const repoHit = hitsWithMarker(runtime.chunks, ["RETAIN_DAYS"])[0]!;
  const docChunk = docChunks.find((chunk) => chunk.text.includes("RETAIN_DAYS"));
  assert.ok(docChunk);
  const docHit = { ...docChunk, score: 10 };
  const hits = [repoHit, docHit];
  const ctx = {
    material,
    document: (sourceId: string) => (sourceId === document.sourceId ? document : undefined),
    documents: [document],
  };
  const routed = await routeSearchAnswer("How long is RETAIN_DAYS retention?", hits, performance.now(), {
    pack: runtime.pack,
    material,
    cardContext: ctx,
    ask: async () => ({
      text: "Retention keeps logs for RETAIN_DAYS repo days and PDF retention window is RETAIN_DAYS calendar days. [1][2]",
    }),
  });
  assert.ok(routed.card.say, routed.card.reason);
  const kinds = new Set(routed.card.citations.map((cite) => cite.kind));
  assert.ok(kinds.has("file"));
  assert.ok(kinds.has("document"));
});

test("legacy single-source space still answers from one repo", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const body = `/** Attempts are capped at three because a fourth attempt duplicates the settlement file. */\nexport function retry() {}\n`;
  const pack = repoPack("solo", body);
  const { context } = await persistPackAsContext(pack, repo);
  const runtime = await indexSpace(repo, context.id, { embed: false });
  const material = buildSpaceMaterialView({
    workspaceId: defaultWorkspaceId(),
    spaceId: context.id,
    primaryContextId: context.id,
    memberContextIds: [context.id],
    pack: runtime.pack,
    sources: runtime.allSources,
  });
  const hits = hitsWithMarker(runtime.chunks, ["Attempts are capped at three"]);
  const card = localCard("Why does that retry three times?", hits, runtime.pack, 0, null, { material });
  assert.ok(card.say);
  assert.match(card.say!, /three/i);
  assert.equal(material.sources.length, 1);
  assert.ok(isTextSource(runtime.allSources[0]!));
  assert.ok(buildChunks(pack).length > 0);
});
