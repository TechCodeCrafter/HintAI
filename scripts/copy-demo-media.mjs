#!/usr/bin/env node
/**
 * Landing demo mp4s are too large for git. Restore the cutaway clip from a
 * pinned commit so production serves /demo/* first-party (no jsDelivr).
 *
 * Vercel (and other CI) use depth-1 clones — the pin may not exist locally until
 * we fetch it or fall back to GitHub raw.
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Canonical landing demo clip (served at /demo/meethint-demo-cutaway.mp4). */
const DEMO_CLIP = "meethint-demo-cutaway.mp4";
/** Preferred source — brag export used for the landing product cut. */
const LOCAL_SOURCE = join("assets", "brag", "ad.mp4");

/** Last commit on main lineage that still tracked the mp4 in git. */
const PINNED_COMMITS = ["54057ff", "ba30b35"];
const FILES = [DEMO_CLIP];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destDir = join(root, "public/demo");
mkdirSync(destDir, { recursive: true });

function repoSlug() {
  try {
    const url = execSync("git remote get-url origin", { cwd: root, encoding: "utf8" }).trim();
    const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/i);
    if (match) return match[1];
  } catch {
    /* ignore */
  }
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const url = pkg.repository?.url ?? "";
    const match = url.match(/github\.com\/(.+?)(?:\.git)?$/i);
    if (match) return match[1];
  } catch {
    /* ignore */
  }
  return "TechCodeCrafter/HintAI";
}

function gitShow(commit, name) {
  return execSync(`git show ${commit}:public/demo/${name}`, {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function fetchCommit(commit) {
  execSync(`git fetch --depth=1 origin ${commit}`, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function downloadFromGitHub(commit, name) {
  const slug = repoSlug();
  const url = `https://raw.githubusercontent.com/${slug}/${commit}/public/demo/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1024) throw new Error(`unexpected size ${bytes.length}`);
  return bytes;
}

function copyFromAssets(name) {
  const source = join(root, LOCAL_SOURCE);
  const dest = join(destDir, name);
  if (!existsSync(source)) return false;
  copyFileSync(source, dest);
  console.log(`[copy-demo-media] Copied ${LOCAL_SOURCE} → public/demo/${name}.`);
  return true;
}

async function restoreFile(name) {
  const dest = join(destDir, name);
  if (name === DEMO_CLIP && copyFromAssets(name)) return;

  if (existsSync(dest) && statSync(dest).size > 1024) {
    console.log(`[copy-demo-media] ${name} already present — skipping.`);
    return;
  }

  const errors = [];
  for (const commit of PINNED_COMMITS) {
    try {
      writeFileSync(dest, gitShow(commit, name));
      console.log(`[copy-demo-media] Restored ${name} from ${commit}.`);
      return;
    } catch (err) {
      errors.push(`git show ${commit}: ${err.message?.trim() ?? err}`);
    }

    try {
      fetchCommit(commit);
      writeFileSync(dest, gitShow(commit, name));
      console.log(`[copy-demo-media] Restored ${name} from ${commit} after fetch.`);
      return;
    } catch (err) {
      errors.push(`fetch+show ${commit}: ${err.message?.trim() ?? err}`);
    }

    try {
      const bytes = await downloadFromGitHub(commit, name);
      writeFileSync(dest, bytes);
      console.log(`[copy-demo-media] Downloaded ${name} from GitHub @ ${commit}.`);
      return;
    } catch (err) {
      errors.push(`http ${commit}: ${err.message?.trim() ?? err}`);
    }
  }

  console.error(`[copy-demo-media] Failed to restore ${name}:`);
  for (const line of errors) console.error(`  - ${line}`);
  process.exit(1);
}

for (const name of FILES) {
  await restoreFile(name);
}
