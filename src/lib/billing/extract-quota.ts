import { readAccountStorage, writeAccountStorage } from "../auth/account-boundary.ts";

/** Free Extract is grounded RAG with a daily question cap. Pro is unlimited. */

export const EXTRACT_DAILY_LIMIT = 20;
export const EXTRACT_QUOTA_KEY = "meethint.extractQuota";

export type ExtractQuota = {
  day: string;
  used: number;
};

export function localDayKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function emptyQuota(now = new Date()): ExtractQuota {
  return { day: localDayKey(now), used: 0 };
}

export function readExtractQuota(now = new Date()): ExtractQuota {
  const today = localDayKey(now);
  if (typeof localStorage === "undefined") return emptyQuota(now);
  try {
    const raw = readAccountStorage(EXTRACT_QUOTA_KEY);
    if (!raw) return emptyQuota(now);
    const parsed = JSON.parse(raw) as ExtractQuota;
    if (parsed.day !== today || !Number.isFinite(parsed.used)) return emptyQuota(now);
    return { day: today, used: Math.max(0, Math.floor(parsed.used)) };
  } catch {
    return emptyQuota(now);
  }
}

export function extractRemaining(now = new Date()): number {
  const quota = readExtractQuota(now);
  return Math.max(0, EXTRACT_DAILY_LIMIT - quota.used);
}

export function extractExhausted(now = new Date()): boolean {
  return extractRemaining(now) <= 0;
}

export function consumeExtractQuestion(now = new Date()): ExtractQuota {
  const today = localDayKey(now);
  const current = readExtractQuota(now);
  const next = { day: today, used: current.used + 1 };
  try {
    writeAccountStorage(EXTRACT_QUOTA_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
