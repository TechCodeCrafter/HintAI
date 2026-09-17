import { expect, type Page } from "@playwright/test";

export const PRODUCTION_URL = (process.env.PLAYWRIGHT_BASE_URL ?? "https://www.meethint.ai").replace(
  /\/$/,
  "",
);
export const SMOKE_MARKER = "SMOKE_GATE_91626";
export const SMOKE_SPACE = "smoke-gate-91626";
export const SMOKE_FILE = "smoke-gate.ts";
export const SMOKE_SUPPORTED_QUESTION =
  "What unique marker value appears in the smoke gate source file?";
export const SMOKE_UNSUPPORTED_QUESTION =
  "What is the headquarters street address of Zylorp Corporation?";

export type SmokeTimings = {
  loginMs: number | null;
  indexReadyMs: number | null;
  firstUsefulAnswerMs: number | null;
  supportedAnswerCount: number;
  unsupportedConfidentCount: number;
  liveLatenciesMs: number[];
};

export function emptyTimings(): SmokeTimings {
  return {
    loginMs: null,
    indexReadyMs: null,
    firstUsefulAnswerMs: null,
    supportedAnswerCount: 0,
    unsupportedConfidentCount: 0,
    liveLatenciesMs: [],
  };
}

export function smokeSourceBuffer() {
  return Buffer.from(
    `/** Beta production smoke gate — unique marker ${SMOKE_MARKER}. */\n` +
      `export const token = "${SMOKE_MARKER}";\n`,
  );
}

export async function expectProtectedRedirect(page: Page) {
  await expect(page).toHaveURL(/\/(login|sign-in|auth\/)/);
}

export async function waitForIndexing(page: Page) {
  await page.getByTestId("indexing-complete").waitFor({ timeout: 120_000 });
  const spanStat = page.getByTestId("index-stats").locator("div").filter({ hasText: "evidence spans" });
  const countText = await spanStat.locator(".mh-display").textContent();
  const spanCount = Number.parseInt((countText ?? "0").replace(/,/g, ""), 10);
  expect(spanCount).toBeGreaterThan(0);
}

export async function waitForAuthenticatedHome(page: Page) {
  await page.waitForURL(/\/(home|login)/, { timeout: 30_000 });
  const loginSurface = page
    .getByTestId("login-page")
    .or(page.getByRole("heading", { name: /sign in to meethint/i }));
  const createButton = page.getByTestId("create-space-button");
  const signInStep = page.getByTestId("beta-onboarding-sign-in");

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (page.url().includes("/login")) break;
    if (await createButton.isVisible().catch(() => false)) return;
    if ((await signInStep.count()) > 0) {
      const complete = await signInStep.getAttribute("data-complete");
      if (complete === "true") return;
    }
    if (await loginSurface.isVisible().catch(() => false)) break;
    await page.waitForTimeout(500);
  }

  const loggedOut =
    page.url().includes("/login") ||
    (await loginSurface.isVisible({ timeout: 2_000 }).catch(() => false));
  if (loggedOut) {
    throw new Error("Storage state is not authenticated — re-run: node scripts/capture-smoke-auth.mjs a");
  }
  await expect(createButton).toBeVisible({ timeout: 15_000 });
}

export async function waitForAskReady(page: Page) {
  const query = page.getByTestId("ask-query");
  await expect(query).toBeEnabled({ timeout: 120_000 });
  await expect(query).toHaveAttribute("placeholder", /Ask about this Knowledge Space/i);
}

export function smokeSpaceName() {
  return `${SMOKE_SPACE}-${Date.now()}`;
}

export async function fillCreateContextIdentity(page: Page, name: string) {
  const kindButton = page.getByTestId("context-type-work");
  const nameInput = page.getByTestId("context-name");
  const submit = page.getByTestId("create-context-submit");
  await kindButton.click();
  await nameInput.fill(name);
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();
  await page.getByRole("heading", { name: "Add material" }).waitFor();
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function assertDiagnosticsPrivacy(json: string) {
  const forbidden = [
    /sk-[a-zA-Z0-9]{10,}/,
    /\bapi[_-]?key\b/i,
    /"evidence"\s*:\s*\[/,
    /SMOKE_GATE_91626/,
    /"content"\s*:\s*"/,
  ];
  for (const pattern of forbidden) {
    expect(json).not.toMatch(pattern);
  }
}

/** Ordered smoke steps — used for FAIL vs SKIP reporting when a run aborts early. */
export const SMOKE_STEP_ORDER = [
  "auth-session",
  "api-key-injected",
  "index-ready",
  "space-created",
  "supported-ask",
  "citation-open",
  "feedback-useful",
  "unsupported-ask",
  "live-start",
  "live-questions",
  "feedback-not-useful",
  "diagnostics-privacy",
  "refresh-session",
  "same-user-persistence",
  "cross-user-isolation",
] as const;

/**
 * Collect privacy-relevant diagnostic payload in-page (same sources as export flow).
 * Does not click the blob download control — safe for persistent Chrome profiles.
 */
export async function collectSmokeDiagnostics(page: Page): Promise<string> {
  const exportButton = page.getByTestId("export-beta-diagnostics");
  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeEnabled();

  return page.evaluate(async () => {
    const sessionResponse = await fetch("/api/auth/get-session", { credentials: "include" });
    const session = await sessionResponse.json();
    const accountId = session?.user?.id ?? "";

    const matchingKeys = (prefix: string) => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key === prefix || key.startsWith(`${prefix}.`)) keys.push(key);
      }
      return keys;
    };

    const parseTelemetryLines = (raw: string | null) => {
      if (!raw) return [];
      const records: unknown[] = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          records.push(JSON.parse(trimmed));
        } catch {
          /* ignore corrupt lines */
        }
      }
      return records;
    };

    const parseFlightLines = (raw: string | null) => {
      if (!raw) return [];
      const records: unknown[] = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          records.push(JSON.parse(trimmed));
        } catch {
          /* ignore corrupt lines */
        }
      }
      return records;
    };

    const telemetryRecords = matchingKeys("meethint.betaTelemetry").flatMap((key) =>
      parseTelemetryLines(localStorage.getItem(key)),
    );
    const flightRecords = matchingKeys("meethint.flightLog").flatMap((key) =>
      parseFlightLines(localStorage.getItem(key)),
    );

    type TelemetryRow = {
      kind?: string;
      traceId?: string;
      answerId?: string;
      meta?: { errorCode?: string };
      latencyMs?: number;
      sourceCount?: number;
      evidenceCount?: number;
      supported?: boolean;
    };

    const rows = telemetryRecords as TelemetryRow[];
    const traceIds = rows
      .filter((row) => row.kind === "answer" || row.kind === "feedback")
      .map((row) => row.traceId ?? row.answerId)
      .filter((id): id is string => Boolean(id))
      .slice(-50);
    const errorCodes = rows
      .filter((row) => row.kind === "event" && row.meta && typeof row.meta.errorCode === "string")
      .map((row) => String(row.meta?.errorCode));
    const answerRows = rows.filter((row) => row.kind === "answer");
    const latencies = answerRows
      .map((row) => row.latencyMs)
      .filter((ms): ms is number => typeof ms === "number");
    latencies.sort((a, b) => a - b);
    const p50 = latencies.length ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : 0;
    const cited = answerRows
      .map((row) => row.sourceCount ?? row.evidenceCount ?? 0)
      .filter((n) => n > 0);
    const averageSourcesCited =
      cited.length === 0 ? 0 : cited.reduce((sum, n) => sum + n, 0) / cited.length;

    const payload = {
      exportedAt: Date.now(),
      appVersion: "smoke-harness",
      platform: navigator.platform,
      browser: navigator.userAgent.includes("Chrome") ? "Chrome" : "unknown",
      workspaceId: accountId || "unknown",
      traceIds,
      timings: {
        latencyP50: p50,
        latencyP95: p95,
        timeToFirstUsefulAnswerMs: null,
      },
      sourceCounts: {
        totalAnswers: answerRows.length,
        averageSourcesCited,
      },
      sourceTypes: {},
      errorCodes,
      qualitySummary: `answers=${answerRows.length} traceIds=${traceIds.length}`,
      betaTelemetry: { exportedAt: Date.now(), records: rows },
      flightSession: flightRecords.length ? { exportedAt: Date.now(), records: flightRecords } : undefined,
    };

    return JSON.stringify(payload, null, 2);
  });
}

export function markSmokeStepOutcomes(
  steps: Record<string, "PASS" | "FAIL" | "SKIP">,
): Record<string, "PASS" | "FAIL" | "SKIP"> {
  const failIndex = SMOKE_STEP_ORDER.findIndex((key) => !steps[key]);
  if (failIndex === -1) return steps;
  for (let i = failIndex; i < SMOKE_STEP_ORDER.length; i += 1) {
    const key = SMOKE_STEP_ORDER[i];
    if (i === failIndex) steps[key] = "FAIL";
    else if (!steps[key]) steps[key] = "SKIP";
  }
  return steps;
}
