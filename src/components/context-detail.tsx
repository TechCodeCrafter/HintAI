import { Link, useNavigate } from "@tanstack/react-router";
import { Activity, CheckCircle2, Database, FileStack, FileText, FolderOpen, MessageSquareText, Mic2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContextShell } from "@/components/context-shell";
import { FolderPickerFields } from "@/components/review-pack-dialog";
import { useFolderPicker } from "@/components/use-folder-picker";
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
        status: head.readiness === "ready" ? "Ready" : head.readiness,
        updatedAt: head.updatedAt,
      });
      continue;
    }
    rows.push({
      key: sourceId,
      displayName: head.displayName,
      sourceType: "repo",
      path: `${bundle.length} file${bundle.length === 1 ? "" : "s"}`,
      status: "Ready",
      updatedAt: Math.max(...bundle.map((row) => row.updatedAt)),
    });
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
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
        <main className="enterprise-page" data-testid="space-missing">
          <div className="enterprise-card mx-auto max-w-xl p-8 text-center">
            <FileStack className="mx-auto size-9 text-accent" aria-hidden="true" />
            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.045em] text-fg">That Knowledge Space is gone.</h1>
            <p className="mt-2 text-sm text-muted">The local space could not be found for this account.</p>
            <Link to="/home" className="enterprise-primary mt-6">
              Back to Knowledge Spaces
            </Link>
          </div>
        </main>
      </ContextShell>
    );
  }

  if (!space) {
    return (
      <ContextShell>
        <main className="enterprise-page">
          <div className="enterprise-card p-6 text-sm text-muted">Opening Knowledge Space…</div>
        </main>
      </ContextShell>
    );
  }

  return (
    <ContextShell>
      <main className="enterprise-page mh-rise space-y-7 pb-16" data-testid="space-detail">
        <section className="enterprise-space-header">
          <div className="relative z-10 flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="enterprise-overline">Knowledge Space</p>
                <span className="mh-chip gap-1.5 text-xs">
                  <span
                    className={`size-1.5 rounded-full ${status === "ready" ? "bg-ok" : status === "error" ? "bg-bad" : "bg-warn"}`}
                    aria-hidden="true"
                  />
                  {spaceStatusLabel(status)}
                </span>
              </div>
              <h1 className="truncate text-4xl font-semibold tracking-[-0.055em] text-fg sm:text-5xl lg:text-6xl">
                {space.name}
              </h1>
              <p className="text-sm text-muted">
                {formatSpaceCounts(counts)}. Ask questions, add more material, or take this space into a live conversation.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link to="/context/$id/ask" params={{ id: space.id }} className="enterprise-secondary">
                <MessageSquareText className="size-4 text-accent" aria-hidden="true" />
                Ask
              </Link>
              {sources.length > 0 ? (
                <Link
                  to="/context/$id/live"
                  params={{ id: space.id }}
                  data-testid="start-live"
                  className="enterprise-primary"
                >
                  <Mic2 className="size-4" aria-hidden="true" />
                  Start live session
                </Link>
              ) : (
                <span className="enterprise-primary pointer-events-none opacity-50">
                  <Mic2 className="size-4" aria-hidden="true" />
                  Start live session
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="enterprise-stat-grid" aria-label="Knowledge Space summary">
          <SummaryCard icon={<FileStack className="size-5" />} value={sources.length} label="Indexed files" />
          <SummaryCard icon={<Database className="size-5" />} value={sourceRows.length} label="Source bundles" />
          <SummaryCard
            icon={<CheckCircle2 className="size-5" />}
            value={spaceStatusLabel(status)}
            label="Space status"
            positive={status === "ready"}
          />
          <SummaryCard icon={<Activity className="size-5" />} value={counts.repoCount + counts.docCount} label="Repos + PDFs" />
        </section>

        <section className="enterprise-card p-4 sm:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="enterprise-overline">Sources</p>
              <h2 className="mt-1 enterprise-section-title">Material powering this space</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Add new material without replacing the sources already indexed here.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="add-repo-folder"
                className="enterprise-secondary"
                disabled={folderPicker.reading}
                onClick={() => void folderPicker.offerFolder()}
              >
                <FolderOpen className="size-4" />
                {folderPicker.reading ? "Reading…" : "Add repo / folder"}
              </button>
              <button type="button" className="enterprise-secondary" onClick={() => filesRef.current?.click()}>
                <Plus className="size-4" />
                Add files
              </button>
              <button
                type="button"
                data-testid="add-pdf"
                className="enterprise-secondary"
                onClick={() => pdfRef.current?.click()}
              >
                <FileText className="size-4" />
                Add PDF
              </button>
            </div>
          </div>

          <div className="mt-5">
            {sourceRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
                <FolderOpen className="mx-auto size-8 text-accent" aria-hidden="true" />
                <h3 className="mt-4 font-semibold text-fg">Add the first source.</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                  MeetHint needs material in this space before it can search for evidence or start a live session.
                </p>
              </div>
            ) : (
              <ul className="enterprise-source-table" data-testid="space-source-list">
                {sourceRows.map((row) => (
                  <li key={row.key} className="enterprise-source-row">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="enterprise-icon-tile size-9 rounded-lg" aria-hidden="true">
                        {row.sourceType === "pdf" ? <FileText className="size-4" /> : <FolderOpen className="size-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-fg">{row.displayName}</p>
                        <p className="mt-0.5 truncate text-xs text-muted">{row.path}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <span className="hidden text-xs text-faint sm:inline">{row.sourceType === "pdf" ? "PDF" : "Repo"}</span>
                      <span className="mh-chip text-xs">{row.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="border-t border-line pt-6" data-testid="space-menu">
          {confirmDelete ? (
            <div className="enterprise-card flex flex-col gap-4 border-bad/20 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-fg">Delete this Knowledge Space?</p>
                <p className="mt-1 text-sm text-muted">Its sources stored on this device will also be deleted.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-bad px-4 text-sm font-semibold text-white"
                  data-testid="confirm-delete"
                  onClick={async () => {
                    await deleteStoredContext(space.id);
                    void navigate({ to: "/home" });
                  }}
                >
                  Delete
                </button>
                <button type="button" className="enterprise-secondary" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
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
          aria-hidden="true"
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
          aria-hidden="true"
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

function SummaryCard({
  icon,
  value,
  label,
  positive,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  positive?: boolean;
}) {
  return (
    <div className="enterprise-card enterprise-stat-card">
      <div className="flex items-center justify-between gap-3">
        <span className="enterprise-icon-tile size-9 rounded-lg" aria-hidden="true">
          {icon}
        </span>
        {positive ? <span className="size-2 rounded-full bg-ok" aria-hidden="true" /> : null}
      </div>
      <p className="mt-4 truncate text-2xl font-semibold tracking-[-0.04em] text-fg tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}
