import type { RepoFile, RepoPack } from "./types";

/** First-visit /home chips. Each must extract a cited line from the demo pack. */
export const HOME_PROOF_CHIPS = [
  "What is the architecture of this application?",
  "What did we change in the exporter?",
  "Why does that retry three times?",
] as const;

/** Kept so the pack still has a single-file cite the tests can pin. */
export const HOME_TRY_QUESTION = "What does the auth service do?";
export const AUTH_SERVICE_CLAIM =
  "The auth service verifies the session cookie on every non-public request and rotates it on the way out.";
export const AUTH_SERVICE_PATH = "src/auth.ts";
export const AUTH_SERVICE_LINE = 47;

/** A barrel whose only speakable sentence sits on AUTH_SERVICE_LINE. */
function authServiceFile(): RepoFile {
  const lines = ["/**", " * Auth service.", " *"];
  while (lines.length < AUTH_SERVICE_LINE - 1) lines.push(" *");
  lines.push(` * ${AUTH_SERVICE_CLAIM}`);
  lines.push(" */");
  lines.push("");
  lines.push('export { runAuthFlow } from "./auth/flow";');
  lines.push('export { authMiddleware } from "./auth/middleware";');
  lines.push('export { rotateCookie } from "./auth/session";');
  return {
    path: AUTH_SERVICE_PATH,
    language: "ts",
    content: `${lines.join("\n")}\n`,
  };
}

/**
 * The built-in demo pack.
 *
 * Every answer the demo gives is extracted from the text below and verified
 * against it, exactly as it would be for a folder a user opens — there is no
 * scripted path and no support exemption for this pack. That puts a real
 * constraint on the fixture: it has to carry the prose a working repository
 * carries, because the demo can only say what the material says. A file with no
 * docstring produces silence here, which is the correct product behaviour and a
 * poor demonstration of it.
 */
export const NORTHSTAR: RepoPack = {
  id: "northstar-payments",
  name: "northstar-payments",
  description: "Settlement exporter and edge auth for Northstar Payments.",
  files: [
    {
      path: "README.md",
      language: "md",
      content: `# Northstar Payments

Northstar exports merchant settlement files to S3 and guards the operator
dashboard with edge auth.

## Layout

- \`src/exporter\` — builds the settlement CSV and uploads it
- \`src/auth\` — verifies and rotates session cookies at the edge
- \`docs/adr\` — decisions worth keeping

## Running

Exports run per merchant on a nightly schedule. Failures land in the
dead-letter queue and are replayed from the PAY-219 runbook.
`,
    },
    {
      path: "src/exporter/retry.ts",
      language: "ts",
      content: `/**
 * Retry policy for settlement exports.
 *
 * Attempts are capped at three because the payment gateway stalls rather than
 * failing fast, so a fourth attempt duplicates the settlement file instead of
 * recovering it.
 */
import { logger } from "../lib/log";
import type { ExportJob } from "./types";

/** Default attempts after the March 2026 payment-timeout incident. */
export const MAX_ATTEMPTS = 3;

const BASE_DELAY_MS = 400;

export function backoffMs(attempt: number): number {
  const exp = Math.min(attempt, MAX_ATTEMPTS);
  return BASE_DELAY_MS * 2 ** (exp - 1);
}

export async function withRetry<T>(
  job: ExportJob,
  run: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      logger.warn("exporter.retry", {
        jobId: job.id,
        attempt,
        max: MAX_ATTEMPTS,
        delayMs: backoffMs(attempt),
      });
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`,
    },
    {
      path: "src/exporter/index.ts",
      language: "ts",
      content: `/**
 * Settlement export entry point.
 *
 * Maps captured payment rows into the locked settlement column order and
 * uploads the resulting CSV to the merchant prefix in S3, retrying through the
 * capped backoff when the gateway stalls.
 */
import { withRetry } from "./retry";
import { mapSettlementRow } from "./format";
import { putObject } from "../lib/s3";
import type { ExportJob, SettlementRow } from "./types";

export async function runExporter(job: ExportJob, rows: SettlementRow[]) {
  const body = rows.map(mapSettlementRow).join("\\n");
  return withRetry(job, async () => {
    const key = \`exports/\${job.merchantId}/\${job.id}.csv\`;
    await putObject({ bucket: job.bucket, key, body });
    return { key, rows: rows.length };
  });
}
`,
    },
    {
      path: "src/exporter/format.ts",
      language: "ts",
      content: `/**
 * Settlement CSV formatting.
 *
 * Writes one line per settlement in a column order finance imports directly,
 * which is why the order is locked and changing it needs PAY-180.
 */
import type { SettlementRow } from "./types";

/**
 * Column order locked in Feb 2026 for the finance settlement file.
 * Do not reorder without PAY-180.
 */
export const SETTLEMENT_COLUMNS = [
  "settlement_id",
  "merchant_id",
  "captured_at",
  "amount_cents",
  "currency",
  "processor_ref",
] as const;

export function mapSettlementRow(row: SettlementRow): string {
  return [
    row.settlementId,
    row.merchantId,
    row.capturedAt,
    String(row.amountCents),
    row.currency,
    row.processorRef,
  ].join(",");
}
`,
    },
    {
      path: "src/exporter/types.ts",
      language: "ts",
      content: `/**
 * Shared exporter types.
 *
 * Describes the settlement rows the exporter reads and the job envelope naming
 * the destination bucket and merchant.
 */
export type ExportJob = {
  id: string;
  merchantId: string;
  bucket: string;
};

export type SettlementRow = {
  settlementId: string;
  merchantId: string;
  capturedAt: string;
  amountCents: number;
  currency: string;
  processorRef: string;
};
`,
    },
    authServiceFile(),
    {
      path: "src/auth/flow.ts",
      language: "ts",
      content: `/**
 * Edge auth flow.
 *
 * Verifies the session cookie on every non-public request and rotates it on the
 * way out, so a stolen cookie stops working within thirty minutes.
 */
import { rotateCookie } from "./session";
import { verifyAccess } from "./tokens";

export async function runAuthFlow(request: Request) {
  const existing = request.headers.get("cookie");
  const session = await verifyAccess(existing);
  if (!session) return { ok: false as const, status: 401 };
  const setCookie = await rotateCookie(session);
  return { ok: true as const, session, setCookie };
}
`,
    },
    {
      path: "src/auth/middleware.ts",
      language: "ts",
      content: `/**
 * Request guard.
 *
 * Runs the auth flow ahead of every handler except paths under public, and
 * answers with 401 before the route executes when verification fails.
 */
import { runAuthFlow } from "./flow";

export async function authMiddleware(request: Request): Promise<Response | null> {
  if (request.url.includes("/public/")) return null;
  const result = await runAuthFlow(request);
  if (!result.ok) {
    return new Response("unauthorized", { status: 401 });
  }
  return null;
}
`,
    },
    {
      path: "src/auth/session.ts",
      language: "ts",
      content: `/**
 * Session cookie issuance.
 *
 * Issues the rotated session cookie with HttpOnly, Secure and Lax same-site
 * flags, expiring thirty minutes after it is handed back.
 */
type Session = { sub: string; exp: number };

export async function rotateCookie(session: Session): Promise<string> {
  const exp = Date.now() + 1000 * 60 * 30;
  return \`ns_session=\${session.sub}.\${exp}; HttpOnly; Secure; SameSite=Lax; Path=/\`;
}
`,
    },
    {
      path: "docs/adr/0007-exporter-retries.md",
      language: "md",
      content: `# ADR 0007 — Exporter retry cap

Date: 2026-03-18
Status: Accepted
PR: #842
Ticket: PAY-219

Exporter attempts are capped at three because the payment gateway stalls
instead of failing fast, so raising the cap only duplicates settlement files
while the job still ends in the dead-letter queue.

## Context

The settlement exporter retried indefinitely when the payment gateway stalled.
March timeouts piled duplicate files into the bucket.

## Decision

Cap attempts at **3** with exponential backoff starting at 400ms.
This is not a generic HTTP retry policy — it exists because of payment
gateway timeouts, not because three is a lucky number.

## Consequences

Jobs fail to the dead-letter queue after three tries. Operators replay
from PAY-219 runbooks. Do not raise the cap without finance sign-off.
`,
    },
  ],
  commits: [
    {
      sha: "a3f91c2",
      date: "2026-03-18",
      author: "Priya Shah",
      message: "exporter: cap retries at 3 after payment gateway timeouts",
      files: ["src/exporter/retry.ts", "docs/adr/0007-exporter-retries.md"],
      pr: "842",
    },
    {
      sha: "9b21e04",
      date: "2026-03-18",
      author: "Priya Shah",
      message: "docs: ADR 0007 for exporter backoff (PAY-219)",
      files: ["docs/adr/0007-exporter-retries.md"],
      pr: "842",
    },
    {
      sha: "11ae902",
      date: "2026-02-02",
      author: "Chris Okonkwo",
      message: "exporter: lock settlement CSV column order (PAY-180)",
      files: ["src/exporter/format.ts"],
      pr: "771",
    },
    {
      sha: "c4d88aa",
      date: "2026-01-09",
      author: "Jordan Lee",
      message: "auth: rotate session cookies through edge middleware",
      files: ["src/auth/flow.ts", "src/auth/middleware.ts", "src/auth/session.ts"],
      pr: "640",
    },
    {
      sha: "5f0c7d1",
      date: "2025-10-04",
      author: "Priya Shah",
      message: "docs: describe the exporter and edge auth in the README",
      files: ["README.md"],
      pr: "488",
    },
    {
      sha: "e17bb30",
      date: "2025-11-12",
      author: "Jordan Lee",
      message: "auth: introduce verifyAccess for edge session checks",
      files: ["src/auth/flow.ts"],
      pr: "512",
    },
  ],
};
