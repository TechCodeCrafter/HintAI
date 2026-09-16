#!/usr/bin/env node
/**
 * Fail when an auth-enabled build could still bind the shared dev-user fallback.
 *
 * 1. Source invariants — dev-user paths are gated on `!authEnabled`.
 * 2. Optional client bundle scan — when `dist/client` exists, dev-only user
 *    strings must not appear (dead-code eliminated for auth-enabled builds).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { buildAuthEnabled, authEnabledFromEnvValue } from "./check-auth-invariant.mjs";
import { isMainModule, projectRoot } from "./with-app-env.mjs";

const DEV_USER_MARKERS = ["Dev User", "dev@example.com", "isDevFallback:!0"];

const SOURCE_GATES = [
  {
    file: "src/lib/store.ts",
    pattern: /if \(typeof window !== "undefined" && !authEnabled\)/,
    label: "store boot binds dev-user only when auth is disabled",
  },
  {
    file: "src/lib/auth/account-session.ts",
    pattern: /if \(!authEnabled\)/,
    label: "account session uses dev-user only when auth is disabled",
  },
  {
    file: "src/lib/auth/use-current-user.ts",
    pattern: /if \(!authEnabled\) return \{ user: DEV_USER/,
    label: "useCurrentUserState returns DEV_USER only when auth is disabled",
  },
  {
    file: "src/components/require-auth.tsx",
    pattern: /if \(!authEnabled\) return <>\{children\}<\/>;/,
    label: "RequireAuth bypasses gate only when auth is disabled",
  },
];

export function assertAuthEnabledSourceGates(root = projectRoot()) {
  if (!buildAuthEnabled(root)) {
    return { ok: true, skipped: true, reason: "auth disabled in build env" };
  }
  const failures = [];
  for (const gate of SOURCE_GATES) {
    const path = join(root, gate.file);
    const source = readFileSync(path, "utf8");
    if (!gate.pattern.test(source)) failures.push(gate.label);
  }
  if (failures.length > 0) {
    return { ok: false, reason: failures.join("; ") };
  }
  return { ok: true };
}

export function assertAuthEnabledClientBundle(root = projectRoot()) {
  if (!buildAuthEnabled(root)) {
    return { ok: true, skipped: true, reason: "auth disabled in build env" };
  }
  const clientDir = join(root, "dist", "client");
  if (!existsSync(clientDir)) {
    return { ok: true, skipped: true, reason: "dist/client not built" };
  }
  const stack = [clientDir];
  let haystack = "";
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name.endsWith(".js")) haystack += readFileSync(path, "utf8");
    }
  }
  const hit = DEV_USER_MARKERS.find((marker) => haystack.includes(marker));
  if (hit) {
    return {
      ok: false,
      reason: `auth-enabled client bundle still contains dev-user marker "${hit}"`,
    };
  }
  return { ok: true };
}

function main() {
  const root = projectRoot();
  if (!authEnabledFromEnvValue(process.env.VITE_AUTH_ENABLED ?? "true")) {
    console.error("[production-auth-build] FAIL — VITE_AUTH_ENABLED must not be false");
    process.exit(1);
  }
  const source = assertAuthEnabledSourceGates(root);
  if (!source.ok) {
    console.error(`[production-auth-build] FAIL — ${source.reason}`);
    process.exit(1);
  }
  console.log("[production-auth-build] OK — dev-user paths gated in source");

  const bundle = assertAuthEnabledClientBundle(root);
  if (!bundle.ok) {
    console.error(`[production-auth-build] FAIL — ${bundle.reason}`);
    process.exit(1);
  }
  if (bundle.skipped) {
    console.log(`[production-auth-build] SKIP — client bundle scan (${bundle.reason})`);
  } else {
    console.log("[production-auth-build] OK — auth-enabled client bundle has no dev-user fallback");
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
