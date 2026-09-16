import { useEffect, useState } from "react";
import { useAccountVaultReady } from "@/lib/auth/account-session";
import { readAccountStorage, writeAccountStorage } from "@/lib/auth/account-boundary";

const DISMISS_KEY = "meethint.betaPrivacyDismissed";

export function BetaPrivacyNotice() {
  const { ready: vaultReady, accountId } = useAccountVaultReady();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!vaultReady) return;
    setDismissed(readAccountStorage(DISMISS_KEY) === "1");
  }, [vaultReady, accountId]);

  if (dismissed) return null;

  return (
    <aside
      className="rounded-sm border border-line/60 bg-surface/40 px-3 py-2.5 text-xs text-muted"
      data-testid="beta-privacy-notice"
    >
      <p className="font-medium text-body">Closed beta — how Hint handles your data</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-4">
        <li>
          Your connected repos, PDFs, and indexes stay in this browser. Signing in links this local workspace to
          your account so only you can access it on this device.
        </li>
        <li>
          Hint only sends the minimum retrieved excerpts needed to answer a question to the AI provider you choose.
        </li>
        <li>
          Beta telemetry records timings, answer tiers, source IDs, trace IDs, and feedback labels locally on this
          device. It does not store file contents, evidence bodies, or full transcripts.
        </li>
      </ul>
      <div className="mt-2 flex flex-wrap gap-3">
        <a href="/privacy" className="text-accent hover:underline">
          Privacy policy
        </a>
        <button
          type="button"
          className="hover:text-fg"
          onClick={() => {
            writeAccountStorage(DISMISS_KEY, "1");
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </div>
    </aside>
  );
}
