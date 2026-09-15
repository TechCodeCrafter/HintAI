import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import { bindAccountId, wipeBrowserAccountData } from "../../auth/account-boundary.ts";
import { defaultWorkspaceId } from "../../auth/workspace.ts";
import { createMemoryRepository } from "../memory.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { indexSpace } from "../space-index.ts";
import type { SpaceRecord } from "../space-types.ts";
import {
  authorizedSourceIdsFrom,
  buildSearchRetrievalScope,
  runSpaceScopedRetrieval,
} from "../../search/search-scope.ts";
import type { RepoPack } from "../../repo/types.ts";

function repoPack(name: string, note: string, path = "src/main.ts"): RepoPack {
  return {
    id: `folder-${name}`,
    name,
    description: name,
    files: [
      {
        path,
        language: "ts",
        content: `/** ${note} */\nexport const value = 1;\n`,
      },
    ],
    commits: [],
  };
}

async function fourRepoSpace(repo: ReturnType<typeof createMemoryRepository>) {
  const { context } = await persistPackAsContext(
    repoPack("alpha", "alpha pipeline handles ALPHA_FLOW routing"),
    repo,
  );
  for (const [name, note] of [
    ["beta", "beta pipeline handles BETA_FLOW routing"],
    ["gamma", "gamma pipeline handles GAMMA_FLOW routing"],
    ["delta", "delta pipeline handles DELTA_FLOW routing"],
  ] as const) {
    await repo.upsertRepoBundle(context.id, {
      displayName: name,
      files: repoPack(name, note).files.map((file) => ({
        path: file.path,
        language: file.language,
        content: file.content,
      })),
    });
  }
  const space = await repo.getSpace(context.id);
  assert.ok(space);
  const runtime = await indexSpace(repo, space.id, { embed: false });
  return { context, space, runtime };
}

function spaceStateFromRuntime(space: SpaceRecord, runtime: Awaited<ReturnType<typeof indexSpace>>) {
  return {
    activeSpaceId: space.id,
    activeContextId: space.primaryContextId,
    memberContextIds: runtime.memberContextIds,
    authorizedSourceIds: authorizedSourceIdsFrom(runtime.allSources),
  };
}

async function searchSpace(
  runtime: Awaited<ReturnType<typeof indexSpace>>,
  space: SpaceRecord,
  query: string,
  workspaceId?: string,
) {
  return runSpaceScopedRetrieval({
    query,
    previousQuestion: null,
    chunks: runtime.chunks,
    pack: runtime.pack,
    spaceState: spaceStateFromRuntime(space, runtime),
    workspaceId,
    hybrid: false,
    vectorStore: null,
  });
}

afterEach(async () => {
  setContextRepository(null);
  bindAccountId(null);
  await wipeBrowserAccountData();
});

test("space with four repos retrieves hits from more than one repo", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { space, runtime } = await fourRepoSpace(repo);

  const alphaHits = await searchSpace(runtime, space, "alpha flow routing");
  const betaHits = await searchSpace(runtime, space, "beta flow routing");
  assert.ok(alphaHits.some((hit) => hit.path.startsWith("alpha/")));
  assert.ok(betaHits.some((hit) => hit.path.startsWith("beta/")));
});

test("same-path files in different repos remain distinct at retrieval", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { space, runtime } = await fourRepoSpace(repo);

  const samePathHits = runtime.chunks.filter((chunk) => chunk.path.endsWith("src/main.ts"));
  const ids = new Set(samePathHits.map((chunk) => chunk.id));
  assert.equal(ids.size, 4, "four repos with src/main.ts must keep distinct chunk ids");

  const betaHit = await searchSpace(runtime, space, "beta pipeline handles");
  assert.ok(betaHit.length > 0);
  assert.ok(betaHit[0]!.path.startsWith("beta/"), "strongest beta evidence must rank from the beta repo");
});

test("irrelevant repo content is not selected when stronger evidence exists elsewhere", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await persistPackAsContext(
    {
      ...repoPack("auth", "login timeout milliseconds config"),
      files: [
        {
          path: "src/config.ts",
          language: "ts",
          content: "/** login timeout milliseconds */\nexport const LOGIN_TIMEOUT_MS = 45000;\n",
        },
      ],
    },
    repo,
  );
  await repo.upsertRepoBundle(context.id, {
    displayName: "marketing",
    files: [
      {
        path: "src/main.ts",
        language: "ts",
        content: '/** tagline copy */\nexport const tagline = "timeout grace period invoice";\n',
      },
    ],
  });
  const space = (await repo.getSpace(context.id))!;
  const runtime = await indexSpace(repo, space.id, { embed: false });

  const hits = await searchSpace(runtime, space, "login timeout milliseconds");
  assert.ok(hits.length > 0);
  assert.ok(hits[0]!.path.includes("auth") || hits[0]!.text.includes("LOGIN_TIMEOUT_MS"));
  assert.equal(hits[0]!.text.includes("tagline"), false);
});

test("another workspace with matching text is never retrieved", async () => {
  bindAccountId("user-a");
  const repoA = createMemoryRepository();
  setContextRepository(repoA);
  const savedA = await persistPackAsContext(repoPack("a", "CROSS_WS_MARKER_44102 secret token"), repoA);
  const spaceA = (await repoA.getSpace(savedA.context.id))!;
  const runtimeA = await indexSpace(repoA, spaceA.id, { embed: false });

  bindAccountId("user-b");
  setContextRepository(null);
  const repoB = createMemoryRepository();
  setContextRepository(repoB);
  const savedB = await persistPackAsContext(repoPack("b", "nothing relevant here"), repoB);
  const spaceB = (await repoB.getSpace(savedB.context.id))!;
  const runtimeB = await indexSpace(repoB, spaceB.id, { embed: false });

  const hits = await searchSpace(runtimeB, spaceB, "CROSS_WS_MARKER_44102 secret", "user-b");
  assert.equal(
    hits.filter((hit) => hit.text.includes("CROSS_WS_MARKER_44102")).length,
    0,
    "workspace B must not retrieve workspace A marker",
  );
  assert.ok(runtimeA.chunks.some((chunk) => chunk.text.includes("CROSS_WS_MARKER_44102")));
});

test("account switching cannot reuse previous space state", async () => {
  const marker = "ACCOUNT_SWITCH_MARKER_8821";
  bindAccountId("user-a");
  const repoA = createMemoryRepository();
  setContextRepository(repoA);
  const savedA = await persistPackAsContext(repoPack("a", `${marker} secret`), repoA);
  const spaceA = (await repoA.getSpace(savedA.context.id))!;
  const runtimeA = await indexSpace(repoA, spaceA.id, { embed: false });

  bindAccountId("user-b");
  setContextRepository(null);
  const repoB = createMemoryRepository();
  setContextRepository(repoB);
  const savedB = await persistPackAsContext(repoPack("b", "benign copy"), repoB);
  const spaceB = (await repoB.getSpace(savedB.context.id))!;
  const runtimeB = await indexSpace(repoB, spaceB.id, { embed: false });

  const staleUnion = [...runtimeB.chunks, ...runtimeA.chunks];
  const hits = await searchSpace(runtimeB, spaceB, marker, "user-b");
  assert.equal(hits.some((hit) => hit.text.includes(marker)), false);

  const scoped = await runSpaceScopedRetrieval({
    query: marker,
    previousQuestion: null,
    chunks: staleUnion,
    pack: runtimeB.pack,
    spaceState: spaceStateFromRuntime(spaceB, runtimeB),
    workspaceId: "user-b",
    hybrid: false,
    vectorStore: null,
  });
  assert.equal(
    scoped.some((hit) => hit.text.includes(marker)),
    false,
    "stale A chunks in memory must be dropped by B workspace scope",
  );
});

test("legacy single-context user still searches correctly", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const saved = await persistPackAsContext(repoPack("solo", "solo marker SOLO_FLOW routing"), repo);
  const space = (await repo.getSpace(saved.context.id))!;
  const runtime = await indexSpace(repo, space.id, { embed: false });
  const scope = buildSearchRetrievalScope({
    activeSpaceId: saved.context.id,
    activeContextId: saved.context.id,
    memberContextIds: [saved.context.id],
    authorizedSourceIds: authorizedSourceIdsFrom(await repo.listSources(saved.context.id)),
  });
  assert.equal(scope.spaceId, saved.context.id);
  assert.deepEqual(scope.contextIds, [saved.context.id]);

  const hits = await searchSpace(runtime, space, "solo flow routing");
  assert.ok(hits.some((hit) => hit.text.includes("SOLO_FLOW")));
});

test("multi-member space unions authorized contexts only", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const auth = await persistPackAsContext(repoPack("auth", "auth member AUTH_MEMBER routing"), repo);
  const billing = await persistPackAsContext(repoPack("billing", "billing member BILL_MEMBER routing"), repo);
  const space = await repo.createSpace({
    name: "paired",
    memberContextIds: [auth.context.id, billing.context.id],
    primaryContextId: auth.context.id,
  });
  const runtime = await indexSpace(repo, space.id, { embed: false });
  const scope = buildSearchRetrievalScope({
    activeSpaceId: space.id,
    activeContextId: space.primaryContextId,
    memberContextIds: runtime.memberContextIds,
    authorizedSourceIds: authorizedSourceIdsFrom(runtime.allSources),
  });
  assert.deepEqual(scope.contextIds?.sort(), [auth.context.id, billing.context.id].sort());
  assert.equal(scope.workspaceId, defaultWorkspaceId());

  const hits = await searchSpace(runtime, space, "bill member routing");
  assert.ok(hits.some((hit) => hit.text.includes("BILL_MEMBER")));
});

test("performance: index and search scale roughly linearly from 1 to 4 repos", async () => {
  bindAccountId("perf-user");

  async function bench(repoCount: number) {
    const local = createMemoryRepository();
    setContextRepository(local);
    const { context } = await persistPackAsContext(
      repoPack("r0", "perf marker PERF_FLOW routing zero"),
      local,
    );
    const names = ["r1", "r2", "r3"];
    for (let i = 1; i < repoCount; i++) {
      await local.upsertRepoBundle(context.id, {
        displayName: names[i - 1]!,
        files: repoPack(names[i - 1]!, `perf marker PERF_FLOW routing ${i}`).files.map((file) => ({
          path: file.path,
          language: file.language,
          content: file.content,
        })),
      });
    }
    const space = (await local.getSpace(context.id))!;
    const t0 = performance.now();
    const runtime = await indexSpace(local, space.id, { embed: false });
    const indexMs = performance.now() - t0;
    const s0 = performance.now();
    await searchSpace(runtime, space, "perf flow routing");
    const searchMs = performance.now() - s0;
    return { indexMs, searchMs, chunks: runtime.chunks.length };
  }

  const one = await bench(1);
  const four = await bench(4);
  assert.ok(four.chunks >= one.chunks);
  assert.ok(
    four.indexMs < one.indexMs * 8,
    `index 1 repo=${one.indexMs.toFixed(1)}ms vs 4 repos=${four.indexMs.toFixed(1)}ms`,
  );
  assert.ok(
    four.searchMs < one.searchMs * 8,
    `search 1 repo=${one.searchMs.toFixed(1)}ms vs 4 repos=${four.searchMs.toFixed(1)}ms`,
  );
});
