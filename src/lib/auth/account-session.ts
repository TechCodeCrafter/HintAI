import { useEffect, useState } from "react";
import {
  ACCOUNT_EPOCH_KEY,
  bindAccountId,
  currentAccountId,
  publishAccountEpoch,
  wipeBrowserAccountData,
} from "./account-boundary";
import { authEnabled } from "./client";
import { useCurrentUserState, DEV_USER } from "./use-current-user";

async function resetWorkspaceMemory(): Promise<void> {
  const { useMeetHint } = await import("../store");
  useMeetHint.getState().resetForAccountChange();
}

async function bindDevUser(): Promise<void> {
  bindAccountId(DEV_USER.id);
  publishAccountEpoch(DEV_USER.id);
}

/**
 * Cancel in-flight work, drop in-memory workspace state, and delete local
 * copies of repos, indexes, answers, meetings, and API keys.
 */
export async function leaveAccount(): Promise<void> {
  await resetWorkspaceMemory();
  await wipeBrowserAccountData();
  bindAccountId(null);
  publishAccountEpoch(null);
  if (!authEnabled) {
    await bindDevUser();
  }
}

export async function switchAccount(accountId: string | null): Promise<void> {
  if (accountId && currentAccountId() === accountId) {
    const { useMeetHint } = await import("../store");
    await useMeetHint.getState().boot();
    return;
  }
  await leaveAccount();
  if (!accountId) return;
  bindAccountId(accountId);
  publishAccountEpoch(accountId);
  const { useMeetHint } = await import("../store");
  await useMeetHint.getState().boot();
}

/** Bind the vault to the server-verified user id, or dev user when auth is off. */
export function useAccountVaultReady(): { ready: boolean; accountId: string | null; tierError: string | null } {
  const { user, isPending } = useCurrentUserState();
  const [verifiedId, setVerifiedId] = useState<string | null>(authEnabled ? null : DEV_USER.id);
  const [verifyError, setVerifyError] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);

  useEffect(() => {
    if (!authEnabled) {
      if (currentAccountId() !== DEV_USER.id) void bindDevUser();
      setVerifiedId(DEV_USER.id);
      setBindError(null);
      return;
    }

    if (isPending) return;

    if (!user) {
      if (currentAccountId() !== null) bindAccountId(null);
      setVerifiedId(null);
      setVerifyError(false);
      setBindError(null);
      return;
    }

    let cancelled = false;
    void import("./workspace-identity")
      .then(({ resolveWorkspaceIdentity }) => resolveWorkspaceIdentity())
      .then(({ userId }) => {
        if (cancelled) return;
        bindAccountId(userId);
        publishAccountEpoch(userId);
        setVerifiedId(userId);
        setVerifyError(false);
        setBindError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setVerifiedId(null);
        setVerifyError(true);
        setBindError("Could not verify your workspace identity.");
      });
    return () => {
      cancelled = true;
    };
  }, [user, isPending]);

  if (!authEnabled) return { ready: true, accountId: verifiedId, tierError: null };
  if (isPending || (user && verifiedId == null && !verifyError)) {
    return { ready: false, accountId: null, tierError: bindError };
  }
  if (!user) {
    return { ready: false, accountId: null, tierError: null };
  }
  if (verifyError || bindError) {
    return { ready: false, accountId: null, tierError: bindError };
  }
  return { ready: verifiedId === currentAccountId(), accountId: verifiedId, tierError: null };
}

function otherTabLeft(): void {
  void resetWorkspaceMemory().then(async () => {
    bindAccountId(null);
    publishAccountEpoch(null);
    if (!authEnabled) {
      await bindDevUser();
    }
    if (typeof window !== "undefined") window.location.reload();
  });
}

/** Keep other tabs /relay in lockstep when this profile signs out. */
export function AccountWorkspaceSync() {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACCOUNT_EPOCH_KEY) return;
      otherTabLeft();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}
