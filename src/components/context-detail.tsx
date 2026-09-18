import { Link, useNavigate } from "@tanstack/react-router";
import { FileText, FolderGit2, FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContextShell } from "@/components/context-shell";
import { FolderPickerFields } from "@/components/review-pack-dialog";
import { useFolderPicker } from "@/components/use-folder-picker";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { formatSpaceCounts, spaceStatusLabel } from "@/lib/context/kinds";
import { persistActiveSpaceId } from "@/lib/context/migration";
import { getContextRepository } from "@/lib/context/service";
import type { SpaceRecord } from "@/lib/context/space-types";
import type { StoredSource } from "@/lib/context/types";
import { isPdfSource, isTextSource } from "@/lib/context/types";
import { useAccountVaultReady } from "@/lib/auth/account-session";
import { useMeetHint } from "@/lib/store";

type SourceRow = {
  key: string;
  displayName: string;
  sourceType: "repo" | "pdf" | "file";
  path: string;
  fileCount: number;
  status: string;
  updatedAt: number;
};

function rowsFromSources(sources: StoredSource[]): SourceRow[] {
  const byBundle = new Map<string, StoredSource[]>();
  for (const source of sources) {
    const bucket = byBundle.get(source.sourceId) ?? [];
    bucket.push(source);
    byBundle.set(source.sourceId, bucket);
  }
  const rows: SourceRow[] = [];
  for (const [sourceId, bundle] of byBundle) {
    const head = bundle[0]!;
    if (isPdfSource(head)) {
      rows.push({
        key: sourceId,
        displayName: head.displayName,
        sourceType: "pdf",
        path: head.path,
        fileCount: 1,
        status: head.readiness === "ready" ? "Ready" : head.readiness,
        updatedAt: head.updatedAt,
      });
      continue;
    }
    rows.push({
      key: sourceId,
      displayName: head.displayName,
      sourceType: "repo",
      path: head.path,
      fileCount: bundle.length,
      status: "Ready",
      updatedAt: Math.max(...bundle.map((row) => row.updatedAt)),
    });
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function ContextDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const folderPicker = useFolderPicker();
  const filesRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [space, setSpace] = useState<SpaceRecord | null>(null);
  const [sources, setSources] = useState<StoredSource[]>([]);
  const [status, setStatus] = useState<"ready" | "indexing" | "error">("ready");
  const [missing, setMissing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { ready: vaultReady } = useAccountVaultReady();
  const attachFolderToContext = useMeetHint((s) => s.attachFolderToContext);
  const addPdfFiles = useMeetHint((s) => s.addPdfFiles);
  const deleteStoredContext = useMeetHint((s) => s.deleteStoredContext);
  const activateSpace = useMeetHint((s) => s.activateSpace);

  const primaryContextId = space?.primaryContextId ?? id;
  const sourceRows = useMemo(() => rowsFromSources(sources), [sources]);
  const totalFiles = useMemo(
    () => sourceRows.reduce((sum, row) => sum + row.fileCount, 0),
    [sourceRows],
  );
  const lastUpdated = useMemo(
    () => (sourceRows.length > 0 ? Math.max(...sourceRows.map((row) => row.updatedAt)) : null),
    [sourceRows],
  );
  const counts = useMemo(() => {
    const repoIds = new Set(sources.filter(isTextSource).map((row) => row.sourceId));
    return { repoCount: repoIds.size, docCount: sources.filter(isPdfSource).length };
  }, [sources]);

  async function load() {
    const repo = getContextRepository();
    let record = await repo.getSpace(id);
    if (!record) {
      const context = await repo.getContext(id);
      if (!context) {
        setMissing(true);
        return;
      }
      record =
        (await repo.getSpace(context.id)) ??
        (await repo.createSpace({
          id: context.id,
          name: context.name,
          memberContextIds: [context.id],
          primaryContextId: context.id,
        }));
    }
    const memberSources = (
      await Promise.all(record.memberContextIds.map((contextId) => repo.listSources(contextId)))
    ).flat();
    const members = await Promise.all(record.memberContextIds.map((contextId) => repo.getContext(contextId)));
    const nextStatus = members.some((row) => row?.status === "error")
      ? "error"
      : members.some((row) => row?.status === "indexing")
        ? "indexing"
        : "ready";
    setSpace(record);
    setSources(memberSources);
    setStatus(nextStatus);
    persistActiveSpaceId(record.id);
    void activateSpace(record.id);
  }

  useEffect(() => {
    if (!vaultReady) return;
    void load();
  }, [id, vaultReady]);

  if (missing) {
    return (
      <ContextShell>
        <main className="space-y-4 py-10" data-testid="space-missing">
          <h1 className="ds-display">That Knowledge Space is gone.</h1>
          <Link to="/home" className="text-accent hover:underline">
            Back to Knowledge Spaces
          </Link>
        </main>
      </ContextShell>
    );
  }

  if (!space) {
    return (
      <ContextShell>
        <p className="py-10 text-sm text-muted">Opening Knowledge Space…</p>
      </ContextShell>
    );
  }

  const statusVariant =
    status === "ready" ? "ready" : status === "indexing" ? "indexing" : "error";

  return (
    <ContextShell wide>
      <main className="mh-rise space-y-8" data-testid="space-detail">
        <PageHeader
          overline="Knowledge Space"
          title={space.name}
          description="Manage the material MeetHint uses for answers in this space."
          breadcrumb={
            <Link to="/home" className="text-sm text-muted hover:text-fg">
              ← Knowledge Spaces
            </Link>
          }
          actions={
            <Badge variant={statusVariant} dot>
              {spaceStatusLabel(status)}
            </Badge>
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            to="/context/$id/ask"
            params={{ id: space.id }}
            className="ds-surface-elevated flex min-h-[5.5rem] flex-col justify-between bg-accent p-4 text-on-accent transition-opacity hover:opacity-95"
          >
            <p className="text-sm font-semibold">Ask</p>
            <p className="text-xs opacity-90">Get an answer now</p>
          </Link>
          {sources.length > 0 ? (
            <Link
              to="/context/$id/live"
              params={{ id: space.id }}
              data-testid="start-live"
              className="ds-surface-elevated flex min-h-[5.5rem] flex-col justify-between p-4 transition-colors hover:border-accent"
            >
              <p className="text-sm font-semibold text-fg">Start live session</p>
              <p className="text-xs text-muted">Talk with your knowledge</p>
            </Link>
          ) : (
            <div className="ds-surface flex min-h-[5.5rem] flex-col justify-between p-4 opacity-55">
              <p className="text-sm font-semibold text-fg">Start live session</p>
              <p className="text-xs text-muted">Add a source first</p>
            </div>
          )}
          <button
            type="button"
            data-testid="add-repo-folder"
            className="ds-surface-elevated flex min-h-[5.5rem] flex-col justify-between p-4 text-left transition-colors hover:border-accent"
            disabled={folderPicker.reading}
            onClick={() => void folderPicker.offerFolder()}
          >
            <FolderOpen aria-hidden className="size-4 text-accent" />
            <p className="text-sm font-medium text-fg">{folderPicker.reading ? "Reading…" : "Add repo / folder"}</p>
          </button>
          <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-1">
            <button
              type="button"
              className="ds-surface-elevated flex flex-col justify-between p-4 text-left transition-colors hover:border-accent"
              onClick={() => filesRef.current?.click()}
            >
              <p className="text-sm font-medium text-fg">Add files</p>
            </button>
            <button
              type="button"
              data-testid="add-pdf"
              className="ds-surface-elevated flex flex-col justify-between p-4 text-left transition-colors hover:border-accent"
              onClick={() => pdfRef.current?.click()}
            >
              <FileText aria-hidden className="size-4 text-accent" />
              <p className="text-sm font-medium text-fg">Add PDF</p>
            </button>
          </div>
        </div>

        <div className="ds-metric-grid">
          <MetricCard label="Total files" value={totalFiles} detail="Indexed on this device" />
          <MetricCard label="Data sources" value={sourceRows.length} detail={formatSpaceCounts(counts)} />
          <MetricCard
            label="Status"
            value={spaceStatusLabel(status)}
            detail={status === "ready" ? "All sources indexed" : "Indexing in progress"}
          />
          <MetricCard
            label="Last updated"
            value={lastUpdated ? formatRelativeTime(lastUpdated) : "—"}
            detail={lastUpdated ? "Most recent source change" : "No sources yet"}
          />
        </div>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="ds-section-title">Sources</h2>
              <p className="ds-caption">Manage the content that powers this Knowledge Space.</p>
            </div>
          </div>

          {sourceRows.length === 0 ? (
            <EmptyState
              icon={<FolderGit2 aria-hidden />}
              title="No sources yet"
              description="Add repos, folders, files, or PDFs. MeetHint indexes them locally for cited answers."
            />
          ) : (
            <div className="ds-surface-elevated overflow-hidden">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Files</th>
                    <th>Status</th>
                    <th>Last synced</th>
                  </tr>
                </thead>
                <tbody data-testid="space-source-list">
                  {sourceRows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-fg">{row.displayName}</p>
                          <p className="truncate text-xs text-muted">{row.path}</p>
                        </div>
                      </td>
                      <td>
                        <Badge variant="local">{row.sourceType === "pdf" ? "PDF" : "Repository"}</Badge>
                      </td>
                      <td className="tabular-nums text-fg">{row.fileCount}</td>
                      <td>
                        <Badge variant={row.status === "Ready" ? "ready" : "indexing"} dot>
                          {row.status}
                        </Badge>
                      </td>
                      <td className="text-muted">{formatRelativeTime(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="border-t border-line pt-6" data-testid="space-menu">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-body">Delete this Knowledge Space and its sources on this device?</p>
              <button
                type="button"
                className="mh-cta bg-bad border-bad"
                data-testid="confirm-delete"
                onClick={async () => {
                  await deleteStoredContext(space.id);
                  void navigate({ to: "/home" });
                }}
              >
                Delete
              </button>
              <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="delete-space"
              className="inline-flex h-11 items-center gap-2 text-xs text-muted hover:text-bad"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
              Delete Knowledge Space
            </button>
          )}
        </div>

        <FolderPickerFields
          picker={folderPicker}
          onIndex={(files, options) => {
            void attachFolderToContext(primaryContextId, files, options).then(() => load());
          }}
        />
        <input
          ref={filesRef}
          type="file"
          multiple
          accept=".md,.mdx,.txt,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.kt,.json,.css,.yml,.yaml,.docx,.xlsx,.csv"
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) void attachFolderToContext(primaryContextId, files).then(() => load());
            event.target.value = "";
          }}
        />
        <input
          ref={pdfRef}
          type="file"
          multiple
          accept=".pdf,application/pdf"
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) {
              void activateSpace(space.id).then(() => addPdfFiles(files)).then(() => load());
            }
            event.target.value = "";
          }}
        />
      </main>
    </ContextShell>
  );
}
