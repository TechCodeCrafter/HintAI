import { SynthesisGuardError } from "./synthesis-guard.server.ts";

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

function limitPerHour(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function windowMs(): number {
  return 60 * 60 * 1000;
}

/** Count one call against `key`; false once the hourly limit is spent. */
function consume(key: string, limit: number): boolean {
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs() };
    buckets.set(key, entry);
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

/** Per-user sliding window rate limit for server-managed synthesis. */
export function checkSynthesisRateLimit(userId: string): void {
  if (!consume(`synthesis:${userId}`, limitPerHour("SYNTHESIS_RATE_LIMIT_PER_HOUR", 120))) {
    throw new SynthesisGuardError("rate_limited", "Synthesis rate limit exceeded", 429);
  }
}

/**
 * Per-user hourly budget for server-side speech-to-text. Live captions send one
 * clip per utterance, so the default is sized for a long meeting; callers fall
 * back to on-device transcription when it is spent.
 */
export function takeTranscribeQuota(userId: string): boolean {
  return consume(`transcribe:${userId}`, limitPerHour("TRANSCRIBE_RATE_LIMIT_PER_HOUR", 1200));
}

/** Test-only reset. */
export function resetSynthesisRateLimitsForTests(): void {
  buckets.clear();
}
