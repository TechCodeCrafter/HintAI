import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpenCheck, FolderPlus, Mic2, Plus, SearchCheck, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { BetaOnboardingChecklist } from "@/components/beta-onboarding";
import { BetaPrivacyNotice } from "@/components/beta-privacy-notice";
import { HomeProof } from "@/components/home-proof";
import { ContextShell } from "@/components/context-shell";
import { formatSpaceCounts, spaceHasSources, spaceStatusLabel } from "@/lib/context/kinds";
import { migrateLegacyPack, readSavedPack } from "@/lib/context/migration";
import { listSpaceSummaries, type SpaceSummary } from "@/lib/context/service";
import { useAccountVaultReady } from "@/lib/auth/account-session";
import { useMeetHint } from "@/lib/store";

export function ContextHome() {
  const { ready: vaultReady, accountId } = useAccountVaultReady();
  const spaceCatalogEpoch = useMeetHint((s) => s.spaceCatalogEpoch);
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
  }, [vaultReady, accountId, spaceCatalogEpoch]);

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

  const firstSpace = spaces?.[0];
  const firstSpaceCanGoLive = Boolean(firstSpace && spaceHasSources(firstSpace));

  return (
    <ContextShell
      aside={
        firstSpaceCanGoLive && firstSpace ? (
          <Link
            to="/context/$id/live"
            params={{ id: firstSpace.space.id }}
            className="enterprise-secondary whitespace-nowrap"
          >
            <Mic2 aria-hidden className="size-4 text-accent" />
            <span className="hidden md:inline">Start Live</span>
          </Link>
        ) : (
          <Link to="/create" className="enterprise-secondary whitespace-nowrap">
            <Plus aria-hidden className="size-4 text-accent" />
            <span className="hidden md:inline">New Space</span>
          </Link>
        )
      }
    >
      <main className="enterprise-page mh-rise space-y-8 pb-16">
        <section className="enterprise-home-grid">
          <div className="enterprise-hero-card">
            <div className="relative z-10 space-y-7">
              <div className="space-y-4">
                <p className="enterprise-overline">MeetHint workspace</p>
                <h1>Know what to say. Know why it is true.</h1>
                <p className="max-w-2xl text-[16px] leading-relaxed text-body sm:text-[17px]">
                  Bring the material you trust. MeetHint can listen during a conversation, search that material, and show the evidence behind a supported answer.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link to="/create" data-testid="create-space-button" className="enterprise-primary">
                  <Plus aria-hidden className="size-4" />
                  Create a Knowledge Space
                </Link>
                {firstSpace ? (
                  <Link to="/context/$id" params={{ id: firstSpace.space.id }} className="enterprise-secondary">
                    Open latest space
                    <ArrowRight aria-hidden className="size-4 text-accent" />
                  </Link>
                ) : null}
              </div>

              <div className="grid gap-4 pt-2 sm:grid-cols-3">
                <MiniProof icon={<SearchCheck className="size-4" />} title="Answers from your material" />
                <MiniProof icon={<BookOpenCheck className="size-4" />} title="Evidence stays attached" />
                <MiniProof icon={<ShieldCheck className="size-4" />} title="Quiet when unsupported" />
              </div>
            </div>
          </div>

          <div className="enterprise-card p-5 sm:p-6">
            <BetaOnboardingChecklist spaceId={firstSpace?.space.id} />
          </div>
        </section>

        <section className="enterprise-card p-5 sm:p-7" aria-labelledby="ask-hint-title">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <p className="enterprise-overline">Ask Hint</p>
              <h2 id="ask-hint-title" className="enterprise-section-title">
                Search a cited example
              </h2>
            </div>
            <p className="max-w-md text-xs leading-relaxed text-muted">
              The answer card is only useful when MeetHint can point back to supporting material.
            </p>
          </div>
          <HomeProof />
        </section>

        <section className="enterprise-quick-grid" aria-label="Quick actions">
          <Link to="/create" className="enterprise-card enterprise-card-interactive enterprise-quick-action">
            <span className="enterprise-icon-tile" aria-hidden="true">
              <FolderPlus className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-fg">Create a Knowledge Space</span>
              <span className="mt-1 block text-xs text-muted">Organize material for a project, customer, course, or topic.</span>
            </span>
          </Link>
          {firstSpace ? (
            <Link
              to="/context/$id/ask"
              params={{ id: firstSpace.space.id }}
              className="enterprise-card enterprise-card-interactive enterprise-quick-action"
            >
              <span className="enterprise-icon-tile" aria-hidden="true">
                <SearchCheck className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-fg">Ask your material</span>
                <span className="mt-1 block text-xs text-muted">Search the selected space and inspect the supporting source.</span>
              </span>
            </Link>
          ) : (
            <Link to="/create" className="enterprise-card enterprise-card-interactive enterprise-quick-action">
              <span className="enterprise-icon-tile" aria-hidden="true">
                <SearchCheck className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-fg">Ask your material</span>
                <span className="mt-1 block text-xs text-muted">Create a space first, then search the material you add.</span>
              </span>
            </Link>
          )}
          {firstSpaceCanGoLive && firstSpace ? (
            <Link
              to="/context/$id/live"
              params={{ id: firstSpace.space.id }}
              className="enterprise-card enterprise-card-interactive enterprise-quick-action"
            >
              <span className="enterprise-icon-tile" aria-hidden="true">
                <Mic2 className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-fg">Start a live session</span>
                <span className="mt-1 block text-xs text-muted">Listen for questions and surface supported answers in real time.</span>
              </span>
            </Link>
          ) : (
            <Link to="/create" className="enterprise-card enterprise-card-interactive enterprise-quick-action">
              <span className="enterprise-icon-tile" aria-hidden="true">
                <Mic2 className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-fg">Start a live session</span>
                <span className="mt-1 block text-xs text-muted">Add material to a Knowledge Space before going live.</span>
              </span>
            </Link>
          )}
        </section>

        {legacy ? (
          <div className="enterprise-card space-y-3 p-5">
            <p className="text-sm text-body">
              A folder from a previous visit is still on this device. Convert it to a Knowledge Space to keep using it.
            </p>
            <button type="button" className="enterprise-primary" disabled={migrating} onClick={() => void convertLegacy()}>
              {migrating ? "Converting…" : "Convert saved folder"}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}

        <section className="space-y-4" aria-labelledby="spaces-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="enterprise-overline">Workspace</p>
              <h2 id="spaces-heading" className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-fg">
                Knowledge Spaces
              </h2>
            </div>
            <Link to="/create" className="text-sm font-medium text-accent hover:underline">
              New space
            </Link>
          </div>

          {spaces && spaces.length > 0 ? (
            <ul className="grid gap-3 md:grid-cols-2" data-testid="space-list">
              {spaces.map((item) => (
                <li key={item.space.id}>
                  <article className="enterprise-card enterprise-card-interactive flex h-full flex-col justify-between gap-5 p-5 sm:p-6">
                    <Link to="/context/$id" params={{ id: item.space.id }} className="min-w-0 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="truncate text-lg font-semibold tracking-[-0.025em] text-fg">{item.space.name}</p>
                          <p className="mt-1 text-xs text-muted">{formatSpaceCounts(item)}</p>
                        </div>
                        <span className="mh-chip shrink-0 text-xs">{spaceStatusLabel(item.status)}</span>
                      </div>
                    </Link>
                    <div className="flex flex-wrap gap-2">
                      <Link to="/context/$id" params={{ id: item.space.id }} className="enterprise-secondary">
                        Open
                      </Link>
                      <Link to="/context/$id/ask" params={{ id: item.space.id }} className="enterprise-secondary">
                        Ask
                      </Link>
                      {spaceHasSources(item) ? (
                        <Link
                          to="/context/$id/live"
                          params={{ id: item.space.id }}
                          data-testid="start-live"
                          className="enterprise-primary"
                        >
                          Start live
                        </Link>
                      ) : (
                        <Link to="/context/$id" params={{ id: item.space.id }} className="enterprise-secondary text-faint">
                          Add source
                        </Link>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          ) : spaces ? (
            <div className="enterprise-card px-6 py-12 text-center">
              <BookOpenCheck className="mx-auto size-9 text-accent" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold text-fg">Your first answer starts with a source.</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                Create a Knowledge Space, add a repo, folder, file, or PDF, then ask MeetHint to find the evidence.
              </p>
              <Link to="/create" className="enterprise-primary mt-5">
                <Plus className="size-4" aria-hidden="true" />
                Create a Knowledge Space
              </Link>
            </div>
          ) : null}
        </section>

        <BetaPrivacyNotice />
      </main>
    </ContextShell>
  );
}

function MiniProof({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-body">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
        {icon}
      </span>
      <span>{title}</span>
    </div>
  );
}
