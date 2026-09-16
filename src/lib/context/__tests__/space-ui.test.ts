import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import { bindAccountId, wipeBrowserAccountData } from "../../auth/account-boundary.ts";
import { createMemoryRepository } from "../memory.ts";
import { persistPackAsContext, setContextRepository, listSpaceSummaries } from "../service.ts";
import { formatSpaceCounts, spaceHasSources } from "../kinds.ts";
import { citationChipText } from "../../search/cite.ts";
import type { RepoPack } from "../../repo/types.ts";

function pack(name: string, marker: string): RepoPack {
  return {
    id: `folder-${name}`,
    name,
    description: name,
    files: [{ path: "src/main.ts", language: "ts", content: `export const note = "${marker}";\n` }],
    commits: [],
  };
}

afterEach(async () => {
  setContextRepository(null);
  bindAccountId(null);
  await wipeBrowserAccountData();
});

test("listSpaceSummaries returns migrated legacy space with repo counts", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  await persistPackAsContext(pack("IAM Platform", "alpha"), repo);
  const rows = await listSpaceSummaries(repo);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.space.name, "IAM Platform");
  assert.equal(rows[0]!.repoCount, 1);
  assert.equal(formatSpaceCounts(rows[0]!), "1 repo");
  assert.ok(spaceHasSources(rows[0]!));
});

test("deleteSpace removes one Knowledge Space without affecting another", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const keep = await persistPackAsContext(pack("Keep Space", "keep"), repo);
  const drop = await persistPackAsContext(pack("Drop Space", "drop"), repo);
  const before = await listSpaceSummaries(repo);
  assert.equal(before.length, 2);

  await repo.deleteSpace(drop.context.id);

  const after = await listSpaceSummaries(repo);
  assert.equal(after.length, 1);
  assert.equal(after[0]!.space.name, "Keep Space");
  assert.equal(await repo.getSpace(drop.context.id), null);
  assert.ok(await repo.getContext(keep.context.id));
});

test("listSpaceSummaries counts two repos in one Knowledge Space", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await persistPackAsContext(pack("Backend", "one"), repo);
  await repo.upsertRepoBundle(context.id, {
    displayName: "billing-service",
    files: pack("billing-service", "two").files.map((file) => ({
      path: file.path,
      language: file.language,
      content: file.content,
    })),
  });
  const rows = await listSpaceSummaries(repo);
  assert.equal(rows[0]!.repoCount, 2);
  assert.match(formatSpaceCounts(rows[0]!), /2 repos/);
});

test("citation chips prefix repo displayName for same-path disambiguation", () => {
  const auth = citationChipText({
    kind: "file",
    path: "auth-service/src/main.ts",
    line: 41,
    endLine: 58,
    displayName: "auth-service",
    sourceId: "a",
    label: "",
  });
  const billing = citationChipText({
    kind: "file",
    path: "billing-service/src/main.ts",
    line: 41,
    endLine: 58,
    displayName: "billing-service",
    sourceId: "b",
    label: "",
  });
  assert.match(auth, /auth-service · auth-service\/src\/main\.ts:41-58/);
  assert.match(billing, /billing-service · billing-service\/src\/main\.ts:41-58/);
  assert.notEqual(auth, billing);
});
