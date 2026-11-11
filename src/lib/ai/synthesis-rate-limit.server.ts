import { checkMemoryRateLimit, enforceRateLimit, resetRateLimitsForTests } from "./rate-limit.server.ts";

/** Per-user fixed-window limit for server-managed synthesis (in-memory only). */
export function checkSynthesisRateLimit(userId: string): void {
  checkMemoryRateLimit("synthesis", userId);
}

/** Per-user limit shared across instances when DATABASE_URL is set. */
export function enforceSynthesisRateLimit(userId: string): Promise<void> {
  return enforceRateLimit("synthesis", userId);
}

/** Test-only reset. */
export function resetSynthesisRateLimitsForTests(): void {
  resetRateLimitsForTests();
}
