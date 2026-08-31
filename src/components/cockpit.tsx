"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileCode2,
  FileText,
  FolderGit2,
  FolderOpen,
  GitCommitHorizontal,
  Mic,
  Plus,
  Minimize2,
  Play,
  Search,
  Zap,
  Square,
} from "lucide-react";
import { AnswerModeBadge, AnswerModeControl } from "@/components/answer-mode-control";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { highlightLine } from "@/lib/highlight";
import { stopHear, toggleHear } from "@/lib/listen/call-share";
import { useLiveListen } from "@/lib/listen/speech";
import { PdfPane } from "@/components/pdf-pane";
import { ThemeToggle } from "@/components/theme-toggle";
import { isPdfSource } from "@/lib/context/types";
import { pdfSourceStatus } from "@/lib/document/pdf/source-status";
import { citationText, citedPath, isDocumentCitation, isFileCitation } from "@/lib/search/cite";
import type { Citation } from "@/lib/repo/types";
import { questionChips } from "@/lib/search/local-card";
import { cleanCaption } from "@/lib/search/question";
import { useGround } from "@/lib/store";

type MobilePane = "repo" | "room" | "card";

export function Cockpit({ contextId }: { contextId?: string } = {}) {
  const armed = useGround((s) => s.armed);
  const playing = useGround((s) => s.playing);
  const overlay = useGround((s) => s.overlay);
  const sharingCall = useGround((s) => s.sharingCall);
  const disarm = useGround((s) => s.disarm);
  const refining = useGround((s) => s.refining);
  const card = useGround((s) => s.card);
  const utterances = useGround((s) => s.utterances);
  const liveDraft = useGround((s) => s.liveDraft);
  const listenError = useGround((s) => s.listenError);
  const folderError = useGround((s) => s.folderError);
  const pack = useGround((s) => s.pack);
  const playMeeting = useGround((s) => s.playMeeting);
  const stopMeeting = useGround((s) => s.stopMeeting);
  const search = useGround((s) => s.search);
  const setOverlay = useGround((s) => s.setOverlay);
  const autoAnswer = useGround((s) => s.autoAnswer);
  const setAutoAnswer = useGround((s) => s.setAutoAnswer);
  const loadFolder = useGround((s) => s.loadFolder);
  const addPdfFiles = useGround((s) => s.addPdfFiles);
  const contextStatus = useGround((s) => s.contextStatus);
  const contextError = useGround((s) => s.contextError);
  const contextUpdating = useGround((s) => s.contextUpdating);
  const ingestProgress = useGround((s) => s.ingestProgress);
  const setOpenFile = useGround((s) => s.setOpenFile);
  const openDocumentCitation = useGround((s) => s.openDocumentCitation);
  const folderRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const lastQuery = useRef<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("room");
  const live = (armed && !playing && !listenError) || sharingCall;
  const cueSearch = armed && (Boolean(liveDraft) || utterances.some((u) => u.role === "them")) && !card?.say;
  const demo = pack.id === "northstar-payments";
  const listenLabel = live ? "Stop listen" : "Listen";
  const statusLabel = live ? "Listening" : "Idle";
  const searchReady = contextStatus === "ready";
  const ingestNote =
    ingestProgress && ingestProgress.phase !== "ready"
      ? ingestProgress.total > 1
        ? `Adding ${ingestProgress.current} of ${ingestProgress.total}…`
        : ingestProgress.phase === "indexing"
          ? "Indexing…"
          : "Reading PDF…"
      : contextUpdating
        ? "Updating…"
        : null;
  const statusNote =
    contextError ??
    ingestNote ??
    (folderError && !listenError ? folderError : "The pack is the brief");

  useLiveListen();

  useEffect(() => {
    useGround.getState().setListenError(null);
    void import("@/lib/listen/local-asr").then((m) => m.warmupAsr());
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("overlay") === "1") setOverlay(true);
    void useGround.getState().boot(contextId).then(() => {
      if (params.get("viewerqa") === "1") {
        void import("@/lib/document/viewer/qa-boot").then((mod) => mod.bootCockpitViewerQa());
      }
    });
  }, [contextId, setOverlay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        void search();
        return;
      }
      if (e.key === "Escape" && overlay) {
        e.preventDefault();
        setOverlay(false);
        return;
      }
      if (typing) return;
      if (e.key === "s" || e.key === "S" || e.key === "/") {
        e.preventDefault();
        void search();
      }
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        toggleHear();
      }
      if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        setOverlay(!overlay);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search, overlay, setOverlay]);

  useEffect(() => {
    if (!card?.query || card.query === lastQuery.current) return;
    lastQuery.current = card.query;
    setMobilePane("card");
  }, [card?.query]);

  useEffect(() => {
    if (playing) setMobilePane("room");
  }, [playing]);

  useEffect(() => {
    if (overlay && mobilePane === "repo") setMobilePane("room");
  }, [overlay, mobilePane]);

  function openCited(cite: Citation) {
    if (isFileCitation(cite)) {
      setOpenFile(cite.path);
      setMobilePane("repo");
      if (overlay) setOverlay(false);
      return;
    }
    if (isDocumentCitation(cite)) {
      // Overlay hides RepoPane. Do not open a PDF the user cannot see.
      if (overlay) return;
      openDocumentCitation(cite);
      setMobilePane("repo");
    }
  }

  return (
    <div
      className="cockpit-shell text-fg"
      data-testid="cockpit"
      data-context-status={contextStatus}
      data-context-updating={contextUpdating ? "true" : undefined}
    >
      <header className="shrink-0 border-b border-line px-4 py-3 md:px-8">
        <div className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-2 md:flex-row md:items-center">
          <div className="flex min-w-0 items-center gap-3 md:shrink-0">
            <GroundMark />
            <span className="brand-word text-fg">MeetHint</span>
            <StatusDot on={live} down={false} label={statusLabel} live={live} />
            <span
              className="hidden min-w-0 truncate font-serif text-base italic text-body lg:inline"
              data-ingest-progress={ingestNote ?? undefined}
            >
              {statusNote}
            </span>
            <Button
              size="sm"
              disabled={!searchReady}
              onClick={() => void search()}
              className={cn("ml-auto md:hidden", cueSearch && "ring-1 ring-accent/50")}
            >
              <Search className="size-4" />
              Search
            </Button>
          </div>
          <div className="cockpit-actions md:ml-auto">
            <Button
              variant={live ? "primary" : "ghost"}
              size="sm"
              aria-label={listenLabel}
              title="Hear you and the computer. The Card is what you say."
              disabled={!searchReady}
              onClick={() => {
                if (live) {
                  stopHear();
                  disarm();
                  return;
                }
                toggleHear();
              }}
            >
              <Mic className={cn("size-4", live && "live-dot")} />
              <span className="hidden md:inline">{listenLabel}</span>
            </Button>
            <Button
              variant={autoAnswer ? "primary" : "ghost"}
              size="sm"
              aria-label={autoAnswer ? "Auto answer on" : "Auto answer off"}
              title="When they ask about this repo, the Card fills"
              disabled={!searchReady}
              onClick={() => setAutoAnswer(!autoAnswer)}
            >
              <Zap className="size-4" />
              <span className="hidden md:inline">{autoAnswer ? "Auto answer" : "Manual"}</span>
            </Button>
            <AnswerModeControl />
            <ContextSwitcher folderRef={folderRef} />
            <AddMaterial folderRef={folderRef} pdfRef={pdfRef} />
            <input
              ref={folderRef}
              type="file"
              multiple
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              data-folder-input="true"
              suppressHydrationWarning
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) void loadFolder(files);
                e.target.value = "";
              }}
              {...{ webkitdirectory: "", directory: "" }}
            />
            <input
              ref={pdfRef}
              type="file"
              multiple
              accept=".pdf,application/pdf"
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              data-pdf-input="true"
              suppressHydrationWarning
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) void addPdfFiles(files);
                e.target.value = "";
              }}
            />
            <a
              href="/app?overlay=1"
              target="_blank"
              rel="noreferrer"
              aria-label="Live window"
              title="Live window"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-sm border border-line px-3 text-xs font-medium text-secondary hover:border-accent hover:text-fg"
            >
              <ExternalLink className="size-4" />
              <span className="hidden md:inline">Live window</span>
            </a>
            <Button
              variant="ghost"
              size="sm"
              aria-label={overlay ? "Cockpit" : "Overlay"}
              title={overlay ? "Cockpit" : "Overlay"}
              onClick={() => setOverlay(!overlay)}
            >
              <Minimize2 className="size-4" />
              <span className="hidden md:inline">{overlay ? "Cockpit" : "Overlay"}</span>
            </Button>
            <ThemeToggle />
            {demo ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={playing ? "Stop" : "Play review"}
                title={playing ? "Stop" : "Play review"}
                onClick={playing ? stopMeeting : playMeeting}
              >
                {playing ? <Square className="size-4" /> : <Play className="size-4" />}
                <span className="hidden md:inline">{playing ? "Stop" : "Play review"}</span>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <nav
        className={cn(
          "grid w-full shrink-0 grid-cols-3 gap-1 border-b border-line bg-bg px-3 py-1.5 md:hidden",
          overlay && "grid-cols-2",
        )}
        aria-label="Cockpit panes"
      >
        {overlay ? null : (
          <PaneTab active={mobilePane === "repo"} onClick={() => setMobilePane("repo")} label="Repo" />
        )}
        <PaneTab active={mobilePane === "room"} onClick={() => setMobilePane("room")} label="Room" />
        <PaneTab active={mobilePane === "card"} onClick={() => setMobilePane("card")} label="Card" mark={Boolean(card?.say)} />
      </nav>

      <main className="cockpit-grid" data-mode={overlay ? "overlay" : "cockpit"}>
        {overlay ? null : (
          <div
            className={cn("cockpit-pane", mobilePane !== "repo" && "max-md:hidden")}
            data-pane="repo"
            data-active={mobilePane === "repo" ? "true" : undefined}
          >
            <RepoPane />
          </div>
        )}
        <div
          className={cn("cockpit-pane", mobilePane !== "room" && "max-md:hidden")}
          data-pane="room"
          data-active={mobilePane === "room" ? "true" : undefined}
        >
          <TranscriptPane />
        </div>
        <div
          className={cn("cockpit-pane", mobilePane !== "card" && "max-md:hidden")}
          data-pane="card"
          data-active={mobilePane === "card" ? "true" : undefined}
        >
          <CardPane refining={refining} compact={overlay} onOpenCited={openCited} overlay={overlay} />
        </div>
      </main>
    </div>
  );
}

function AddMaterial({
  folderRef,
  pdfRef,
}: {
  folderRef: RefObject<HTMLInputElement | null>;
  pdfRef: RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Add material"
        aria-haspopup="menu"
        aria-expanded={open}
        data-add-material="true"
        onClick={() => setOpen((value) => !value)}
      >
        <Plus className="size-4" />
        <span className="hidden md:inline">Add material</span>
        <ChevronDown className="size-3.5 shrink-0 text-faint" />
      </Button>
      {open ? (
        <div className="context-menu" role="menu" aria-label="Add material">
          <button
            type="button"
            role="menuitem"
            className="context-option"
            onClick={() => {
              setOpen(false);
              folderRef.current?.click();
            }}
          >
            <FolderOpen className="size-3.5 shrink-0" />
            Open folder
          </button>
          <button
            type="button"
            role="menuitem"
            className="context-option"
            data-add-pdf="true"
            onClick={() => {
              setOpen(false);
              pdfRef.current?.click();
            }}
          >
            <FileText className="size-3.5 shrink-0" />
            Add PDF files
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ContextSwitcher({ folderRef }: { folderRef: RefObject<HTMLInputElement | null> }) {
  const pack = useGround((s) => s.pack);
  const contexts = useGround((s) => s.contexts);
  const activeContextId = useGround((s) => s.activeContextId);
  const contextStatus = useGround((s) => s.contextStatus);
  const loadingFolder = useGround((s) => s.loadingFolder);
  const activateContext = useGround((s) => s.activateContext);
  const resetPack = useGround((s) => s.resetPack);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hydrating = contextStatus === "booting" || contextStatus === "hydrating" || loadingFolder;
  const label = hydrating ? "Loading…" : pack.name;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label}
        disabled={hydrating}
        onClick={() => setOpen((value) => !value)}
      >
        <FolderOpen className="size-4" />
        <span className="hidden max-w-40 truncate md:inline">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-faint" />
      </Button>
      {open ? (
        <div className="context-menu" role="listbox" aria-label="Contexts">
          <button
            type="button"
            role="option"
            aria-selected={pack.id === "northstar-payments"}
            className="context-option"
            data-active={pack.id === "northstar-payments" ? "true" : undefined}
            onClick={() => {
              resetPack();
              setOpen(false);
            }}
          >
            northstar-payments
          </button>
          {contexts.map((context) => (
            <button
              key={context.id}
              type="button"
              role="option"
              aria-selected={context.id === activeContextId}
              className="context-option"
              data-active={context.id === activeContextId ? "true" : undefined}
              onClick={() => {
                void activateContext(context.id);
                setOpen(false);
              }}
            >
              {context.name}
            </button>
          ))}
          <div className="context-menu-rule" />
          <a href="/home" className="context-option" onClick={() => setOpen(false)}>
            Your contexts
          </a>
          <a href="/create" className="context-option" onClick={() => setOpen(false)}>
            <Plus className="size-3.5 shrink-0" />
            Create context
          </a>
          <button
            type="button"
            className="context-option"
            onClick={() => {
              setOpen(false);
              folderRef.current?.click();
            }}
          >
            <Plus className="size-3.5 shrink-0" />
            Open new folder
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PaneTab({
  active,
  onClick,
  label,
  mark,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  mark?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-11 items-center justify-center rounded-sm text-sm font-medium",
        active ? "bg-subtle text-fg" : "text-muted hover:bg-subtle hover:text-fg",
      )}
    >
      {label}
      {mark ? <span className="ml-1 size-1.5 rounded-full bg-ok" aria-hidden="true" /> : null}
    </button>
  );
}

function GroundMark() {
  return (
    <span className="ground-mark shrink-0" aria-hidden="true">
      <span className="ground-mark-dot" />
    </span>
  );
}

function StatusDot({
  on,
  down,
  label,
  live,
}: {
  on: boolean;
  down?: boolean;
  label: string;
  live: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted tabular-nums">
      <span
        className={cn(
          "size-1.5 rounded-full",
          down ? "bg-bad" : on ? "bg-accent" : "bg-gutter",
          (live || down) && "live-dot",
        )}
      />
      {label}
    </span>
  );
}

function ProofLine({ local }: { local?: string }) {
  if (local) {
    return (
      <p className="font-serif text-base italic text-body">
        Proof from files in {local}. <span className="text-accent">Never a guess.</span>
      </p>
    );
  }
  return (
    <p className="font-serif text-base italic text-body">
      Proof or silence. <span className="text-accent">Never a guess.</span>
    </p>
  );
}

function RepoPane() {
  const pack = useGround((s) => s.pack);
  const sources = useGround((s) => s.sources);
  const openFile = useGround((s) => s.openFile);
  const setOpenFile = useGround((s) => s.setOpenFile);
  const openDocument = useGround((s) => s.openDocument);
  const openPdfSource = useGround((s) => s.openPdfSource);
  const card = useGround((s) => s.card);
  const [filter, setFilter] = useState("");
  const pdfs = sources.filter(isPdfSource);
  const file = pack.files.find((f) => f.path === openFile) ?? (openDocument ? undefined : pack.files[0]);
  // Only a file citation has a line to highlight in this pane. A commit
  // citation is about history and deliberately has no position in the file.
  const cite = card?.citations.find((c) => isFileCitation(c) && c.path === file?.path);
  const citeLine = cite && isFileCitation(cite) ? cite.line : undefined;
  const preRef = useRef<HTMLPreElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const why = pack.commits.find(
    (c) =>
      card?.citations.some(
        (item) =>
          (item.kind === "commit" && (item.sha === c.sha || item.pr === c.pr)) ||
          (item.kind === "file" && (item.sha === c.sha || item.pr === c.pr)),
      ) ?? false,
  );
  const codeCount = pack.files.filter((f) => /\.(ts|tsx|js|jsx|go|py|java|rs|kt)$/i.test(f.path)).length;
  const weak = pack.id !== "northstar-payments" && pack.files.length > 0 && codeCount < 3;
  const visible = pack.files.filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase()));
  const visiblePdfs = pdfs.filter((source) => !filter || source.path.toLowerCase().includes(filter.toLowerCase()));
  const sourceCount = pack.files.length + pdfs.length;
  const lines = useMemo(
    () => (file ? file.content.replace(/\n$/, "").split("\n") : []),
    [file],
  );
  const painted = useMemo(() => {
    if (lines.length <= 480) return lines.map((line) => highlightLine(line));
    return lines.map((line, i) => {
      if (citeLine && Math.abs(i + 1 - citeLine) < 24) return highlightLine(line);
      return line;
    });
  }, [lines, citeLine]);

  useEffect(() => {
    if (citeLine == null) return;
    const node = preRef.current?.querySelector(`[data-line="${citeLine}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [citeLine, file?.path]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [file?.path]);

  if (!file && !openDocument && pdfs.length === 0) {
    return (
      <section className="ground-panel p-5">
        <p className="font-serif text-lg italic text-body">Open a local folder to cite your repo.</p>
      </section>
    );
  }

  return (
    <section className="ground-panel">
      <div className="ground-head">
        <span className="ground-head-left">
          <FolderGit2 className="size-3.5 shrink-0 text-faint" />
          <span className="truncate">{pack.name}</span>
        </span>
        <span className="ground-hint tabular-nums">{sourceCount} files</span>
      </div>
      {weak ? (
        <p className="px-3 pb-2 text-xs text-warn">Mostly CI/config. Open the src folder, then Search.</p>
      ) : null}
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(16rem,0.55fr)_minmax(0,1fr)] gap-2 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files"
            className="ground-input mx-2 mb-1 h-9 shrink-0 rounded-sm px-2.5 text-xs placeholder:text-faint"
          />
          <ul
            ref={listRef}
            className="file-list min-h-0 min-w-0 flex-1 space-y-0.5 overflow-auto px-1 pt-1.5 pb-2"
          >
            {visible.length === 0 && visiblePdfs.length === 0 ? (
              <li className="px-2 py-3 text-xs text-muted">No files match that filter.</li>
            ) : null}
            {visible.map((f) => (
              <li key={f.path} className="min-w-0">
                <button
                  type="button"
                  data-source-kind="file"
                  data-source-path={f.path}
                  data-active={!openDocument && file && f.path === file.path ? "true" : undefined}
                  onClick={() => setOpenFile(f.path)}
                  className="file-row flex h-9 w-full min-w-0 items-center gap-2 px-2 text-left text-xs text-muted hover:text-fg"
                >
                  <FileCode2 className="size-3.5 shrink-0" />
                  <span className="truncate font-mono">{f.path}</span>
                </button>
              </li>
            ))}
            {visiblePdfs.map((source) => {
              const status = pdfSourceStatus(source);
              const active = openDocument?.sourceId === source.id;
              return (
                <li key={source.id} className="min-w-0">
                  <button
                    type="button"
                    data-source-kind="pdf"
                    data-source-path={source.path}
                    data-source-status={source.readiness}
                    data-active={active ? "true" : undefined}
                    title={status.detail}
                    onClick={() => openPdfSource(source.id)}
                    className="file-row flex min-h-9 w-full min-w-0 items-center gap-2 px-2 py-1 text-left text-xs text-muted hover:text-fg"
                  >
                    <FileText className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono">{source.path}</span>
                      {status.short !== "Ready" || source.lastFailedNote ? (
                        <span className="block truncate text-[11px] text-faint" data-source-label>
                          {source.lastFailedNote && source.readiness === "ready" ? "Update failed" : status.short}
                        </span>
                      ) : (
                        <span className="block truncate text-[11px] text-faint" data-source-label>
                          Ready
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="ground-code mx-2 mb-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="file-viewer">
          {openDocument ? (
            <PdfPane />
          ) : file ? (
            <>
              <div className="ground-code-name shrink-0 truncate text-xs">{file.path}</div>
              <pre ref={preRef} className="min-h-0 min-w-0 flex-1 overflow-auto px-3 py-2 text-xs leading-6 text-fg">
                {painted.map((node, i) => {
                  const n = i + 1;
                  const active = citeLine === n;
                  return (
                    <div
                      key={n}
                      data-line={n}
                      className={cn("flex gap-3 md:min-w-max", active && "bg-pick")}
                    >
                      <span className="w-8 shrink-0 select-none text-right text-muted tabular-nums">{n}</span>
                      <span className="min-w-0 whitespace-pre-wrap break-all md:whitespace-pre md:break-normal">
                        {node}
                      </span>
                    </div>
                  );
                })}
              </pre>
              {why ? (
                <p className="shrink-0 border-t border-line px-3 py-2 font-mono text-xs text-muted">
                  <span className="text-accent">{why.sha}</span>
                  <span className="mx-2 text-fg">{why.message}</span>
                  <span className="text-faint">#{why.pr}</span>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TranscriptPane() {
  const utterances = useGround((s) => s.utterances);
  const typedQuery = useGround((s) => s.typedQuery);
  const setTypedQuery = useGround((s) => s.setTypedQuery);
  const search = useGround((s) => s.search);
  const searchReady = useGround((s) => s.contextStatus === "ready");
  const playing = useGround((s) => s.playing);
  const armed = useGround((s) => s.armed);
  const liveDraft = useGround((s) => s.liveDraft);
  const draftRole = useGround((s) => s.draftRole);
  const listenError = useGround((s) => s.listenError);
  const sharingCall = useGround((s) => s.sharingCall);
  const pack = useGround((s) => s.pack);
  const hearLevel = useGround((s) => s.hearLevel);
  const asrStatus = useGround((s) => s.asrStatus);
  const asrNote = useGround((s) => s.asrNote);
  const queryRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const themLines = utterances.filter((u) => u.role === "them");
  const transcript = themLines.map((u) => cleanCaption(u.text)).filter(Boolean).join(" ");
  const draft = liveDraft === "…" ? "…" : cleanCaption(liveDraft);
  const themDraft = draftRole === "them" ? draft : "";
  const youDraft = draftRole === "you" ? draft : "";
  const youLast = cleanCaption(utterances.filter((u) => u.role === "you").at(-1)?.text ?? "");
  const live = (armed && !playing && !listenError) || sharingCall;
  const demo = pack.id === "northstar-payments";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [utterances.length, liveDraft]);

  async function pasteQuery() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setTypedQuery(text.trim());
        queryRef.current?.focus();
        return;
      }
    } catch {
      /* fall through */
    }
    queryRef.current?.focus();
  }

  return (
    <section className="ground-panel" data-fit="content">
      <div className="ground-head">
        <span className="ground-head-left">
          <ChevronDown className="size-3.5 shrink-0 text-faint" />
          <span>Room</span>
        </span>
        <span className="ground-hint">
          {playing ? "Playing design review" : live ? "Transcript" : "Idle"}
        </span>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-auto p-4">
        <div className="flex min-h-0 min-w-0 flex-col rounded-md border border-line bg-input px-3 py-3">
          <p className="ground-hint">They said</p>
          <div className="mt-2 max-h-[min(16rem,36vh)] min-h-0 overflow-auto">
            {transcript || themDraft ? (
              <p className="ground-transcript">
                {transcript}
                {themDraft ? (
                  <span className={cn("text-muted", live && "live-caret")}>
                    {transcript ? " " : ""}
                    {themDraft}
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="font-serif text-lg italic leading-snug text-body">
                {asrNote
                  ? asrNote
                  : asrStatus === "loading"
                    ? "Loading captions…"
                    : live
                      ? "Hearing you. The next line lands here."
                      : "Press Listen, then share the call tab with audio. The transcript lands here."}
              </p>
            )}
            {youLast || youDraft ? (
              <p className="mt-3 border-t border-line pt-2 text-xs text-faint">
                <span className="text-muted">You · </span>
                {youDraft || youLast}
              </p>
            ) : null}
            {utterances
              .filter((u) => u.role === "system")
              .slice(-2)
              .map((u) => (
                <p key={u.id} className="mt-3 text-xs text-faint">
                  {u.text}
                </p>
              ))}
            <div ref={endRef} />
          </div>
          {live ? (
            <div className="hear-meter mt-3" aria-hidden="true">
              <div className="hear-meter-fill" style={{ width: `${Math.round(hearLevel * 100)}%` }} />
            </div>
          ) : null}
        </div>
        <form
          className="flex min-w-0 flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <p className="ground-hint">Question</p>
          <textarea
            ref={queryRef}
            data-testid="search-input"
            value={typedQuery}
            onChange={(e) => setTypedQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void search();
              }
            }}
            rows={2}
            placeholder={demo ? "why does that retry three times?" : "Type what they asked if words do not appear"}
            className="ground-input ground-question"
          />
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button type="submit" size="sm" className="min-w-28 flex-1" disabled={!searchReady}>
              <Search className="size-3.5" />
              Search
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void pasteQuery()}>
              <ClipboardPaste className="size-3.5" />
              Paste
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function CardPane({
  refining,
  compact,
  onOpenCited,
  overlay,
}: {
  refining: boolean;
  compact: boolean;
  onOpenCited: (cite: Citation) => void;
  overlay: boolean;
}) {
  const card = useGround((s) => s.card);
  const lastAnswerMode = useGround((s) => s.lastAnswerMode);
  const pack = useGround((s) => s.pack);
  const search = useGround((s) => s.search);
  const searchReady = useGround((s) => s.contextStatus === "ready");
  const heardQuestion = useGround((s) => s.heardQuestion);
  const theySaid = card?.query || heardQuestion;
  const chips = useMemo(() => questionChips(pack), [pack]);
  const [copied, setCopied] = useState(false);
  // The inline excerpt can only be shown for evidence that is in a file.
  const citedFile = card?.citations.find(isFileCitation);
  const cited = pack.files.find((f) => f.path === citedFile?.path);
  const speaking = Boolean(card?.say);
  const shownMode = card?.answerMode ?? lastAnswerMode;
  const assisted = shownMode === "assisted" && speaking;
  const cardKey = `${card?.query ?? ""}|${card?.say ?? ""}|${card?.reason ?? ""}|${card?.latencyMs ?? 0}`;

  function copySay() {
    if (!card?.say) return;
    void navigator.clipboard.writeText(card.say);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const citations =
    card && !assisted && card.citations.length > 0 ? (
      <ul className="space-y-2">
        {card.citations.map((c) => {
          const opensFile = Boolean(citedPath(c));
          const opensPdf = isDocumentCitation(c) && !overlay;
          const opens = opensFile || opensPdf;
          return (
            <li key={c.evidenceId ?? citationText(c)} className="min-w-0" data-testid="card-citation">
              <button
                type="button"
                onClick={opens ? () => onOpenCited(c) : undefined}
                disabled={!opens}
                className="flex min-h-11 w-full min-w-0 items-start gap-2 rounded-md border border-line bg-input px-3 py-2 text-left text-xs enabled:hover:border-accent disabled:cursor-default"
              >
                {isDocumentCitation(c) ? (
                  <FileText className="mt-0.5 size-3.5 shrink-0 text-muted" />
                ) : (
                  <GitCommitHorizontal className="mt-0.5 size-3.5 shrink-0 text-muted" />
                )}
                <span className="min-w-0">
                  <span className="block break-all font-mono text-fg">{citationText(c)}</span>
                  {c.label ? (
                    <span className="mt-0.5 block break-words text-muted">{c.label}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <section
      className={cn("ground-panel", speaking && `card-mode-${shownMode}`)}
      data-fit="content"
      data-testid="card"
      data-answer-mode={speaking ? shownMode : undefined}
    >
      <div className="ground-head">
        <span className="ground-head-left">
          <Search className="size-3.5 shrink-0 text-faint" />
          <span>Card</span>
          {speaking ? <AnswerModeBadge mode={shownMode} /> : null}
        </span>
        <span className="ground-hint tabular-nums">
          {card ? `${card.latencyMs}ms${refining ? " · polishing" : ""}` : "Say this"}
        </span>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col gap-5 overflow-auto p-5">
        <div key={cardKey} className="flex min-w-0 flex-col gap-5">
          {theySaid ? (
            <div className="min-w-0 rounded-md border border-line bg-input px-3 py-3">
              <p className="ground-hint">Heard</p>
              <p className="mt-2 font-serif text-base leading-snug text-body">{theySaid}</p>
            </div>
          ) : null}
          {speaking ? (
            <div className="space-y-5">
              <p className="ground-hint">You say · Say this</p>
              <p
                data-testid="card-say"
                className={cn(
                  "font-serif leading-snug text-fg",
                  compact ? "text-2xl md:text-3xl" : "text-xl md:text-2xl",
                )}
              >
                {card?.say}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" className="border-accent text-fg" onClick={copySay}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              {assisted ? (
                <p className="text-xs text-muted">General knowledge. Verify before using.</p>
              ) : null}
              {citations}
              {compact && cited && citedFile && !assisted ? (
                <pre className="ground-code max-h-40 overflow-auto whitespace-pre px-3 py-2 font-mono text-xs leading-5 text-muted">
                  {cited.content
                    .split("\n")
                    .slice(Math.max(0, citedFile.line - 3), citedFile.line + 5)
                    .join("\n")}
                </pre>
              ) : null}
            </div>
          ) : (
            <div className="space-y-5">
              <p data-testid="card-reason" className="font-serif text-lg italic text-body">
                {card?.reason ??
                  "Room is the transcript. A question about this pack becomes You say. Small talk stays in Room."}
              </p>
              {citations}
            </div>
          )}
        </div>
        <div className="space-y-3 rounded-md border border-line bg-input px-3 py-3">
          <p className="ground-hint">Try a question</p>
          <div className="flex min-w-0 flex-wrap gap-2">
            {chips.map((q) => (
              <button
                key={q}
                type="button"
                disabled={!searchReady}
                onClick={() => void search(q)}
                className="ground-chip text-xs disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>
          <ProofLine
            local={
              pack.commits.length === 0 && pack.id !== "northstar-payments" ? pack.name : undefined
            }
          />
        </div>
      </div>
    </section>
  );
}
