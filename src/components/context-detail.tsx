import { Link, useNavigate } from "@tanstack/react-router";
import { FileText, FolderOpen, Trash2 } from "lucide-react";
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
        <main className="space-y-4 py-10" data-testid="space-missing">
          <h1 className="mh-display text-3xl">That Knowledge Space is gone.</h1>
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

  return (
    <ContextShell>
      <main className="mh-rise space-y-8 pb-16 pt-4" data-testid="space-detail">
        <div className="space-y-2">
          <p className="mh-eyebrow">Knowledge Space</p>
          <h1 className="mh-display text-4xl sm:text-5xl">{space.name}</h1>
          <p className="text-sm text-muted">
            {formatSpaceCounts(counts)} · {spaceStatusLabel(status)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/context/$id/ask"
            params={{ id: space.id }}
            className="inline-flex h-11 items-center justify-center rounded-sm border border-line px-4 text-xs font-medium text-secondary hover:border-accent hover:text-fg"
          >
            Ask
          </Link>
          {sources.length > 0 ? (
            <Link
              to="/context/$id/live"
              params={{ id: space.id }}
              data-testid="start-live"
              className="mh-cta inline-flex items-center justify-center"
            >
              Start live session
            </Link>
          ) : (
            <span className="mh-cta inline-flex items-center justify-center opacity-55">Start live session</span>
          )}
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="mh-eyebrow">Sources</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="add-repo-folder"
                className="inline-flex h-11 items-center gap-2 rounded-sm border border-line px-3 text-xs text-secondary hover:border-accent hover:text-fg"
                disabled={folderPicker.reading}
                onClick={() => void folderPicker.offerFolder()}
              >
                <FolderOpen className="size-3.5" />
                {folderPicker.reading ? "Reading…" : "Add repo / folder"}
              </button>
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-sm border border-line px-3 text-xs text-secondary hover:border-accent hover:text-fg"
                onClick={() => filesRef.current?.click()}
              >
                Add files
              </button>
              <button
                type="button"
                data-testid="add-pdf"
                className="inline-flex h-11 items-center gap-2 rounded-sm border border-line px-3 text-xs text-secondary hover:border-accent hover:text-fg"
                onClick={() => pdfRef.current?.click()}
              >
                <FileText className="size-3.5" />
                Add PDF
              </button>
            </div>
          </div>
          {sourceRows.length === 0 ? (
            <p className="text-sm text-muted">No sources yet. Add repos, folders, or PDFs — existing sources stay intact.</p>
          ) : (
            <ul className="mh-panel divide-y divide-line overflow-hidden" data-testid="space-source-list">
              {sourceRows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{row.displayName}</p>
                    <p className="truncate text-xs text-muted">{row.path}</p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-faint">
                    <p>{row.sourceType === "pdf" ? "PDF" : "Repo"}</p>
                    <p>{row.status}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="border-t border-line pt-6" data-testid="space-menu">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-body">Delete this Knowledge Space and its sources on this device?</p>
              <button
                type="button"
                className="mh-cta"
                data-testid="confirm-delete"
                onClick={async () => {
                  await deleteStoredContext(primaryContextId);
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
