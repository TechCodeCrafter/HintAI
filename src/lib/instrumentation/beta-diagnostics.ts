import { defaultWorkspaceId } from "../auth/workspace.ts";
import { exportBetaTelemetry } from "./beta-telemetry.ts";
import { computeBetaQualityMetrics, formatBetaQualityReport } from "./beta-quality-report.ts";
import { exportFlightSession } from "./flight-recorder.ts";
import { isFlightRecorder } from "../debug.ts";

export type BetaDiagnosticExport = {
  exportedAt: number;
  appVersion: string;
  platform: string;
  browser: string;
  workspaceId: string;
  traceIds: string[];
  timings: {
    latencyP50: number;
    latencyP95: number;
    timeToFirstUsefulAnswerMs: number | null;
  };
  sourceCounts: { totalAnswers: number; averageSourcesCited: number };
  sourceTypes: Record<string, number>;
  errorCodes: string[];
  qualitySummary: string;
  betaTelemetry: ReturnType<typeof exportBetaTelemetry>;
  /** Flight log included only when debug capture is enabled — still privacy-safe. */
  flightSession?: ReturnType<typeof exportFlightSession>;
};

function readAppVersion(): string {
  try {
    const value = (import.meta as { env?: Record<string, unknown> }).env?.VITE_APP_VERSION;
    if (typeof value === "string" && value.trim()) return value;
  } catch {
    /* node --test */
  }
  return "dev";
}

function detectBrowser(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "unknown";
}

export function buildBetaDiagnosticExport(): BetaDiagnosticExport {
  const metrics = computeBetaQualityMetrics();
  const beta = exportBetaTelemetry();
  const traceIds = beta.records
    .filter((row) => row.kind === "answer" || row.kind === "feedback")
    .map((row) => row.traceId ?? row.answerId)
    .slice(-50);
  const errorCodes = beta.records
    .filter((row) => row.kind === "event" && row.meta && typeof row.meta.errorCode === "string")
    .map((row) => String((row as { meta?: { errorCode?: string } }).meta?.errorCode));
  return {
    exportedAt: Date.now(),
    appVersion: readAppVersion(),
    platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
    browser: detectBrowser(),
    workspaceId: defaultWorkspaceId(),
    traceIds,
    timings: {
      latencyP50: metrics.latencyP50,
      latencyP95: metrics.latencyP95,
      timeToFirstUsefulAnswerMs: metrics.funnel.timeToFirstUsefulAnswerMs,
    },
    sourceCounts: {
      totalAnswers: metrics.answerCount,
      averageSourcesCited: metrics.averageSourcesCited,
    },
    sourceTypes: {},
    errorCodes,
    qualitySummary: formatBetaQualityReport(metrics),
    betaTelemetry: beta,
    flightSession: isFlightRecorder() ? exportFlightSession() : undefined,
  };
}

export function betaDiagnosticJson(pretty = true): string {
  const payload = buildBetaDiagnosticExport();
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}

export function downloadBetaDiagnostics(filename?: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([betaDiagnosticJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? `meethint-beta-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
