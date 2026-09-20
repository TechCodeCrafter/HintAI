import { SynthesisGuardError } from "./synthesis-guard.server.ts";

type Window = { count: number; resetAt: number };

/** In-memory per warm instance — not a global cap on serverless (see PRODUCT-BACKLOG). */
const buckets = new Map<string, Window>();

function limitPerHour(): number {
  const raw = process.env.SYNTHESIS_RATE_LIMIT_PER_HOUR?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 120;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

function windowMs(): number {
  return 60 * 60 * 1000;
}

/** Per-user sliding window rate limit for server-managed synthesis. */
export function checkSynthesisRateLimit(userId: string): void {
  const now = Date.now();
  const limit = limitPerHour();
  let entry = buckets.get(userId);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs() };
    buckets.set(userId, entry);
  }
  if (entry.count >= limit) {
    throw new SynthesisGuardError("rate_limited", "Synthesis rate limit exceeded", 429);
  }
  entry.count += 1;
}

/** Test-only reset. */
export function resetSynthesisRateLimitsForTests(): void {
  buckets.clear();
}
