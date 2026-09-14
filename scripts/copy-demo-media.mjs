#!/usr/bin/env node
/**
 * Landing demo mp4s are too large for git. Restore the cutaway clip from a
 * pinned commit so production serves /demo/* first-party (no jsDelivr).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PINNED = "ba30b35";
const FILES = ["meethint-demo-cutaway.mp4"];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destDir = join(root, "public/demo");
mkdirSync(destDir, { recursive: true });

for (const name of FILES) {
  const dest = join(destDir, name);
  if (existsSync(dest) && statSync(dest).size > 1024) {
    console.log(`[copy-demo-media] ${name} already present — skipping.`);
    continue;
  }
  try {
    const bytes = execSync(`git show ${PINNED}:public/demo/${name}`, {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    writeFileSync(dest, bytes);
    console.log(`[copy-demo-media] Restored ${name} from ${PINNED}.`);
  } catch (err) {
    console.error(`[copy-demo-media] Failed to restore ${name}:`, err.message);
    process.exit(1);
  }
}
