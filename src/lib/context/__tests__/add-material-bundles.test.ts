import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import { bindAccountId, wipeBrowserAccountData } from "../../auth/account-boundary.ts";
import type { RepoPack } from "../../repo/types.ts";
import { isFileHit } from "../../repo/types.ts";
import { retrieve } from "../../search/retrieve.ts";
import { createMemoryRepository } from "../memory.ts";
import type { ContextRepository } from "../repository.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { indexSpace } from "../space-index.ts";
import { isTextSource } from "../types.ts";

/**
 * Adding material to a space that already holds a repo bundle. Each add is its
 * own bundle; the write check must look at that bundle only, and still catch a
 * write that came back short or changed.
 */

function pack(files: Array<[path: string, content: string]>): RepoPack {
  return {
    id: "local-repo",
    name: "local-repo",
    description: "",
    files: files.map(([path, content]) => ({ path, language: "ts", content })),
    commits: [],
  };
}

const AUTH = "/** Checkout requires E2E_TOKEN_A for every request. */\nexport const token = 'E2E_TOKEN_A';\n";
const BILLING = "/** Sessions expire after E2E_TIMEOUT_B minutes. */\nexport const timeout = 'E2E_TIMEOUT_B';\n";

function setup() {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  return repo;
}

async function searchPaths(repo: ContextRepository, spaceId: string, query: string) {
  const runtime = await indexSpace(repo, spaceId, { embed: false });
  return retrieve(query, runtime.chunks).filter(isFileHit).map((hit) => hit.path);
}

afterEach(async () => {
  setContextRepository(null);
  await wipeBrowserAccountData().catch(() => undefined);
});

test("a second add with different files succeeds and both are searchable", async () => {
  const repo = setup();
  const { context } = await persistPackAsContext(pack([["auth.ts", AUTH]]), repo);
  await persistPackAsContext(pack([["billing.ts", BILLING]]), repo, { contextId: context.id });

  const text = (await repo.listSources(context.id)).filter(isTextSource);
  assert.deepEqual(text.map((row) => row.path).sort(), ["local-repo/auth.ts", "local-repo/billing.ts"]);
  assert.equal(new Set(text.map((row) => row.sourceId)).size, 2, "each add is its own bundle");

  const space = await repo.getSpace(context.id);
  assert.ok(space);
  assert.ok((await searchPaths(repo, space.id, "E2E_TIMEOUT_B")).includes("local-repo/billing.ts"));
  assert.ok((await searchPaths(repo, space.id, "E2E_TOKEN_A")).includes("local-repo/auth.ts"));
});

test("adding a same-named file again replaces the older copy: newest wins", async () => {
  const repo = setup();
  const { context } = await persistPackAsContext(
    pack([["auth.ts", "export const OLD_MARKER_ONE = 1;\n"], ["billing.ts", BILLING]]),
    repo,
  );
  const space = await repo.getSpace(context.id);
  assert.ok(space);
  await indexSpace(repo, space.id, { embed: false });
  await persistPackAsContext(pack([["auth.ts", "export const NEW_MARKER_TWO = 2;\n"]]), repo, { contextId: context.id });

  const text = (await repo.listSources(context.id)).filter(isTextSource);
  const auth = text.filter((row) => row.path === "local-repo/auth.ts");
  assert.equal(auth.length, 1, "one row per path");
  assert.match(auth[0].content, /NEW_MARKER_TWO/);
  // The rest of the earlier add is untouched.
  assert.ok(text.some((row) => row.path === "local-repo/billing.ts" && row.content === BILLING));
  assert.equal((await repo.getContext(context.id))?.sourceCount, 2);

  assert.ok((await searchPaths(repo, space.id, "NEW_MARKER_TWO")).includes("local-repo/auth.ts"));
  assert.deepEqual(await searchPaths(repo, space.id, "OLD_MARKER_ONE"), []);
  assert.ok((await searchPaths(repo, space.id, "E2E_TIMEOUT_B")).includes("local-repo/billing.ts"));
});

/** A repository whose bundle writes drop or change files, like a short write. */
function lossy(repo: ContextRepository, mode: "drop" | "change"): ContextRepository {
  return new Proxy(repo, {
    get(target, key, receiver) {
      if (key === "upsertRepoBundle") {
        return (contextId: string, bundle: Parameters<ContextRepository["upsertRepoBundle"]>[1]) =>
          target.upsertRepoBundle(contextId, {
            ...bundle,
            files:
              mode === "drop"
                ? bundle.files.slice(1)
                : bundle.files.map((file, i) => (i === 0 ? { ...file, content: `${file.content}// changed\n` } : file)),
          });
      }
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("a short write still throws, on a new context and next to an existing bundle", async () => {
  const repo = setup();
  const two = pack([["billing.ts", BILLING], ["auth.ts", AUTH]]);
  await assert.rejects(persistPackAsContext(two, lossy(repo, "drop")), /did not match/);

  const { context } = await persistPackAsContext(pack([["auth.ts", AUTH]]), repo);
  await assert.rejects(
    persistPackAsContext(pack([["billing.ts", BILLING], ["extra.ts", "export const x = 1;\n"]]), lossy(repo, "drop"), {
      contextId: context.id,
    }),
    /did not match/,
  );
});

test("a write whose content came back changed still throws next to an existing bundle", async () => {
  const repo = setup();
  const { context } = await persistPackAsContext(pack([["auth.ts", AUTH]]), repo);
  await assert.rejects(
    persistPackAsContext(pack([["billing.ts", BILLING]]), lossy(repo, "change"), { contextId: context.id }),
    /did not match/,
  );
});
