import { authEnabled } from "@/lib/auth/client";
import { anonymousTierError, anonymousTierReady } from "@/lib/auth/anonymous-tier";

const showDevBanner = import.meta.env.DEV || import.meta.env.VITE_E2E === "true";

/**
 * Loud failure when auth is on but the anonymous workspace tier did not initialize.
 * The funnel must never silently degrade to in-memory storage.
 */
export function AnonymousTierBanner() {
  if (!authEnabled || !showDevBanner) return null;
  if (anonymousTierReady() || !anonymousTierError()) return null;

  return (
    <div
      data-testid="anonymous-tier-error"
      role="alert"
      className="fixed inset-x-0 top-0 z-[9999] border-b border-red-500/40 bg-red-950 px-4 py-2 text-center text-sm text-red-100"
    >
      Anonymous workspace tier failed to load: {anonymousTierError()}. The no-signup funnel cannot
      persist uploads until this is fixed.
    </div>
  );
}
