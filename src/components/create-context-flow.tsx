import { Link, useNavigate } from "@tanstack/react-router";
import { FileText, FolderOpen, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ContextShell } from "@/components/context-shell";
import { CONTEXT_KINDS } from "@/lib/context/kinds";
import type { ContextKind } from "@/lib/context/types";
import { cn } from "@/lib/cn";
import { useMeetHint } from "@/lib/store";

type Step = "identity" | "material" | "indexing";

const COMING_SOON = ["DOCX", "PPTX", "XLSX"] as const;

export function CreateContextFlow() {
  const navigate = useNavigate();
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("identity");
  const [kind, setKind] = useState<ContextKind | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contextId, setContextId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const createNamedContext = useMeetHint((s) => s.createNamedContext);
  const attachFolderToContext = useMeetHint((s) => s.attachFolderToContext);
  const addPdfFiles = useMeetHint((s) => s.addPdfFiles);
  const contextStatus = useMeetHint((s) => s.contextStatus);
  const ingestProgress = useMeetHint((s) => s.ingestProgress);
  const loadingFolder = useMeetHint((s) => s.loadingFolder);
  const folderError = useMeetHint((s) => s.folderError);
  const sources = useMeetHint((s) => s.sources);
  const chunks = useMeetHint((s) => s.chunks);
  const activeContextId = useMeetHint((s) => s.activeContextId);

  const busy = creating || loadingFolder || contextStatus === "hydrating" || contextStatus === "booting";
  const symbolCount = useMemo(() => chunks.filter((chunk) => "symbol" in chunk && chunk.symbol).length, [chunks]);
  const sourceCount = sources.length;
  const workingId = contextId ?? activeContextId;
  const progress =
    ingestProgress && ingestProgress.total > 0
      ? Math.min(100, Math.round((ingestProgress.current / ingestProgress.total) * 100))
      : loadingFolder || contextStatus === "hydrating"
        ? 55
        : contextStatus === "ready" && sourceCount > 0
          ? 100
          : 8;

  async function continueToMaterial() {
    const trimmed = name.trim();
    if (!kind || !trimmed || creating) return;
    setCreating(true);
    try {
      const id = await createNamedContext({
        name: trimmed,
        description: description.trim() || undefined,
        kind,
      });
      setContextId(id);
      setStep("material");
    } finally {
      setCreating(false);
    }
  }

  async function addFolder(list: FileList | File[]) {
    if (!workingId) return;
    setStep("indexing");
    await attachFolderToContext(workingId, list);
  }

  async function addPdfs(list: FileList | File[]) {
    if (!workingId) return;
    setStep("indexing");
    await addPdfFiles(list);
  }

  const indexingDone = step === "indexing" && contextStatus === "ready" && !loadingFolder;

  return (
    <ContextShell>
      <main className="mh-rise space-y-8 pb-16 pt-4">
        {step === "identity" ? (
          <section className="space-y-6">
            <div className="space-y-2">
              <p className="mh-eyebrow">New context</p>
              <h1 className="mh-display text-4xl">What are you working with?</h1>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CONTEXT_KINDS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`context-type-${item.id}`}
                  onClick={() => setKind(item.id)}
                  className={cn(
                    "min-h-11 rounded-md border px-3 py-3 text-left text-sm",
                    kind === item.id
                      ? "border-accent bg-accent-soft text-fg"
                      : "border-line text-body hover:border-accent hover:text-fg",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="block space-y-2">
              <span className="text-xs text-muted">Name</span>
              <input
                className="mh-field"
                data-testid="context-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="northstar-payments"
                autoComplete="off"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-xs text-muted">Description (optional)</span>
              <input
                className="mh-field"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Checkout recovery, exporter retries"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="mh-cta"
              data-testid="create-context-submit"
              disabled={!kind || !name.trim() || creating}
              onClick={() => void continueToMaterial()}
            >
              {creating ? "Creating…" : "Continue"}
            </button>
          </section>
        ) : null}

        {step === "material" ? (
          <section className="space-y-6">
            <div className="space-y-2">
              <p className="mh-eyebrow">{name.trim() || "New context"}</p>
              <h1 className="mh-display text-4xl">Add material</h1>
              <p className="text-sm text-muted">Folder, files, or PDFs. Office formats stay off until they parse.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <button type="button" className="mh-panel flex min-h-24 flex-col items-start gap-2 p-4 text-left" onClick={() => folderRef.current?.click()}>
                <FolderOpen className="size-4 text-accent" />
                <span className="text-sm font-medium">Upload folder</span>
              </button>
              <button
                type="button"
                data-testid="upload-files-button"
                className="mh-panel flex min-h-24 flex-col items-start gap-2 p-4 text-left"
                onClick={() => filesRef.current?.click()}
              >
                <Upload className="size-4 text-accent" />
                <span className="text-sm font-medium">Upload files</span>
                <span className="text-xs text-faint">Markdown, text, source</span>
              </button>
              <button type="button" className="mh-panel flex min-h-24 flex-col items-start gap-2 p-4 text-left" onClick={() => pdfRef.current?.click()}>
                <FileText className="size-4 text-accent" />
                <span className="text-sm font-medium">Add PDFs</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {COMING_SOON.map((label) => (
                <span key={label} className="mh-chip border-dashed">
                  {label}
                  <span className="text-faint">Coming soon</span>
                </span>
              ))}
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
                if (files && files.length > 0) void addFolder(files);
                event.target.value = "";
              }}
              {...{ webkitdirectory: "", directory: "" }}
            />
            <input
              ref={filesRef}
              type="file"
              multiple
              accept=".md,.mdx,.txt,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.kt,.json,.css,.yml,.yaml"
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const files = event.target.files;
                if (files && files.length > 0) void addFolder(files);
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
                if (files && files.length > 0) void addPdfs(files);
                event.target.value = "";
              }}
            />
          </section>
        ) : null}

        {step === "indexing" ? (
          <section
            className="space-y-6"
            data-testid={indexingDone ? "indexing-complete" : "indexing"}
          >
            <div className="space-y-2">
              <p className="mh-eyebrow">{name.trim() || "Context"}</p>
              <h1 className="mh-display text-4xl">{indexingDone ? "Ready" : "Indexing…"}</h1>
            </div>
            <div className="mh-progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
            <dl className="grid gap-3 sm:grid-cols-3" data-testid="index-stats">
              <Stat label="sources" value={sourceCount} />
              <Stat label="evidence spans" value={chunks.length} />
              <Stat label="code symbols" value={symbolCount} />
            </dl>
            {folderError ? (
              <p className="text-sm text-warn" role="status">
                {folderError}
              </p>
            ) : null}
            <button
              type="button"
              className="mh-cta"
              data-testid="indexing-done"
              disabled={!indexingDone || !workingId || busy}
              onClick={() => {
                if (!workingId) return;
                void navigate({ to: "/context/$id", params: { id: workingId } });
              }}
            >
              Done
            </button>
          </section>
        ) : null}

        <p className="text-xs text-faint">
          <Link to="/home" className="hover:text-fg">
            Back to contexts
          </Link>
        </p>
      </main>
    </ContextShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="mh-panel space-y-1 p-4">
      <p className="mh-display text-3xl tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
