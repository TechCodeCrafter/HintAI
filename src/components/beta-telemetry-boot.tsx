import { useEffect } from "react";
import { useAccountVaultReady } from "@/lib/auth/account-session";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { shouldRecordAuthenticatedSignup } from "@/lib/instrumentation/authenticated-signup-gate";
import { noteBetaSessionStart, noteBetaUserCreated } from "@/lib/instrumentation/beta-telemetry";

/** Initializes privacy-safe beta lifecycle events once a verified account vault is bound. */
export function BetaTelemetryBoot() {
  const { ready, accountId } = useAccountVaultReady();
  const { user } = useCurrentUserState();

  useEffect(() => {
    if (!shouldRecordAuthenticatedSignup({ ready, accountId, hasUser: Boolean(user), authEnabled })) return;
    noteBetaUserCreated();
    noteBetaSessionStart();
  }, [ready, accountId, user]);

  return null;
}
