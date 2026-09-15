import { useEffect } from "react";
import { useAccountVaultReady } from "@/lib/auth/account-session";
import { noteBetaSessionStart, noteBetaUserCreated } from "@/lib/instrumentation/beta-telemetry";

/** Initializes privacy-safe beta lifecycle events once the account vault is bound. */
export function BetaTelemetryBoot() {
  const { ready, accountId } = useAccountVaultReady();

  useEffect(() => {
    if (!ready || !accountId) return;
    noteBetaUserCreated();
    noteBetaSessionStart();
  }, [ready, accountId]);

  return null;
}
