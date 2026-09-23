import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  FolderPlus,
  Plus,
  Radio,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { QuickActionTile } from "@/components/app-shell";
import { BetaOnboardingChecklist } from "@/components/beta-onboarding";
import { BetaPrivacyNotice } from "@/components/beta-privacy-notice";
import { ContextShell } from "@/components/context-shell";
import { HomeProof } from "@/components/home-proof";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatSpaceCounts, spaceHasSources, spaceStatusLabel } from "@/lib/context/kinds";
import { migrateLegacyPack, readSavedPack } from "@/lib/context/migration";
import { listSpaceSummaries, type SpaceSummary } from "@/lib/context/service";
import { useAccountVaultReady } from "@/lib/auth/account-session";
import { useMeetHint } from "@/lib/store";

export function ContextHome() {
  const { ready: vaultReady, accountId } = useAccountVaultReady();
  const spaceCatalogEpoch = useMeetHint((s) => s.spaceCatalogEpoch);
  const locationHash = useRouterState({ select: (s) => s.location.hash });
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

  useEffect(() => {
    const hash = locationHash.replace(/^#/, "");
    if (!hash || spaces === null) return;
    const target = document.getElementById(hash);
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [locationHash, spaces]);

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

  const firstSpaceId = spaces?.[0]?.space.id;

  return (
    <ContextShell>
      <main className="space-y-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
          <div className="space-y-6">
            <PageHeader
              overline="Welcome to MeetHint"
              title="Get ready for your first meeting."
              description="MeetHint listens during your call, searches the material you loaded, and shows a cited answer, or stays silent when your files don't support one."
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="ds-surface-subtle space-y-1 p-4">
                <p className="ds-card-title">Answers in real time</p>
                <p className="ds-caption">Search and live paths cite your sources.</p>
              </div>
              <div className="ds-surface-subtle space-y-1 p-4">
                <p className="ds-card-title">Your data stays local</p>
                <p className="ds-caption">Indexed on device. Not uploaded.</p>
              </div>
              <div className="ds-surface-subtle space-y-1 p-4">
                <p className="ds-card-title">Built for teams</p>
                <p className="ds-caption">Organize material into Knowledge Spaces.</p>
              </div>
            </div>
          </div>
          <BetaOnboardingChecklist spaceId={firstSpaceId} />
        </div>

        <section id="ask" className="scroll-mt-24 space-y-4">
          <div className="space-y-1">
            <p className="ds-overline">Ask Hint</p>
            <h2 className="ds-section-title">What would you like to know?</h2>
          </div>
          <HomeProof />
        </section>

        <section className="space-y-3">
          <h2 className="ds-section-title">Quick actions</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickActionTile
              to="/create"
              title="Create Knowledge Space"
              description="Organize material for a project or meeting."
              icon={<BookOpen aria-hidden />}
              testId="create-space-button"
            />
            {firstSpaceId ? (
              <Link
                to="/context/$id"
                params={{ id: firstSpaceId }}
                className="ds-action-tile group"
              >
                <div className="space-y-1.5">
                  <FolderPlus aria-hidden className="size-4 text-accent" />
                  <p className="ds-card-title">Add material</p>
                  <p className="ds-caption">Upload repos, PDFs, PowerPoint, Word, or spreadsheets.</p>
                </div>
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                />
              </Link>
            ) : (
              <QuickActionTile
                to="/create"
                title="Add material"
                description="Create a space, then upload sources."
                icon={<FolderPlus aria-hidden />}
              />
            )}
            {firstSpaceId ? (
              <Link
                to="/context/$id/live"
                params={{ id: firstSpaceId }}
                className="ds-action-tile group"
              >
                <div className="space-y-1.5">
                  <Radio aria-hidden className="size-4 text-accent" />
                  <p className="ds-card-title">Start live session</p>
                  <p className="ds-caption">Listen during a call and cite answers.</p>
                </div>
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                />
              </Link>
            ) : (
              <QuickActionTile
                to="/create"
                title="Start live session"
                description="Create a Knowledge Space first."
                icon={<Radio aria-hidden />}
              />
            )}
            {firstSpaceId ? (
              <Link
                to="/context/$id/ask"
                params={{ id: firstSpaceId }}
                className="ds-action-tile group"
              >
                <div className="space-y-1.5">
                  <Search aria-hidden className="size-4 text-accent" />
                  <p className="ds-card-title">Ask a question</p>
                  <p className="ds-caption">Test retrieval before your call.</p>
                </div>
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                />
              </Link>
            ) : null}
          </div>
        </section>

        {legacy ? (
          <div className="ds-surface-elevated space-y-3 p-5">
            <p className="ds-body">
              A folder from a previous visit is still on this device. Convert it to a Knowledge Space to keep using
              it.
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

        <section id="knowledge-spaces" className="scroll-mt-24 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="ds-section-title">Recent Knowledge Spaces</h2>
            <Link to="/create" className="inline-flex items-center gap-1 text-sm text-accent hover:text-fg">
              <Plus aria-hidden className="size-3.5" />
              New space
            </Link>
          </div>

          {spaces && spaces.length > 0 ? (
            <ul className="space-y-2" data-testid="space-list">
              {spaces.map((item) => (
                <li key={item.space.id}>
                  <article className="ds-surface-elevated flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <Link to="/context/$id" params={{ id: item.space.id }} className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium text-fg">{item.space.name}</p>
                        <Badge
                          variant={
                            item.status === "ready"
                              ? "ready"
                              : item.status === "indexing"
                                ? "indexing"
                                : "error"
                          }
                          dot
                        >
                          {spaceStatusLabel(item.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted">{formatSpaceCounts(item)}</p>
                    </Link>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to="/context/$id"
                        params={{ id: item.space.id }}
                        className="inline-flex h-10 items-center justify-center rounded-sm border border-line px-3 text-xs font-medium text-secondary hover:border-accent hover:text-fg"
                      >
                        Open
                      </Link>
                      <Link
                        to="/context/$id/ask"
                        params={{ id: item.space.id }}
                        className="inline-flex h-10 items-center justify-center rounded-sm border border-line px-3 text-xs font-medium text-secondary hover:border-accent hover:text-fg"
                      >
                        Ask
                      </Link>
                      {spaceHasSources(item) ? (
                        <Link
                          to="/context/$id/live"
                          params={{ id: item.space.id }}
                          data-testid="start-live"
                          className="mh-cta inline-flex h-10 items-center justify-center px-3 text-xs"
                        >
                          Start live
                        </Link>
                      ) : (
                        <Link
                          to="/context/$id"
                          params={{ id: item.space.id }}
                          className="inline-flex h-10 items-center justify-center rounded-sm border border-dashed border-line px-3 text-xs text-muted"
                        >
                          Add source
                        </Link>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          ) : spaces ? (
            <EmptyState
              icon={<BookOpen aria-hidden />}
              title="No Knowledge Spaces yet"
              description="Create a Knowledge Space to add repos, folders, files, or PDFs."
              action={{ label: "+ Create a Knowledge Space", href: "/create", testId: "create-space-empty" }}
              testId="space-list-empty"
            />
          ) : (
            <p className="text-sm text-muted">Loading Knowledge Spaces…</p>
          )}
        </section>

        <BetaPrivacyNotice />
      </main>
    </ContextShell>
  );
}
