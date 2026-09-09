import { readAccountStorage, writeAccountStorage } from "../auth/account-boundary.ts";

export type SubscriptionTier = "free" | "pro" | "team" | "enterprise";

export const SUBSCRIPTION_KEY = "meethint.subscription";

const TIERS = new Set<SubscriptionTier>(["free", "pro", "team", "enterprise"]);

export function isPaidTier(tier: SubscriptionTier): boolean {
  return tier !== "free";
}

/** Temporal contradiction detection is Team/Enterprise only. */
export function canDetectContradictions(tier: SubscriptionTier): boolean {
  return tier === "team" || tier === "enterprise";
}

export function readSubscription(): SubscriptionTier {
  try {
    const raw = readAccountStorage(SUBSCRIPTION_KEY);
    if (raw && TIERS.has(raw as SubscriptionTier)) return raw as SubscriptionTier;
  } catch {
    /* private mode / SSR */
  }
  return "free";
}

export function writeSubscription(tier: SubscriptionTier): void {
  try {
    writeAccountStorage(SUBSCRIPTION_KEY, tier);
  } catch {
    /* ignore quota */
  }
}
