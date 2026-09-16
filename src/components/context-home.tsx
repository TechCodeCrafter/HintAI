import { Link } from "@tanstack/react-router";
import { ArrowRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { BetaOnboardingChecklist } from "@/components/beta-onboarding";
import { BetaPrivacyNotice } from "@/components/beta-privacy-notice";
import { HomeProof } from "@/components/home-proof";
import { ContextShell } from "@/components/context-shell";
import { formatSpaceCounts, spaceHasSources, spaceStatusLabel } from "@/lib/context/kinds";
import { migrateLegacyPack, readSavedPack } from "@/lib/context/migration";
import { listSpaceSummaries, type SpaceSummary } from "@/lib/context/service";
import { useAccountVaultReady } from "@/lib/auth/account-session";

export function ContextHome() {
  const { ready: vaultReady, accountId } = useAccountVaultReady();
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setSpaces(await listSpaceSummaries());
      setLegacy(Boolean(readSavedPack()));
    } catch {
      setError("Could not read Knowledge Spaces.");
      setSpaces([]);
    }
  }

  useEffect(() => {
    if (!vaultReady) return;
    void reload();
  }, [vaultReady, accountId]);

  async function convertLegacy() {
    setMigrating(true);
    setError(null);
    try {
      const result = await migrateLegacyPack();
      if (result.kind === "failed") setError(result.error);
      await reload();
    } catch {
      setError("Could not convert the saved folder.");
    } finally {
      setMigrating(false);
    }
  }

  return (
    <ContextShell
      aside={
        <Link to="/app" className="mh-chip whitespace-nowrap hover:text-fg">
          Start Live
          <ArrowRight aria-hidden className="size-3.5 text-accent" />
        </Link>
      }
    >
      <main className="mh-rise space-y-10 pb-16 pt-6 sm:pt-10">
        <BetaOnboardingChecklist spaceId={spaces?.[0]?.space.id} />
        <div className="space-y-5">
          <HomeProof />
          <Link
            to="/create"
            data-testid="create-space-button"
            className="inline-flex items-center gap-1.5 text-sm text-body hover:text-fg"
          >
            <Plus aria-hidden className="size-3.5" />
            Create a Knowledge Space
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>

        {legacy ? (
          <div className="mh-panel space-y-3 p-5">
            <p className="text-sm text-body">
              A folder from a previous visit is still on this device. Convert it to a Knowledge Space to
              keep using it.
            </p>
            <button type="button" className="mh-cta" disabled={migrating} onClick={() => void convertLegacy()}>
              {migrating ? "Converting…" : "Convert saved folder"}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}

        {spaces && spaces.length > 0 ? (
          <section className="space-y-3">
            <p className="mh-eyebrow">Knowledge Spaces</p>
            <ul className="space-y-2" data-testid="space-list">
              {spaces.map((item) => (
                <li key={item.space.id}>
                  <article className="mh-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <Link to="/context/$id" params={{ id: item.space.id }} className="min-w-0 space-y-1">
                      <p className="truncate font-medium text-fg">{item.space.name}</p>
                      <p className="text-xs text-muted">{formatSpaceCounts(item)}</p>
                      <p className="text-xs text-faint">{spaceStatusLabel(item.status)}</p>
                    </Link>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to="/context/$id"
                        params={{ id: item.space.id }}
                        className="inline-flex h-11 items-center justify-center rounded-sm border border-line px-3 text-xs font-medium text-secondary hover:border-accent hover:text-fg"
                      >
                        Open
                      </Link>
                      <Link
                        to="/context/$id/ask"
                        params={{ id: item.space.id }}
                        className="inline-flex h-11 items-center justify-center rounded-sm border border-line px-3 text-xs font-medium text-secondary hover:border-accent hover:text-fg"
                      >
                        Ask
                      </Link>
                      {spaceHasSources(item) ? (
                        <Link
                          to="/context/$id/live"
                          params={{ id: item.space.id }}
                          data-testid="start-live"
                          className="inline-flex h-11 items-center justify-center rounded-sm border border-accent bg-accent px-3 text-xs font-medium text-on-accent"
                        >
                          Start live
                        </Link>
                      ) : (
                        <Link
                          to="/context/$id"
                          params={{ id: item.space.id }}
                          className="inline-flex h-11 items-center justify-center rounded-sm border border-line px-3 text-xs font-medium text-faint"
                        >
                          Add source
                        </Link>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        ) : spaces ? (
          <p className="text-sm text-muted">No Knowledge Spaces yet. Create one to add repos and documents.</p>
        ) : null}

        <BetaPrivacyNotice />
      </main>
    </ContextShell>
  );
}
