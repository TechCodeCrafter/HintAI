import assert from "node:assert/strict";
import test from "node:test";
import { indexContext } from "../chunk-index.ts";
import { createMemoryRepository } from "../memory.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { fileChunkId } from "../source-identity.ts";
import { defaultWorkspaceId } from "../../auth/workspace.ts";
import { filterChunksForScope, vectorCacheKey } from "../../search/retrieval-scope.ts";
import { tagChunksForScope } from "../../search/retrieval-scope.ts";
import type { RepoPack } from "../../repo/types.ts";
import { isPdfSource, isTextSource } from "../types.ts";

const MAIN_TS = `export function main() { return "a"; }\n`;

function pack(name: string, marker: string): RepoPack {
  return {
    id: `folder-${name}`,
    name,
    description: name,
    files: [{ path: "src/main.ts", language: "ts", content: MAIN_TS.replace('"a"', `"${marker}"`) }],
    commits: [],
  };
}

test("two repo bundles persist in one context without overwriting", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await persistPackAsContext(pack("auth-service", "auth"), repo);
  await repo.upsertRepoBundle(context.id, {
    displayName: "billing-service",
    files: pack("billing-service", "billing").files.map((f) => ({
      path: f.path,
      language: f.language,
      content: f.content,
    })),
  });
  const sources = await repo.listSources(context.id);
  const authFiles = sources.filter((s) => isTextSource(s) && s.displayName === "auth-service");
  const billingFiles = sources.filter((s) => isTextSource(s) && s.displayName === "billing-service");
  assert.equal(authFiles.length, 1);
  assert.equal(billingFiles.length, 1);
  assert.notEqual(authFiles[0]!.sourceId, billingFiles[0]!.sourceId);
  assert.match(authFiles[0]!.path, /^auth-service\//);
  assert.match(billingFiles[0]!.path, /^billing-service\//);
});

test("duplicate relative paths across repos produce distinct chunk ids", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await persistPackAsContext(pack("auth-service", "auth"), repo);
  await repo.upsertRepoBundle(context.id, {
    displayName: "billing-service",
    files: pack("billing-service", "billing").files.map((f) => ({
      path: f.path,
      language: f.language,
      content: f.content,
    })),
  });
  const runtime = await indexContext(repo, context.id, { embed: false });
  const authChunk = runtime.chunks.find((c) => c.path.includes("auth-service") && c.text.includes("auth"));
  const billingChunk = runtime.chunks.find((c) => c.path.includes("billing-service") && c.text.includes("billing"));
  assert.ok(authChunk);
  assert.ok(billingChunk);
  assert.notEqual(authChunk!.id, billingChunk!.id);
  assert.ok(authChunk!.sourceId);
  assert.notEqual(authChunk!.sourceId, billingChunk!.sourceId);
});

test("updating repo A does not remove repo B sources", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await persistPackAsContext(pack("auth-service", "auth"), repo);
  const authSourceId = (await repo.listSources(context.id)).find(isTextSource)!.sourceId;
  await repo.upsertRepoBundle(context.id, {
    displayName: "billing-service",
    files: pack("billing-service", "billing").files.map((f) => ({
      path: f.path,
      language: f.language,
      content: f.content,
    })),
  });
  await repo.upsertRepoBundle(context.id, {
    displayName: "auth-service",
    bundleSourceId: authSourceId,
    files: [{ path: "src/main.ts", language: "ts", content: `${MAIN_TS}// updated\n` }],
  });
  const sources = await repo.listSources(context.id);
  assert.equal(sources.filter((s) => isTextSource(s) && s.displayName === "billing-service").length, 1);
  assert.equal(sources.filter((s) => isTextSource(s) && s.displayName === "auth-service").length, 1);
});

test("PDF sources remain when adding a second repo bundle", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await persistPackAsContext(pack("auth-service", "auth"), repo);
  await repo.upsertSources(context.id, [
    {
      path: "spec.pdf",
      kind: "pdf",
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
    },
  ]);
  await repo.upsertRepoBundle(context.id, {
    displayName: "billing-service",
    files: pack("billing-service", "billing").files.map((f) => ({
      path: f.path,
      language: f.language,
      content: f.content,
    })),
  });
  const sources = await repo.listSources(context.id);
  assert.equal(sources.filter(isPdfSource).length, 1);
  assert.equal(sources.filter((s) => isTextSource(s) && s.displayName === "auth-service").length, 1);
  assert.equal(sources.filter((s) => isTextSource(s) && s.displayName === "billing-service").length, 1);
});

test("vector cache keys are scoped and do not collide across repos", () => {
  const workspaceId = defaultWorkspaceId();
  const contextId = "ctx-1";
  const authId = "bundle-auth";
  const billingId = "bundle-billing";
  const path = "auth-service/src/main.ts";
  const a = fileChunkId({ workspaceId, contextId, sourceId: authId }, path, "1-28");
  const b = fileChunkId({ workspaceId, contextId, sourceId: billingId }, "billing-service/src/main.ts", "1-28");
  assert.notEqual(a, b);
  const chunkA = tagChunksForScope(
    [{ id: a, kind: "code", sourceId: authId, path, startLine: 1, endLine: 1, startOffset: 0, text: "x" }],
    { workspaceId, spaceId: contextId, contextId, contextIds: [contextId] },
  )[0]!;
  const chunkB = tagChunksForScope(
    [
      {
        id: b,
        kind: "code",
        sourceId: billingId,
        path: "billing-service/src/main.ts",
        startLine: 1,
        endLine: 1,
        startOffset: 0,
        text: "y",
      },
    ],
    { workspaceId, spaceId: contextId, contextId, contextIds: [contextId] },
  )[0]!;
  assert.notEqual(vectorCacheKey(chunkA), vectorCacheKey(chunkB));
});

test("foreign workspace chunks are still filtered from retrieval scope", () => {
  const scope = { workspaceId: "user-a", spaceId: "ctx-a", contextId: "ctx-a", contextIds: ["ctx-a"] };
  const foreign = tagChunksForScope(
    [
      {
        id: "x",
        kind: "code",
        path: "a.ts",
        startLine: 1,
        endLine: 1,
        startOffset: 0,
        text: "secret",
      },
    ],
    { workspaceId: "user-b", spaceId: "ctx-b", contextId: "ctx-b", contextIds: ["ctx-b"] },
  );
  assert.equal(filterChunksForScope(foreign, scope).length, 0);
});
