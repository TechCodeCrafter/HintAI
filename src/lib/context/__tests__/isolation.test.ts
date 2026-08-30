import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { persistPackAsContext } from "../service.ts";
import { createMemoryRepository } from "../memory.ts";
import { indexContext } from "../chunk-index.ts";
import { hydrateContext, runtimeFromPack } from "../hydrate.ts";
import { localCard } from "../../search/local-card.ts";
import { retrieve } from "../../search/retrieve.ts";
import type { RepoPack } from "../../repo/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "../../..");

const ALPHA = "ALPHA_ONLY_92817";
const BETA = "BETA_ONLY_38111";

const PACK_A: RepoPack = {
  id: "a",
  name: "payments-backend",
  description: "A",
  commits: [],
  files: [
    {
      path: "src/exporter/retry.ts",
      language: "ts",
      content: `/**
 * Renew the quorumlease before the exporter retries a failed settlement.
 * Unique token ${ALPHA} lives only in context A.
 */
export const MAX_ATTEMPTS = 3;

export function retry() {
  return MAX_ATTEMPTS;
}
`,
    },
    {
      path: "src/exporter/index.ts",
      language: "ts",
      content: `/** Settlement exporter for merchant payouts. */
export function exportSettlement() {
  return "csv";
}
`,
    },
  ],
};

const PACK_B: RepoPack = {
  id: "b",
  name: "cs401-notes",
  description: "B",
  commits: [],
  files: [
    {
      path: "src/notes/lecture.ts",
      language: "ts",
      content: `/**
 * Lecture notes on lamportclocks ordering for CS401.
 * Unique token ${BETA} lives only in context B.
 */
export const topic = "clocks";

export function orderEvents() {
  return topic;
}
`,
    },
    {
      path: "src/notes/index.ts",
      language: "ts",
      content: `/** Course notes for distributed systems. */
export function outline() {
  return "cs401";
}
`,
    },
  ],
};

function collectTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTs(path));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

test("search, store, and cockpit never import Dexie", () => {
  const files = [
    ...collectTs(join(srcRoot, "lib/search")),
    join(srcRoot, "lib/store.ts"),
    join(srcRoot, "components/cockpit.tsx"),
    join(srcRoot, "lib/context/hydrate.ts"),
    join(srcRoot, "lib/context/repository.ts"),
    join(srcRoot, "lib/context/types.ts"),
    join(srcRoot, "lib/context/migration.ts"),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes('from "dexie"'), false, file);
    assert.equal(text.includes("MeetHintDatabase"), false, file);
    assert.equal(text.includes("storage/indexeddb"), false, file);
  }
});

test("activating B cannot retrieve a token that only lives in A", async () => {
  const repo = createMemoryRepository();
  const a = await persistPackAsContext(PACK_A, repo);
  const b = await persistPackAsContext(PACK_B, repo);

  const packA = runtimeFromPack(await hydrateContext(repo, a.context.id));
  const packB = await indexContext(repo, b.context.id);
  const reloadedB = await indexContext(repo, b.context.id);

  assert.ok(packA.pack.files.some((f) => f.content.includes("quorumlease")));
  assert.equal(
    packB.pack.files.some((f) => f.content.includes("quorumlease")),
    false,
    "B must not store a token that only lives in A",
  );

  const question = "How does the quorumlease renew?";
  const hitsA = retrieve(question, packA.chunks);
  assert.ok(
    hitsA.some((hit) => hit.text.includes("quorumlease")),
    "A must retrieve its own unique token",
  );
  for (const runtime of [packB, reloadedB]) {
    const hitsB = retrieve(question, runtime.chunks);
    assert.equal(
      hitsB.filter((hit) => hit.text.includes("quorumlease")).length,
      0,
      "B must not retrieve a token that only lives in A",
    );
    const cardB = localCard(question, hitsB, runtime.pack, 0, null);
    assert.equal(cardB.say, null, "B must stay silent on a question only A can answer");
    assert.equal(
      runtime.chunks.some((chunk) => chunk.text.includes(ALPHA)),
      false,
      "cached A chunks must not appear after B is indexed",
    );
    const alphaHits = retrieve(ALPHA, runtime.chunks);
    assert.equal(alphaHits.filter((hit) => hit.text.includes(ALPHA)).length, 0);
    assert.ok(runtime.chunks.some((chunk) => chunk.text.includes(BETA)));
  }
});
