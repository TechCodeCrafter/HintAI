import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { contextHasSources, formatContextCounts } from "@/lib/context/kinds";
import { migrateLegacyPack, readSavedPack } from "@/lib/context/migration";
import { listContextSummaries, type ContextSummary } from "@/lib/context/service";
import { ContextShell } from "@/components/context-shell";

export function ContextHome() {
  const [summaries, setSummaries] = useState<ContextSummary[] | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setSummaries(await listContextSummaries());
      setLegacy(Boolean(readSavedPack()));
    } catch {
      setError("Could not read saved contexts.");
      setSummaries([]);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

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

  const ready = summaries !== null;
  const empty = ready && summaries.length === 0;

  return (
    <ContextShell
      aside={
        <a href="/app" className="mh-chip hover:text-fg">
          Live session
          <ArrowRight aria-hidden className="size-3.5 text-accent" />
        </a>
      }
    >
      <main className="mh-rise space-y-10 pb-16 pt-6 sm:pt-10">
        <div className="space-y-5">
          <h1 className="mh-display text-5xl sm:text-6xl">MeetHint</h1>
          <p className="mh-lede max-w-md">Your knowledge, right when you need it.</p>
          <Link
            to="/create"
            data-testid="create-context-button"
            className="mh-cta inline-flex items-center justify-center gap-2"
          >
            Create Context
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>

        {legacy ? (
          <div className="mh-panel space-y-3 p-5">
            <p className="text-sm text-body">
              A folder from a previous visit is still on this device. Convert it to a context to
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

        {!ready ? <p className="text-sm text-muted">Looking for saved contexts…</p> : null}

        {empty ? (
          <p className="text-sm text-muted">No contexts yet. Create one and add the material you work from.</p>
        ) : null}

        {summaries && summaries.length > 0 ? (
          <section className="space-y-3">
            <p className="mh-eyebrow">Your contexts</p>
            <ul className="space-y-2" data-testid="context-list">
              {summaries.map((item) => (
                <li key={item.context.id}>
                  <article className="mh-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <Link to="/context/$id" params={{ id: item.context.id }} className="min-w-0 space-y-1">
                      <p className="truncate font-medium text-fg">{item.context.name}</p>
                      <p className="text-xs text-muted">
                        {formatContextCounts({
                          fileCount: item.fileCount,
                          pdfCount: item.pdfCount,
                          chunkCount: item.chunkCount,
                        })}
                      </p>
                    </Link>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to="/context/$id/ask"
                        params={{ id: item.context.id }}
                        className="inline-flex h-11 items-center justify-center rounded-sm border border-line px-3 text-xs font-medium text-secondary hover:border-accent hover:text-fg"
                      >
                        Ask
                      </Link>
                      {contextHasSources(item) ? (
                        <Link
                          to="/context/$id/live"
                          params={{ id: item.context.id }}
                          className="inline-flex h-11 items-center justify-center rounded-sm border border-accent bg-accent px-3 text-xs font-medium text-on-accent"
                        >
                          Live
                        </Link>
                      ) : (
                        <span className="inline-flex h-11 items-center justify-center rounded-sm border border-line px-3 text-xs font-medium text-faint">
                          Live
                        </span>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </ContextShell>
  );
}
