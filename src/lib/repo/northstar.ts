import type { RepoPack } from "./types";

export const NORTHSTAR: RepoPack = {
  id: "northstar-payments",
  name: "northstar-payments",
  description: "Settlement exporter and edge auth for Northstar Payments.",
  files: [
    {
      path: "src/exporter/retry.ts",
      language: "ts",
      content: `import { logger } from "../lib/log";
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
      content: `import { withRetry } from "./retry";
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
      content: `import type { SettlementRow } from "./types";

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
      content: `export type ExportJob = {
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
    {
      path: "src/auth/flow.ts",
      language: "ts",
      content: `import { rotateCookie } from "./session";
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
      content: `import { runAuthFlow } from "./flow";

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
      content: `type Session = { sub: string; exp: number };

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
      sha: "e17bb30",
      date: "2025-11-12",
      author: "Jordan Lee",
      message: "auth: introduce verifyAccess for edge session checks",
      files: ["src/auth/flow.ts"],
      pr: "512",
    },
  ],
};
