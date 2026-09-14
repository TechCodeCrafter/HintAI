import { create } from "zustand";
import "@/lib/e2e-hooks";
import { bindAccountId, LOCAL_DEV_ACCOUNT_ID, readAccountStorage, writeAccountStorage } from "@/lib/auth/account-boundary";
import { authEnabled } from "@/lib/auth/client";
import type { ContextRecord, ContextRuntimeStatus, StoredSource } from "@/lib/context/types";
import { isPdfSource } from "@/lib/context/types";
import { indexSpace } from "@/lib/context/space-index";
import type { SpaceRecord } from "@/lib/context/space-types.ts";
import { authorizedSourceIdsFrom, assertSpaceWorkspace, runSpaceScopedRetrieval } from "@/lib/search/search-scope.ts";
import type { ContextRepository } from "@/lib/context/repository";
import type { IndexedSpaceRuntime } from "@/lib/context/space-index";
import { runtimeFromPack } from "@/lib/context/hydrate";
import { pdfWorkPending } from "@/lib/context/source-write";
import { addPdfFilesToContext, planPdfBatch } from "@/lib/document/pdf/add-files";
import { canServeSnapshot, resumePdfWork, type IngestProgress } from "@/lib/document/pdf/ingest-flow";
import {
  migrateLegacyPack,
  persistActiveSpaceId,
  readActiveSpaceId,
  readSavedPack,
} from "@/lib/context/migration";
import { dropExcludedEvidence, normalizeExcludePatterns, pathExcluded, toggleExcludePath } from "@/lib/context/exclusions";
import { getVectorStore } from "@/lib/search/vector-access";
import { getContextRepository, listStoredContexts, persistPackAsContext } from "@/lib/context/service";
import type { CreateContextInput } from "@/lib/context/repository";
import { evidenceForOpenTarget, resolveDocumentOpen } from "@/lib/document/viewer/resolve";
import { syncViewerBlobPins } from "@/lib/document/viewer/retain";
import type { DocumentOpenTarget } from "@/lib/document/viewer/types";
import { NORTHSTAR } from "@/lib/repo/northstar";
import {
  SYNTHESIZE_MAX_TOKENS,
  getDefaultModel,
  readSelectedModelId,
  writeSelectedModelId,
} from "@/lib/ai/models";
import {
  EXTRACT_DAILY_LIMIT,
  consumeExtractQuestion,
  extractExhausted,
  extractRemaining,
} from "@/lib/billing/extract-quota";
import {
  canDetectContradictions,
  readSubscription,
  writeSubscription,
  type SubscriptionTier,
} from "@/lib/billing/subscription";
import type { Card, DocumentCitation, HeardEvent, IndexedChunk, RepoPack, Utterance } from "@/lib/repo/types";
import { buildSpaceMaterialView } from "@/lib/context/material-view";
import {
  appendAnswerHistory,
  cardFromHistory,
  findHistoryItem,
  telemetryFromCard,
  type AnswerHistoryItem,
} from "@/lib/search/answer-history";
import type { LocalCardContext } from "@/lib/search/local-card";
import { currentWorkspaceId, defaultWorkspaceId } from "@/lib/auth/workspace.ts";
import { recordAnswerFlight, transcriptLanes } from "@/lib/instrumentation/flight-recorder";
import { routeSearchAnswer } from "@/lib/search/answer-route";
import { officeReadError, packFromFiles, truncationNotice, type FolderLoadOptions } from "@/lib/repo/folder";
import { DESIGN_REVIEW } from "@/lib/meeting/script";
import type { Gate } from "@/lib/search/question";
import { applyHeard, newestFrom } from "@/lib/listen/transcript-events";
import { type GateRecord, gateRecords, recordGate } from "@/lib/search/gate-log";
import {
  cleanCaption,
  extractQuestion,
  gateNewest,
  liveQuestionFromTranscript,
  looksLikeQuestion,
} from "@/lib/search/question";
import {
  buildChunks,
  formatFlightRetrievalSummary,
  packVocabulary,
} from "@/lib/search/retrieve";
import { shapeOf } from "@/lib/search/intent";
import {
  contentWords,
  normalizeSpokenQuestion,
  previousRetrievalQuestion,
} from "@/lib/search/spoken";
import { subjectTerms } from "@/lib/search/subject";
import { threadAlive, threadFrom, type ThreadContext } from "@/lib/search/thread";
import {
  downloadClaimReport as saveClaimReport,
  reportFilename,
} from "@/lib/audit/report";
import { claimAdmit } from "@/lib/audit/admit";
import { detectContradictions } from "@/lib/audit/contradict";
import { isClaimLine } from "@/lib/audit/claim-gate";
import { getMeetingRepository } from "@/lib/audit/repository";
import { finishMeeting, latestOpenMeeting, loadMeetings, meetingTitle, persistMeeting } from "@/lib/audit/session";
import { newClaim, newMeetingRecord, type MeetingRecord } from "@/lib/audit/types";

export { readSavedPack };

export const SESSION_KEY = "meethint.session";
const SESSION_KEY_LEGACY = "ground.session";

function readSessionRaw(): string | null {
  const next = readAccountStorage(SESSION_KEY);
  if (next != null) return next;
  try {
    const legacy = localStorage.getItem(SESSION_KEY_LEGACY);
    if (legacy == null) return null;
    writeAccountStorage(SESSION_KEY, legacy);
    localStorage.removeItem(SESSION_KEY_LEGACY);
    return legacy;
  } catch {
    return null;
  }
}
const HERO_QUERY = "Why does that retry three times?";
const WEAK_PACK = "This pack is mostly CI/config. Open the src folder, not the repo root.";

function packWarning(weak: boolean, files: number): string | null {
  return weak && files > 0 ? WEAK_PACK : null;
}

function noticesFromFolderLoad(args: {
  failed: string[];
  skipped: number;
  truncated: boolean;
  weak: boolean;
  fileCount: number;
}): { folderError: string | null; packNotice: string | null } {
  const readError = args.failed.length > 0 ? officeReadError(args.failed) : null;
  return {
    folderError:
      readError ??
      (args.weak
        ? WEAK_PACK
        : args.skipped && !args.truncated
          ? `Skipped ${args.skipped} files that are not source or text.`
          : null),
    packNotice: args.truncated ? truncationNotice(args.fileCount) : null,
  };
}

type SessionWire = {
  card: Card | null;
  armed: boolean;
  listening: boolean;
  searching: boolean;
};

function persist(partial: SessionWire) {
  writeAccountStorage(SESSION_KEY, JSON.stringify(partial));
  try {
    localStorage.removeItem(SESSION_KEY_LEGACY);
  } catch {
    /* ignore quota */
  }
}

if (typeof window !== "undefined" && !authEnabled) {
  bindAccountId(LOCAL_DEV_ACCOUNT_ID);
}

export type { SubscriptionTier };

type MeetHintState = {
  pack: RepoPack;
  chunks: IndexedChunk[];
  contexts: ContextRecord[];
  /** Active Knowledge Space — production search corpus boundary. */
  activeSpaceId: string | null;
  /** Legacy route/UI alias — primary member context id. */
  activeContextId: string | null;
  memberContextIds: string[];
  authorizedSourceIds: string[];
  contextStatus: ContextRuntimeStatus;
  contextError: string | null;
  hydrationEpoch: number;
  sources: StoredSource[];
  contextUpdating: boolean;
  ingestProgress: IngestProgress | null;
  /** Words the loaded material contains. Drives the question gate. */
  vocab: Set<string>;
  armed: boolean;
  listening: boolean;
  playing: boolean;
  overlay: boolean;
  autoAnswer: boolean;
  subscription: SubscriptionTier;
  selectedModelId: string;
  extractRemaining: number;
  upgradeFeature: string | null;
  auditOpen: boolean;
  sharingCall: boolean;
  searching: boolean;
  refining: boolean;
  loadingFolder: boolean;
  liveDraft: string;
  /** Which lane the in-flight draft came from, so the UI never mislabels it. */
  draftRole: "them" | "you";
  hearLevel: number;
  asrStatus: "off" | "loading" | "live" | "down";
  asrNote: string;
  listenError: string | null;
  listenBlocked: "iframe" | "denied" | "missing" | "speech" | null;
  folderError: string | null;
  packNotice: string | null;
  utterances: Utterance[];
  typedQuery: string;
  heardQuestion: string | null;
  /** The utterance whose question was last acted on, so a re-ask is a new event. */
  handledId: string | null;
  card: Card | null;
  openFile: string | null;
  openDocument: DocumentOpenTarget | null;
  openPdfSource: (sourceId: string) => void;
  answerHistory: AnswerHistoryItem[];
  /** Structured context for the open thread. See thread.ts. */
  thread: ThreadContext | null;
  arm: () => void;
  disarm: () => void;
  setOverlay: (value: boolean) => void;
  setAutoAnswer: (value: boolean) => void;
  setSubscription: (tier: SubscriptionTier) => void;
  setSelectedModelId: (id: string) => void;
  requestUpgrade: (feature: string) => void;
  clearUpgrade: () => void;
  setSharingCall: (value: boolean) => void;
  setTypedQuery: (q: string) => void;
  setHeardQuestion: (q: string | null) => void;
  setOpenFile: (path: string | null) => void;
  setOpenDocument: (target: DocumentOpenTarget | null) => void;
  openDocumentCitation: (cite: DocumentCitation) => void;
  setLiveDraft: (text: string, role?: "them" | "you") => void;
  setHearLevel: (level: number) => void;
  setAsrStatus: (status: MeetHintState["asrStatus"]) => void;
  setAsrNote: (note: string) => void;
  setListenError: (text: string | null, blocked?: MeetHintState["listenBlocked"]) => void;
  boot: (preferredSpaceId?: string) => Promise<void>;
  activateSpace: (spaceId: string) => Promise<void>;
  /** Compatibility — resolves the member space and activates it. */
  activateContext: (contextId: string) => Promise<void>;
  createNamedContext: (input: CreateContextInput) => Promise<string>;
  attachFolderToContext: (contextId: string, list: FileList | File[], options?: FolderLoadOptions) => Promise<void>;
  deleteStoredContext: (id: string) => Promise<void>;
  refreshContexts: () => Promise<void>;
  hydratePack: (pack: RepoPack) => void;
  playMeeting: () => void;
  stopMeeting: () => void;
  /**
   * `resolved` marks a question that only exists because a reference was
   * grounded against the thread, which is what earns it the replay guard.
   */
  search: (explicit?: string, opts?: { fast?: boolean; resolved?: boolean }) => Promise<void>;
  appendUtterance: (u: Omit<Utterance, "id"> & { id?: string }) => void;
  /** Single entry point for live speech. Only "them" reaches the question gate. */
  heard: (event: HeardEvent) => void;
  clearThem: () => void;
  lastWindow: (ms?: number) => string;
  loadFolder: (list: FileList | File[], options?: FolderLoadOptions) => Promise<void>;
  addPdfFiles: (list: FileList | File[]) => Promise<void>;
  setPackExclusions: (patterns: string[]) => Promise<void>;
  togglePackExclusion: (path: string) => Promise<void>;
  resetPack: () => void;
  dismissPackNotice: () => void;
  currentMeeting: MeetingRecord | null;
  meetingHistory: MeetingRecord[];
  selectedClaimId: string | null;
  claimReport: string | null;
  openAudit: () => Promise<void>;
  startClaimAudit: () => Promise<void>;
  admitHeardClaim: (utterance: Utterance) => Promise<void>;
  endClaimAudit: () => Promise<void>;
  selectAuditClaim: (id: string | null) => void;
  closeClaimAudit: () => void;
  exportClaimReport: () => void;
  restoreAnswer: (id: string) => void;
  reviewMeeting: (id: string) => Promise<void>;
  resetForAccountChange: () => void;
};

const playTimeouts: number[] = [];
let searchEpoch = 0;
let hydrationEpoch = 0;
const contextWriteLocks = new Map<string, Promise<unknown>>();

function withContextWrite<T>(contextId: string, work: () => Promise<T>): Promise<T> {
  const previous = contextWriteLocks.get(contextId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  contextWriteLocks.set(
    contextId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

function nextHydrationEpoch(): number {
  hydrationEpoch += 1;
  return hydrationEpoch;
}

function searchIsLive(): boolean {
  return useMeetHint.getState().contextStatus === "ready";
}

function clearSessionOnSwitch(): Pick<
  MeetHintState,
  | "thread"
  | "card"
  | "answerHistory"
  | "heardQuestion"
  | "handledId"
  | "openFile"
  | "openDocument"
  | "liveDraft"
  | "ingestProgress"
  | "typedQuery"
> {
  syncViewerBlobPins(null, null);
  return {
    thread: null,
    card: null,
    answerHistory: [],
    heardQuestion: null,
    handledId: null,
    openFile: null,
    openDocument: null,
    liveDraft: "",
    ingestProgress: null,
    typedQuery: "",
  };
}

function applyCard(card: Card | null, openDocument: DocumentOpenTarget | null) {
  if (openDocument && !openDocument.evidenceId) {
    syncViewerBlobPins(card, openDocument);
    return { card, openDocument };
  }
  const next = card && openDocument && evidenceForOpenTarget(card, openDocument) ? openDocument : null;
  syncViewerBlobPins(card, next);
  return { card, openDocument: next };
}

/**
 * The file a Card should open in the repo pane, if any of its citations names
 * one. Commit citations name history rather than a location, so they leave the
 * pane where it was instead of jumping it somewhere arbitrary.
 */
function firstCitedPath(card: Card): string | null {
  for (const cite of card.citations) if (cite.kind === "file") return cite.path;
  return null;
}

function windowText(utterances: Utterance[], ms = 15000): string {
  const cutoff = Date.now() - ms;
  return utterances
    .filter((u) => u.at >= cutoff && u.role !== "system")
    .map((u) => `${u.speaker}: ${u.text}`)
    .join("\n");
}

const THREAD_MS = 45000;

/**
 * How many earlier utterances may help interpret the newest one. Enough to
 * resolve "that", short enough that a question from minutes ago cannot.
 */
const CONTEXT_LINES = 4;

/**
 * What the question gate is allowed to know: the words in the loaded material,
 * and whether a cited Card is still fresh enough for a terse follow-up.
 */
function gateFrom(state: Pick<MeetHintState, "vocab" | "answerHistory" | "thread">): Gate {
  const recent = state.answerHistory[0];
  const alive = threadAlive(state.thread, THREAD_MS);
  return {
    vocab: state.vocab,
    threadOpen: Boolean(recent?.say) && Date.now() - (recent?.timestamp ?? 0) < THREAD_MS && alive,
    thread: alive ? state.thread : null,
  };
}

/**
 * What the thread should be after this answer.
 *
 * A Card that spoke becomes the thread — that is the only thing a later pointer
 * may reach. A self-contained question that stayed silent clears it, because the
 * room has moved on and "why?" must not reach back past it. A follow-up that
 * stayed silent leaves the thread alone: the topic is still the topic.
 */
function nextThread(
  current: ThreadContext | null,
  input: { query: string; canonical: string; card: Card; pack: RepoPack; resolved: boolean },
): ThreadContext | null {
  if (input.card.say) {
    return (
      threadFrom({
        utteranceId: input.query,
        canonical: input.canonical,
        shape: shapeOf(input.canonical),
        subject: subjectTerms(contentWords(input.canonical), input.pack),
        card: input.card,
      }) ?? current
    );
  }
  return input.resolved ? current : null;
}

function isTyping(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable;
}

const NORTHSTAR_CHUNKS = buildChunks(NORTHSTAR);

async function resolveSpaceForActivation(
  repo: ContextRepository,
  contextOrSpaceId: string,
): Promise<SpaceRecord> {
  let space = await repo.getSpace(contextOrSpaceId);
  if (!space) {
    const all = await repo.listSpaces();
    space = all.find((item) => item.memberContextIds.includes(contextOrSpaceId)) ?? null;
  }
  if (!space) {
    const ctx = await repo.getContext(contextOrSpaceId);
    if (!ctx) throw new Error("Context not in this account");
    space = await repo.createSpace({
      id: ctx.id,
      name: ctx.name,
      memberContextIds: [ctx.id],
      primaryContextId: ctx.id,
    });
  }
  assertSpaceWorkspace(space);
  return space;
}

async function listAllSpaceSources(repo: ContextRepository, memberContextIds: string[]): Promise<StoredSource[]> {
  const rows: StoredSource[] = [];
  for (const contextId of memberContextIds) {
    rows.push(...(await repo.listSources(contextId)));
  }
  return rows;
}

function patchFromSpaceRuntime(
  space: SpaceRecord,
  runtime: Pick<
    IndexedSpaceRuntime,
    "memberContextIds" | "allSources" | "pack" | "chunks" | "vocab" | "openFile"
  >,
): Pick<
  MeetHintState,
  | "activeSpaceId"
  | "activeContextId"
  | "memberContextIds"
  | "authorizedSourceIds"
  | "sources"
  | "pack"
  | "chunks"
  | "vocab"
  | "openFile"
> {
  return {
    activeSpaceId: space.id,
    activeContextId: space.primaryContextId,
    memberContextIds: runtime.memberContextIds,
    authorizedSourceIds: authorizedSourceIdsFrom(runtime.allSources),
    sources: runtime.allSources,
    pack: runtime.pack,
    chunks: runtime.chunks,
    vocab: runtime.vocab,
    openFile: runtime.openFile,
  };
}

export const useMeetHint = create<MeetHintState>((set, get) => ({
  pack: NORTHSTAR,
  chunks: NORTHSTAR_CHUNKS,
  contexts: [],
  activeSpaceId: null,
  activeContextId: null,
  memberContextIds: [],
  authorizedSourceIds: [],
  contextStatus: "booting",
  contextError: null,
  hydrationEpoch: 0,
  sources: [],
  contextUpdating: false,
  ingestProgress: null,
  vocab: packVocabulary(NORTHSTAR_CHUNKS),
  armed: false,
  listening: false,
  playing: false,
  overlay: false,
  autoAnswer: true,
  subscription: "free",
  selectedModelId: getDefaultModel().id,
  extractRemaining: EXTRACT_DAILY_LIMIT,
  upgradeFeature: null,
  auditOpen: false,
  sharingCall: false,
  searching: false,
  refining: false,
  loadingFolder: false,
  liveDraft: "",
  draftRole: "them",
  hearLevel: 0,
  asrStatus: "off",
  asrNote: "",
  listenError: null,
  listenBlocked: null,
  folderError: null,
  packNotice: null,
  currentMeeting: null,
  meetingHistory: [],
  selectedClaimId: null,
  claimReport: null,
  utterances: [],
  typedQuery: "",
  heardQuestion: null,
  handledId: null,
  card: null,
  openFile: "src/exporter/retry.ts",
  openDocument: null,
  answerHistory: [],
  thread: null,
  arm: () => {
    playTimeouts.splice(0).forEach((id) => window.clearTimeout(id));
    set({ armed: true, listening: true, playing: false, listenError: null, listenBlocked: null });
    persist({ card: get().card, armed: true, listening: true, searching: false });
    void get().startClaimAudit();
  },
  disarm: () => {
    playTimeouts.splice(0).forEach((id) => window.clearTimeout(id));
    set({
      armed: false,
      listening: false,
      playing: false,
      sharingCall: false,
      liveDraft: "",
      hearLevel: 0,
      asrStatus: "off",
      asrNote: "",
      listenError: null,
      listenBlocked: null,
      // Listening stopped, so the open thread is over: the next session's
      // pointers must not reach into this one.
      thread: null,
    });
    persist({ card: get().card, armed: false, listening: false, searching: false });
    void get().endClaimAudit();
  },
  setOverlay: (value) => set({ overlay: value }),
  setAutoAnswer: (value) => set({ autoAnswer: value }),
  setSubscription: (tier) => {
    writeSubscription(tier);
    set({
      subscription: tier,
      extractRemaining: extractRemaining(),
      folderError: get().folderError?.includes("requires Pro") ? null : get().folderError,
    });
  },
  setSelectedModelId: (id) => set({ selectedModelId: writeSelectedModelId(id) }),
  requestUpgrade: (feature) => set({ upgradeFeature: feature }),
  clearUpgrade: () => set({ upgradeFeature: null }),
  setSharingCall: (value) => set({ sharingCall: value }),
  setTypedQuery: (q) => set({ typedQuery: q }),
  setHeardQuestion: (q) => set({ heardQuestion: q }),
  setOpenFile: (path) =>
    set((s) => {
      syncViewerBlobPins(s.card, null);
      return { openFile: path, openDocument: null };
    }),
  setOpenDocument: (target) =>
    set((s) => {
      syncViewerBlobPins(s.card, target);
      return { openDocument: target };
    }),
  openPdfSource: (sourceId) =>
    set((s) => {
      const source = s.sources.find((row) => row.id === sourceId);
      if (!source || !isPdfSource(source)) return s;
      const target = {
        sourceId: source.id,
        contentHash: source.contentHash,
        page: 1,
        evidenceId: "",
      };
      syncViewerBlobPins(s.card, target);
      return { openDocument: target, openFile: null };
    }),
  openDocumentCitation: (cite) =>
    set((s) => {
      const resolved = resolveDocumentOpen(s.card, cite);
      if (!resolved.target) {
        syncViewerBlobPins(s.card, null);
        return {
          openDocument: {
            sourceId: cite.sourceId,
            contentHash: "",
            page: cite.page,
            evidenceId: cite.evidenceId ?? "",
          },
        };
      }
      syncViewerBlobPins(s.card, resolved.target);
      return { openDocument: resolved.target };
    }),
  setLiveDraft: (text, role) =>
    set((s) => ({
      liveDraft: !text || text === "…" ? text : cleanCaption(text),
      draftRole: role ?? s.draftRole,
    })),
  setHearLevel: (level) => set({ hearLevel: Math.max(0, Math.min(1, level)) }),
  setAsrStatus: (status) => set({ asrStatus: status }),
  setAsrNote: (note) => set({ asrNote: note }),
  setListenError: (text, blocked = null) =>
    set({
      listenError: text,
      listenBlocked: text ? (blocked ?? get().listenBlocked) : null,
      listening: text ? false : get().listening,
    }),
  boot: async (preferredId) => {
    const epoch = nextHydrationEpoch();
    set({
      contextStatus: "booting",
      contextError: null,
      hydrationEpoch: epoch,
    });
    try {
      const migration = await migrateLegacyPack();
      if (epoch !== hydrationEpoch) return;
      const contexts = await listStoredContexts();
      if (epoch !== hydrationEpoch) return;
      set({ contexts });
      if (migration.kind === "failed") {
        set({
          contextStatus: "error",
          contextError: migration.error,
        });
        return;
      }
      const remembered = preferredId ?? readActiveSpaceId();
      const repo = getContextRepository();
      const spaces = await repo.listSpaces();
      if (epoch !== hydrationEpoch) return;
      const targetSpaceId =
        preferredId ??
        (remembered && spaces.some((row) => row.id === remembered) ? remembered : null) ??
        spaces[0]?.id ??
        (migration.kind === "migrated" ? migration.context.id : null) ??
        contexts[0]?.id ??
        null;
      if (preferredId && !spaces.some((row) => row.id === preferredId) && !contexts.some((row) => row.id === preferredId)) {
        persistActiveSpaceId(null);
        set({
          activeSpaceId: null,
          activeContextId: null,
          memberContextIds: [],
          authorizedSourceIds: [],
          contextStatus: "ready",
          contextError: "That Knowledge Space is not in this account.",
          contexts,
          pack: NORTHSTAR,
          chunks: NORTHSTAR_CHUNKS,
          vocab: packVocabulary(NORTHSTAR_CHUNKS),
          sources: [],
          ...clearSessionOnSwitch(),
        });
        persist({ card: null, armed: false, listening: false, searching: false });
        const history = await loadMeetings().catch(() => []);
        if (epoch !== hydrationEpoch) return;
        set({ meetingHistory: history, currentMeeting: latestOpenMeeting(history) });
        return;
      }
      if (!targetSpaceId) {
        persistActiveSpaceId(null);
        set({
          activeSpaceId: null,
          activeContextId: null,
          memberContextIds: [],
          authorizedSourceIds: [],
          contextStatus: "ready",
          contextError: null,
        });
        const history = await loadMeetings().catch(() => []);
        if (epoch !== hydrationEpoch) return;
        set({ meetingHistory: history, currentMeeting: latestOpenMeeting(history) });
        return;
      }
      await get().activateSpace(targetSpaceId);
      if (epoch !== hydrationEpoch) return;
      const history = await loadMeetings().catch(() => []);
      if (epoch !== hydrationEpoch) return;
      set({ meetingHistory: history, currentMeeting: latestOpenMeeting(history) });
    } catch {
      if (epoch !== hydrationEpoch) return;
      set({
        contextStatus: "error",
        contextError: "Could not open saved contexts.",
      });
    }
  },
  createNamedContext: async (input) => {
    const repo = getContextRepository();
    const context = await repo.createContext(input);
    persistActiveSpaceId(context.id);
    const contexts = await listStoredContexts();
    set({
      contexts,
      activeSpaceId: context.id,
      activeContextId: context.id,
      memberContextIds: [context.id],
      authorizedSourceIds: [],
      sources: [],
    });
    return context.id;
  },
  attachFolderToContext: async (contextId, list, options) => {
    const epoch = nextHydrationEpoch();
    searchEpoch += 1;
    set({
      loadingFolder: true,
      folderError: null,
      packNotice: null,
      contextStatus: "hydrating",
      contextError: null,
      hydrationEpoch: epoch,
      activeContextId: contextId,
      activeSpaceId: contextId,
      ...clearSessionOnSwitch(),
    });
    persistActiveSpaceId(contextId);
    try {
      const { pack: raw, skipped, truncated, failed } = await packFromFiles(list, options);
      if (raw.files.length === 0) {
        if (epoch !== hydrationEpoch) return;
        set({
          loadingFolder: false,
          contextStatus: "ready",
          folderError: failed.length
            ? officeReadError(failed)
            : "No readable source files in that selection. Pick source, markdown, text, or office files.",
          packNotice: null,
        });
        return;
      }
      const repo = getContextRepository();
      const { context } = await persistPackAsContext(raw, repo, { contextId });
      if (epoch !== hydrationEpoch) return;
      const space = await resolveSpaceForActivation(repo, context.id);
      const hydrated = await indexSpace(repo, space.id, {
        isCancelled: () => epoch !== hydrationEpoch,
      });
      if (epoch !== hydrationEpoch || hydrated.cancelled) return;
      persistActiveSpaceId(space.id);
      const contexts = await listStoredContexts();
      if (epoch !== hydrationEpoch) return;
      set({
        contexts,
        ...patchFromSpaceRuntime(space, hydrated),
        loadingFolder: false,
        contextStatus: "ready",
        contextUpdating: false,
        ingestProgress: null,
        contextError: null,
        ...noticesFromFolderLoad({
          failed,
          skipped,
          truncated,
          weak: hydrated.weak,
          fileCount: hydrated.pack.files.length,
        }),
      });
    } catch {
      if (epoch !== hydrationEpoch) return;
      set({
        loadingFolder: false,
        contextStatus: "error",
        contextError: "Could not save that material.",
        folderError: "Could not read those files.",
        packNotice: null,
      });
    }
  },
  deleteStoredContext: async (id) => {
    const repo = getContextRepository();
    await repo.deleteContext(id);
    const contexts = await listStoredContexts();
    if (get().activeContextId === id || get().activeSpaceId === id) {
      persistActiveSpaceId(null);
      const next = contexts[0];
      if (next) {
        await get().activateContext(next.id);
        return;
      }
      get().resetPack();
      set({ contexts });
      return;
    }
    set({ contexts });
  },
  refreshContexts: async () => {
    set({ contexts: await listStoredContexts() });
  },
  activateSpace: async (spaceId) => {
    const epoch = nextHydrationEpoch();
    searchEpoch += 1;
    set({
      contextStatus: "hydrating",
      contextError: null,
      contextUpdating: false,
      hydrationEpoch: epoch,
      packNotice: null,
      ...clearSessionOnSwitch(),
    });
    persist({ card: null, armed: get().armed, listening: get().listening, searching: false });
    try {
      const repo = getContextRepository();
      const space = await resolveSpaceForActivation(repo, spaceId);
      const primaryId = space.primaryContextId;
      await withContextWrite(primaryId, async () => {
        const record = await repo.getContext(primaryId);
        if (!record) throw new Error("Knowledge space not in this account");
        const allSources = await listAllSpaceSources(repo, space.memberContextIds);
        const primarySources = await repo.listSources(primaryId);
        if (epoch !== hydrationEpoch) return;
        if (allSources.length === 0) {
          persistActiveSpaceId(space.id);
          const contexts = await listStoredContexts();
          if (epoch !== hydrationEpoch) return;
          set({
            ...patchFromSpaceRuntime(space, {
              memberContextIds: space.memberContextIds,
              allSources: [],
              pack: {
                id: space.id,
                name: space.name,
                description: record.description ?? "No sources yet",
                files: [],
                commits: [],
              },
              chunks: [],
              vocab: new Set(),
              openFile: null,
            }),
            contexts,
            contextStatus: "ready",
            contextUpdating: false,
            ingestProgress: null,
            contextError: null,
            folderError: "This Knowledge Space has no sources yet. Add a repo, folder, or PDF.",
          });
          return;
        }
        const serveNow = canServeSnapshot(primarySources);
        const pending = pdfWorkPending(primarySources);

        if (serveNow) {
          const runtime = await indexSpace(repo, space.id, {
            isCancelled: () => epoch !== hydrationEpoch,
          });
          if (epoch !== hydrationEpoch || runtime.cancelled) return;
          persistActiveSpaceId(space.id);
          const contexts = await listStoredContexts();
          if (epoch !== hydrationEpoch) return;
          set({
            contexts,
            ...patchFromSpaceRuntime(space, runtime),
            contextStatus: "ready",
            contextUpdating: pending,
            contextError: null,
            folderError: packWarning(runtime.weak, runtime.pack.files.length),
          });
          if (!pending) return;
        }

        const finished = await resumePdfWork(repo, primaryId, {
          isCancelled: () => epoch !== hydrationEpoch,
          onProgress: (progress) => {
            if (epoch !== hydrationEpoch || get().activeSpaceId !== space.id) return;
            set({ ingestProgress: progress, contextUpdating: serveNow, sources: get().sources });
          },
        });
        if (epoch !== hydrationEpoch) return;
        persistActiveSpaceId(space.id);
        const contexts = await listStoredContexts();
        const liveSources = await listAllSpaceSources(repo, space.memberContextIds);
        if (epoch !== hydrationEpoch) return;
        if (!finished.runtime) {
          if (serveNow) {
            set({ contextUpdating: false, ingestProgress: null, sources: liveSources });
            return;
          }
          set({
            ...patchFromSpaceRuntime(space, {
              memberContextIds: space.memberContextIds,
              allSources: liveSources,
              pack: get().pack,
              chunks: get().chunks,
              vocab: get().vocab,
              openFile: get().openFile,
            }),
            contexts,
            contextStatus: "hydrating",
            contextUpdating: false,
            ingestProgress: null,
          });
          return;
        }
        const runtime = await indexSpace(repo, space.id, {
          isCancelled: () => epoch !== hydrationEpoch,
        });
        if (epoch !== hydrationEpoch || runtime.cancelled) return;
        set({
          contexts,
          ...patchFromSpaceRuntime(space, runtime),
          openFile: get().openDocument ? get().openFile : runtime.openFile,
          contextStatus: "ready",
          contextUpdating: false,
          ingestProgress: null,
          contextError: null,
          folderError: packWarning(runtime.weak, runtime.pack.files.length),
        });
      });
    } catch {
      if (epoch !== hydrationEpoch) return;
      set({
        contextStatus: "error",
        contextError: "Could not load that Knowledge Space.",
        contextUpdating: false,
      });
    }
  },
  activateContext: async (contextId) => {
    const repo = getContextRepository();
    const space = await resolveSpaceForActivation(repo, contextId);
    await get().activateSpace(space.id);
  },
  hydratePack: (pack) => {
    const runtime = runtimeFromPack(pack);
    searchEpoch += 1;
    set({
      pack: runtime.pack,
      chunks: runtime.chunks,
      vocab: runtime.vocab,
      openFile: runtime.openFile,
      ...applyCard(null, null),
      thread: null,
      folderError: packWarning(runtime.weak, runtime.pack.files.length),
      packNotice: null,
    });
  },
  playMeeting: () => {
    playTimeouts.splice(0).forEach((id) => window.clearTimeout(id));
    set({
      playing: true,
      liveDraft: "",
      utterances: [
        {
          id: "sys-0",
          at: Date.now(),
          speaker: "MeetHint",
          role: "system",
          text: "Design review armed. Questions search themselves — the Card is what you say.",
        },
      ],
      ...applyCard(null, null),
    });
    void get().startClaimAudit();
    const started = Date.now();
    for (const beat of DESIGN_REVIEW) {
      const id = window.setTimeout(() => {
        get().appendUtterance({
          at: started + beat.delayMs,
          speaker: beat.speaker,
          role: beat.role,
          text: beat.text,
        });
        if (beat.role === "them") {
          get().setTypedQuery(beat.text);
          if (looksLikeQuestion(beat.text)) {
            void get().search(extractQuestion(beat.text), { fast: true });
          }
        }
      }, beat.delayMs);
      playTimeouts.push(id);
    }
    const done = window.setTimeout(() => {
      set({ playing: false });
      void get().endClaimAudit();
    }, 9000);
    playTimeouts.push(done);
  },
  stopMeeting: () => {
    playTimeouts.splice(0).forEach((id) => window.clearTimeout(id));
    set({ playing: false });
    void get().endClaimAudit();
  },
  appendUtterance: (u) =>
    set((s) => {
      const text = u.role === "them" ? cleanCaption(u.text) : u.text;
      if (u.role === "them" && !text) return s;
      return {
        utterances: [...s.utterances, { ...u, text, id: u.id ?? `${u.at}-${s.utterances.length}` }],
      };
    }),
  heard: (event) => {
    const { id, role } = event;
    // Identity is the audio event, never the words. See transcript-events.ts.
    const outcome = applyHeard(get().utterances, event, Date.now());
    if (outcome.kind === "empty") return;
    set({ utterances: outcome.utterances, liveDraft: "" });
    if (outcome.kind === "appended" || outcome.kind === "rewritten") {
      const uttered = outcome.utterances.find((item) => item.id === id);
      if (uttered) void get().admitHeardClaim(uttered);
    }

    if (outcome.kind === "ignored") {
      if (role === "them") {
        recordGate({
          at: Date.now(),
          candidateId: id,
          candidate: outcome.text,
          context: [],
          verdict: "repeat-of-same-event",
          question: null,
          usedContext: false,
          lastHandledId: get().handledId,
          dedupe: "same-utterance-and-question",
          triggered: false,
        });
      }
      return;
    }

    // Only the other person's speech can open a question.
    if (role !== "them") return;

    const state = get();
    const them = state.utterances.filter((u) => u.role === "them");
    const newest = newestFrom(state.utterances);
    if (!newest) return;
    // Clips decode out of order, so an older event can be rewritten after a newer
    // one has landed. Only the newest line is ever a candidate; a late rewrite of
    // an earlier line updates the transcript without reopening the gate.
    if (newest.id !== id) return;
    // The newest utterance is the candidate; everything before it is context that
    // may interpret the candidate but may never trigger on its own.
    const context = them.slice(-CONTEXT_LINES - 1, -1).map((u) => u.text);
    const decision = gateNewest({ id: newest.id, text: newest.text }, context, gateFrom(state));

    // Identity is the utterance, not the words: the same question asked twice in
    // a meeting is two events and deserves two answers. Re-running the same
    // utterance happens when a longer transcription pass rewrites it in place,
    // and is only skipped when the resulting question is unchanged too.
    const repeat =
      state.handledId === decision.candidateId && state.heardQuestion === decision.question;
    const dedupe: GateRecord["dedupe"] = repeat
      ? "same-utterance-and-question"
      : isTyping()
        ? "suppressed-by-typing"
        : state.autoAnswer
          ? "fresh"
          : "auto-answer-off";
    const triggered = Boolean(decision.question) && dedupe === "fresh";

    recordGate({
      ...decision,
      at: Date.now(),
      lastHandledId: state.handledId,
      dedupe: decision.question ? dedupe : "fresh",
      triggered,
    });

    if (!decision.question || repeat) return;
    set({ heardQuestion: decision.question, handledId: decision.candidateId });
    if (isTyping()) return;
    set({ typedQuery: decision.question });
    if (state.autoAnswer && searchIsLive()) {
      void get().search(decision.question, { fast: true, resolved: decision.verdict === "follow-up" });
    }
  },
  clearThem: () =>
    set((s) => ({
      liveDraft: "",
      heardQuestion: null,
      handledId: null,
      thread: null,
      utterances: s.utterances.filter((u) => u.role !== "them"),
    })),
  lastWindow: (ms = 15000) => windowText(get().utterances, ms),
  loadFolder: async (list, options) => {
    const epoch = nextHydrationEpoch();
    searchEpoch += 1;
    set({
      loadingFolder: true,
      folderError: null,
      packNotice: null,
      contextStatus: "hydrating",
      contextError: null,
      hydrationEpoch: epoch,
      ...clearSessionOnSwitch(),
    });
    try {
      const { pack: raw, skipped, truncated, failed } = await packFromFiles(list, options);
      if (raw.files.length === 0) {
        if (epoch !== hydrationEpoch) return;
        set({
          loadingFolder: false,
          contextStatus: "ready",
          folderError: failed.length
            ? officeReadError(failed)
            : "No readable source files in that folder. Pick src or a service folder, not CI or dist.",
          packNotice: null,
        });
        return;
      }
      const repo = getContextRepository();
      const { context } = await persistPackAsContext(raw, repo);
      if (epoch !== hydrationEpoch) return;
      const space = await resolveSpaceForActivation(repo, context.id);
      const hydrated = await indexSpace(repo, space.id, {
        isCancelled: () => epoch !== hydrationEpoch,
      });
      if (epoch !== hydrationEpoch || hydrated.cancelled) return;
      persistActiveSpaceId(space.id);
      const contexts = await listStoredContexts();
      if (epoch !== hydrationEpoch) return;
      const sample = hydrated.pack.files
        .slice(0, 3)
        .map((f) => f.path)
        .join(", ");
      set({
        contexts,
        ...patchFromSpaceRuntime(space, hydrated),
        loadingFolder: false,
        contextStatus: "ready",
        contextUpdating: false,
        ingestProgress: null,
        contextError: null,
        ...noticesFromFolderLoad({
          failed,
          skipped,
          truncated,
          weak: hydrated.weak,
          fileCount: hydrated.pack.files.length,
        }),
      });
      get().appendUtterance({
        at: Date.now(),
        speaker: "MeetHint",
        role: "system",
        text: hydrated.weak
          ? `Loaded ${hydrated.pack.name}, but these look like CI files. Open the src folder, then Search.`
          : truncated
            ? truncationNotice(hydrated.pack.files.length)
            : `Loaded ${hydrated.pack.name} — ${hydrated.pack.files.length} files${skipped ? `, skipped ${skipped}` : ""}. ${sample ? `Keeping ${sample}. ` : ""}Share the call or type a question — the Card is what you say.`,
      });
    } catch {
      if (epoch !== hydrationEpoch) return;
      set({
        loadingFolder: false,
        contextStatus: "error",
        contextError: "Could not save that folder.",
        folderError: "Could not read that folder.",
        packNotice: null,
      });
    }
  },
  addPdfFiles: async (list) => {
    const files = [...list];
    if (files.length === 0) return;
    const repo = getContextRepository();
    const existingId = get().activeContextId;
    const existingSources = existingId ? await repo.listSources(existingId) : [];
    const preview = await planPdfBatch(files, existingSources);
    const rejectNote = preview.rejected.map((item) => `${item.path}: ${item.note}`).join(" ");

    if (preview.accepted.length === 0) {
      set({ folderError: rejectNote || "No PDF files could be added." });
      return;
    }

    let contextId = existingId;
    const created = !existingId;
    const hadSnapshot = Boolean(existingId) && canServeSnapshot(existingSources);
    if (!contextId) {
      const createdContext = await repo.createContext({ name: preview.contextName });
      contextId = createdContext.id;
    }
    const epoch = created ? nextHydrationEpoch() : get().hydrationEpoch;
    if (created) {
      searchEpoch += 1;
      persistActiveSpaceId(contextId);
      const contexts = await listStoredContexts();
      set({
        activeSpaceId: contextId,
        activeContextId: contextId,
        memberContextIds: [contextId],
        authorizedSourceIds: [],
        contexts,
        contextStatus: "hydrating",
        contextUpdating: false,
        contextError: null,
        folderError: rejectNote || null,
        hydrationEpoch: epoch,
        ...clearSessionOnSwitch(),
      });
    } else {
      set({
        contextUpdating: hadSnapshot,
        contextStatus: hadSnapshot ? "ready" : "hydrating",
        folderError: rejectNote || get().folderError,
      });
    }

    const targetId = contextId;
    try {
      const outcome = await withContextWrite(targetId, () =>
        addPdfFilesToContext(repo, files, targetId, {
          isCancelled: () => get().hydrationEpoch !== epoch,
          onProgress: (progress) => {
            if (get().activeContextId !== targetId) return;
            void repo.listSources(targetId).then((sources) => {
              if (get().activeContextId !== targetId) return;
              set({ ingestProgress: progress, sources, contextUpdating: hadSnapshot });
            });
          },
        }),
      );

      if (outcome.quotaFailed) {
        if (get().hydrationEpoch !== epoch && created) return;
        if (get().activeContextId && get().activeContextId !== targetId) return;
        set({
          folderError: "Could not save that PDF. Existing material is unchanged.",
          contextUpdating: false,
          ingestProgress: null,
          contextStatus: outcome.hadSnapshot ? "ready" : get().contextStatus,
        });
        return;
      }

      const finished = outcome.ingest;
      const contexts = await listStoredContexts();
      if (get().hydrationEpoch !== epoch) return;
      if (get().activeContextId && get().activeContextId !== targetId) return;

      if (!finished?.runtime) {
        set({
          activeContextId: targetId,
          sources: finished?.sources ?? [],
          contexts,
          contextUpdating: false,
          ingestProgress: null,
        });
        return;
      }

      const space = await resolveSpaceForActivation(repo, targetId);
      const runtime = await indexSpace(repo, space.id, {
        isCancelled: () => get().hydrationEpoch !== epoch,
      });
      if (get().hydrationEpoch !== epoch || runtime.cancelled) return;
      persistActiveSpaceId(space.id);
      set({
        contexts,
        ...patchFromSpaceRuntime(space, runtime),
        openFile: get().openDocument ? get().openFile : runtime.openFile,
        contextStatus: "ready",
        contextUpdating: false,
        ingestProgress: null,
        contextError: null,
        folderError: rejectNote || packWarning(runtime.weak, runtime.pack.files.length),
      });
    } catch {
      if (created && get().hydrationEpoch !== epoch) return;
      set({
        folderError: "Could not add those PDFs.",
        contextUpdating: false,
        ingestProgress: null,
        contextStatus: hadSnapshot ? "ready" : "error",
        contextError: hadSnapshot ? null : "Could not add those PDFs.",
      });
    }
  },
  resetForAccountChange: () => {
    playTimeouts.splice(0).forEach((id) => window.clearTimeout(id));
    searchEpoch += 1;
    const epoch = nextHydrationEpoch();
    persist({ card: null, armed: false, listening: false, searching: false });
    set({
      pack: NORTHSTAR,
      chunks: NORTHSTAR_CHUNKS,
      vocab: packVocabulary(NORTHSTAR_CHUNKS),
      contexts: [],
      activeSpaceId: null,
      activeContextId: null,
      memberContextIds: [],
      authorizedSourceIds: [],
      contextStatus: "ready",
      contextError: null,
      hydrationEpoch: epoch,
      sources: [],
      contextUpdating: false,
      armed: false,
      listening: false,
      playing: false,
      searching: false,
      refining: false,
      loadingFolder: false,
      hearLevel: 0,
      asrStatus: "off",
      asrNote: "",
      listenError: null,
      listenBlocked: null,
      folderError: null,
      packNotice: null,
      currentMeeting: null,
      meetingHistory: [],
      selectedClaimId: null,
      claimReport: null,
      auditOpen: false,
      utterances: [],
      sharingCall: false,
      extractRemaining: EXTRACT_DAILY_LIMIT,
      subscription: "free",
      selectedModelId: getDefaultModel().id,
      ...clearSessionOnSwitch(),
      openFile: "src/exporter/retry.ts",
    });
  },
  setPackExclusions: async (patterns) => {
    const next = normalizeExcludePatterns(patterns);
    const state = get();
    const previous = state.pack.excludePatterns ?? [];
    const restored = previous.some((pattern) => !next.includes(pattern));
    const nextPack = { ...state.pack, excludePatterns: next.length ? next : undefined };
    // One save: drop matching chunks, delete their vectors, persist the pack.
    const purged = await dropExcludedEvidence(state.chunks, next, getVectorStore());
    set({
      pack: nextPack,
      chunks: purged.chunks,
      vocab: packVocabulary(purged.chunks),
    });
    const spaceId = state.activeSpaceId ?? state.activeContextId;
    if (!spaceId) return;
    const epoch = nextHydrationEpoch();
    try {
      await withContextWrite(state.activeContextId ?? spaceId, async () => {
        const repo = getContextRepository();
        const space = await repo.getSpace(spaceId);
        if (!space) return;
        for (const memberId of space.memberContextIds) {
          await repo.patchContext(memberId, { excludePatterns: nextPack.excludePatterns });
        }
        const excludedIds = state.sources
          .filter((source) => pathExcluded(source.path, next))
          .map((source) => source.id);
        if (excludedIds.length > 0) {
          for (const memberId of space.memberContextIds) {
            await repo.deleteIndexed(memberId, excludedIds);
          }
        }
        if (!restored) {
          const contexts = await listStoredContexts();
          if (epoch !== hydrationEpoch) return;
          set({ contexts });
          return;
        }
        const runtime = await indexSpace(repo, space.id, {
          isCancelled: () => epoch !== hydrationEpoch,
        });
        if (epoch !== hydrationEpoch || runtime.cancelled) return;
        const contexts = await listStoredContexts();
        if (epoch !== hydrationEpoch) return;
        set({
          contexts,
          ...patchFromSpaceRuntime(space, runtime),
        });
      });
    } catch {
      if (epoch !== hydrationEpoch) return;
      set({ folderError: "Could not update pack exclusions." });
    }
  },
  togglePackExclusion: async (path) => {
    await get().setPackExclusions(toggleExcludePath(get().pack.excludePatterns, path));
  },
  resetPack: () => {
    const epoch = nextHydrationEpoch();
    searchEpoch += 1;
    persistActiveSpaceId(null);
    set({
      pack: NORTHSTAR,
      chunks: NORTHSTAR_CHUNKS,
      vocab: packVocabulary(NORTHSTAR_CHUNKS),
      sources: [],
      activeSpaceId: null,
      activeContextId: null,
      memberContextIds: [],
      authorizedSourceIds: [],
      contextStatus: "ready",
      contextUpdating: false,
      contextError: null,
      hydrationEpoch: epoch,
      folderError: null,
      packNotice: null,
      ...clearSessionOnSwitch(),
      openFile: "src/exporter/retry.ts",
    });
  },
  dismissPackNotice: () => set({ packNotice: null }),
  openAudit: async () => {
    if (get().subscription === "free") {
      set({ upgradeFeature: "audit" });
      return;
    }
    await get().startClaimAudit();
    set({ auditOpen: true });
  },
  startClaimAudit: async () => {
    const state = get();
    if (state.subscription === "free") return;
    const live = state.currentMeeting;
    if (live && live.endedAt == null) return;
    const startedAt = Date.now();
    const meeting = newMeetingRecord(meetingTitle(get().pack, startedAt), startedAt);
    set({ currentMeeting: meeting, selectedClaimId: null, claimReport: null });
    try {
      await getMeetingRepository().put(meeting);
      set({ meetingHistory: await getMeetingRepository().listPast(meeting.id) });
    } catch {
      /* Dexie unavailable — monitor still tracks this session in memory */
    }
  },
  admitHeardClaim: async (utterance) => {
    if (utterance.role === "system") return;
    const live = get().currentMeeting;
    if (!live || live.endedAt != null) await get().startClaimAudit();
    const meeting = get().currentMeeting;
    if (!meeting || meeting.endedAt != null) return;

    if (!isClaimLine(utterance.text)) {
      if (!meeting.claims.some((claim) => claim.id === utterance.id)) return;
      const next = { ...meeting, claims: meeting.claims.filter((claim) => claim.id !== utterance.id), utterances: get().utterances };
      set({ currentMeeting: next });
      await persistMeeting(next).catch(() => undefined);
      return;
    }

    const admitted = claimAdmit(utterance.text, get().pack, get().chunks);
    const drafted = {
      ...newClaim({
        meetingId: meeting.id,
        speaker: utterance.speaker,
        text: utterance.text,
        timestamp: utterance.at,
      }),
      id: utterance.id,
      status: admitted.status,
      evidence: admitted.evidence,
    };
    const claim =
      canDetectContradictions(get().subscription)
        ? detectContradictions(drafted, get().meetingHistory) ?? drafted
        : drafted;
    const claims = [...meeting.claims.filter((item) => item.id !== utterance.id), claim];
    const next = { ...meeting, claims, utterances: get().utterances };
    set({ currentMeeting: next });
    await persistMeeting(next).catch(() => undefined);
  },
  endClaimAudit: async () => {
    const meeting = get().currentMeeting;
    if (!meeting || meeting.endedAt != null) return;
    try {
      const finished = await finishMeeting(
        meeting,
        get().utterances,
        get().subscription,
        get().answerHistory,
      );
      if (get().currentMeeting?.id !== meeting.id) return;
      set({
        currentMeeting: finished.meeting,
        claimReport: finished.report,
        meetingHistory: finished.history,
      });
    } catch {
      set({
        currentMeeting: {
          ...meeting,
          endedAt: Date.now(),
          utterances: get().utterances,
          answerHistory: get().answerHistory,
        },
      });
    }
  },
  selectAuditClaim: (id) => set({ selectedClaimId: id }),
  closeClaimAudit: () => {
    const meeting = get().currentMeeting;
    if (meeting && meeting.endedAt == null) {
      set({ auditOpen: false, selectedClaimId: null });
      return;
    }
    set({ currentMeeting: null, selectedClaimId: null, claimReport: null, auditOpen: false });
  },
  exportClaimReport: () => {
    const meeting = get().currentMeeting;
    const report = get().claimReport;
    if (!meeting || !report) return;
    saveClaimReport(report, reportFilename(meeting));
  },
  restoreAnswer: (id) => {
    const state = get();
    const item = findHistoryItem(
      id,
      state.answerHistory,
      state.currentMeeting?.answerHistory,
      ...state.meetingHistory.map((meeting) => meeting.answerHistory),
    );
    if (!item) return;
    const card = cardFromHistory(item);
    set((s) => ({
      ...applyCard(card, s.openDocument),
      typedQuery: item.query,
      heardQuestion: item.query,
      openFile: firstCitedPath(card) ?? s.openFile,
    }));
  },
  reviewMeeting: async (id) => {
    const state = get();
    let meeting =
      state.currentMeeting?.id === id
        ? state.currentMeeting
        : (state.meetingHistory.find((row) => row.id === id) ?? null);
    if (!meeting) {
      try {
        meeting = await getMeetingRepository().get(id);
      } catch {
        meeting = null;
      }
    }
    if (!meeting) return;
    const live = get().currentMeeting;
    if (live && live.endedAt == null && live.id !== meeting.id) {
      set({ auditOpen: true });
      return;
    }
    const history = meeting.answerHistory ?? [];
    const latest = history[0];
    set((s) => ({
      currentMeeting: meeting,
      answerHistory: history.length ? history : s.answerHistory,
      auditOpen: true,
      selectedClaimId: null,
      claimReport: null,
      ...(latest ? applyCard(cardFromHistory(latest), s.openDocument) : {}),
    }));
  },
  search: async (explicit, opts) => {
    const state = get();
    if (state.contextStatus !== "ready") return;
    const typed = state.typedQuery.trim();
    const fromRoom = liveQuestionFromTranscript(
      state.utterances
        .filter((u) => u.role === "them")
        .slice(-8)
        .map((u) => u.text)
        .join(" "),
      gateFrom(state),
    );
    const demo = state.pack.id === "northstar-payments";
    const query = (explicit ?? (typed || fromRoom || (demo && !state.armed ? HERO_QUERY : ""))).trim();
    if (!query) {
      set({
        ...applyCard(
          {
            say: null,
            reason: "No question in the transcript yet. Ask about this repo — or type it.",
            citations: [],
            query: "",
            latencyMs: 0,
            source: "local",
          },
          null,
        ),
      });
      return;
    }
    if (state.subscription === "free" && extractExhausted()) {
      set({
        extractRemaining: 0,
        upgradeFeature: "extract-limit",
        ...applyCard(
          {
            say: null,
            reason: "You've reached your daily limit. Upgrade to Pro for unlimited cited answers and Claim Audit.",
            citations: [],
            query,
            latencyMs: 0,
            source: "local",
          },
          get().openDocument,
        ),
      });
      return;
    }
    const epoch = ++searchEpoch;
    const t0 = performance.now();
    const canonical = normalizeSpokenQuestion(query).canonical;
    const resolved = Boolean(opts?.resolved);
    const previousQuestion = previousRetrievalQuestion(state.answerHistory.map((item) => item.query));
    set({ searching: true, refining: false, typedQuery: explicit ?? get().typedQuery });
    const workspaceId = currentWorkspaceId() ?? defaultWorkspaceId();
    const contextId = state.activeContextId ?? state.pack.id;
    const spaceId = state.activeSpaceId ?? contextId;
    const material = buildSpaceMaterialView({
      workspaceId,
      spaceId,
      primaryContextId: contextId,
      memberContextIds: state.memberContextIds.length ? state.memberContextIds : [contextId],
      pack: state.pack,
      sources: state.sources,
    });
    const cardContext: LocalCardContext = { material };
    const hits = await runSpaceScopedRetrieval({
      query: canonical,
      previousQuestion,
      chunks: state.chunks,
      pack: state.pack,
      spaceState: state,
      workspaceId,
      vectorStore: getVectorStore(),
      limit: 6,
    });
    const retrieveMs = Math.round(performance.now() - t0);
    if (epoch !== searchEpoch) return;

    const finish = (card: Card, remaining = get().extractRemaining) => {
      set((s) => {
        const telemetry = telemetryFromCard(card);
        const answerHistory = appendAnswerHistory(s.answerHistory, card, {
          workspaceId,
          contextId: get().activeContextId ?? state.pack.id,
          spaceId: get().activeSpaceId ?? spaceId,
          sourceIds: telemetry.sourceIds,
          evidenceCount: telemetry.evidenceCount,
        });
        const currentMeeting =
          s.currentMeeting && s.currentMeeting.endedAt == null
            ? { ...s.currentMeeting, answerHistory }
            : s.currentMeeting;
        return {
          searching: false,
          refining: false,
          extractRemaining: remaining,
          ...applyCard(card, s.openDocument),
          openFile: firstCitedPath(card) ?? s.openFile,
          answerHistory,
          currentMeeting,
          thread: nextThread(s.thread, { query, canonical, card, pack: s.pack, resolved }),
        };
      });
      persist({
        card,
        armed: get().armed,
        listening: get().listening,
        searching: false,
      });
    };

    const threadHistory = state.answerHistory.map((item) => item.query).filter(Boolean);
    const routed = await routeSearchAnswer(query, hits, t0, {
      pack: state.pack,
      material,
      cardContext,
      modelId: get().selectedModelId,
      maxTokens: SYNTHESIZE_MAX_TOKENS,
      threadHistory,
      retrieveMs,
    });
    if (epoch !== searchEpoch) return;
    if (routed.consumeQuota && get().subscription === "free") consumeExtractQuestion();
    const remaining = extractRemaining();
    const gate = gateRecords().at(-1);
    const flightTelemetry = telemetryFromCard(routed.card);
    const answerId = recordAnswerFlight({
      query,
      contextId: get().activeContextId ?? state.pack.id,
      spaceId: get().activeSpaceId ?? spaceId,
      sourceIds: flightTelemetry.sourceIds,
      evidenceCount: flightTelemetry.evidenceCount,
      workspaceId,
      transcript: transcriptLanes(get().utterances),
      gate: gate
        ? { verdict: gate.verdict, question: gate.question, triggered: gate.triggered }
        : null,
      retrieval: formatFlightRetrievalSummary(state.chunks, hits, state.pack.excludePatterns),
      tier: routed.tier,
      latency: routed.latency,
      say: routed.card.say,
      reason: routed.card.reason ?? null,
      citations: routed.card.citations,
      quotaRemaining: remaining,
    });
    finish(
      {
        ...routed.card,
        answerId: answerId ?? undefined,
        flightTier: routed.tier,
        flightLatencyMs: routed.latency.totalMs,
      },
      remaining,
    );
  },
}));

/** Apply localStorage prefs after hydration so SSR and the first client paint match. */
export function hydrateClientPrefs() {
  useMeetHint.setState({
    subscription: readSubscription(),
    selectedModelId: readSelectedModelId(),
    extractRemaining: extractRemaining(),
  });
}

if (typeof window !== "undefined") {
  window.useMeetHint = useMeetHint as unknown as Window["useMeetHint"];
  window.__meethintSwitchAccount = async (accountId) => {
    const { switchAccount } = await import("@/lib/auth/account-session");
    await switchAccount(accountId);
  };
}

export function readRelaySession(): SessionWire | null {
  try {
    const raw = readSessionRaw();
    if (!raw) return null;
    return JSON.parse(raw) as SessionWire;
  } catch {
    return null;
  }
}
