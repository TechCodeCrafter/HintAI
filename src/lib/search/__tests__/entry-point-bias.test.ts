import assert from "node:assert/strict";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import type { Card, RepoPack } from "../../repo/types.ts";
import { localCard } from "../local-card.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

/**
 * The README and shallow entry points (main/app/index/server) speak for the
 * whole app. These tests pin that they speak only when the whole app is what
 * was asked about, and that a fact living in one nested file is found there.
 */

function file(path: string, content: string) {
  return { path, language: path.split(".").pop() ?? "txt", content };
}

const PACK: RepoPack = {
  id: "fixture",
  name: "ledger-service",
  description: "",
  commits: [],
  files: [
    file(
      "README.md",
      ["# Ledger", "", "Ledger reconciles merchant payouts against the bank statement every night.", "", "## Setup", "", "Run the installer, then start the worker."].join("\n"),
    ),
    file("main.ts", ["/** Process bootstrap. Reads configuration and starts the worker. */", "export function boot() {", "  return start();", "}"].join("\n")),
    file("app.ts", ["/** Wires the HTTP handlers together. */", "export const handlers = [];"].join("\n")),
    file("index.ts", ["/** Re-exports the public modules. */", 'export * from "./app";'].join("\n")),
    file("server.ts", ["/** Listens on the configured port. */", "export function listen(port: number) {", "  return port;", "}"].join("\n")),
    file(
      "src/exporter/retry.ts",
      [
        "/**",
        " * Backoff policy for payout exports.",
        " * Each attempt waits twice as long as the one before, starting at 400 milliseconds.",
        " */",
        "export function backoffDelay(attempt: number) {",
        "  return 400 * 2 ** attempt;",
        "}",
      ].join("\n"),
    ),
    file("src/auth/middleware.ts", ["/** Rejects a request whose signature header is missing. */", "export function guard() {", "  return true;", "}"].join("\n")),
  ],
};

const CHUNKS = buildChunks(PACK);
const NORTHSTAR_CHUNKS = buildChunks(NORTHSTAR);

function topFiles(query: string, chunks = CHUNKS, count = 3): string[] {
  return [...new Set(retrieve(query, chunks).map((hit) => hit.path))].slice(0, count);
}

function filePaths(card: Card): string[] {
  return card.citations.flatMap((cite) => (cite.kind === "file" ? [cite.path] : []));
}

function northstar(query: string): Card {
  return localCard(query, retrieve(query, NORTHSTAR_CHUNKS), NORTHSTAR, 0, null);
}

test("a fact that lives only in a nested file ranks that file first, past entry points that share a word with the question", () => {
  // "main", "app" and "server" are file names here. None of those files says
  // anything about backoff.
  for (const query of [
    "What is the main backoff policy the app server uses?",
    "How does the app server back off between export attempts?",
    "What backoff does the main index use for payout exports?",
  ]) {
    const files = topFiles(query);
    assert.equal(files[0], "src/exporter/retry.ts", `${query} -> ${files.join(", ")}`);
  }
});

test("a file name with nothing behind it scores below a body that answers", () => {
  const hits = retrieve("What is the main backoff policy the app server uses?", CHUNKS);
  const score = (path: string) => Math.max(0, ...hits.filter((hit) => hit.path === path).map((hit) => hit.score));
  const retry = score("src/exporter/retry.ts");
  for (const entry of ["main.ts", "app.ts", "server.ts"]) {
    assert.ok(score(entry) < retry / 2, `${entry} ${score(entry)} vs retry.ts ${retry}`);
  }
});

test("a question the path fully names still lands on that file", () => {
  assert.equal(topFiles("What does the auth middleware do?")[0], "src/auth/middleware.ts");
  assert.equal(topFiles("What does the server do?")[0], "server.ts");
  assert.equal(topFiles("What does retry.ts do?")[0], "src/exporter/retry.ts");
});

test("the README and entry points get no score from a question that shares no word with them", () => {
  assert.deepEqual(retrieve("What is our parental leave policy for contractors?", CHUNKS).filter((hit) => hit.path === "README.md"), []);
  // "router" and "structure" used to hand every entry point and file head a
  // score, and the README a flat bonus, with no word in common.
  assert.deepEqual(retrieve("Which router terminates kubernetes ingress?", CHUNKS), []);
  assert.deepEqual(retrieve("What is the structure of the quarterly bonus plan?", CHUNKS), []);
  for (const query of ["Which router terminates kubernetes ingress?", "What is the structure of the quarterly bonus plan?"]) {
    const paths = retrieve(query, NORTHSTAR_CHUNKS).map((hit) => hit.path);
    assert.ok(!paths.includes("README.md"), `${query} -> ${paths.join(", ")}`);
  }
});

test("a specific question that says \"the app\" is answered from the file that holds the answer, not the README", () => {
  for (const query of [
    "How does the app retry failed exports?",
    "How does the system cap retry attempts?",
    "What is the high-level reason retries are capped at three?",
  ]) {
    const hits = retrieve(query, NORTHSTAR_CHUNKS);
    assert.ok(
      [...new Set(hits.map((hit) => hit.path))].slice(0, 3).includes("src/exporter/retry.ts"),
      `${query}: retry.ts in the top 3`,
    );
    const card = northstar(query);
    assert.ok(!filePaths(card).includes("README.md"), `${query} cited ${filePaths(card).join(", ")}`);
    assert.doesNotMatch(card.say ?? "", /is a service/);
  }
});

test("a question about the whole app still opens the README", () => {
  for (const query of [
    "What is the architecture of this application?",
    "How does this app work?",
    "Give me a high-level overview of the system",
    "What does this app do?",
  ]) {
    const card = northstar(query);
    assert.ok(card.say, query);
    assert.deepEqual(filePaths(card), ["README.md"], query);
  }
  // And the whole-app path still ranks the README and an entry point up front.
  const files = topFiles("What is the architecture of this application?", NORTHSTAR_CHUNKS);
  assert.ok(files.includes("README.md"));
  assert.ok(files.includes("src/exporter/index.ts"));
});
