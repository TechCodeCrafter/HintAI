import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Briefcase,
  GraduationCap,
  Lightbulb,
  Lock,
  Presentation,
  Sparkles,
  Zap,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ContextShell } from "@/components/context-shell";
import { IndexSummaryNote } from "@/components/index-summary-note";
import { FolderPickerFields } from "@/components/review-pack-dialog";
import { useFolderPicker } from "@/components/use-folder-picker";
import { MaterialUploadPanel } from "@/components/material-upload-panel";
import {
  combineAddOutcomes,
  describeAddStep,
  indexingView,
  marksFromSources,
  type AddOutcome,
  type SourceMark,
} from "@/components/add-material-outcome";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { CONTEXT_KINDS } from "@/lib/context/kinds";
import { getContextRepository } from "@/lib/context/service";
import type { ContextKind } from "@/lib/context/types";
import { cn } from "@/lib/cn";
import type { FolderLoadOptions } from "@/lib/repo/folder";
import { useMeetHint } from "@/lib/store";

type Step = "identity" | "material" | "indexing";

const OFF_TARGET = "Another Knowledge Space was opened while this one was indexing. Open this space from Knowledge Spaces and add the material there.";

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
  const [step, setStep] = useState<Step>("identity");
  const [kind, setKind] = useState<ContextKind | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contextId, setContextId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // True from the moment material is handed over until every part of it has
  // been dealt with, so the screen never judges the result part-way through.
  const [adding, setAdding] = useState(false);
  // Why the files in a mixed selection were left out when its PDFs went in.
  const [filesNote, setFilesNote] = useState<string | null>(null);
  // The judged result of the last selection: what it actually added to this
  // space, not the store's status. Null while working or before any upload.
  const [outcome, setOutcome] = useState<AddOutcome | null>(null);

  const createNamedContext = useMeetHint((s) => s.createNamedContext);
  const attachFolderToContext = useMeetHint((s) => s.attachFolderToContext);
  const addPdfFiles = useMeetHint((s) => s.addPdfFiles);
  const contextStatus = useMeetHint((s) => s.contextStatus);
  const ingestProgress = useMeetHint((s) => s.ingestProgress);
  const loadingFolder = useMeetHint((s) => s.loadingFolder);
  const folderError = useMeetHint((s) => s.folderError);
  const contextError = useMeetHint((s) => s.contextError);
  const sources = useMeetHint((s) => s.sources);
  const chunks = useMeetHint((s) => s.chunks);
  const activeContextId = useMeetHint((s) => s.activeContextId);

  // "booting" is the store's initial state and only the cockpit runs boot(),
  // so a fresh account would sit on it forever. Only real work blocks uploads.
  const working = adding || loadingFolder || contextStatus === "hydrating";
  const busy = creating || working || folderPicker.reading;
  const symbolCount = useMemo(() => chunks.filter((chunk) => "symbol" in chunk && chunk.symbol).length, [chunks]);
  const sourceCount = sources.length;
  const workingId = contextId ?? activeContextId;
  // "Ready" only when the last selection added something usable to the space
  // this flow created. A stored source count is not enough: an unreadable PDF
  // is stored as a source with nothing to search. Judged from the flow's own
  // work, so the screen cannot sit on "Indexing…" once that work is over.
  const view = indexingView({ adding, outcome, onTarget: activeContextId === workingId });
  const indexingDone = step === "indexing" && view === "ready";
  const indexingFailed = step === "indexing" && view === "failed";
  const failureNote =
    (outcome?.tone === "error" ? (outcome.reason ?? outcome.text) : null) ??
    (activeContextId !== workingId ? OFF_TARGET : null) ??
    folderError ??
    contextError ??
    "Nothing in that selection could be read. Try different files or another folder.";
  const hasUsableMaterial = useMemo(() => marksFromSources(sources).some((mark) => !mark.problem), [sources]);
  // Problems to show beneath the stats when part of the selection was usable.
  const readyNote = outcome?.tone === "warn" ? (outcome.reason ?? null) : null;
  // The side tip follows the step, so it never repeats advice that no longer applies.
  const tip =
    step === "identity"
      ? "Be specific with the name and description. It helps you find the right space later."
      : step === "material"
        ? "Add the material you would want open during a call. You can add more later."
        : indexingFailed
          ? "Text, Markdown, Office files, code, and PDFs can be added. Images and archives cannot."
          : indexingDone
            ? "Choose Done to start a live session, or add more material first."
            : "Indexing runs on this device. Keep this page open until it finishes.";
  const progress = indexingDone
    ? 100
    : ingestProgress && ingestProgress.total > 0
      ? Math.min(99, Math.round((ingestProgress.current / ingestProgress.total) * 100))
      : working
        ? 55
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

  // Source rows this flow stored, so a failed attempt can take back its own
  // unusable rows without touching anything else.
  const flowRows = useRef(new Set<string>());

  /** The target space's rows straight from storage; the store may show another space. */
  async function storedMarks(target: string): Promise<SourceMark[]> {
    try {
      return marksFromSources(await getContextRepository().listSources(target));
    } catch {
      return [];
    }
  }

  /**
   * Runs one step and judges it by what changed in the stored sources, read
   * straight after the step so the next one cannot overwrite its error.
   */
  async function runStep(
    kind: "files" | "pdfs",
    target: string,
    action: () => Promise<unknown>,
  ): Promise<{ outcome: AddOutcome; after: SourceMark[] }> {
    const beforeState = useMeetHint.getState();
    const before = await storedMarks(target);
    let threw = false;
    try {
      await action();
    } catch {
      threw = true;
    }
    const after = await storedMarks(target);
    const afterState = useMeetHint.getState();
    const known = new Set(before.map((mark) => mark.key));
    for (const mark of after) if (!known.has(mark.key)) flowRows.current.add(mark.key);
    const outcome = describeAddStep({
      kind,
      before,
      after,
      folderError: afterState.folderError,
      contextError: afterState.contextError !== beforeState.contextError ? afterState.contextError : null,
      threw,
      unusableHint: "Choose a different file.",
    });
    return { outcome, after };
  }

  /**
   * After a failed attempt, remove the rows this flow stored that cannot be
   * used (an unreadable PDF), so the space really is as it was before.
   */
  async function dropUnusableFlowRows(target: string) {
    const marks = await storedMarks(target);
    const ids = marks.filter((mark) => mark.problem && flowRows.current.has(mark.key)).map((mark) => mark.key);
    if (ids.length === 0) return;
    try {
      await useMeetHint.getState().removeSources(target, ids);
      for (const id of ids) flowRows.current.delete(id);
    } catch {
      // Left in place; the space's source list still shows them as failed.
    }
  }

  /** Indexes one selection: its files first, then any PDFs that came with it. */
  async function addMaterial(files: File[], pdfs: File[], options?: FolderLoadOptions) {
    if (!workingId || adding || (files.length === 0 && pdfs.length === 0)) return;
    const target = workingId;
    setStep("indexing");
    setAdding(true);
    setFilesNote(null);
    setOutcome(null);
    const outcomes: AddOutcome[] = [];
    try {
      let filesStep: AddOutcome | null = null;
      let pdfStep: AddOutcome | null = null;
      if (files.length > 0) {
        filesStep = (await runStep("files", target, () => attachFolderToContext(target, files, options))).outcome;
        outcomes.push(filesStep);
      }
      if (pdfs.length > 0) {
        // addPdfFiles adds to whichever space is active. Stop if that is no
        // longer the one this flow created.
        pdfStep =
          useMeetHint.getState().activeContextId !== target
            ? { tone: "error", text: OFF_TARGET, reason: OFF_TARGET }
            : (await runStep("pdfs", target, () => addPdfFiles(pdfs))).outcome;
        outcomes.push(pdfStep);
      }
      const combined = combineAddOutcomes(outcomes);
      // Nothing usable came of this attempt: take back its unusable rows. On a
      // partial success they stay, named in the note and the source list.
      if (combined?.tone === "error") await dropUnusableFlowRows(target);
      if (useMeetHint.getState().activeContextId !== target) {
        setOutcome({ tone: "error", text: OFF_TARGET, reason: OFF_TARGET });
      } else if (combined && combined.tone !== "error" && filesStep?.tone === "error" && pdfStep) {
        // The files were left out but the PDFs went in: the files' reason gets
        // its own line, and the note under the stats keeps only the PDF part.
        setFilesNote(filesStep.reason ?? filesStep.text);
        setOutcome({ ...combined, reason: pdfStep.tone === "ok" ? undefined : pdfStep.reason });
      } else {
        setOutcome(combined);
      }
    } catch {
      setOutcome({
        tone: "error",
        text: "Could not add that material. Try again, or pick different files.",
        reason: "Could not add that material. Try again, or pick different files.",
      });
    } finally {
      setAdding(false);
    }
  }

  function chooseAgain() {
    setFilesNote(null);
    setOutcome(null);
    setStep("material");
  }

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
                <MaterialUploadPanel
                  disabled={busy}
                  folderReading={folderPicker.reading}
                  onFolderClick={() => void folderPicker.offerFolder()}
                  onFiles={(files) => addMaterial(files, [])}
                  onPdfs={(files) => addMaterial([], files)}
                  onAdd={(files, pdfs) => addMaterial(files, pdfs)}
                  onFolderDrop={(files, detail) => folderPicker.acceptList(files, detail)}
                />
              </section>
            ) : null}

            {step === "indexing" && !indexingFailed ? (
              <section
                className="space-y-6"
                data-testid={indexingDone ? "indexing-complete" : "indexing"}
              >
                <PageHeader
                  overline={name.trim() || "Context"}
                  title={indexingDone ? "Ready" : "Indexing…"}
                  description={
                    indexingDone
                      ? "Your material is indexed. Start Live to answer during your next call."
                      : "MeetHint is reading and indexing your material on this device."
                  }
                />
                <div className="mh-progress" aria-hidden="true">
                  <span style={{ width: `${progress}%` }} />
                </div>
                <div className="ds-metric-grid" data-testid="index-stats">
                  <MetricCard label="Sources" value={sourceCount} />
                  <MetricCard label="Evidence spans" value={chunks.length} />
                  {/* Symbol chunks are off by default; a permanent 0 reads as a fault. */}
                  {symbolCount > 0 ? <MetricCard label="Code symbols" value={symbolCount} /> : null}
                  <MetricCard label="Progress" value={`${progress}%`} />
                </div>
                {indexingDone ? <IndexSummaryNote /> : null}
                {filesNote ? (
                  <p className="text-sm text-warn" role="status" data-testid="indexing-files-note">
                    {filesNote}
                  </p>
                ) : null}
                {indexingDone && readyNote ? (
                  <p className="text-sm text-warn" role="status" data-testid="indexing-note">
                    {readyNote}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="mh-cta"
                    data-testid="indexing-done"
                    disabled={!indexingDone || !workingId || busy}
                    onClick={() => {
                      if (!workingId) return;
                      void navigate({ to: "/context/$id/live", params: { id: workingId } });
                    }}
                  >
                    Done
                  </button>
                  {indexingDone ? (
                    <button
                      type="button"
                      className="min-h-12 px-3 text-sm text-muted hover:text-fg"
                      data-testid="indexing-add-more"
                      onClick={chooseAgain}
                    >
                      Add more material
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}

            {indexingFailed ? (
              <section className="space-y-6" data-testid="indexing-failed">
                <PageHeader
                  overline={name.trim() || "Context"}
                  title="Nothing was indexed"
                  description={
                    hasUsableMaterial
                      ? "MeetHint could not use that selection. The material already in this space is unchanged."
                      : "MeetHint could not use that selection, so this Knowledge Space is still empty."
                  }
                />
                <p className="text-sm leading-relaxed text-warn" role="alert" data-testid="indexing-failed-reason">
                  {failureNote}
                </p>
                {filesNote && filesNote !== failureNote ? (
                  <p className="text-sm leading-relaxed text-warn" data-testid="indexing-files-note">
                    {filesNote}
                  </p>
                ) : null}
                <button type="button" className="mh-cta" data-testid="indexing-retry" onClick={chooseAgain}>
                  Choose different material
                </button>
              </section>
            ) : null}

            <FolderPickerFields
              picker={folderPicker}
              onIndex={(files, options, pdfs) => {
                void addMaterial(files, pdfs, options);
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
                  <p className="ds-caption">Your data stays on device. Not used for training.</p>
                </div>
              </li>
            </ul>
            {tip ? (
              <div className="rounded-lg bg-accent-soft p-4" data-testid="create-tip">
                <p className="text-sm text-fg">
                  <Sparkles aria-hidden className="mr-1 inline size-3.5 text-accent" />
                  {tip}
                </p>
              </div>
            ) : null}
          </aside>
        </div>
      </main>
    </ContextShell>
  );
}
