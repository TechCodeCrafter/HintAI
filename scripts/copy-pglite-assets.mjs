#!/usr/bin/env node
/**
 * PGlite resolves pglite.data / *.wasm via import.meta.url next to the bundled
 * electric-sql__pglite.mjs in the Nitro/Vercel server output. Rolldown does not
 * copy those binary artifacts, so preview/e2e crash on first DB import without this.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, "node_modules/@electric-sql/pglite/dist");
const serverFunc = join(root, ".vercel/output/functions/__server.func");
const destDir = join(serverFunc, "_libs");

const ASSETS = ["pglite.data", "pglite.wasm", "initdb.wasm"];

if (!existsSync(serverFunc)) {
  console.warn("[copy-pglite-assets] No Vercel server output — skipping.");
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
for (const name of ASSETS) {
  const from = join(srcDir, name);
  if (!existsSync(from)) {
    console.error(`[copy-pglite-assets] Missing ${from}`);
    process.exit(1);
  }
  cpSync(from, join(destDir, name));
}

console.log(`[copy-pglite-assets] Copied ${ASSETS.length} PGlite assets to ${destDir}`);
