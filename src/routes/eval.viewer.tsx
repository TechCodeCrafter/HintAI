import { useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { PdfPane } from "@/components/pdf-pane";
import { installShotDocument, VIEWER_SHOTS } from "@/lib/document/viewer/qa-boot";
import { openTargetFromEvidence } from "@/lib/document/viewer/resolve";
import { syncViewerBlobPins } from "@/lib/document/viewer/retain";
import { qaToolsEnabled } from "@/lib/qa-tools";
import { useMeetHint } from "@/lib/store";

export const Route = createFileRoute("/eval/viewer")({
  // Installs fixture spaces into the bound account, so it must not be
  // reachable from a production build.
  beforeLoad: () => {
    if (!qaToolsEnabled) throw redirect({ to: "/", replace: true });
  },
  validateSearch: (search: Record<string, unknown>): { shot?: string } =>
    typeof search.shot === "string" ? { shot: search.shot } : {},
  component: ViewerEvalPage,
  head: () => ({ meta: [{ title: "MeetHint PDF viewer QA" }] }),
});

function ViewerEvalPage() {
  // Read from the route, not set after mount: the old two-step installed the
  // "exact" fixture first and then the requested one.
  const { shot: shotId = "exact" } = Route.useSearch();
  const shot = VIEWER_SHOTS.find((item) => item.id === shotId) ?? VIEWER_SHOTS[0];
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void installShotDocument(shot)
      .then(({ evidence }) => {
        if (cancelled) return;
        const target = shot.stale
          ? { sourceId: evidence.sourceId, contentHash: "missing-revision", page: evidence.page, evidenceId: evidence.id }
          : openTargetFromEvidence(evidence);
        const card = {
          say: evidence.spokenText,
          citations: [
            {
              kind: "document" as const,
              sourceId: evidence.sourceId,
              path: evidence.path,
              page: evidence.page,
              evidenceId: evidence.id,
              label: "",
            },
          ],
          evidence: [evidence],
          query: shot.needle,
          latencyMs: 0,
          source: "local" as const,
        };
        syncViewerBlobPins(card, shot.stale ? null : target);
        useMeetHint.setState({ card, openDocument: target });
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "viewer qa failed");
      });
    return () => {
      cancelled = true;
    };
  }, [shot]);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg" data-viewer-shot={shot.id}>
      <header className="shrink-0 border-b border-line px-4 py-3 text-xs text-muted">
        PDF viewer QA · {shot.id}
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col p-3">
        <section className="ground-panel min-h-[28rem] flex-1">
          <div className="ground-code flex min-h-0 flex-1 flex-col overflow-hidden">
            {error ? <p className="p-4 text-sm text-warn">{error}</p> : null}
            {ready ? <PdfPane forceMode={shot.forceMode} /> : <p className="p-4 text-sm text-muted">Preparing…</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
