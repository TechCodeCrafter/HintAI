import assert from "node:assert/strict";
import { test } from "node:test";

import { createRegexParser } from "../regex-parser.ts";

const parser = createRegexParser();

test("TypeScript function with JSDoc becomes a function symbol", () => {
  const content = [
    "/**",
    " * Adds one to the incoming count.",
    " */",
    "export function addOne(count: number): number {",
    "  return count + 1;",
    "}",
    "",
  ].join("\n");
  const symbols = parser.parse({ path: "src/math.ts", content });
  assert.ok(symbols, "parseable TypeScript must yield symbols");
  const fn = symbols.find((s) => s.name === "addOne");
  assert.ok(fn, "should find addOne");
  assert.equal(fn.kind, "function");
  assert.ok(fn.docstring, "JSDoc immediately above the function");
  assert.match(fn.docstring.text, /Adds one/);
  assert.equal(content.slice(fn.startOffset, fn.endOffset).includes("export function addOne"), true);
  assert.equal(content.slice(fn.startOffset, fn.endOffset).includes("return count + 1"), true);
});

test("Python class with an inner docstring is captured", () => {
  const content = [
    "class Store:",
    '    """Holds rows in memory for tests."""',
    "    def get(self, key):",
    "        return self.rows[key]",
    "",
  ].join("\n");
  const symbols = parser.parse({ path: "store.py", content });
  assert.ok(symbols, "parseable Python must yield symbols");
  const cls = symbols.find((s) => s.name === "Store" && s.kind === "class");
  assert.ok(cls, "should find class Store");
  assert.ok(cls.docstring, "class docstring lives on the symbol");
  assert.match(cls.docstring.text, /Holds rows in memory/);
  const method = symbols.find((s) => s.name === "get");
  assert.ok(method, "should find get");
  assert.equal(method.kind, "method");
});

test("unsupported language returns null so the caller can window", () => {
  assert.equal(parser.parse({ path: "notes.txt", content: "just a note about upload\n" }), null);
  assert.equal(parser.parse({ path: "README.md", content: "# Title\n\nSome prose.\n" }), null);
});

test("unparseable file returns null", () => {
  const broken = "function broken(\n{{{{";
  assert.equal(parser.parse({ path: "src/broken.ts", content: broken }), null);
  assert.equal(parser.parse({ path: "src/empty.ts", content: "x = 1 + 2\nhello\n" }), null);
});
