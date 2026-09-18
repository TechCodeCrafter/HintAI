import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Briefcase,
  FileText,
  FolderOpen,
  GraduationCap,
  Lightbulb,
  Lock,
  Presentation,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ContextShell } from "@/components/context-shell";
import { FolderPickerFields } from "@/components/review-pack-dialog";
import { useFolderPicker } from "@/components/use-folder-picker";
import { DropzoneCard } from "@/components/ui/dropzone-card";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { CONTEXT_KINDS } from "@/lib/context/kinds";
import type { ContextKind } from "@/lib/context/types";
import { cn } from "@/lib/cn";
import type { FolderLoadOptions } from "@/lib/repo/folder";
import { useMeetHint } from "@/lib/store";

type Step = "identity" | "material" | "indexing";

const COMING_SOON = ["PPTX"] as const;

const KIND_ICONS: Record<ContextKind, typeof Briefcase> = {
  work: Briefcase,
  course: GraduationCap,
  client: Briefcase,
  presentation: Presentation,
  research: Lightbulb,
  other: Sparkles,
};

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
    <ContextShell wide>
      <main className="mh-rise pb-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
          <div className="space-y-8">
            {step === "identity" ? (
              <section className="space-y-6">
                <PageHeader
                  overline="New context"
                  title="Create a knowledge space."
                  description="Give MeetHint a focused context so you get better, more relevant answers. You can always add or change details later."
                />
                <div className="space-y-3">
                  <p className="text-sm font-medium text-fg">What are you working with?</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {CONTEXT_KINDS.map((item) => {
                      const Icon = KIND_ICONS[item.id];
                      const selected = kind === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-testid={`context-type-${item.id}`}
                          data-selected={selected ? "true" : "false"}
                          onClick={() => setKind(item.id)}
                          className={cn(
                            "ds-card-interactive relative min-h-[5.5rem] p-3 text-left",
                            selected && "border-accent bg-accent-soft",
                          )}
                        >
                          {selected ? (
                            <span className="absolute top-2.5 right-2.5 size-4 rounded-full border-2 border-accent bg-accent" aria-hidden />
                          ) : null}
                          <Icon aria-hidden className="mb-2 size-4 text-accent" />
                          <p className="text-sm font-medium text-fg">{item.label}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-4">
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-muted">Name</span>
                    <Input
                      data-testid="context-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="northstar-payments"
                      autoComplete="off"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-muted">Description (optional)</span>
                    <Input
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Checkout recovery, exporter retries"
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="mh-cta"
                    data-testid="create-context-submit"
                    disabled={!kind || !name.trim() || creating}
                    onClick={() => void continueToMaterial()}
                  >
                    {creating ? "Creating…" : "Create space →"}
                  </button>
                  <Link to="/home" className="inline-flex h-11 items-center px-2 text-sm text-muted hover:text-fg">
                    Cancel
                  </Link>
                </div>
              </section>
            ) : null}

            {step === "material" ? (
              <section className="space-y-6">
                <PageHeader
                  overline={name.trim() || "New context"}
                  title="Add material"
                  description="Add content to this Knowledge Space. MeetHint indexes it so it can answer from it."
                />
                <div className="grid gap-3 md:grid-cols-3">
                  <DropzoneCard
                    icon={<FolderOpen aria-hidden />}
                    title="Upload repo or folder"
                    description="Paste a Git URL or drag & drop a folder"
                    footer="GitHub repos or local folders"
                    disabled={folderPicker.reading}
                    testId="upload-folder-button"
                    onClick={() => void folderPicker.offerFolder()}
                  />
                  <DropzoneCard
                    icon={<Upload aria-hidden />}
                    title="Upload files"
                    description="Drag & drop files or click to browse"
                    footer="Markdown, text, code, DOCX, XLSX, CSV"
                    testId="upload-files-button"
                    onClick={() => filesRef.current?.click()}
                  />
                  <DropzoneCard
                    icon={<FileText aria-hidden />}
                    title="Add PDFs"
                    description="Drag & drop PDFs or click to browse"
                    footer="Text or scanned PDFs (limits apply)"
                    onClick={() => pdfRef.current?.click()}
                  />
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
                  ref={filesRef}
                  type="file"
                  multiple
                  accept=".md,.mdx,.txt,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.kt,.json,.css,.yml,.yaml,.docx,.xlsx,.csv"
                  className="sr-only"
                  aria-hidden
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
                  aria-hidden
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
                <PageHeader
                  overline={name.trim() || "Context"}
                  title={indexingDone ? "Ready" : "Indexing…"}
                  description={
                    indexingDone
                      ? "Your material is indexed. Open the Knowledge Space or start a live session."
                      : "MeetHint is reading and indexing your material on this device."
                  }
                />
                <div className="mh-progress" aria-hidden="true">
                  <span style={{ width: `${progress}%` }} />
                </div>
                <div className="ds-metric-grid" data-testid="index-stats">
                  <MetricCard label="Sources" value={sourceCount} />
                  <MetricCard label="Evidence spans" value={chunks.length} />
                  <MetricCard label="Code symbols" value={symbolCount} />
                  <MetricCard label="Progress" value={`${progress}%`} />
                </div>
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

            <FolderPickerFields
              picker={folderPicker}
              onIndex={(files, options) => {
                void addFolder(files, options);
              }}
            />
            <p className="text-xs text-faint">
              <Link to="/home" className="hover:text-fg">
                ← Back to Knowledge Spaces
              </Link>
            </p>
          </div>

          <aside className="ds-surface-elevated hidden space-y-6 p-6 lg:block">
            <div className="ds-surface-subtle space-y-2 p-4">
              <p className="text-sm font-medium text-fg">Your knowledge, always in context.</p>
              <p className="ds-caption">Turn your materials into better answers during live conversations.</p>
            </div>
            <ul className="space-y-4">
              <li className="flex gap-3">
                <span className="trust-feature-icon">
                  <BookOpen aria-hidden className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-fg">Keep everything in one place</p>
                  <p className="ds-caption">Add repos, folders, files, and PDFs to a Knowledge Space.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="trust-feature-icon">
                  <Zap aria-hidden className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-fg">Get answers that understand your context</p>
                  <p className="ds-caption">Search and live sessions stay scoped to this space.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="trust-feature-icon">
                  <Lock aria-hidden className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-fg">Private and local</p>
                  <p className="ds-caption">Your data stays on device — not used for training.</p>
                </div>
              </li>
            </ul>
            <div className="rounded-lg bg-accent-soft p-4">
              <p className="text-sm text-fg">
                <Sparkles aria-hidden className="mr-1 inline size-3.5 text-accent" />
                Be specific with the name and description — it helps you find the right space later.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </ContextShell>
  );
}
