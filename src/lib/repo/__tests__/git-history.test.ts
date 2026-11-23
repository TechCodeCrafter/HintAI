import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  type GitFiles,
  gitFilesFromMap,
  readRecentChanges,
  recencyOf,
  resolveHead,
} from "../git-history.ts";

/** `.git` on disk, read the way the browser reads a picked folder: by path, as Blobs. */
function gitOnDisk(root: string): GitFiles {
  return {
    file: async (path) => {
      const full = join(root, ".git", path);
      if (!existsSync(full) || !statSync(full).isFile()) return null;
      return new Blob([readFileSync(full)]);
    },
    list: async (dir) => {
      const full = join(root, ".git", dir);
      return existsSync(full) ? readdirSync(full) : [];
    },
  };
}

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const GIT = hasGit();

function repo() {
  const root = mkdtempSync(join(tmpdir(), "meethint-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test Author",
        GIT_AUTHOR_EMAIL: "author@example.test",
        GIT_COMMITTER_NAME: "Test Author",
        GIT_COMMITTER_EMAIL: "author@example.test",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    }).trim();
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  let clock = 1_700_000_000;
  const commit = (message: string) => {
    clock += 3600;
    git("add", "-A");
    execFileSync("git", ["commit", "-q", "-m", message], {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test Author",
        GIT_AUTHOR_EMAIL: "author@example.test",
        GIT_COMMITTER_NAME: "Test Author",
        GIT_COMMITTER_EMAIL: "author@example.test",
        GIT_AUTHOR_DATE: `${clock} +0000`,
        GIT_COMMITTER_DATE: `${clock} +0000`,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    });
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  return { root, git, write, commit, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** What git itself says each recent commit changed, newest change per path. */
function expected(git: (...args: string[]) => string, maxCommits = 30): Map<string, { sha: string; age: number }> {
  const ids = git("rev-list", "--first-parent", "HEAD").split("\n").filter(Boolean);
  const out = new Map<string, { sha: string; age: number }>();
  ids.slice(0, maxCommits).forEach((id, age) => {
    if (age === ids.length - 1) return; // the root commit has no parent to differ from
    const names = git("diff", "--name-only", "--no-renames", `${id}^1`, id).split("\n").filter(Boolean);
    for (const path of names) if (!out.has(path)) out.set(path, { sha: id.slice(0, 7), age });
  });
  return out;
}

function build() {
  const r = repo();
  const body = (n: number) => Array.from({ length: 60 }, (_, i) => `export const line${i} = ${n * 100 + i};`).join("\n");
  r.write("README.md", "# Demo\n");
  r.write("src/export/retry.ts", body(1));
  r.write("src/export/format.ts", body(2));
  r.write("src/auth/session.ts", body(3));
  r.write("docs/guide.md", "Guide.\n");
  r.commit("initial import");
  r.write("src/auth/session.ts", `${body(3)}\nexport const ttl = 12;\n`);
  r.commit("auth: session ttl");
  r.write("src/export/retry.ts", `${body(1)}\nexport const attempts = 3;\n`);
  r.write("src/export/queue/dead-letter.ts", "export const park = true;\n");
  r.commit("export: cap attempts, add dead letter queue");
  r.git("rm", "-q", "docs/guide.md");
  r.write("docs/runbook.md", "Runbook.\n");
  r.commit("docs: replace guide with runbook");
  r.write("src/export/retry.ts", `${body(1)}\nexport const attempts = 4;\n`);
  const head = r.commit("export: raise attempts");
  return { ...r, head };
}

test("recent changes match what git reports, from loose objects", { skip: !GIT }, async () => {
  const r = build();
  try {
    const git = gitOnDisk(r.root);
    assert.equal(await resolveHead(git), r.head);
    const changes = await readRecentChanges(git);
    const want = expected(r.git);
    assert.deepEqual(
      new Map(changes.map((c) => [c.path, { sha: c.sha, age: c.age }])),
      want,
    );
    // The newest change wins: retry.ts was touched twice.
    const retry = changes.find((c) => c.path === "src/export/retry.ts");
    assert.equal(retry?.age, 0);
    assert.equal(retry?.sha, r.head.slice(0, 7));
    assert.equal(retry?.date, new Date((1_700_000_000 + 5 * 3600) * 1000).toISOString());
    // A file only the first commit added was not changed by any later one.
    assert.equal(changes.find((c) => c.path === "README.md"), undefined);
    // A deleted file and a file in a new folder are both seen.
    assert.ok(changes.some((c) => c.path === "docs/guide.md"));
    assert.ok(changes.some((c) => c.path === "src/export/queue/dead-letter.ts"));
  } finally {
    r.done();
  }
});

test("recent changes match what git reports, from a packfile with deltas", { skip: !GIT }, async () => {
  const r = build();
  try {
    const want = expected(r.git);
    r.git("gc", "-q", "--aggressive", "--prune=now");
    r.git("pack-refs", "--all");
    const objects = readdirSync(join(r.root, ".git", "objects")).filter((name) => /^[0-9a-f]{2}$/.test(name));
    assert.deepEqual(objects, [], "every object is packed");
    const packs = readdirSync(join(r.root, ".git", "objects", "pack")).filter((name) => name.endsWith(".pack"));
    assert.equal(packs.length, 1);
    const verify = r.git("verify-pack", "-v", join(".git", "objects", "pack", packs[0].replace(/\.pack$/, ".idx")));
    assert.match(verify, /chain length = \d+: \d+ object/, "the pack holds delta objects");

    const git = gitOnDisk(r.root);
    assert.equal(await resolveHead(git), r.head, "HEAD resolves through packed-refs");
    const changes = await readRecentChanges(git);
    assert.deepEqual(new Map(changes.map((c) => [c.path, { sha: c.sha, age: c.age }])), want);
  } finally {
    r.done();
  }
});

test("a merge is compared with its first parent", { skip: !GIT }, async () => {
  const r = build();
  try {
    r.git("checkout", "-q", "-b", "feature");
    r.write("src/feature/flag.ts", "export const flag = true;\n");
    r.commit("feature: flag");
    r.git("checkout", "-q", "main");
    r.write("README.md", "# Demo\n\nMore.\n");
    r.commit("readme: more");
    execFileSync("git", ["merge", "-q", "--no-ff", "-m", "merge feature", "feature"], {
      cwd: r.root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test Author",
        GIT_AUTHOR_EMAIL: "author@example.test",
        GIT_COMMITTER_NAME: "Test Author",
        GIT_COMMITTER_EMAIL: "author@example.test",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    });
    const changes = await readRecentChanges(gitOnDisk(r.root));
    assert.deepEqual(new Map(changes.map((c) => [c.path, { sha: c.sha, age: c.age }])), expected(r.git));
    assert.equal(changes.find((c) => c.path === "src/feature/flag.ts")?.age, 0);
    assert.equal(changes.find((c) => c.path === "README.md")?.age, 1);
  } finally {
    r.done();
  }
});

test("the walk stops at the commit limit and at the object budget", { skip: !GIT }, async () => {
  const r = build();
  try {
    const git = gitOnDisk(r.root);
    const two = await readRecentChanges(git, { maxCommits: 2 });
    assert.deepEqual(new Map(two.map((c) => [c.path, { sha: c.sha, age: c.age }])), expected(r.git, 2));
    assert.ok(two.every((c) => c.age < 2));
    // A budget too small to finish returns what it had, and does not throw.
    const starved = await readRecentChanges(git, { maxObjects: 3 });
    assert.ok(starved.length <= two.length);
    const expired = await readRecentChanges(git, { budgetMs: -1 });
    assert.deepEqual(expired, []);
  } finally {
    r.done();
  }
});

test("no author name, email or commit message is read into the result", { skip: !GIT }, async () => {
  const r = build();
  try {
    const changes = await readRecentChanges(gitOnDisk(r.root));
    const dump = JSON.stringify(changes);
    assert.doesNotMatch(dump, /Test Author|author@example\.test|raise attempts|dead letter queue/);
    assert.deepEqual(Object.keys(changes[0]).sort(), ["age", "date", "path", "sha"]);
  } finally {
    r.done();
  }
});

test("anything that is not a readable repository yields no changes", async () => {
  const empty = gitFilesFromMap(new Map());
  assert.equal(await resolveHead(empty), null);
  assert.deepEqual(await readRecentChanges(empty), []);

  // A worktree's `.git` is a pointer file, so there is no HEAD to read here.
  const dangling = gitFilesFromMap(new Map([["HEAD", new Blob(["ref: refs/heads/main\n"])]]));
  assert.equal(await resolveHead(dangling), null);
  assert.deepEqual(await readRecentChanges(dangling), []);

  // HEAD names a commit whose object is not there (a damaged or partial copy).
  const missing = gitFilesFromMap(new Map([["HEAD", new Blob([`${"a".repeat(40)}\n`])]]));
  assert.deepEqual(await readRecentChanges(missing), []);

  // A corrupt object does not throw.
  const corrupt = gitFilesFromMap(
    new Map([
      ["HEAD", new Blob([`${"ab".repeat(20)}\n`])],
      [`objects/ab/${"ab".repeat(19)}`, new Blob([new Uint8Array([1, 2, 3, 4])])],
    ]),
  );
  assert.deepEqual(await readRecentChanges(corrupt), []);

  // A ref that tries to leave the folder is not followed.
  const escape = gitFilesFromMap(new Map([["HEAD", new Blob(["ref: ../../etc/passwd\n"])]]));
  assert.equal(await resolveHead(escape), null);
});

test("recency falls from 1 at HEAD to 0 at the edge of the window", () => {
  assert.equal(recencyOf({ age: 0 }, 30), 1);
  assert.equal(recencyOf({ age: 15 }, 30), 0.5);
  assert.equal(recencyOf({ age: 30 }, 30), 0);
  assert.equal(recencyOf(undefined, 30), 0);
  assert.equal(recencyOf({ age: -1 }, 30), 0);
});
