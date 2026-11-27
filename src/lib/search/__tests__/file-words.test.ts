import assert from "node:assert/strict";
import { test } from "node:test";

import type { RepoPack } from "../../repo/types.ts";
import { buildFileWords, fileWordsReady, filesHolding, haystackOf, warmFileWords } from "../file-words.ts";
import { fileFrequency, mentions, subjectTerms } from "../subject.ts";

function file(path: string, content: string) {
  return { path, language: "ts", content };
}

function files(): RepoPack["files"] {
  return [
    file("src/Billing/retry_policy.ts", "export const MAX_ATTEMPTS = 3;\n// Retries the Settlement upload.\n"),
    file("src/billing/upload.py", "def upload_settlement(path):\n    return retry(path, attempts=3)\n"),
    file("docs/README.md", "# Billing\n\nThe exporter uploads settlement files. É-mail ops@acme.io.\n"),
    file("ops/deploy.yaml", "service: billing-exporter\nreplicas: 3\ntimeout_ms: 1500\n"),
    file("src/empty.ts", ""),
  ];
}

function pack(list = files()): RepoPack {
  return { id: "p", name: "p", description: "p", commits: [], files: list };
}

/** The count as it was before there was an index: read every file. */
function byReading(list: RepoPack["files"], needle: string): number {
  return list.filter((item) => haystackOf(item).includes(needle)).length;
}

const NEEDLES = [
  "billing", "retry", "retri", "upload", "settlement", "settle", "attempts", "max_attempts", "3", "1500",
  "timeout_ms", "ms", "e", "exporter", "readme", "yaml", "src", "ops", "acme", "nothing", "retry_policy", "_",
];

test("the index counts the same files as reading every file does", () => {
  const list = files();
  buildFileWords(list);
  assert.equal(fileWordsReady(list), true);
  for (const needle of NEEDLES) {
    assert.equal(filesHolding(list, needle), byReading(list, needle), needle);
  }
});

test("a term the index cannot answer is left to the reader", () => {
  const list = files();
  assert.equal(filesHolding(list, "billing"), null, "not built yet");
  buildFileWords(list);
  for (const needle of ["billing-exporter", "ops@acme", "é", "max attempts", "a.b", ""]) {
    assert.equal(filesHolding(list, needle), null, needle);
  }
});

test("document frequency and the subject of a question are the same with and without the index", () => {
  const questions = [
    ["billing", "retry", "upload"],
    ["settlement", "exporter", "timeout"],
    ["attempts", "retries", "uploaded"],
    ["billing-exporter", "replicas"],
    ["kubernetes", "helm"],
    ["the", "src", "billing"],
  ];
  const plain = pack();
  const before = questions.map((terms) => ({
    df: terms.map((term) => fileFrequency(term, plain)),
    subject: subjectTerms(terms, plain),
  }));
  const indexed = pack();
  buildFileWords(indexed.files);
  const after = questions.map((terms) => ({
    df: terms.map((term) => fileFrequency(term, indexed)),
    subject: subjectTerms(terms, indexed),
  }));
  assert.deepEqual(after, before);
  // And both agree with `mentions`, the rule admission states.
  for (const terms of questions) {
    for (const term of terms) {
      const expected = plain.files.filter((item) => mentions(haystackOf(item), term)).length;
      assert.equal(fileFrequency(term, indexed), expected, term);
    }
  }
});

test("a pack copied to change its exclusions keeps the counts of its files", () => {
  const first = pack();
  buildFileWords(first.files);
  const copy: RepoPack = { ...first, excludePatterns: ["docs/**"] };
  assert.equal(fileWordsReady(copy.files), true);
  assert.equal(fileFrequency("billing", copy), fileFrequency("billing", first));
});

test("the index is built in slices, and a cancelled build leaves nothing behind", async () => {
  const many = Array.from({ length: 300 }, (_, index) => file(`src/f${index}.ts`, `export const value_${index} = "shared";\n`));
  let pauses = 0;
  const built = await warmFileWords(many, {
    sliceMs: 0,
    pause: async () => {
      pauses += 1;
    },
  });
  assert.equal(built, true);
  assert.ok(pauses > 10, `paused ${pauses} times`);
  assert.equal(filesHolding(many, "shared"), 300);
  assert.equal(filesHolding(many, "value_7"), 11);
  // A second call finds it built and does no work.
  assert.equal(await warmFileWords(many, { pause: async () => assert.fail("no work expected") }), true);

  const other = many.map((item) => ({ ...item }));
  let turns = 0;
  const cancelled = await warmFileWords(other, {
    sliceMs: 0,
    pause: async () => {
      turns += 1;
    },
    isCancelled: () => turns >= 3,
  });
  assert.equal(cancelled, false);
  assert.equal(fileWordsReady(other), false);
  assert.equal(filesHolding(other, "shared"), null);
  // Cancelling is not final: the same files can be warmed again.
  assert.equal(await warmFileWords(other, { sliceMs: 0, pause: async () => undefined }), true);
  assert.equal(filesHolding(other, "shared"), 300);
});

test("two callers warming the same files share one build", async () => {
  const list = files();
  const [a, b] = await Promise.all([warmFileWords(list), warmFileWords(list)]);
  assert.deepEqual([a, b], [true, true]);
});
