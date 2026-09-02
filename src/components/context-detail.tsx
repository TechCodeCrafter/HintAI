import { Link, useNavigate } from "@tanstack/react-router";
import { FileText, FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ContextShell } from "@/components/context-shell";
import { persistActiveContextId } from "@/lib/context/migration";
import { contextKindLabel } from "@/lib/context/kinds";
import { getContextRepository } from "@/lib/context/service";
import type { ContextRecord, StoredSource } from "@/lib/context/types";
import { useMeetHint } from "@/lib/store";

export function ContextDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [record, setRecord] = useState<ContextRecord | null>(null);
  const [sources, setSources] = useState<StoredSource[]>([]);
  const [missing, setMissing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const attachFolderToContext = useMeetHint((s) => s.attachFolderToContext);
  const addPdfFiles = useMeetHint((s) => s.addPdfFiles);
  const deleteStoredContext = useMeetHint((s) => s.deleteStoredContext);

  async function load() {
    const repo = getContextRepository();
    const context = await repo.getContext(id);
    if (!context) {
      setMissing(true);
      return;
    }
    setRecord(context);
    setSources(await repo.listSources(id));
  }

  useEffect(() => {
    void load();
  }, [id]);

  function bindActive() {
    persistActiveContextId(id);
    useMeetHint.setState({ activeContextId: id });
  }

  if (missing) {
    return (
      <ContextShell>
        <main className="space-y-4 py-10">
          <h1 className="mh-display text-3xl">That context is gone.</h1>
          <Link to="/home" className="text-accent hover:underline">
            Back to contexts
          </Link>
        </main>
      </ContextShell>
    );
  }

  if (!record) {
    return (
      <ContextShell>
        <p className="py-10 text-sm text-muted">Opening context…</p>
      </ContextShell>
    );
  }

  return (
    <ContextShell>
      <main className="mh-rise space-y-8 pb-16 pt-4">
        <div className="space-y-2">
          <p className="mh-eyebrow">{contextKindLabel(record.kind)}</p>
          <h1 className="mh-display text-4xl sm:text-5xl">{record.name}</h1>
          {record.description ? <p className="mh-lede">{record.description}</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/context/$id/ask"
            params={{ id: record.id }}
            className="inline-flex h-11 items-center justify-center rounded-sm border border-line px-4 text-xs font-medium text-secondary hover:border-accent hover:text-fg"
          >
            Ask
          </Link>
          {sources.length > 0 ? (
            <Link
              to="/context/$id/live"
              params={{ id: record.id }}
              data-testid="start-live"
              className="mh-cta inline-flex items-center justify-center"
            >
              Start Live Session
            </Link>
          ) : (
            <span className="mh-cta inline-flex items-center justify-center opacity-55">Start Live Session</span>
          )}
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="mh-eyebrow">Sources</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-sm border border-line px-3 text-xs text-secondary hover:border-accent hover:text-fg"
                onClick={() => folderRef.current?.click()}
              >
                <FolderOpen className="size-3.5" />
                Add folder
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
                className="inline-flex h-11 items-center gap-2 rounded-sm border border-line px-3 text-xs text-secondary hover:border-accent hover:text-fg"
                onClick={() => pdfRef.current?.click()}
              >
                <FileText className="size-3.5" />
                Add PDFs
              </button>
            </div>
          </div>
          {sources.length === 0 ? (
            <p className="text-sm text-muted">No sources yet. Add a folder, files, or PDFs.</p>
          ) : (
            <ul className="mh-panel divide-y divide-line overflow-hidden">
              {sources.map((source) => (
                <li key={source.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="truncate text-fg">{source.path}</span>
                  <span className="shrink-0 text-xs text-faint">{source.kind === "pdf" ? "PDF" : "file"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="border-t border-line pt-6" data-testid="context-menu">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-body">Delete this context and its sources on this device?</p>
              <button
                type="button"
                className="mh-cta"
                data-testid="confirm-delete"
                onClick={async () => {
                  await deleteStoredContext(id);
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
              data-testid="delete-context"
              className="inline-flex h-11 items-center gap-2 text-xs text-muted hover:text-bad"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
              Delete context
            </button>
          )}
        </div>

        <input
          ref={folderRef}
          type="file"
          multiple
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) void attachFolderToContext(id, files).then(() => load());
            event.target.value = "";
          }}
          {...{ webkitdirectory: "", directory: "" }}
        />
        <input
          ref={filesRef}
          type="file"
          multiple
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) void attachFolderToContext(id, files).then(() => load());
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
              bindActive();
              void addPdfFiles(files).then(() => load());
            }
            event.target.value = "";
          }}
        />
      </main>
    </ContextShell>
  );
}
