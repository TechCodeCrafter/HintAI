import assert from "node:assert/strict";
import { test } from "node:test";

import { applyTheme, readTheme, THEME_BOOT } from "./theme.ts";

test("boot script writes a stored light theme before paint", () => {
  assert.match(THEME_BOOT, /meethint-theme/);
  assert.match(THEME_BOOT, /dataset\.theme/);
  assert.match(THEME_BOOT, /prefers-color-scheme: light/);
});

test("applyTheme persists and paints light tokens", () => {
  const store = new Map<string, string>();
  const html = { dataset: {} as Record<string, string>, style: { colorScheme: "" } };
  const meta = {
    content: "#07090c",
    setAttribute(_name: string, value: string) {
      this.content = value;
    },
  };
  (globalThis as { document?: unknown; localStorage?: Storage }).document = {
    documentElement: html,
    querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' ? meta : null),
  };
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  applyTheme("light");
  assert.equal(html.dataset.theme, "light");
  assert.equal(html.style.colorScheme, "light");
  assert.equal(meta.content, "#f4f5f7");
  assert.equal(readTheme(), "light");
});
