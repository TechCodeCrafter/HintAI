import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { test } from "node:test";

import {
  packFromFiles,
  packFromScan,
  scanDirectoryHandle,
  scanFileList,
  type DirectoryLike,
  type FsEntry,
} from "../../repo/folder.ts";
import { recencyByPath } from "../../repo/git-history.ts";
import { retrieve } from "../../search/retrieve.ts";
import { createMemoryRepository } from "../memory.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { indexSpace } from "../space-index.ts";

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const GIT = hasGit();

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test Author",
  GIT_AUTHOR_EMAIL: "author@example.test",
  GIT_COMMITTER_NAME: "Test Author",
  GIT_COMMITTER_EMAIL: "author@example.test",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

/** A small repository where only history tells the two invoice files apart. */
function build(name = "billing-app") {
  const parent = mkdtempSync(join(tmpdir(), "meethint-recent-"));
  const root = join(parent, name);
  mkdirSync(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: ENV }).trim();
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  git("init", "-q", "-b", "main");
  write("src/billing/invoice-v1.ts", "// Rounds the invoice total to cents before export.\nexport const a = 1;\n");
  write("src/billing/invoice-v2.ts", "// Rounds the invoice total to cents before export.\nexport const b = 1;\n");
  write("src/auth/session.ts", "// Session cookies expire after twelve hours.\nexport const c = 1;\n");
  commit("initial import");
  write("src/auth/session.ts", "// Session cookies expire after twelve hours.\nexport const c = 2;\n");
  commit("auth: bump");
  write("src/billing/invoice-v2.ts", "// Rounds the invoice total to cents before export.\nexport const b = 2;\n");
  commit("billing: v2 rounding");
  return { root, name, git, done: () => rmSync(parent, { recursive: true, force: true }) };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** What `<input webkitdirectory>` hands over: every file, with its path under the folder. */
function fileList(root: string): File[] {
  return walk(root).map((full) => {
    const file = new File([readFileSync(full)], basename(full));
    Object.defineProperty(file, "webkitRelativePath", {
      value: `${basename(root)}/${relative(root, full).split("\\").join("/")}`,
      configurable: true,
    });
    return file;
  });
}

/** What the directory picker hands over: a handle that is walked on demand. */
function directory(path: string): FsEntry & DirectoryLike {
  return {
    kind: "directory",
    name: basename(path),
    async *values() {
      for (const entry of readdirSync(path)) {
        const full = join(path, entry);
        if (statSync(full).isDirectory()) yield directory(full);
        else yield { kind: "file", name: entry, getFile: async () => new File([readFileSync(full)], entry) } as FsEntry;
      }
    },
  };
}

test("a picked folder with history reports which loaded files recent commits changed", { skip: !GIT }, async () => {
  const r = build();
  try {
    const head = r.git("rev-parse", "--short=7", "HEAD");
    const viaInput = await packFromFiles(fileList(r.root));
    const viaPicker = await packFromScan(await scanDirectoryHandle(directory(r.root)));
    for (const load of [viaInput, viaPicker]) {
      assert.deepEqual(
        load.pack.files.map((file) => file.path).sort(),
        ["src/auth/session.ts", "src/billing/invoice-v1.ts", "src/billing/invoice-v2.ts"],
        "nothing under .git is loaded as a source",
      );
      assert.deepEqual(
        (load.recentChanges ?? []).map((change) => [change.path, change.age, change.sha]),
        [
          ["src/billing/invoice-v2.ts", 0, head],
          ["src/auth/session.ts", 1, r.git("rev-parse", "--short=7", "HEAD~1")],
        ],
      );
      assert.equal(load.pack.commits.length, 0, "no commit is added to the pack to be indexed or spoken");
    }
  } finally {
    r.done();
  }
});

test("the folder review hands on only the files to index, and the history still arrives", { skip: !GIT }, async () => {
  // What the app does: scan the selection, show the review, then load only
  // the files that passed it. Nothing under .git is among those files.
  const r = build();
  try {
    const head = r.git("rev-parse", "--short=7", "HEAD");
    for (const scan of [scanFileList(fileList(r.root)), await scanDirectoryHandle(directory(r.root))]) {
      const reviewed = scan.candidates.map((item) => item.file);
      assert.ok(reviewed.length > 0);
      const withoutHistory = await packFromFiles(reviewed, { selectedCount: scan.selected });
      assert.deepEqual(withoutHistory.recentChanges, [], "the reviewed files alone carry no history");

      const load = await packFromFiles(reviewed, { selectedCount: scan.selected, git: scan.git });
      assert.deepEqual(
        load.pack.files.map((file) => file.path).sort(),
        ["src/auth/session.ts", "src/billing/invoice-v1.ts", "src/billing/invoice-v2.ts"],
      );
      assert.deepEqual(
        (load.recentChanges ?? []).map((change) => [change.path, change.age, change.sha]),
        [
          ["src/billing/invoice-v2.ts", 0, head],
          ["src/auth/session.ts", 1, r.git("rev-parse", "--short=7", "HEAD~1")],
        ],
      );
    }
  } finally {
    r.done();
  }
});

test("a folder without history loads exactly as before", async () => {
  const file = (path: string, content: string) => {
    const made = new File([content], basename(path));
    Object.defineProperty(made, "webkitRelativePath", { value: `plain/${path}`, configurable: true });
    return made;
  };
  const scan = scanFileList([file("src/a.ts", "export const a = 1;\n")]);
  assert.equal(scan.git, undefined);
  const load = await packFromScan(scan);
  assert.deepEqual(load.recentChanges, []);
  // A `.git` with no HEAD (a stray folder, a worktree pointer) is not history.
  const stray = scanFileList([file("src/a.ts", "export const a = 1;\n"), file(".git/config", "[core]\n")]);
  assert.equal(stray.git, undefined);
});

test("recent changes are stored with the space, survive reopening, and break a ranking tie", { skip: !GIT }, async () => {
  const r = build();
  try {
    const repo = createMemoryRepository();
    setContextRepository(repo);
    const load = await packFromFiles(fileList(r.root));
    const { context } = await persistPackAsContext(load.pack, repo, { recentChanges: load.recentChanges });

    // Opening the space reads them from storage, not from the load that made them.
    const runtime = await indexSpace(repo, context.id, { embed: false });
    const chunkPaths = new Set(runtime.chunks.map((chunk) => chunk.path));
    assert.equal(runtime.recentChanges.length, 2);
    for (const change of runtime.recentChanges) {
      assert.ok(chunkPaths.has(change.path), `${change.path} is the path its chunks have`);
    }

    const question = "How is the invoice total rounded?";
    const plain = retrieve(question, runtime.chunks);
    const v1 = plain.find((hit) => hit.path.endsWith("invoice-v1.ts"))!;
    const v2 = plain.find((hit) => hit.path.endsWith("invoice-v2.ts"))!;
    assert.equal(v1.score, v2.score, "the two files tie on text");

    const recency = recencyByPath(runtime.recentChanges);
    const ranked = retrieve(question, runtime.chunks, 6, { recency });
    assert.ok(ranked[0]?.path.endsWith("invoice-v2.ts"), "the file the newest commit changed comes first");
    assert.ok((ranked[0]?.boosts?.recentCommit ?? 0) > 0);
    // session.ts changed recently too, and does not match the question.
    assert.ok(!ranked.some((hit) => hit.path.endsWith("session.ts")));

    // Removing a file leaves no recency entry for it.
    const sources = await repo.listSources(context.id);
    const gone = sources.find((source) => source.path.endsWith("invoice-v2.ts"))!;
    await repo.deleteSources(context.id, [gone.id]);
    const after = await indexSpace(repo, context.id, { embed: false });
    assert.deepEqual(after.recentChanges.map((change) => change.path.split("/").pop()), ["session.ts"]);
  } finally {
    setContextRepository(null);
    r.done();
  }
});

test("loading the same folder again replaces its recent changes", { skip: !GIT }, async () => {
  const r = build();
  try {
    const repo = createMemoryRepository();
    setContextRepository(repo);
    const first = await packFromFiles(fileList(r.root));
    const { context } = await persistPackAsContext(first.pack, repo, { recentChanges: first.recentChanges });

    writeFileSync(join(r.root, "src/billing/invoice-v1.ts"), "// Rounds the invoice total to cents before export.\nexport const a = 3;\n");
    r.git("add", "-A");
    r.git("commit", "-q", "-m", "billing: v1 again");
    const second = await packFromFiles(fileList(r.root));
    await persistPackAsContext(second.pack, repo, { contextId: context.id, recentChanges: second.recentChanges });

    const runtime = await indexSpace(repo, context.id, { embed: false });
    assert.deepEqual(
      runtime.recentChanges.map((change) => [change.path.split("/").pop(), change.age]),
      [
        ["invoice-v1.ts", 0],
        ["invoice-v2.ts", 1],
        ["session.ts", 2],
      ],
    );
  } finally {
    setContextRepository(null);
    r.done();
  }
});
