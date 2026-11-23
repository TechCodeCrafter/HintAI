import assert from "node:assert/strict";
import { test } from "node:test";

import type { RepoPack } from "../../repo/types.ts";
import { declaredNames, declaredWords } from "../declared-names.ts";
import { buildChunks, retrieve } from "../retrieve.ts";
import { RETRIEVAL_WEIGHTS } from "../retrieval-weights.ts";

test("declared names: functions, classes, types, methods and top-level constants", () => {
  const ts = [
    "export async function retryBackoff(attempt: number) {",
    "  const delay = base * 2 ** attempt;",
    "  if (delay > cap) {",
    "    return cap;",
    "  }",
    "  for (const item of queue) {",
    "    send(item);",
    "  }",
    "}",
    "export const MAX_ATTEMPTS = 5;",
    "export type RetryPolicy = { attempts: number };",
    "class ExportQueue {",
    "  enqueue(job: Job): void {",
    "  }",
    "  private drain = async () => {",
    "  };",
    "}",
    "const handlers = {",
    "  onFailure: (job) => park(job),",
    "};",
  ].join("\n");
  assert.deepEqual(declaredNames(ts), [
    "retryBackoff",
    "MAX_ATTEMPTS",
    "RetryPolicy",
    "ExportQueue",
    "enqueue",
    "handlers",
    "onFailure",
  ]);
  // A local, a call, and control flow are not declarations.
  for (const not of ["delay", "send", "if", "for", "return", "item"]) {
    assert.ok(!declaredNames(ts).includes(not), not);
  }
  assert.deepEqual(declaredNames("def parse_invoice(path):\n    total = 0\n\nclass InvoiceParser:\n    def load(self):\n        pass\n"), [
    "parse_invoice",
    "InvoiceParser",
    "load",
  ]);
  assert.deepEqual(declaredNames("func (s *Store) SaveSession(id string) error {\n\treturn nil\n}\n\ntype SessionStore struct {\n}\n"), [
    "SaveSession",
    "SessionStore",
  ]);
  assert.deepEqual(declaredNames("pub fn compute_backoff(attempt: u32) -> u64 {\n}\n\npub struct RetryState {\n}\n"), [
    "compute_backoff",
    "RetryState",
  ]);
  assert.deepEqual(declaredWords("export function retryBackoff() {}\n"), ["retry", "backoff"]);
  assert.deepEqual(declaredNames("We call retryBackoff() when the export fails.\n"), []);
});

const body = (lines: string[]) => lines.join("\n");

/** Two files that say "backoff" equally often. One defines it, one calls it. */
const PACK: RepoPack = {
  id: "symbols",
  name: "symbols",
  description: "",
  commits: [],
  files: [
    {
      path: "src/jobs/runner.ts",
      language: "ts",
      content: body([
        "import { computeBackoff } from '../util/timing';",
        "",
        "export async function runJob(job: Job) {",
        "  // wait for the backoff before the next attempt",
        "  await sleep(computeBackoff(job.attempt));",
        "  return job.run();",
        "}",
      ]),
    },
    {
      path: "src/util/timing.ts",
      language: "ts",
      content: body([
        "const BASE_MS = 200;",
        "",
        "export function computeBackoff(attempt: number): number {",
        "  // doubles the wait on every attempt",
        "  return BASE_MS * 2 ** attempt;",
        "}",
      ]),
    },
    {
      path: "docs/notes.md",
      language: "md",
      content: body(["# Notes", "", "```ts", "export function computeBackoff(attempt: number) {}", "```", "", "The backoff doubles."]),
    },
  ],
};

test("a chunk that declares the thing outranks the chunks that call or mention it", () => {
  const chunks = buildChunks(PACK);
  const hits = retrieve("How is the backoff computed?", chunks);
  const at = (path: string) => hits.findIndex((hit) => hit.path === path);
  const definition = hits[at("src/util/timing.ts")]!;
  const caller = hits[at("src/jobs/runner.ts")]!;
  assert.ok(definition && caller, "both source files are found");
  assert.ok(at("src/util/timing.ts") < at("src/jobs/runner.ts"), "the definition ranks above the caller");
  assert.ok((definition.boosts?.declares ?? 0) > 0, "the definition is credited for declaring it");
  // runJob is declared in the caller, computeBackoff is not: no credit for "backoff".
  assert.equal(caller.boosts?.declares, undefined);
  // On text alone the caller says "backoff" more often and would rank first.
  assert.ok(definition.score - (definition.boosts?.declares ?? 0) < caller.score);
  // A declaration quoted in a markdown fence is prose, not a definition.
  const doc = hits[at("docs/notes.md")];
  assert.ok(doc, "the document is still found");
  assert.equal(doc?.boosts?.declares, undefined);
  // The score is still the sum of its named addends.
  for (const hit of hits) {
    const sum = Object.values(hit.boosts ?? {}).reduce((total, value) => total + value, 0);
    assert.ok(Math.abs(sum - hit.score) < 1e-9, hit.path);
  }
});

/** Two files that match a question equally. Only history tells them apart. */
const TWINS: RepoPack = {
  id: "twins",
  name: "twins",
  description: "",
  commits: [],
  files: [
    { path: "src/billing/invoice-v1.ts", language: "ts", content: "// Rounds the invoice total to cents before export.\nexport const a = 1;\n" },
    { path: "src/billing/invoice-v2.ts", language: "ts", content: "// Rounds the invoice total to cents before export.\nexport const b = 1;\n" },
    { path: "src/auth/session.ts", language: "ts", content: "// Session cookies expire after twelve hours.\nexport const c = 1;\n" },
  ],
};

test("a recent commit on a matching file is a small boost, and breaks a tie", () => {
  const chunks = buildChunks(TWINS);
  const question = "How is the invoice total rounded?";
  const plain = retrieve(question, chunks);
  const v1 = plain.find((hit) => hit.path.endsWith("invoice-v1.ts"))!;
  const v2 = plain.find((hit) => hit.path.endsWith("invoice-v2.ts"))!;
  assert.equal(v1.score, v2.score, "without history the two files tie");
  assert.equal(v1.boosts?.recentCommit, undefined);

  const recent = retrieve(question, chunks, 6, { recency: new Map([["src/billing/invoice-v2.ts", 1]]) });
  assert.equal(recent[0]?.path, "src/billing/invoice-v2.ts");
  const boost = recent[0]?.boosts?.recentCommit ?? 0;
  assert.ok(boost > 0 && boost <= RETRIEVAL_WEIGHTS.recentCommit, `boost ${boost}`);
  assert.ok(Math.abs(recent[0]!.score - v2.score - boost) < 1e-9, "nothing else about the score changed");

  // An older change counts for less.
  const older = retrieve(question, chunks, 6, { recency: new Map([["src/billing/invoice-v2.ts", 0.25]]) });
  assert.ok((older[0]?.boosts?.recentCommit ?? 0) < boost);
});

test("a recent commit does not lift a file that does not match the question", () => {
  const chunks = buildChunks(TWINS);
  const question = "How is the invoice total rounded?";
  const plain = retrieve(question, chunks);
  const recent = retrieve(question, chunks, 6, { recency: new Map([["src/auth/session.ts", 1]]) });
  assert.deepEqual(
    recent.map((hit) => [hit.path, hit.score]),
    plain.map((hit) => [hit.path, hit.score]),
  );
  assert.ok(!recent.some((hit) => hit.path === "src/auth/session.ts"));
});

test("recency is small next to a real text match", () => {
  const pack: RepoPack = {
    id: "weights",
    name: "weights",
    description: "",
    commits: [],
    files: [
      { path: "src/export/retry.ts", language: "ts", content: "// Export retries use exponential backoff with jitter, capped at five attempts.\nexport const a = 1;\n" },
      { path: "src/export/log.ts", language: "ts", content: "// Export writes a log line.\nexport const b = 1;\n" },
    ],
  };
  const chunks = buildChunks(pack);
  const hits = retrieve("How do export retries back off with jitter?", chunks, 6, {
    recency: new Map([["src/export/log.ts", 1]]),
  });
  assert.equal(hits[0]?.path, "src/export/retry.ts", "the newest file does not outrank the file that answers");
});
