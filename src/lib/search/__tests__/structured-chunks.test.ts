import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { CHUNKER_VERSION, USE_STRUCTURED_CHUNKER } from "../../context/index-versions.ts";
import { chunksFromFile, indexContext } from "../../context/chunk-index.ts";
import { createMemoryRepository } from "../../context/memory.ts";
import { persistPackAsContext, setContextRepository } from "../../context/service.ts";
import { createRegexParser } from "../../repo/parsers/regex-parser.ts";
import { NORTHSTAR } from "../../repo/northstar.ts";
import { buildStructuredChunks } from "../../repo/structured-chunks.ts";
import type { RepoPack } from "../../repo/types.ts";
import { buildChunks } from "../retrieve.ts";

const PARSER = createRegexParser();

function file(path: string, content: string) {
  return { path, language: path.split(".").pop() ?? "txt", content };
}

const TS = `/**
 * Adds one to the incoming count.
 */
export function addOne(count: number): number {
  return count + 1;
}
`;

const NOTES = "plain notes about the upload flow\nand a second line\n";

afterEach(() => {
  setContextRepository(null);
});

test("USE_STRUCTURED_CHUNKER stays off and CHUNKER_VERSION is unchanged", () => {
  assert.equal(USE_STRUCTURED_CHUNKER, false);
  assert.equal(CHUNKER_VERSION, 1);
});

test("a TypeScript file gets structured chunks with symbol names", () => {
  const chunks = buildStructuredChunks({ path: "src/math.ts", content: TS }, PARSER);
  assert.ok(chunks && chunks.length > 0, "structured chunks expected");
  assert.ok(
    chunks.some((c) => c.symbol === "addOne" && c.symbolKind === "function"),
    `symbols: ${chunks.map((c) => c.symbol).join(",")}`,
  );
  assert.ok(chunks.every((c) => c.id.includes("@")), "structured ids are path:name@line");
  assert.ok(chunks.every((c) => TS.slice(c.startOffset).startsWith(c.text) || TS.includes(c.text)));
});

test("plain text falls back to window chunks", () => {
  const pack: RepoPack = {
    id: "plain",
    name: "plain",
    description: "",
    commits: [],
    files: [file("notes.txt", NOTES)],
  };
  const chunks = buildChunks(pack, { structured: true });
  assert.ok(chunks.length > 0);
  assert.ok(chunks.every((c) => !c.symbol), "windows do not carry symbols");
  assert.ok(chunks.every((c) => /:\d+-\d+$/.test(c.id)), `window ids, got ${chunks.map((c) => c.id)}`);
});

test("a mixed repo has both structured and window chunks", () => {
  const pack: RepoPack = {
    id: "mixed",
    name: "mixed",
    description: "",
    commits: [],
    files: [file("src/math.ts", TS), file("notes.txt", NOTES), file("README.md", "# Mixed\n\nHello.\n")],
  };
  const chunks = buildChunks(pack, { structured: true });
  const ts = chunks.filter((c) => c.path === "src/math.ts");
  const notes = chunks.filter((c) => c.path === "notes.txt");
  const readme = chunks.filter((c) => c.path === "README.md");
  assert.ok(ts.some((c) => c.symbol === "addOne"), "TS file is structured");
  assert.ok(notes.every((c) => /:\d+-\d+$/.test(c.id)), "txt falls back to windows");
  assert.ok(readme.every((c) => /:\d+-\d+$/.test(c.id)), "markdown falls back to windows");
});

test("the default buildChunks path is still the 28-line window", () => {
  const fromDefault = buildChunks(NORTHSTAR).filter((c) => c.kind === "code");
  const fromOff = buildChunks(NORTHSTAR, { structured: false }).filter((c) => c.kind === "code");
  assert.deepEqual(
    fromDefault.map((c) => c.id),
    fromOff.map((c) => c.id),
  );
  assert.ok(fromDefault.every((c) => /:\d+-\d+$/.test(c.id)));
  assert.ok(fromDefault.every((c) => c.symbol === undefined));
});

test("indexContext accepts both window and structured chunk types", async () => {
  const pack: RepoPack = {
    id: "idx-mixed",
    name: "idx-mixed",
    description: "",
    commits: [],
    files: [file("src/math.ts", TS), file("notes.txt", NOTES)],
  };

  const windows = createMemoryRepository();
  const { context: windowCtx } = await persistPackAsContext(pack, windows);
  const windowed = await indexContext(windows, windowCtx.id, { structured: false });
  assert.ok(windowed.chunks.length > 0);
  assert.ok(windowed.chunks.filter((c) => c.kind === "code").every((c) => /:\d+-\d+$/.test(c.id)));

  const structured = createMemoryRepository();
  const { context: structuredCtx } = await persistPackAsContext(pack, structured);
  const indexed = await indexContext(structured, structuredCtx.id, { structured: true });
  assert.ok(indexed.chunks.some((c) => "symbol" in c && c.symbol === "addOne"));
  assert.ok(indexed.chunks.some((c) => c.path === "notes.txt" && /:\d+-\d+$/.test(c.id)));

  const fromFile = chunksFromFile(file("src/math.ts", TS), { structured: true });
  assert.ok(fromFile.some((c) => c.symbol === "addOne"));
});
