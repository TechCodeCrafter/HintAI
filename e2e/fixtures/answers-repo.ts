import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A small repository whose answers are written in its comments, so a question
 * has an exact line to be read from. Two questions need two sentences from
 * different places, and "error handling" is written in two files, which is
 * what a follow-up has to tell apart.
 */
export const FILES: Record<string, string> = {
  "src/export/retry.ts": `/**
 * Retries a failed export up to three times with exponential backoff.
 */
export function retryExport(job: Job) {
  return schedule(job, 3);
}

const LIMIT = 3;

/**
 * After the last attempt the export job is moved to the dead letter queue.
 */
export function parkJob(job: Job) {
  return deadLetter.push(job);
}

/**
 * Error handling for exports: a timeout is retried, and a validation error fails the job at once.
 */
export function classifyError(error: ExportError) {
  return error.kind === "timeout" ? "retry" : "fail";
}
`,
  "src/export/notify.ts": `/**
 * Sends the account owner an email when an export lands in the dead letter queue.
 */
export function notifyOwner(job: Job) {
  return mail.send(job.owner);
}
`,
  "src/auth/session.ts": `/**
 * Error handling for sign-in: a bad password locks the account after five attempts.
 */
export function onSignInError(user: User) {
  return lockout.bump(user);
}

/**
 * Sessions are stored in an encrypted cookie that expires after twelve hours.
 */
export function issueSession(user: User) {
  return cookie.seal(user);
}
`,
  "src/billing/invoice.ts": `/**
 * Builds the monthly invoice from metered usage.
 */
export function buildInvoice() {
  return 1;
}
`,
};

/** The files changed by the commits after the first, newest last. */
export const LATER_COMMITS = ["src/export/notify.ts", "src/auth/session.ts"] as const;

/**
 * Writes the files into a new folder as a real git repository with three
 * commits. The first two are packed, as an older checkout is, and the newest
 * is left as loose objects, so loading it reads both forms. The working tree
 * ends exactly as FILES has it.
 */
export function writeAnswersRepo(name = "answers"): string {
  const folder = join(mkdtempSync(join(tmpdir(), "hint-answers-")), name);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: folder,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    });
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), content);
  };
  const draft = (path: string) => `${FILES[path]}// draft\n`;
  mkdirSync(folder, { recursive: true });
  git("init", "--quiet", "--initial-branch=main");
  // First commit: every file, the two that change later still in draft.
  for (const path of Object.keys(FILES)) {
    write(path, (LATER_COMMITS as readonly string[]).includes(path) ? draft(path) : FILES[path]);
  }
  git("add", "-A");
  git("commit", "--quiet", "-m", "Add export, auth and billing");

  write(LATER_COMMITS[0], FILES[LATER_COMMITS[0]]);
  git("commit", "--quiet", "-am", "Finish owner notification");
  git("gc", "--quiet", "--aggressive");
  git("pack-refs", "--all");

  write(LATER_COMMITS[1], FILES[LATER_COMMITS[1]]);
  git("commit", "--quiet", "-am", "Finish the session cookie");
  return folder;
}
