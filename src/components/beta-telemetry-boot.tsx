import { useEffect } from "react";
import { useAccountVaultReady } from "@/lib/auth/account-session";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { noteBetaSessionStart, noteBetaUserCreated } from "@/lib/instrumentation/beta-telemetry";

function isVerifiedAccountId(accountId: string): boolean {
  return !accountId.startsWith("ws_anon_") && accountId !== "dev-user";
}

/** Initializes privacy-safe beta lifecycle events once a verified account vault is bound. */
export function BetaTelemetryBoot() {
  const { ready, accountId } = useAccountVaultReady();
  const { user } = useCurrentUserState();

  useEffect(() => {
    if (!ready || !accountId || !user) return;
    if (authEnabled && !isVerifiedAccountId(accountId)) return;
    noteBetaUserCreated();
    noteBetaSessionStart();
  }, [ready, accountId, user]);

  return null;
}
