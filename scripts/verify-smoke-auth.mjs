#!/usr/bin/env node
/**
 * Verify saved smoke Chrome profiles authenticate on production before full smoke.
 * When both a and b are checked, they must resolve to different Better Auth users.
 *
 * Usage:
 *   node scripts/verify-smoke-auth.mjs a
 *   node scripts/verify-smoke-auth.mjs a b
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readProfileSession } from "./smoke-session.mjs";
import { isMainModule, projectRoot } from "./with-app-env.mjs";

function profileDir(user) {
  const fromEnv = process.env[`MEETHINT_SMOKE_PROFILE_${user.toUpperCase()}`]?.trim();
  return fromEnv ?? join(projectRoot(), ".grok", `smoke-profile-${user}`);
}

async function verifyUser(user) {
  const dir = profileDir(user);
  if (!existsSync(dir)) {
    console.error(`[verify-smoke-auth] FAIL User ${user.toUpperCase()} — missing profile ${dir}`);
    return null;
  }

  const session = await readProfileSession(dir);
  if (!session.email || !session.id) {
    console.error(
      `[verify-smoke-auth] FAIL User ${user.toUpperCase()} — get-session null (re-run capture-smoke-auth.mjs ${user})`,
    );
    return null;
  }
  console.log(`[verify-smoke-auth] OK User ${user.toUpperCase()} — ${session.email} (${session.id})`);
  return session;
}

async function main() {
  const users = process.argv.slice(2).map((u) => u.toLowerCase()).filter((u) => u === "a" || u === "b");
  if (users.length === 0) {
    console.error("Usage: node scripts/verify-smoke-auth.mjs a|b [b]");
    process.exit(1);
  }

  const sessions = {};
  let ok = true;
  for (const user of users) {
    sessions[user] = await verifyUser(user);
    if (!sessions[user]) ok = false;
  }

  if (sessions.a && sessions.b) {
    if (sessions.a.id === sessions.b.id || sessions.a.email === sessions.b.email) {
      console.error(
        `[verify-smoke-auth] BLOCKER User A and User B share the same account (${sessions.a.email}) — re-run: node scripts/capture-smoke-auth.mjs b`,
      );
      ok = false;
    } else {
      console.log(
        `[verify-smoke-auth] OK A/B distinct — ${sessions.a.email} vs ${sessions.b.email}`,
      );
    }
  }

  process.exit(ok ? 0 : 1);
}

if (isMainModule(import.meta.url)) {
  await main();
}
