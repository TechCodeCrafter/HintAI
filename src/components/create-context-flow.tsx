import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpenCheck, CheckCircle2, FileCode2, FileText, FolderOpen, LockKeyhole, Sparkles, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ContextShell } from "@/components/context-shell";
import { FolderPickerFields } from "@/components/review-pack-dialog";
import { useFolderPicker } from "@/components/use-folder-picker";
import { CONTEXT_KINDS } from "@/lib/context/kinds";
import type { ContextKind } from "@/lib/context/types";
import { cn } from "@/lib/cn";
import type { FolderLoadOptions } from "@/lib/repo/folder";
import { useMeetHint } from "@/lib/store";

type Step = "identity" | "material" | "indexing";

const COMING_SOON = ["PPTX"] as const;

export function CreateContextFlow() {
  const navigate = useNavigate();
  const folderPicker = useFolderPicker();
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

  const busy =
    creating ||
    loadingFolder ||
    folderPicker.reading ||
    contextStatus === "hydrating" ||
    contextStatus === "booting";
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

  async function addFolder(list: FileList | File[], options?: FolderLoadOptions) {
    if (!workingId) return;
    setStep("indexing");
    await attachFolderToContext(workingId, list, options);
  }

  async function addPdfs(list: FileList | File[]) {
    if (!workingId) return;
    setStep("indexing");
    await addPdfFiles(list);
  }

  const indexingDone = step === "indexing" && contextStatus === "ready" && !loadingFolder;

  return (
    <ContextShell>
      <main className="enterprise-page mh-rise pb-16">
        {step === "identity" ? (
          <div className="enterprise-create-grid">
            <section className="space-y-8">
              <header className="enterprise-page-heading">
                <p className="enterprise-overline">New Knowledge Space</p>
                <h1 className="enterprise-title">Create a knowledge space.</h1>
                <p className="enterprise-subtitle">
                  Group the material MeetHint should use for one project, customer, course, presentation, or research topic.
                </p>
              </header>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="enterprise-section-title">1. What are you working with?</h2>
                  <span className="hidden text-xs text-muted sm:block">Choose the closest fit.</span>
                </div>
                <div className="enterprise-kind-grid">
                  {CONTEXT_KINDS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`context-type-${item.id}`}
                      data-selected={kind === item.id ? "true" : undefined}
                      onClick={() => setKind(item.id)}
                      className="enterprise-card enterprise-card-interactive enterprise-kind-card"
                    >
                      <span className="enterprise-icon-tile mb-5" aria-hidden="true">
                        <Sparkles className="size-5" />
                      </span>
                      <span className="block pr-6 text-[15px] font-semibold text-fg">{item.label}</span>
                      <span className="mt-2 block text-xs leading-relaxed text-muted">
                        Keep the material and answers for this work together.
                      </span>
                      <span
                        className={cn(
                          "absolute right-4 top-4 grid size-5 place-items-center rounded-full border",
                          kind === item.id ? "border-accent bg-accent text-white" : "border-line bg-surface",
                        )}
                        aria-hidden="true"
                      >
                        {kind === item.id ? <CheckCircle2 className="size-3.5" /> : null}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="enterprise-section-title">2. Add the details</h2>
                <div className="enterprise-card space-y-5 p-5 sm:p-6">
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-secondary">Name</span>
                    <input
                      className="mh-field w-full px-4"
                      data-testid="context-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="northstar-payments"
                      autoComplete="off"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-secondary">Description (optional)</span>
                    <input
                      className="mh-field w-full px-4"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Checkout recovery, exporter retries"
                      autoComplete="off"
                    />
                    <span className="block text-xs leading-relaxed text-faint">
                      A short description helps you recognize the space later. It does not replace the material you add.
                    </span>
                  </label>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      className="enterprise-primary"
                      data-testid="create-context-submit"
                      disabled={!kind || !name.trim() || creating}
                      onClick={() => void continueToMaterial()}
                    >
                      {creating ? "Creating…" : "Create space"}
                    </button>
                    <Link to="/home" className="enterprise-secondary">
                      Cancel
                    </Link>
                  </div>
                </div>
              </div>
            </section>

            <aside className="enterprise-card enterprise-helper-panel space-y-7">
              <div className="space-y-3">
                <span className="enterprise-icon-tile" aria-hidden="true">
                  <BookOpenCheck className="size-5" />
                </span>
                <h2 className="text-xl font-semibold tracking-[-0.035em] text-fg">Your material, one clear scope.</h2>
                <p className="text-sm leading-relaxed text-muted">
                  A Knowledge Space defines the material MeetHint can search for this conversation or task.
                </p>
              </div>
              <HelperPoint
                icon={<FileCode2 className="size-4" />}
                title="Keep related sources together"
                body="Add code, documents, notes, spreadsheets, or PDFs that belong to the same body of work."
              />
              <HelperPoint
                icon={<LockKeyhole className="size-4" />}
                title="Stay grounded in the space"
                body="Answers should come from material available to this space, with evidence attached when supported."
              />
              <div className="rounded-xl border border-accent/15 bg-accent-soft p-4 text-xs leading-relaxed text-body">
                You can add more sources after the space is created.
              </div>
            </aside>
          </div>
        ) : null}

        {step === "material" ? (
          <div className="space-y-8">
            <header className="enterprise-page-heading">
              <p className="enterprise-overline">{name.trim() || "New Knowledge Space"}</p>
              <h1 className="enterprise-title">Add material.</h1>
              <p className="enterprise-subtitle">
                Add the files MeetHint is allowed to use for answers in this space. Indexing begins after you choose material.
              </p>
            </header>

            <section className="enterprise-material-grid" aria-label="Add material options">
              <button
                type="button"
                data-testid="upload-folder-button"
                className="enterprise-card enterprise-card-interactive enterprise-material-card flex flex-col items-start text-left"
                disabled={folderPicker.reading}
                onClick={() => void folderPicker.offerFolder()}
              >
                <span className="enterprise-icon-tile" aria-hidden="true">
                  <FolderOpen className="size-5" />
                </span>
                <span className="mt-7 text-lg font-semibold tracking-[-0.025em] text-fg">
                  {folderPicker.reading ? "Reading folder…" : "Upload repo or folder"}
                </span>
                <span className="mt-2 text-sm leading-relaxed text-muted">
                  Bring a local project or folder of supported text and code files into this space.
                </span>
                <span className="mt-auto pt-6 text-xs font-medium text-accent">Choose a folder</span>
              </button>

              <button
                type="button"
                data-testid="upload-files-button"
                className="enterprise-card enterprise-card-interactive enterprise-material-card flex flex-col items-start text-left"
                onClick={() => filesRef.current?.click()}
              >
                <span className="enterprise-icon-tile" aria-hidden="true">
                  <Upload className="size-5" />
                </span>
                <span className="mt-7 text-lg font-semibold tracking-[-0.025em] text-fg">Upload files</span>
                <span className="mt-2 text-sm leading-relaxed text-muted">
                  Markdown, text, source code, DOCX, XLSX, CSV, JSON, CSS, YAML, and more supported source files.
                </span>
                <span className="mt-auto pt-6 text-xs font-medium text-accent">Choose files</span>
              </button>

              <button
                type="button"
                className="enterprise-card enterprise-card-interactive enterprise-material-card flex flex-col items-start text-left"
                onClick={() => pdfRef.current?.click()}
              >
                <span className="enterprise-icon-tile" aria-hidden="true">
                  <FileText className="size-5" />
                </span>
                <span className="mt-7 text-lg font-semibold tracking-[-0.025em] text-fg">Add PDFs</span>
                <span className="mt-2 text-sm leading-relaxed text-muted">
                  Add PDF documents separately so MeetHint can index document evidence and page references.
                </span>
                <span className="mt-auto pt-6 text-xs font-medium text-accent">Choose PDFs</span>
              </button>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-5 py-4">
              <p className="text-sm text-muted">PPTX is not supported yet.</p>
              <div className="flex flex-wrap gap-2">
                {COMING_SOON.map((label) => (
                  <span key={label} className="mh-chip border-dashed text-xs">
                    {label}
                    <span className="text-faint">Coming soon</span>
                  </span>
                ))}
              </div>
            </div>

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
          </div>
        ) : null}

        {step === "indexing" ? (
          <section
            className="mx-auto max-w-3xl space-y-7"
            data-testid={indexingDone ? "indexing-complete" : "indexing"}
          >
            <div className="enterprise-card p-6 sm:p-8">
              <div className="flex flex-col items-center text-center">
                <span className="enterprise-icon-tile size-12" aria-hidden="true">
                  {indexingDone ? <CheckCircle2 className="size-6" /> : <Sparkles className="size-6" />}
                </span>
                <p className="enterprise-overline mt-6">{name.trim() || "Knowledge Space"}</p>
                <h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em] text-fg sm:text-5xl">
                  {indexingDone ? "Ready to ask." : "Indexing your material…"}
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">
                  {indexingDone
                    ? "Your material is indexed and ready for cited search."
                    : "MeetHint is preparing the material so answers can point back to supporting evidence."}
                </p>
              </div>

              <div className="mh-progress mt-8" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>

              <dl className="enterprise-stat-grid mt-7" data-testid="index-stats">
                <Stat label="sources" value={sourceCount} />
                <Stat label="evidence spans" value={chunks.length} />
                <Stat label="code symbols" value={symbolCount} />
              </dl>

              {folderError ? (
                <p className="mt-5 rounded-xl border border-warn/20 bg-warn/5 px-4 py-3 text-sm text-warn" role="status">
                  {folderError}
                </p>
              ) : null}

              <div className="mt-7 flex justify-center">
                <button
                  type="button"
                  className="enterprise-primary"
                  data-testid="indexing-done"
                  disabled={!indexingDone || !workingId || busy}
                  onClick={() => {
                    if (!workingId) return;
                    void navigate({ to: "/context/$id", params: { id: workingId } });
                  }}
                >
                  Open Knowledge Space
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <FolderPickerFields
          picker={folderPicker}
          onIndex={(files, options) => {
            void addFolder(files, options);
          }}
        />
        <p className="mt-8 text-xs text-faint">
          <Link to="/home" className="hover:text-fg">
            Back to Knowledge Spaces
          </Link>
        </p>
      </main>
    </ContextShell>
  );
}

function HelperPoint({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
        {icon}
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="text-xs leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="enterprise-stat-card rounded-xl border border-line bg-subtle/55">
      <p className="text-2xl font-semibold tracking-[-0.04em] text-fg tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}
