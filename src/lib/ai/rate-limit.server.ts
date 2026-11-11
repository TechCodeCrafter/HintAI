import { SynthesisGuardError } from "./synthesis-guard.server.ts";

/**
 * Per-user fixed-window rate limits for endpoints that spend a server API key.
 *
 * With DATABASE_URL set the counter lives in Postgres (`rate_limits`), so the
 * limit holds across serverless instances and cold starts. Without a database
 * (local dev, PGlite preview) it falls back to an in-process Map.
 */

export type RateLimitScope = "synthesis" | "transcribe";

const WINDOW_MS = 60 * 60 * 1000;

const DEFAULTS: Record<RateLimitScope, { env: string; perHour: number }> = {
  synthesis: { env: "SYNTHESIS_RATE_LIMIT_PER_HOUR", perHour: 120 },
  transcribe: { env: "TRANSCRIBE_RATE_LIMIT_PER_HOUR", perHour: 240 },
};

export function limitPerHour(scope: RateLimitScope): number {
  const { env, perHour } = DEFAULTS[scope];
  const raw = process.env[env]?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : perHour;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : perHour;
}

type Window = { count: number; resetAt: number };
const buckets = new Map<string, Window>();

/** In-memory check. Synchronous; used directly by tests and as the fallback. */
export function checkMemoryRateLimit(scope: RateLimitScope, userId: string, now = Date.now()): void {
  const key = `${scope}:${userId}`;
  let entry = buckets.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, entry);
  }
  if (entry.count >= limitPerHour(scope)) {
    throw new SynthesisGuardError("rate_limited", "Rate limit exceeded", 429);
  }
  entry.count += 1;
}

function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * Count one call against the caller's hourly budget, or throw 429.
 * A database error falls back to the in-memory limiter rather than failing open.
 */
export async function enforceRateLimit(scope: RateLimitScope, userId: string): Promise<void> {
  if (!databaseConfigured()) {
    checkMemoryRateLimit(scope, userId);
    return;
  }
  let count: number;
  try {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    const rows = await sql<{ count: number | string }>`
      insert into rate_limits (bucket, count, reset_at)
      values (${`${scope}:${userId}`}, 1, now() + interval '1 hour')
      on conflict (bucket) do update set
        count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
        reset_at = case when rate_limits.reset_at <= now() then now() + interval '1 hour' else rate_limits.reset_at end
      returning count`;
    count = Number(rows[0]?.count ?? 0);
  } catch (err) {
    console.error("[rate-limit] database check failed, using in-memory limiter", err);
    checkMemoryRateLimit(scope, userId);
    return;
  }
  if (count > limitPerHour(scope)) {
    throw new SynthesisGuardError("rate_limited", "Rate limit exceeded", 429);
  }
}

/** Test-only reset. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
}
