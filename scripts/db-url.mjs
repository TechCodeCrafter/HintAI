#!/usr/bin/env node
/**
 * Builds DATABASE_URL for the Supabase pooler, prompting for the password.
 *
 * Usage:  eval "$(node scripts/db-url.mjs)"
 *
 * Why a script rather than a shell one-liner: `read` in an interactive shell
 * consumes whatever is already sitting in the terminal's input buffer, so a
 * pasted block or a stray newline silently answers the prompt with an empty
 * string — which reaches Postgres as an empty password and fails as 28P01. This
 * opens /dev/tty directly, drains anything pending, and only then reads, so the
 * prompt cannot be answered by something the user did not type.
 *
 * The password is written straight into the printed `export` line and never
 * touches shell history, argv, or a file on disk.
 */
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync, writeSync } from "node:fs";

const PROJECT = process.env.SUPABASE_PROJECT_REF || "aupohtzttfbarexhnxup";
/**
 * The pooler by default. `--direct` targets the project's own host, which is
 * IPv6-only on new projects but talks to Postgres with no proxy in between — so
 * agreement between the two isolates a bad password from a pooler problem.
 */
const DIRECT = process.argv.includes("--direct");
const HOST = DIRECT
  ? `db.${PROJECT}.supabase.co:5432`
  : "aws-0-us-west-2.pooler.supabase.com:5432";
const USER = DIRECT ? "postgres" : `postgres.${PROJECT}`;
// libpq semantics for `require`: encrypt, but do not verify the CA. Supabase's
// chain does not validate against the system roots, and pg-connection-string
// now reads a bare `require` as `verify-full`. Swap this for
// `sslmode=verify-full&sslrootcert=/path/to/prod-ca.crt` once the CA is on disk.
const SSL = "uselibpqcompat=true&sslmode=require";

/** stdout is captured by `$(...)`, so anything the human reads goes to the tty. */
function prompt(tty, text) {
  writeSync(tty, text);
}

function readSecret(tty) {
  // Anything already buffered was not typed in answer to this prompt.
  try {
    execFileSync("stty", ["-F", "/dev/tty", "-echo"], { stdio: "ignore" });
  } catch {
    execFileSync("stty", ["-echo"], { stdio: [tty, "ignore", "ignore"] });
  }
  try {
    let out = "";
    const buf = Buffer.alloc(1);
    for (;;) {
      const n = readSync(tty, buf, 0, 1, null);
      if (n === 0) break;
      const ch = buf.toString("utf8");
      if (ch === "\n" || ch === "\r") break;
      if (ch === "\u0003") throw new Error("cancelled");
      if (ch === "\u007f") out = out.slice(0, -1);
      else out += ch;
    }
    return out;
  } finally {
    try {
      execFileSync("stty", ["-F", "/dev/tty", "echo"], { stdio: "ignore" });
    } catch {
      execFileSync("stty", ["echo"], { stdio: [tty, "ignore", "ignore"] });
    }
  }
}

let tty;
try {
  tty = openSync("/dev/tty", "r+");
} catch {
  console.error("No terminal available — run this from an interactive shell.");
  process.exit(1);
}

// Drain: a paste or a stray newline left in the buffer must not answer the
// prompt. Reading with a zero timeout returns immediately when nothing is queued.
try {
  execFileSync("stty", ["-F", "/dev/tty", "-icanon", "min", "0", "time", "0"], {
    stdio: "ignore",
  });
  const scratch = Buffer.alloc(4096);
  while (readSync(tty, scratch, 0, scratch.length, null) > 0);
} catch {
  /* draining is best-effort */
} finally {
  try {
    execFileSync("stty", ["-F", "/dev/tty", "icanon"], { stdio: "ignore" });
  } catch {
    /* leave the terminal as we found it */
  }
}

prompt(tty, "Supabase database password (input hidden): ");
const typed = readSecret(tty);
prompt(tty, "\n");

// A terminal left in bracketed-paste mode wraps a paste in these escapes, and
// with echo off they are invisible — the password looks right and is rejected.
const password = typed
  .replace(new RegExp(`${String.fromCharCode(0x1b)}\\[20[01]~`, "g"), "")
  .replace(/^\s+|\s+$/g, "");

if (!password) {
  prompt(tty, "Nothing was entered — no DATABASE_URL printed.\n");
  closeSync(tty);
  process.exit(1);
}

if (password !== typed) {
  prompt(
    tty,
    `Trimmed ${typed.length - password.length} stray character(s) from the paste.\n`,
  );
}

// A fingerprint, not the password: enough to spot invisible junk without
// putting the secret on screen or in a scrollback buffer.
const control = [...password].filter((c) => c < " " || c === "\u007f").length;
prompt(
  tty,
  `Captured ${password.length} characters` +
    ` (${/[a-z]/.test(password) ? "a-z " : ""}${/[A-Z]/.test(password) ? "A-Z " : ""}` +
    `${/[0-9]/.test(password) ? "0-9 " : ""}${/[^a-zA-Z0-9]/.test(password) ? "symbols " : ""}` +
    `${control ? `${control} CONTROL CHARS — that is the bug` : "no control chars"})\n`,
);
prompt(tty, `Target: ${USER}@${HOST}\n`);
closeSync(tty);

const url = `postgresql://${USER}:${encodeURIComponent(password)}@${HOST}/postgres?${SSL}`;
process.stdout.write(`export DATABASE_URL='${url.replace(/'/g, `'\\''`)}'\n`);
