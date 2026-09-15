import { useState } from "react";
import { readAccountStorage, writeAccountStorage } from "@/lib/auth/account-boundary";

const DISMISS_KEY = "meethint.betaPrivacyDismissed";

export function BetaPrivacyNotice() {
  const [dismissed, setDismissed] = useState(() => readAccountStorage(DISMISS_KEY) === "1");

  if (dismissed) return null;

  return (
    <aside className="mh-panel space-y-2 border border-line p-4 text-sm text-body" data-testid="beta-privacy-notice">
      <p className="font-medium text-fg">Closed beta — how Hint handles your data</p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
        <li>Repos, PDFs, and indexes stay in your browser unless you sign in to bind them to your account workspace.</li>
        <li>
          When you add an API key, questions and retrieved excerpts are sent directly from your device to the provider you
          choose — not through a general-knowledge fallback.
        </li>
        <li>
          Beta telemetry records timings, answer tiers, source IDs, trace IDs, and feedback labels locally on this device.
          It does not store file contents, evidence bodies, or full transcripts.
        </li>
      </ul>
      <div className="flex flex-wrap gap-3 pt-1">
        <a href="/privacy" className="text-xs text-accent hover:underline">
          Privacy policy
        </a>
        <button
          type="button"
          className="text-xs text-muted hover:text-fg"
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
