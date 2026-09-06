"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Check,
  ChevronDown,
  ClipboardList,
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileCode2,
  FileText,
  FolderGit2,
  FolderOpen,
  Mic,
  MoreHorizontal,
  Plus,
  Minimize2,
  Play,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { AnswerSay } from "@/components/answer-say";
import { AnswerHistory } from "@/components/answer-history";
import { AnswerModeBadge } from "@/components/answer-mode-control";
import { ClaimMonitor } from "@/components/claim-monitor";
import { ModelPicker } from "@/components/ModelPicker";
import { UpgradeModal } from "@/components/UpgradeModal";
import { MeetHintMark } from "@/components/meethint-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { highlightLine } from "@/lib/highlight";
import { stopHear, toggleHear } from "@/lib/listen/call-share";
import { isFramed, useLiveListen } from "@/lib/listen/speech";
import { PdfPane } from "@/components/pdf-pane";
import { ThemeToggle } from "@/components/theme-toggle";
import { isPdfSource } from "@/lib/context/types";
import { pdfSourceStatus } from "@/lib/document/pdf/source-status";
import { receiptKicker } from "@/lib/search/answer-mode";
import { citationText, citedLineRange, citedPath, isDocumentCitation, isFileCitation } from "@/lib/search/cite";
import type { Citation } from "@/lib/repo/types";
import { questionChips } from "@/lib/search/local-card";
import { cleanCaption } from "@/lib/search/question";
import { useMeetHint } from "@/lib/store";

type MobilePane = "repo" | "room" | "card";

export function Cockpit({ contextId }: { contextId?: string } = {}) {
  const armed = useMeetHint((s) => s.armed);
  const playing = useMeetHint((s) => s.playing);
  const overlay = useMeetHint((s) => s.overlay);
  const sharingCall = useMeetHint((s) => s.sharingCall);
  const disarm = useMeetHint((s) => s.disarm);
  const card = useMeetHint((s) => s.card);
  const utterances = useMeetHint((s) => s.utterances);
  const liveDraft = useMeetHint((s) => s.liveDraft);
  const listenError = useMeetHint((s) => s.listenError);
  const folderError = useMeetHint((s) => s.folderError);
  const packNotice = useMeetHint((s) => s.packNotice);
  const dismissPackNotice = useMeetHint((s) => s.dismissPackNotice);
  const currentMeeting = useMeetHint((s) => s.currentMeeting);
  const pack = useMeetHint((s) => s.pack);
  const playMeeting = useMeetHint((s) => s.playMeeting);
  const stopMeeting = useMeetHint((s) => s.stopMeeting);
  const search = useMeetHint((s) => s.search);
  const setOverlay = useMeetHint((s) => s.setOverlay);
  const autoAnswer = useMeetHint((s) => s.autoAnswer);
  const setAutoAnswer = useMeetHint((s) => s.setAutoAnswer);
  const loadFolder = useMeetHint((s) => s.loadFolder);
  const attachFolderToContext = useMeetHint((s) => s.attachFolderToContext);
  const activeContextId = useMeetHint((s) => s.activeContextId);
  const addPdfFiles = useMeetHint((s) => s.addPdfFiles);
  const contextStatus = useMeetHint((s) => s.contextStatus);
  const contextError = useMeetHint((s) => s.contextError);
  const contextUpdating = useMeetHint((s) => s.contextUpdating);
  const ingestProgress = useMeetHint((s) => s.ingestProgress);
  const setOpenFile = useMeetHint((s) => s.setOpenFile);
  const openDocumentCitation = useMeetHint((s) => s.openDocumentCitation);
  const subscription = useMeetHint((s) => s.subscription);
  const selectedModelId = useMeetHint((s) => s.selectedModelId);
  const setSelectedModelId = useMeetHint((s) => s.setSelectedModelId);
  const clearUpgrade = useMeetHint((s) => s.clearUpgrade);
  const upgradeFeature = useMeetHint((s) => s.upgradeFeature);
  const auditOpen = useMeetHint((s) => s.auditOpen);
  const openAudit = useMeetHint((s) => s.openAudit);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const lastQuery = useRef<string | null>(null);
  const [citeReveal, setCiteReveal] = useState(0);
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
  const statusNote = contextError ?? ingestNote ?? (folderError && !listenError ? folderError : null);

  useLiveListen();

  useEffect(() => {
    useMeetHint.getState().setListenError(null);
    void import("@/lib/listen/local-asr").then((m) => m.warmupAsr());
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("overlay") === "1") setOverlay(true);
    void useMeetHint.getState().boot(contextId).then(() => {
      if (params.get("viewerqa") === "1") {
        void import("@/lib/document/viewer/qa-boot").then((mod) => mod.bootCockpitViewerQa());
      }
    });
  }, [contextId, setOverlay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
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
      setCiteReveal((n) => n + 1);
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
      <header className="shrink-0 border-b border-hairline bg-bg px-5 md:px-8">
        <div className="cockpit-header">
          <div className="cockpit-brand">
            <MeetHintMark className="cockpit-mark" />
            <span className="brand-word">Hint</span>
            <StatusDot on={live} down={false} label={statusLabel} live={live} />
            {statusNote ? (
              <span
                className="cockpit-note hidden min-w-0 truncate text-[13px] text-body xl:inline"
                data-ingest-progress={ingestNote ?? undefined}
              >
                {statusNote}
              </span>
            ) : null}
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
          <div className="cockpit-cluster" role="group" aria-label="Session">
            <Button
              variant="primary"
              size="sm"
              aria-label={listenLabel}
              title="Hear you and the computer. The answer is what you say."
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
              <span className="hidden lg:inline">{listenLabel}</span>
            </Button>
            <Button
              variant="quiet"
              size="sm"
              aria-pressed={autoAnswer}
              aria-label={autoAnswer ? "Auto answer on" : "Auto answer off"}
              title="When they ask about this folder, the answer fills"
              disabled={!searchReady}
              className={autoAnswer ? "border-transparent bg-accent-soft text-fg" : undefined}
              onClick={() => setAutoAnswer(!autoAnswer)}
            >
              <span
                className={cn("size-1.5 rounded-full", autoAnswer ? "bg-accent" : "bg-gutter")}
                aria-hidden="true"
              />
              <span className="hidden lg:inline">Auto answer</span>
            </Button>
            <Button
              variant="quiet"
              size="sm"
              data-testid="audit-meeting"
              aria-pressed={auditOpen}
              aria-label="Audit this meeting"
              title="Review claims after the meeting"
              disabled={!searchReady}
              className={auditOpen ? "border-transparent bg-accent-soft text-fg" : undefined}
              onClick={() => void openAudit()}
            >
              <ClipboardList className="size-4" />
              <span className="hidden lg:inline">Audit</span>
            </Button>
          </div>
          <div className="cockpit-pack">
            <ContextSwitcher folderRef={folderRef} />
            <AddMaterial folderRef={folderRef} filesRef={filesRef} pdfRef={pdfRef} />
            <div className="cockpit-utils">
              <UtilityLinks
                overlay={overlay}
                demo={demo}
                playing={playing}
                onOverlay={() => setOverlay(!overlay)}
                onReview={playing ? stopMeeting : playMeeting}
              />
            </div>
            <UtilityMenu
              className="md:hidden"
              overlay={overlay}
              demo={demo}
              playing={playing}
              onOverlay={() => setOverlay(!overlay)}
              onReview={playing ? stopMeeting : playMeeting}
              onAudit={() => void openAudit()}
            />
          </div>
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
            ref={filesRef}
            type="file"
            multiple
            accept=".md,.mdx,.txt,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.kt,.json,.css,.yml,.yaml,.docx,.xlsx,.csv"
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            data-files-input="true"
            suppressHydrationWarning
            onChange={(e) => {
              const files = e.target.files;
              if (!files || files.length === 0) return;
              if (activeContextId) void attachFolderToContext(activeContextId, files);
              else void loadFolder(files);
              e.target.value = "";
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
            data-pdf-input="true"
            suppressHydrationWarning
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) void addPdfFiles(files);
              e.target.value = "";
            }}
          />
        </div>
      </header>
      {packNotice ? (
        <div
          role="status"
          data-testid="pack-limit-banner"
          className="flex items-start justify-between gap-3 border-b border-line bg-accent-soft px-4 py-3 text-sm text-fg md:px-8"
        >
          <p>{packNotice}</p>
          <button
            type="button"
            className="shrink-0 text-xs text-body underline-offset-4 hover:text-fg hover:underline"
            onClick={dismissPackNotice}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <nav
        className={cn(
          "grid w-full shrink-0 grid-cols-3 gap-1 border-b border-hairline bg-nav px-3 py-1.5 lg:hidden",
          overlay && "grid-cols-2",
        )}
        aria-label="Cockpit panes"
      >
        <PaneTab active={mobilePane === "room"} onClick={() => setMobilePane("room")} label="Room" />
        <PaneTab active={mobilePane === "card"} onClick={() => setMobilePane("card")} label="Answer" mark={Boolean(card?.say)} />
        {overlay ? null : (
          <PaneTab active={mobilePane === "repo"} onClick={() => setMobilePane("repo")} label="Files" />
        )}
      </nav>

      <main
        className="cockpit-workspace"
        data-mode={overlay ? "overlay" : "cockpit"}
        data-audit={auditOpen ? "on" : undefined}
        data-files={mobilePane === "repo" ? "open" : undefined}
      >
      <div
        className="cockpit-grid"
        data-mode={overlay ? "overlay" : "cockpit"}
        data-audit={auditOpen ? "on" : undefined}
        data-files={mobilePane === "repo" ? "open" : undefined}
      >
        {auditOpen && currentMeeting ? (
          <div className="cockpit-pane claim-monitor-pane max-md:hidden" data-pane="audit">
            <ClaimMonitor />
          </div>
        ) : null}
        {overlay ? null : (
          <div
            className={cn("cockpit-pane", mobilePane !== "repo" && "max-md:hidden")}
            data-pane="repo"
            data-active={mobilePane === "repo" ? "true" : undefined}
          >
            <RepoPane reveal={citeReveal} />
          </div>
        )}
        <div
          className={cn("cockpit-pane", mobilePane !== "room" && "max-md:hidden")}
          data-pane="room"
          data-active={mobilePane === "room" ? "true" : undefined}
        >
          <TranscriptPane
            active={live && !card?.query}
            extras={
              <ModelPicker
                subscription={subscription}
                value={selectedModelId}
                onChange={setSelectedModelId}
              />
            }
          />
        </div>
        <div
          className={cn("cockpit-pane cockpit-card-col", mobilePane !== "card" && "max-md:hidden")}
          data-pane="card"
          data-active={mobilePane === "card" ? "true" : undefined}
        >
          <CardPane
            compact={overlay}
            onOpenCited={openCited}
            overlay={overlay}
            active={Boolean(card?.query)}
          />
        </div>
      </div>
      </main>
      <UpgradeModal
        open={upgradeFeature !== null}
        feature={upgradeFeature}
        onClose={clearUpgrade}
      />
    </div>
  );
}

function AddMaterial({
  folderRef,
  filesRef,
  pdfRef,
}: {
  folderRef: RefObject<HTMLInputElement | null>;
  filesRef: RefObject<HTMLInputElement | null>;
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
        variant="quiet"
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
            data-add-files="true"
            onClick={() => {
              setOpen(false);
              filesRef.current?.click();
            }}
          >
            <FileCode2 className="size-3.5 shrink-0" />
            Upload files
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
  const pack = useMeetHint((s) => s.pack);
  const contexts = useMeetHint((s) => s.contexts);
  const activeContextId = useMeetHint((s) => s.activeContextId);
  const contextStatus = useMeetHint((s) => s.contextStatus);
  const loadingFolder = useMeetHint((s) => s.loadingFolder);
  const activateContext = useMeetHint((s) => s.activateContext);
  const deleteStoredContext = useMeetHint((s) => s.deleteStoredContext);
  const resetPack = useMeetHint((s) => s.resetPack);
  const [open, setOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hydrating = contextStatus === "booting" || contextStatus === "hydrating" || loadingFolder;
  const label = hydrating ? "Loading…" : pack.name;

  useEffect(() => {
    if (!open) {
      setRemoveId(null);
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (removeId) setRemoveId(null);
        else setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, removeId]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="quiet"
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
          {contexts.map((context) =>
            removeId === context.id ? (
              <div key={context.id} className="context-remove-confirm" data-testid="confirm-remove-context">
                <p>
                  Remove <span className="text-fg">{context.name}</span> from this device?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="context-option context-option-danger"
                    onClick={() => {
                      void deleteStoredContext(context.id);
                      setRemoveId(null);
                      setOpen(false);
                    }}
                  >
                    Remove
                  </button>
                  <button type="button" className="context-option" onClick={() => setRemoveId(null)}>
                    Keep
                  </button>
                </div>
              </div>
            ) : (
              <div key={context.id} className="context-row">
                <button
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
                <button
                  type="button"
                  className="context-remove"
                  data-testid={`remove-context-${context.id}`}
                  aria-label={`Remove ${context.name}`}
                  title="Remove from this device"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setRemoveId(context.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ),
          )}
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

function UtilityLinks({
  overlay,
  demo,
  playing,
  onOverlay,
  onReview,
}: {
  overlay: boolean;
  demo: boolean;
  playing: boolean;
  onOverlay: () => void;
  onReview: () => void;
}) {
  return (
    <>
      <a
        href="/app?overlay=1"
        target="_blank"
        rel="noreferrer"
        aria-label="Live window"
        title="Live window"
        className="cockpit-icon"
      >
        <ExternalLink className="size-4" />
      </a>
      <button
        type="button"
        className="cockpit-icon"
        aria-label={overlay ? "Cockpit" : "Overlay"}
        title={overlay ? "Cockpit" : "Overlay"}
        onClick={onOverlay}
      >
        <Minimize2 className="size-4" />
      </button>
      {demo ? (
        <button
          type="button"
          className="cockpit-icon"
          aria-label={playing ? "Stop" : "Play review"}
          title={playing ? "Stop" : "Play review"}
          onClick={onReview}
        >
          {playing ? <Square className="size-4" /> : <Play className="size-4" />}
        </button>
      ) : null}
      <ThemeToggle className="cockpit-icon border-transparent" />
    </>
  );
}

function UtilityMenu({
  className,
  overlay,
  demo,
  playing,
  onOverlay,
  onReview,
  onAudit,
}: {
  className?: string;
  overlay: boolean;
  demo: boolean;
  playing: boolean;
  onOverlay: () => void;
  onReview: () => void;
  onAudit: () => void;
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
    <div ref={rootRef} className={cn("relative", className)}>
      <Button
        variant="ghost"
        size="sm"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {open ? (
        <div className="context-menu" role="menu" aria-label="More">
          <a
            href="/app?overlay=1"
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            className="context-option"
            onClick={() => setOpen(false)}
          >
            <ExternalLink className="size-3.5 shrink-0" />
            Live window
          </a>
          <button
            type="button"
            role="menuitem"
            className="context-option"
            onClick={() => {
              setOpen(false);
              onOverlay();
            }}
          >
            <Minimize2 className="size-3.5 shrink-0" />
            {overlay ? "Cockpit" : "Overlay"}
          </button>
          {demo ? (
            <button
              type="button"
              role="menuitem"
              className="context-option"
              onClick={() => {
                setOpen(false);
                onReview();
              }}
            >
              {playing ? <Square className="size-3.5 shrink-0" /> : <Play className="size-3.5 shrink-0" />}
              {playing ? "Stop" : "Play review"}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="context-option"
            onClick={() => {
              setOpen(false);
              onAudit();
            }}
          >
            <ClipboardList className="size-3.5 shrink-0" />
            Audit this meeting
          </button>
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-xs text-muted">Theme</span>
            <ThemeToggle className="size-11 rounded-sm" />
          </div>
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

function ProofLine() {
  const subscription = useMeetHint((s) => s.subscription);
  const remaining = useMeetHint((s) => s.extractRemaining);
  const free = subscription === "free";
  return (
    <p className="quota-line" data-testid="extract-quota">
      {free
        ? remaining > 0
          ? `${remaining} questions remaining · GPT-4o Mini`
          : "Today's 20 questions are used. Upgrade for unlimited."
        : "Cited when possible, generated when needed."}
    </p>
  );
}

function splitPath(path: string) {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return { name: path, dir: "" };
  return { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

function RepoPane({ reveal = 0 }: { reveal?: number }) {
  const pack = useMeetHint((s) => s.pack);
  const sources = useMeetHint((s) => s.sources);
  const openFile = useMeetHint((s) => s.openFile);
  const setOpenFile = useMeetHint((s) => s.setOpenFile);
  const openDocument = useMeetHint((s) => s.openDocument);
  const openPdfSource = useMeetHint((s) => s.openPdfSource);
  const card = useMeetHint((s) => s.card);
  const [filter, setFilter] = useState("");
  const pdfs = sources.filter(isPdfSource);
  const file = pack.files.find((f) => f.path === openFile) ?? (openDocument ? undefined : pack.files[0]);
  // Only a file citation has a line to highlight in this pane. A commit
  // citation is about history and deliberately has no position in the file.
  const cite = card?.citations.find((c) => isFileCitation(c) && c.path === file?.path);
  const citeRange = cite ? citedLineRange(cite) : null;
  const citeLine = citeRange?.startLine;
  const citeEnd = citeRange?.endLine;
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
      const n = i + 1;
      const near =
        citeLine != null &&
        n >= citeLine - 24 &&
        n <= (citeEnd ?? citeLine) + 24;
      if (near) return highlightLine(line);
      return line;
    });
  }, [lines, citeLine, citeEnd]);

  useEffect(() => {
    if (citeLine == null) return;
    const start = preRef.current?.querySelector(`[data-line="${citeLine}"]`);
    const end = citeEnd != null ? preRef.current?.querySelector(`[data-line="${citeEnd}"]`) : null;
    start?.scrollIntoView({ block: "center" });
    end?.scrollIntoView({ block: "nearest" });
  }, [citeLine, citeEnd, file?.path, reveal]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [file?.path]);

  if (!file && !openDocument && pdfs.length === 0) {
    return (
      <section className="ground-panel p-5">
        <p className="text-[15px] leading-relaxed text-body">Open a local folder to search your files.</p>
      </section>
    );
  }

  return (
    <section className="ground-panel">
      <div className="ground-head">
        <span className="ground-head-left">
          <FolderGit2 className="size-3.5 shrink-0 text-muted" />
          <span className="truncate">{pack.name}</span>
        </span>
        <span className="ground-status tabular-nums">
          {sourceCount} {sourceCount === 1 ? "file" : "files"}
        </span>
      </div>
      {weak ? (
        <p className="px-3 pb-2 text-xs text-warn">Mostly CI/config. Open the src folder, then Search.</p>
      ) : null}
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(16rem,0.55fr)_minmax(0,1fr)] gap-4 overflow-hidden px-4 pb-4">
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <label className="relative mb-3 block shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search files..."
              className="ground-input h-10 rounded-[10px] pl-9 pr-3 text-[13px] placeholder:text-muted"
            />
          </label>
          <ul
            ref={listRef}
            className="file-list min-h-0 min-w-0 flex-1 space-y-1 overflow-auto"
          >
            {visible.length === 0 && visiblePdfs.length === 0 ? (
              <li className="px-2 py-3 text-xs text-muted">No files match that filter.</li>
            ) : null}
            {visible.map((f) => {
              const parts = splitPath(f.path);
              return (
              <li key={f.path} className="min-w-0">
                <button
                  type="button"
                  data-source-kind="file"
                  data-source-path={f.path}
                  data-active={!openDocument && file && f.path === file.path ? "true" : undefined}
                  onClick={() => setOpenFile(f.path)}
                  className="file-row flex w-full min-w-0 items-center gap-2 px-2.5 text-left"
                >
                  <FileCode2 className="size-3.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="file-name block truncate text-[13px]">{parts.name}</span>
                    {parts.dir ? <span className="file-path block truncate">{parts.dir}</span> : null}
                  </span>
                </button>
              </li>
              );
            })}
            {visiblePdfs.map((source) => {
              const status = pdfSourceStatus(source);
              const active = openDocument?.sourceId === source.id;
              const parts = splitPath(source.path);
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
                    className="file-row flex w-full min-w-0 items-center gap-2 px-2.5 text-left"
                  >
                    <FileText className="size-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="file-name block truncate text-[13px]">{parts.name}</span>
                      {status.short !== "Ready" || source.lastFailedNote ? (
                        <span className="file-path block truncate" data-source-label>
                          {source.lastFailedNote && source.readiness === "ready" ? "Update failed" : status.short}
                        </span>
                      ) : parts.dir ? (
                        <span className="file-path block truncate font-mono" data-source-label>
                          {parts.dir}
                        </span>
                      ) : (
                        <span className="file-path block truncate" data-source-label>
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
        <div className="ground-code flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="file-viewer">
          {openDocument ? (
            <PdfPane />
          ) : file ? (
            <>
              <div className="ground-code-name shrink-0 truncate text-xs">{file.path}</div>
              <pre ref={preRef} className="min-h-0 min-w-0 flex-1 overflow-auto px-3 py-2 text-xs leading-6 text-fg">
                {painted.map((node, i) => {
                  const n = i + 1;
                  const active = citeLine != null && n >= citeLine && n <= (citeEnd ?? citeLine);
                  return (
                    <div
                      key={n}
                      data-line={n}
                      data-cited={active ? "true" : undefined}
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

function markAsked(transcript: string, asked: string | null): { text: string; hit: boolean }[] {
  if (!transcript) return [];
  const needle = asked?.trim().replace(/[?]+$/, "").trim();
  if (!needle) return [{ text: transcript, hit: false }];
  const idx = transcript.toLowerCase().lastIndexOf(needle.toLowerCase());
  if (idx < 0) return [{ text: transcript, hit: false }];
  const before = transcript.slice(0, idx);
  const mid = transcript.slice(idx, idx + needle.length);
  const after = transcript.slice(idx + needle.length);
  return [
    ...(before ? [{ text: before, hit: false }] : []),
    { text: mid, hit: true },
    ...(after ? [{ text: after, hit: false }] : []),
  ];
}

const BUBBLE_LIMIT = 140;
const LISTEN_HINT_KEY = "meethint.listen-hint-dismissed";
const IFRAME_HINT =
  "This preview cannot hear the mic. Open Live window, allow the mic there, or paste the question.";

function TurnBubble({
  text,
  role,
  asked,
  draft,
}: {
  text: string;
  role: "them" | "you";
  asked: string | null;
  draft?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const long = text.length > BUBBLE_LIMIT;
  const shown = long && !open ? `${text.slice(0, BUBBLE_LIMIT).trimEnd()}…` : text;
  const parts = markAsked(shown, asked);

  return (
    <div className={cn("room-turn", role === "you" && "room-turn-you")} data-testid="room-turn">
      <p className="ground-hint">{role === "them" ? "They" : "You"}</p>
      <p className={cn("ground-transcript", draft && "live-caret")}>
        {parts.map((part, i) =>
          part.hit ? (
            <mark key={i} className="ground-transcript-ask">
              {part.text}
            </mark>
          ) : (
            <span key={i} className={asked ? "ground-transcript-fill" : undefined}>
              {part.text}
            </span>
          ),
        )}
      </p>
      {long ? (
        <button
          type="button"
          className="mt-1 text-xs text-body underline-offset-4 hover:text-fg hover:underline"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function TranscriptPane({ extras }: { active: boolean; extras: ReactNode }) {
  const utterances = useMeetHint((s) => s.utterances);
  const typedQuery = useMeetHint((s) => s.typedQuery);
  const setTypedQuery = useMeetHint((s) => s.setTypedQuery);
  const search = useMeetHint((s) => s.search);
  const searching = useMeetHint((s) => s.searching);
  const searchReady = useMeetHint((s) => s.contextStatus === "ready");
  const playing = useMeetHint((s) => s.playing);
  const armed = useMeetHint((s) => s.armed);
  const liveDraft = useMeetHint((s) => s.liveDraft);
  const draftRole = useMeetHint((s) => s.draftRole);
  const listenError = useMeetHint((s) => s.listenError);
  const listenBlocked = useMeetHint((s) => s.listenBlocked);
  const sharingCall = useMeetHint((s) => s.sharingCall);
  const pack = useMeetHint((s) => s.pack);
  const hearLevel = useMeetHint((s) => s.hearLevel);
  const asrStatus = useMeetHint((s) => s.asrStatus);
  const asrNote = useMeetHint((s) => s.asrNote);
  const asked = useMeetHint((s) => s.card?.query ?? s.heardQuestion);
  const queryRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [asrDismissed, setAsrDismissed] = useState<string | null>(null);
  const [iframeDismissed, setIframeDismissed] = useState(false);
  const [framed, setFramed] = useState(false);
  const draft = liveDraft === "…" ? "…" : cleanCaption(liveDraft);
  const themDraft = draftRole === "them" ? draft : "";
  const youDraft = draftRole === "you" ? draft : "";
  const turns = useMemo(() => {
    const spoken = utterances
      .filter((u) => u.role === "them" || u.role === "you")
      .map((u) => ({
        id: u.id,
        role: u.role as "them" | "you",
        text: cleanCaption(u.text),
      }))
      .filter((u) => u.text);
    if (themDraft) spoken.push({ id: "draft-them", role: "them", text: themDraft });
    if (youDraft) spoken.push({ id: "draft-you", role: "you", text: youDraft });
    return spoken;
  }, [utterances, themDraft, youDraft]);
  const live = (armed && !playing && !listenError) || sharingCall;
  const demo = pack.id === "northstar-payments";
  const iframeHint =
    !iframeDismissed && (listenBlocked === "iframe" || framed) ? IFRAME_HINT : null;
  const listenHint = (asrNote && asrDismissed !== asrNote ? asrNote : null) || iframeHint;

  useEffect(() => {
    setFramed(isFramed());
    try {
      if (sessionStorage.getItem(LISTEN_HINT_KEY) === "1") setIframeDismissed(true);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, liveDraft]);

  function dismissListenHint() {
    if (asrNote && asrDismissed !== asrNote) {
      setAsrDismissed(asrNote);
      return;
    }
    try {
      sessionStorage.setItem(LISTEN_HINT_KEY, "1");
    } catch {
      /* private mode */
    }
    setIframeDismissed(true);
  }

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
          <span>Room</span>
        </span>
        <span className="ground-status">
          {playing ? "Playing design review" : live ? "Listening" : "Idle"}
        </span>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col gap-5 overflow-auto px-5 py-4">
        {listenHint ? (
          <div
            role="status"
            data-testid="listen-hint"
            className="flex items-start justify-between gap-3 rounded-[10px] bg-accent-soft px-3 py-2 text-sm text-fg"
          >
            <p>{listenHint}</p>
            <button
              type="button"
              className="shrink-0 text-xs text-body underline-offset-4 hover:text-fg hover:underline"
              onClick={dismissListenHint}
            >
              Dismiss
            </button>
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="max-h-[min(16rem,36vh)] min-h-0 overflow-auto">
            {turns.length > 0 ? (
              turns.map((turn) => (
                <TurnBubble
                  key={turn.id}
                  text={turn.text}
                  role={turn.role}
                  asked={asked}
                  draft={turn.id.startsWith("draft-")}
                />
              ))
            ) : asrStatus === "loading" ? (
              <p className="text-[15px] leading-relaxed text-body">Loading captions…</p>
            ) : live ? (
              <p className="text-[15px] leading-relaxed text-body">Hearing you. The next line lands here.</p>
            ) : (
              <div className="empty-listen">
                <Mic className="size-4 text-muted" aria-hidden="true" />
                <p className="text-[15px] font-medium text-fg">Start listening</p>
                <p className="text-[13px] leading-relaxed text-muted">
                  Share the call or meeting tab with audio.
                  <br />
                  Hint will pick up questions as they are asked.
                </p>
              </div>
            )}
            <div ref={endRef} />
          </div>
          {live ? (
            <div className="hear-meter mt-3" aria-hidden="true">
              <div className="hear-meter-fill" style={{ width: `${Math.round(hearLevel * 100)}%` }} />
            </div>
          ) : null}
        </div>
        {extras}
        <form
          className="flex min-w-0 flex-col gap-3"
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
            placeholder={demo ? "Why does that retry three times?" : "What is the architecture of this application?"}
            className="ground-input ground-question"
          />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button type="submit" size="sm" className="min-w-24" disabled={!searchReady}>
              {searching ? <span className="search-spin" aria-hidden="true" /> : <Search className="size-3.5" />}
              Search
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void pasteQuery()}>
              <ClipboardPaste className="size-3.5" />
              Paste question
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function cardMeta(card: { latencyMs: number } | null) {
  if (!card || card.latencyMs <= 0) return null;
  return `Found in ${(card.latencyMs / 1000).toFixed(2)}s`;
}

function CardPane({
  compact,
  onOpenCited,
  overlay,
}: {
  compact: boolean;
  onOpenCited: (cite: Citation) => void;
  overlay: boolean;
  active: boolean;
}) {
  const card = useMeetHint((s) => s.card);
  const pack = useMeetHint((s) => s.pack);
  const search = useMeetHint((s) => s.search);
  const searching = useMeetHint((s) => s.searching);
  const searchReady = useMeetHint((s) => s.contextStatus === "ready");
  const heardQuestion = useMeetHint((s) => s.heardQuestion);
  const theySaid = card?.query || heardQuestion;
  const chips = useMemo(() => questionChips(pack), [pack]);
  const [copied, setCopied] = useState(false);
  const [sayOpen, setSayOpen] = useState(true);
  // The inline excerpt can only be shown for evidence that is in a file.
  const citedFile = card?.citations.find(isFileCitation);
  const cited = pack.files.find((f) => f.path === citedFile?.path);
  const speaking = Boolean(card?.say);
  const cardKey = `${card?.query ?? ""}|${card?.say ?? ""}|${card?.reason ?? ""}|${card?.latencyMs ?? 0}`;
  const longSay = (card?.say?.length ?? 0) > 180;
  const sayClamped = longSay && !sayOpen;
  const found = cardMeta(card);

  useEffect(() => {
    setSayOpen(!compact);
  }, [cardKey, compact]);

  function copySay() {
    if (!card?.say) return;
    void navigator.clipboard.writeText(card.say);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const generated = card?.answerMode === "generated";
  const citations =
    !generated && card && card.citations.length > 0 ? (
      <ul className="answer-receipt-cites">
        {card.citations.map((c) => {
          const opensFile = Boolean(citedPath(c));
          const opensPdf = isDocumentCitation(c) && !overlay;
          const opens = opensFile || opensPdf;
          const range = citedLineRange(c);
          const lines =
            range == null
              ? null
              : range.startLine === range.endLine
                ? `line ${range.startLine}`
                : `lines ${range.startLine}–${range.endLine}`;
          const path = isFileCitation(c) || isDocumentCitation(c) ? c.path : citationText(c);
          const extra =
            isDocumentCitation(c) && !lines
              ? `Page ${c.page}`
              : c.kind === "commit"
                ? null
                : lines;
          return (
            <li key={c.evidenceId ?? citationText(c)} className="min-w-0 cite-fade" data-testid="card-citation">
              <button
                type="button"
                onClick={opens ? () => onOpenCited(c) : undefined}
                disabled={!opens}
                className="cite-chip"
              >
                <Check className="size-3.5 shrink-0 text-ok" aria-hidden="true" />
                <span className="cite-status">Verified</span>
                <span className="break-all font-mono text-[12px] text-fg">{path}</span>
                {extra ? <span className="font-mono text-[12px] text-fg">{extra}</span> : null}
                {c.label ? <span className="text-[12px] text-muted">{c.label}</span> : null}
                <span className="sr-only">{citationText(c)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <section className="ground-panel answer-panel" data-testid="card">
      <div className="ground-head">
        <span className="ground-head-left">
          <span>Answer</span>
          {speaking ? <AnswerModeBadge mode={card?.answerMode} /> : null}
          {searching ? <span className="search-spin" aria-label="Searching" /> : null}
        </span>
        <span className="ground-status tabular-nums">
          {found ?? (searching ? "Searching" : speaking ? "Ready" : "Ready")}
        </span>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div key={cardKey} className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-auto px-5 py-5">
          {theySaid || speaking ? (
            <div className="answer-receipt">
              <div className="answer-receipt-body">
                {theySaid ? (
                  <div className="heard-block min-w-0">
                    <p className="receipt-kicker">They asked</p>
                    <p className="mt-2 text-[17px] font-semibold leading-snug text-fg">“{theySaid}”</p>
                  </div>
                ) : null}
                {speaking ? (
                  <div className="space-y-3">
                    <p className="receipt-kicker receipt-kicker-accent">{receiptKicker(card?.answerMode)}</p>
                    {card?.say ? (
                      <AnswerSay text={card.say} className={sayClamped ? "line-clamp-2" : undefined} />
                    ) : null}
                    {generated ? (
                      <p
                        className="generated-note"
                        data-testid="generated-note"
                        title="General knowledge — verify before saying it."
                      >
                        General knowledge — verify before saying it.
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="quiet"
                        size="sm"
                        className={copied ? "text-ok" : undefined}
                        onClick={copySay}
                      >
                        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {copied ? "Copied" : "Copy"}
                      </Button>
                      {longSay ? (
                        <Button
                          variant="quiet"
                          size="sm"
                          data-testid="card-say-expand"
                          onClick={() => setSayOpen((open) => !open)}
                        >
                          {sayOpen ? "Show less" : "Show full"}
                        </Button>
                      ) : null}
                    </div>
                    {citations}
                  </div>
                ) : (
                  <>
                    <p data-testid="card-reason" className="text-[15px] leading-relaxed text-body">
                      {card?.reason ?? "Ask a question about this pack. Small talk stays in Room."}
                    </p>
                    {citations}
                  </>
                )}
              </div>
              {compact && cited && citedFile ? (
                <pre className="ground-code mx-4 mb-4 max-h-40 overflow-auto whitespace-pre px-3 py-2 font-mono text-xs leading-5 text-muted">
                  {cited.content
                    .split("\n")
                    .slice(Math.max(0, citedFile.line - 3), citedFile.line + 5)
                    .join("\n")}
                </pre>
              ) : null}
            </div>
          ) : (
            <p data-testid="card-reason" className="text-[15px] leading-relaxed text-body">
              {card?.reason ?? "Ask a question about this pack. Small talk stays in Room."}
            </p>
          )}
          <AnswerHistory />
        </div>
        <div className="shrink-0 space-y-3 px-5 py-4">
          <p className="ground-hint">Try another question</p>
          <div className="card-chips">
            {chips.map((q) => (
              <button
                key={q}
                type="button"
                disabled={!searchReady}
                data-current={theySaid && q.toLowerCase() === theySaid.toLowerCase() ? "true" : undefined}
                onClick={() => void search(q)}
                className="ground-chip text-xs disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>
          <ProofLine />
        </div>
      </div>
    </section>
  );
}
