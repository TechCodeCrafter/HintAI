import { useEffect } from "react";
import {
  ACCOUNT_EPOCH_KEY,
  bindAccountId,
  currentAccountId,
  publishAccountEpoch,
  wipeBrowserAccountData,
} from "./account-boundary";
import { authEnabled } from "./client";
import { useCurrentUserState } from "./use-current-user";

async function resetWorkspaceMemory(): Promise<void> {
  const { useMeetHint } = await import("../store");
  useMeetHint.getState().resetForAccountChange();
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
}

export async function switchAccount(accountId: string | null): Promise<void> {
  if (currentAccountId() === accountId) {
    if (accountId) {
      const { useMeetHint } = await import("../store");
      await useMeetHint.getState().boot();
    }
    return;
  }
  await leaveAccount();
  bindAccountId(accountId);
  if (!accountId) return;
  const { useMeetHint } = await import("../store");
  await useMeetHint.getState().boot();
}

/** Bind the vault to the current session. Auth-off uses the stable dev user. */
export function useAccountVaultReady(): { ready: boolean; accountId: string | null } {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return { ready: false, accountId: null };
  const accountId = user?.id ?? null;
  if (currentAccountId() !== accountId) bindAccountId(accountId);
  return { ready: true, accountId };
}

function otherTabLeft(): void {
  void resetWorkspaceMemory().then(() => {
    bindAccountId(null);
    if (typeof window !== "undefined") window.location.reload();
  });
}

/** Keep other tabs /relay in lockstep when this profile signs out. */
export function AccountWorkspaceSync() {
  const { ready, accountId } = useAccountVaultReady();

  useEffect(() => {
    if (!ready) return;
    if (authEnabled && !accountId) {
      void resetWorkspaceMemory();
    }
  }, [ready, accountId]);

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
