#!/usr/bin/env node
/**
 * Run a command with `.grok/app-env.json` merged into its environment.
 *
 * `dev`, `build` and `preview` all route through this wrapper, so the dev
 * server, the built bundle and the preview server can never disagree about
 * `VITE_AUTH_ENABLED` — a divergence that only shows up as a built-output
 * mismatch long after the fact. Anything that starts Vite directly bypasses it.
 *
 * Only `VITE_`-prefixed keys are honored: the file is a build flag carrier, not
 * a secret store, and only `VITE_` vars reach the browser anyway. A real
 * `process.env` entry always wins, so an explicit override still works.
 *
 * That precedence also means the file governs this workspace only. A deployed
 * build runs with the provider's project env, where the deployer sets
 * `VITE_AUTH_ENABLED` itself (today unconditionally `"true"`), so the deployed
 * flag is the platform's, not this file's.
 *
 * Vite picks the values up because `loadEnv` prefix-matches entries already in
 * `process.env`, which is why the merge has to happen before Vite starts.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { constants as osConstants } from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAppVersion } from "./resolve-app-version.mjs";

export const APP_ENV_REL_PATH = ".grok/app-env.json";

const VITE_PREFIX = "VITE_";

/**
 * Parse an app-env document, keeping only `VITE_`-prefixed string entries.
 * Anything unparseable is an empty environment — a workspace without the file
 * must behave exactly like today (auth on, no overrides).
 */
export function parseAppEnv(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const env = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith(VITE_PREFIX)) continue;
    if (typeof value !== "string") continue;
    env[key] = value;
  }
  return env;
}

/** The app env recorded under `root`, or `{}` when the file is absent. */
export function readAppEnv(root) {
  try {
    return parseAppEnv(readFileSync(join(root, APP_ENV_REL_PATH), "utf8"));
  } catch {
    return {};
  }
}

/** File values under the process environment: an explicit override wins. */
export function mergeAppEnv(appEnv, processEnv) {
  const merged = { ...appEnv, ...processEnv };
  if (!merged.VITE_APP_VERSION?.trim()) {
    merged.VITE_APP_VERSION = resolveAppVersion(merged);
  }
  return merged;
}

/**
 * Translate a child's `exit` `(code, signal)` into this process's exit status.
 *
 * Do not re-raise the signal with `process.kill(process.pid, signal)`: under
 * qemu-user (amd64 image builds on an arm host) a self-directed signal is
 * routinely delivered as SIGSEGV to the wrong process, which takes down the
 * test worker and fails the image build. `128 + signo` is what a shell reports
 * for a signal-killed command, so a cancelled `vite build` is still a failure.
 */
export function exitStatusFromChild(code, signal) {
  if (signal) {
    const signo = osConstants.signals[signal];
    return 128 + (typeof signo === "number" ? signo : 1);
  }
  return code ?? 1;
}

/** The workspace root (this file lives in `<root>/scripts/`). */
export function projectRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Whether `moduleUrl` is the script node was asked to run.
 *
 * Both sides are resolved through symlinks: node realpaths `import.meta.url`
 * but leaves `process.argv[1]` as typed, so comparing them raw makes a CLI
 * launched through a symlinked path (`/tmp` on macOS) a silent no-op.
 */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

/**
 * Decide how to launch `command`.
 *
 * Windows ships no extensionless `vite`, only `vite.cmd`, and Node refuses to
 * spawn a `.cmd` without a shell (CVE-2024-27980). So a bare bin name is routed
 * through `cmd.exe` explicitly. Spawning `cmd.exe` by path keeps `shell: true`
 * off, which is what Node warns about when unescaped args are passed through it
 * (DEP0190).
 *
 * A command carrying a path or an extension is spawned directly, never through a
 * shell: `cmd.exe` splits on spaces, so a wrapped
 * `C:\Program Files\nodejs\node.exe` would be torn in half.
 *
 * Returns `{ file, args }` to hand to `spawn`.
 */
export function spawnPlan(command, args, env = process.env, root = projectRoot()) {
  const bare =
    process.platform === "win32" &&
    !command.includes("/") &&
    !command.includes("\\") &&
    !/\.[a-z]+$/i.test(command);
  if (!bare) return { file: command, args };

  const shim = `${command}.cmd`;
  const dirs = [
    ...String(env.PATH ?? "").split(path.delimiter),
    join(root, "node_modules", ".bin"),
  ];
  if (!dirs.some((dir) => dir && existsSync(join(dir, shim)))) {
    return { file: command, args };
  }
  const comspec = env.ComSpec || env.COMSPEC || "cmd.exe";
  // The shim is a bare name by the check above, so it carries no spaces and
  // needs no quoting. `cmd.exe /s /c` strips one layer of outer quotes, so
  // quoting it here would hand cmd a literal `"vite.cmd"` it cannot resolve.
  const line = [shim, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");
  return { file: comspec, args: ["/d", "/s", "/c", line] };
}

function main(argv) {
  const [command, ...args] = argv;
  if (!command) {
    console.error("usage: node scripts/with-app-env.mjs <command> [args…]");
    process.exit(2);
  }
  const env = mergeAppEnv(readAppEnv(projectRoot()), process.env);
  const { file, args: childArgs } = spawnPlan(command, args, env);
  const child = spawn(file, childArgs, { stdio: "inherit", env });
  // The dev server is long-running and is stopped by signalling this wrapper.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (err) => {
    console.error(`[with-app-env] failed to run ${command}:`, err?.message || err);
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    process.exit(exitStatusFromChild(code, signal));
  });
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2));
}
