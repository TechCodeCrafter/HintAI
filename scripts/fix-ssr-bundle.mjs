#!/usr/bin/env node
/**
 * Nitro/TanStack Start sometimes emit a broken SSR entry:
 * - `ssr.mjs` exports undefined `ssr_exports` instead of `server_default`
 * - `ssr2.mjs` imports __exportAll from `ssr.mjs`, creating a circular init bug
 *
 * Patch the Vercel server bundle so preview/production can render HTML again.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ssrDir = join(root, ".vercel/output/functions/__server.func/_ssr");
const ssrPath = join(ssrDir, "ssr.mjs");
const ssr2Path = join(ssrDir, "ssr2.mjs");

if (!existsSync(ssrPath) || !existsSync(ssr2Path)) {
  console.warn("[fix-ssr-bundle] No SSR output — skipping.");
  process.exit(0);
}

let ssr = readFileSync(ssrPath, "utf8");
const brokenExport = "ssr_exports as s";
if (ssr.includes(brokenExport)) {
  ssr = ssr.replace(brokenExport, "server_default as s");
  writeFileSync(ssrPath, ssr);
  console.log("[fix-ssr-bundle] Patched ssr.mjs export (ssr_exports → server_default)");
}

let ssr2 = readFileSync(ssr2Path, "utf8");
const circularImport = 'import { c as __exportAll$1 } from "./ssr.mjs";';
const inlineExportAll = `var __defProp$fix = Object.defineProperty;
var __exportAll$1 = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp$fix(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp$fix(target, Symbol.toStringTag, { value: "Module" });
	return target;
};`;

if (ssr2.includes(circularImport)) {
  ssr2 = ssr2.replace(circularImport, inlineExportAll);
  writeFileSync(ssr2Path, ssr2);
  console.log("[fix-ssr-bundle] Inlined __exportAll in ssr2.mjs (broke circular import)");
}

console.log("[fix-ssr-bundle] OK");
