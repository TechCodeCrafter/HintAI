#!/usr/bin/env node
/**
 * Run Impeccable detect against rendered MeetHint surfaces on the e2e preview server.
 *
 * Uses the same preview URL as Playwright (127.0.0.1:4173). In CI, Playwright boots
 * the server; locally run `npm run build && npm run preview:e2e` or `npm run design:detect`
 * which starts preview when nothing is listening.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  E2E_PREVIEW_BOOT,
  E2E_PREVIEW_COMMAND,
  E2E_PREVIEW_URL,
} from "./e2e-preview-shared.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baseURL = (process.env.PLAYWRIGHT_BASE_URL ?? E2E_PREVIEW_URL).replace(/\/$/, "");

/** Canonical surfaces — one entry per route. */
const SURFACES = [
  { name: "landing", path: "/" },
  { name: "cockpit", path: "/app" },
];

const impeccableBin = join(root, ".cursor/skills/impeccable/scripts/impeccable");
const impeccableCmd = join(root, ".cursor/skills/impeccable/scripts/impeccable.cmd");
const launcher = process.platform === "win32" ? impeccableCmd : impeccableBin;
const lastRunPath = join(root, ".impeccable/last-run.json");

if (!existsSync(launcher)) {
  console.error(
    "Impeccable is not installed. Run: npx impeccable install --providers=cursor --scope=project -y",
  );
  process.exit(1);
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* wait */
  }
}

function waitForServer(url, attempts = 120) {
  for (let i = 0; i < attempts; i += 1) {
    const res = spawnSync("curl", ["-sf", "-o", "/dev/null", url], { encoding: "utf8" });
    if (res.status === 0) return true;
    sleepMs(1000);
  }
  return false;
}

let previewChild = null;

function startPreviewIfNeeded() {
  if (waitForServer(baseURL, 2)) return;

  console.log(`[design:detect] Starting preview at ${baseURL}…`);
  const needsBuild =
    !existsSync(join(root, ".vercel/output/static/index.html")) &&
    !existsSync(join(root, "dist", "index.html"));
  const boot = needsBuild ? E2E_PREVIEW_BOOT : E2E_PREVIEW_COMMAND;
  previewChild = spawn(boot, {
    cwd: root,
    shell: true,
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  if (previewChild.unref) previewChild.unref();

  if (!waitForServer(baseURL)) {
    console.error(`Server not reachable at ${baseURL} after boot (${boot}).`);
    process.exit(1);
  }
}

function parseDetectJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return { findings: [] };
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, findings: [] };
  }
}

function countFindings(payload) {
  if (Array.isArray(payload)) {
    return payload.filter((item) => item?.advisory !== true).length;
  }
  if (Array.isArray(payload?.findings)) return payload.findings.length;
  if (typeof payload?.summary?.primary === "number") return payload.summary.primary;
  if (typeof payload?.count === "number") return payload.count;
  return 0;
}

startPreviewIfNeeded();

mkdirSync(join(root, ".impeccable"), { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  surfaces: [],
  totalFindings: 0,
};

let exitCode = 0;

for (const surface of SURFACES) {
  const url = `${baseURL}${surface.path}`;
  console.log(`\n${"=".repeat(72)}\nDesign detect: ${surface.name} (${url})\n${"=".repeat(72)}`);
  const run = spawnSync(launcher, ["detect", "--json", url], {
    cwd: root,
    encoding: "utf8",
  });
  if (run.stderr) process.stderr.write(run.stderr);

  const payload = parseDetectJson(run.stdout);
  const findingCount = countFindings(payload);
  report.surfaces.push({ name: surface.name, url, findingCount, payload });
  report.totalFindings += findingCount;

  if (run.stdout) process.stdout.write(run.stdout);

  if (run.status === 2) exitCode = 2;
  else if (run.status !== 0 && exitCode === 0) exitCode = run.status ?? 1;
}

writeFileSync(lastRunPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`\n[design:detect] ${report.totalFindings} primary finding(s) — wrote ${lastRunPath}`);

if (process.env.DESIGN_DETECT_WARN_ONLY === "1" && exitCode === 2) {
  console.warn("[design:detect] WARNING-ONLY mode — exiting 0 despite findings.");
  process.exit(0);
}

process.exit(exitCode);
