import { create } from "zustand";
import type { ContextRecord, ContextRuntimeStatus, StoredSource } from "@/lib/context/types";
import { isPdfSource } from "@/lib/context/types";
import { indexContext } from "@/lib/context/chunk-index";
import { runtimeFromPack } from "@/lib/context/hydrate";
import { pdfWorkPending } from "@/lib/context/source-write";
import { addPdfFilesToContext, planPdfBatch } from "@/lib/document/pdf/add-files";
import { canServeSnapshot, resumePdfWork, type IngestProgress } from "@/lib/document/pdf/ingest-flow";
import {
  migrateLegacyPack,
  persistActiveContextId,
  readActiveContextId,
  readSavedPack,
} from "@/lib/context/migration";
import { getContextRepository, listStoredContexts, persistPackAsContext } from "@/lib/context/service";
import type { NormalizedDocument } from "@/lib/document/types";
import { evidenceForOpenTarget, resolveDocumentOpen } from "@/lib/document/viewer/resolve";
import { syncViewerBlobPins } from "@/lib/document/viewer/retain";
import type { DocumentOpenTarget } from "@/lib/document/viewer/types";
import { NORTHSTAR } from "@/lib/repo/northstar";
import type { Card, DocumentCitation, HeardEvent, Hit, IndexedChunk, RepoPack, Utterance } from "@/lib/repo/types";
import { isDocumentHit } from "@/lib/repo/types";
import { refinePayload, shouldRefine } from "@/lib/search/refine-payload";
import { packFromFiles } from "@/lib/repo/folder";
import { DESIGN_REVIEW } from "@/lib/meeting/script";
import { localCard } from "@/lib/search/local-card";
import type { Gate } from "@/lib/search/question";
import { applyHeard, newestFrom } from "@/lib/listen/transcript-events";
import { type GateRecord, recordGate } from "@/lib/search/gate-log";
import {
  cleanCaption,
  extractQuestion,
  gateNewest,
  liveQuestionFromTranscript,
  looksLikeQuestion,
} from "@/lib/search/question";
import { buildChunks, packVocabulary, retrieve } from "@/lib/search/retrieve";
import { shapeOf } from "@/lib/search/intent";
import { contentWords, normalizeSpokenQuestion } from "@/lib/search/spoken";
import { subjectTerms } from "@/lib/search/subject";
import { threadAlive, threadFrom, withdrawReplay, type ThreadContext } from "@/lib/search/thread";

export { readSavedPack };

const SESSION_KEY = "ground.session";
const HERO_QUERY = "Why does that retry three times?";
const WEAK_PACK = "This pack is mostly CI/config. Open the src folder, not the repo root.";

function packWarning(weak: boolean, files: number): string | null {
  return weak && files > 0 ? WEAK_PACK : null;
}

type SessionWire = {
  card: Card | null;
  armed: boolean;
  listening: boolean;
  searching: boolean;
};

function persist(partial: SessionWire) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(partial));
  } catch {
    /* ignore quota */
  }
}

type GroundState = {
  pack: RepoPack;
  chunks: IndexedChunk[];
  contexts: ContextRecord[];
  activeContextId: string | null;
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
  utterances: Utterance[];
  typedQuery: string;
  heardQuestion: string | null;
  /** The utterance whose question was last acted on, so a re-ask is a new event. */
  handledId: string | null;
  card: Card | null;
  openFile: string | null;
  openDocument: DocumentOpenTarget | null;
  openPdfSource: (sourceId: string) => void;
  ledger: Array<{ query: string; say: string | null; at: number }>;
  /** Structured context for the open thread. See thread.ts. */
  thread: ThreadContext | null;
  arm: () => void;
  disarm: () => void;
  setOverlay: (value: boolean) => void;
  setAutoAnswer: (value: boolean) => void;
  setSharingCall: (value: boolean) => void;
  setTypedQuery: (q: string) => void;
  setHeardQuestion: (q: string | null) => void;
  setOpenFile: (path: string | null) => void;
  setOpenDocument: (target: DocumentOpenTarget | null) => void;
  openDocumentCitation: (cite: DocumentCitation) => void;
  setLiveDraft: (text: string, role?: "them" | "you") => void;
  setHearLevel: (level: number) => void;
  setAsrStatus: (status: GroundState["asrStatus"]) => void;
  setAsrNote: (note: string) => void;
  setListenError: (text: string | null, blocked?: GroundState["listenBlocked"]) => void;
  boot: () => Promise<void>;
  activateContext: (id: string) => Promise<void>;
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
  loadFolder: (list: FileList | File[]) => Promise<void>;
  addPdfFiles: (list: FileList | File[]) => Promise<void>;
  resetPack: () => void;
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
  return useGround.getState().contextStatus === "ready";
}

function clearSessionOnSwitch(): Pick<
  GroundState,
  | "thread"
  | "card"
  | "ledger"
  | "heardQuestion"
  | "handledId"
  | "openFile"
  | "openDocument"
  | "liveDraft"
  | "ingestProgress"
> {
  syncViewerBlobPins(null, null);
  return {
    thread: null,
    card: null,
    ledger: [],
    heardQuestion: null,
    handledId: null,
    openFile: null,
    openDocument: null,
    liveDraft: "",
    ingestProgress: null,
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

async function documentsForHits(hits: Hit[]): Promise<Map<string, NormalizedDocument>> {
  const documents = new Map<string, NormalizedDocument>();
  if (!hits.some(isDocumentHit)) return documents;
  const repo = getContextRepository();
  for (const hit of hits) {
    if (!isDocumentHit(hit) || documents.has(hit.sourceId)) continue;
    const document = await repo.getNormalizedDocument(hit.sourceId, hit.contentHash);
    if (document) documents.set(hit.sourceId, document);
  }
  return documents;
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
function gateFrom(state: Pick<GroundState, "vocab" | "ledger" | "thread">): Gate {
  const recent = state.ledger[0];
  const alive = threadAlive(state.thread, THREAD_MS);
  return {
    vocab: state.vocab,
    threadOpen: Boolean(recent?.say) && Date.now() - (recent?.at ?? 0) < THREAD_MS && alive,
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

function hitPayload(hits: Hit[]) {
  return refinePayload(hits);
}

const NORTHSTAR_CHUNKS = buildChunks(NORTHSTAR);

export const useGround = create<GroundState>((set, get) => ({
  pack: NORTHSTAR,
  chunks: NORTHSTAR_CHUNKS,
  contexts: [],
  activeContextId: null,
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
  utterances: [],
  typedQuery: "",
  heardQuestion: null,
  handledId: null,
  card: null,
  openFile: "src/exporter/retry.ts",
  openDocument: null,
  ledger: [],
  thread: null,
  arm: () => {
    playTimeouts.splice(0).forEach((id) => window.clearTimeout(id));
    set({ armed: true, listening: true, playing: false, listenError: null, listenBlocked: null });
    persist({ card: get().card, armed: true, listening: true, searching: false });
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
  },
  setOverlay: (value) => set({ overlay: value }),
  setAutoAnswer: (value) => set({ autoAnswer: value }),
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
  boot: async () => {
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
      const remembered = readActiveContextId();
      const target =
        contexts.find((item) => item.id === remembered) ??
        (migration.kind === "migrated" ? migration.context : null) ??
        contexts[0] ??
        null;
      if (!target) {
        persistActiveContextId(null);
        set({
          activeContextId: null,
          contextStatus: "ready",
          contextError: null,
        });
        return;
      }
      await get().activateContext(target.id);
    } catch {
      if (epoch !== hydrationEpoch) return;
      set({
        contextStatus: "error",
        contextError: "Could not open saved contexts.",
      });
    }
  },
  activateContext: async (id) => {
    const epoch = nextHydrationEpoch();
    searchEpoch += 1;
    set({
      contextStatus: "hydrating",
      contextError: null,
      contextUpdating: false,
      hydrationEpoch: epoch,
      ...clearSessionOnSwitch(),
    });
    persist({ card: null, armed: get().armed, listening: get().listening, searching: false });
    try {
      await withContextWrite(id, async () => {
        const repo = getContextRepository();
        const sources = await repo.listSources(id);
        if (epoch !== hydrationEpoch) return;
        const serveNow = canServeSnapshot(sources);
        const pending = pdfWorkPending(sources);

        if (serveNow) {
          const runtime = await indexContext(repo, id, {
            isCancelled: () => epoch !== hydrationEpoch,
          });
          if (epoch !== hydrationEpoch || runtime.cancelled) return;
          persistActiveContextId(id);
          const contexts = await listStoredContexts();
          if (epoch !== hydrationEpoch) return;
          set({
            activeContextId: id,
            contexts,
            sources,
            pack: runtime.pack,
            chunks: runtime.chunks,
            vocab: runtime.vocab,
            openFile: runtime.openFile,
            contextStatus: "ready",
            contextUpdating: pending,
            contextError: null,
            folderError: packWarning(runtime.weak, runtime.pack.files.length),
          });
          if (!pending) return;
        }

        const finished = await resumePdfWork(repo, id, {
          isCancelled: () => epoch !== hydrationEpoch,
          onProgress: (progress) => {
            if (epoch !== hydrationEpoch || get().activeContextId !== id) return;
            set({ ingestProgress: progress, contextUpdating: serveNow, sources: get().sources });
          },
        });
        if (epoch !== hydrationEpoch) return;
        persistActiveContextId(id);
        const contexts = await listStoredContexts();
        const liveSources = finished.sources;
        if (epoch !== hydrationEpoch) return;
        if (!finished.runtime) {
          if (serveNow) {
            set({ contextUpdating: false, ingestProgress: null, sources: liveSources });
            return;
          }
          set({
            activeContextId: id,
            contexts,
            sources: liveSources,
            contextStatus: "hydrating",
            contextUpdating: false,
            ingestProgress: null,
          });
          return;
        }
        set({
          activeContextId: id,
          contexts,
          sources: liveSources,
          pack: finished.runtime.pack,
          chunks: finished.runtime.chunks,
          vocab: finished.runtime.vocab,
          openFile: get().openDocument ? get().openFile : finished.runtime.openFile,
          contextStatus: "ready",
          contextUpdating: false,
          ingestProgress: null,
          contextError: null,
          folderError: packWarning(finished.runtime.weak, finished.runtime.pack.files.length),
        });
      });
    } catch {
      if (epoch !== hydrationEpoch) return;
      set({
        contextStatus: "error",
        contextError: "Could not load that context.",
        contextUpdating: false,
      });
    }
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
    const done = window.setTimeout(() => set({ playing: false }), 9000);
    playTimeouts.push(done);
  },
  stopMeeting: () => {
    playTimeouts.splice(0).forEach((id) => window.clearTimeout(id));
    set({ playing: false });
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
  loadFolder: async (list) => {
    const epoch = nextHydrationEpoch();
    searchEpoch += 1;
    set({
      loadingFolder: true,
      folderError: null,
      contextStatus: "hydrating",
      contextError: null,
      hydrationEpoch: epoch,
      ...clearSessionOnSwitch(),
    });
    try {
      const { pack: raw, skipped } = await packFromFiles(list);
      if (raw.files.length === 0) {
        if (epoch !== hydrationEpoch) return;
        set({
          loadingFolder: false,
          contextStatus: "ready",
          folderError: "No readable source files in that folder. Pick src or a service folder, not CI or dist.",
        });
        return;
      }
      const { context } = await persistPackAsContext(raw);
      if (epoch !== hydrationEpoch) return;
      const hydrated = await indexContext(getContextRepository(), context.id, {
        isCancelled: () => epoch !== hydrationEpoch,
      });
      if (epoch !== hydrationEpoch || hydrated.cancelled) return;
      persistActiveContextId(context.id);
      const contexts = await listStoredContexts();
      const sources = await getContextRepository().listSources(context.id);
      if (epoch !== hydrationEpoch) return;
      const sample = hydrated.pack.files
        .slice(0, 3)
        .map((f) => f.path)
        .join(", ");
      set({
        contexts,
        activeContextId: context.id,
        sources,
        pack: hydrated.pack,
        chunks: hydrated.chunks,
        vocab: hydrated.vocab,
        loadingFolder: false,
        openFile: hydrated.openFile,
        contextStatus: "ready",
        contextUpdating: false,
        ingestProgress: null,
        contextError: null,
        folderError: hydrated.weak ? WEAK_PACK : null,
      });
      get().appendUtterance({
        at: Date.now(),
        speaker: "MeetHint",
        role: "system",
        text: hydrated.weak
          ? `Loaded ${hydrated.pack.name}, but these look like CI files. Open the src folder, then Search.`
          : `Loaded ${hydrated.pack.name} — ${hydrated.pack.files.length} files${skipped ? `, skipped ${skipped}` : ""}. ${sample ? `Keeping ${sample}. ` : ""}Share the call or type a question — the Card is what you say.`,
      });
    } catch {
      if (epoch !== hydrationEpoch) return;
      set({
        loadingFolder: false,
        contextStatus: "error",
        contextError: "Could not save that folder.",
        folderError: "Could not read that folder.",
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
      persistActiveContextId(contextId);
      const contexts = await listStoredContexts();
      set({
        activeContextId: contextId,
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

      persistActiveContextId(targetId);
      set({
        activeContextId: targetId,
        contexts,
        sources: finished.sources,
        pack: finished.runtime.pack,
        chunks: finished.runtime.chunks,
        vocab: finished.runtime.vocab,
        openFile: get().openDocument ? get().openFile : finished.runtime.openFile,
        contextStatus: "ready",
        contextUpdating: false,
        ingestProgress: null,
        contextError: null,
        folderError: rejectNote || packWarning(finished.runtime.weak, finished.runtime.pack.files.length),
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
  resetPack: () => {
    const epoch = nextHydrationEpoch();
    searchEpoch += 1;
    persistActiveContextId(null);
    set({
      pack: NORTHSTAR,
      chunks: NORTHSTAR_CHUNKS,
      vocab: packVocabulary(NORTHSTAR_CHUNKS),
      sources: [],
      activeContextId: null,
      contextStatus: "ready",
      contextUpdating: false,
      contextError: null,
      hydrationEpoch: epoch,
      folderError: null,
      ...clearSessionOnSwitch(),
      openFile: "src/exporter/retry.ts",
    });
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
    const fast = Boolean(opts?.fast);
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
    const epoch = ++searchEpoch;
    const t0 = performance.now();
    // Retrieval reads the question with its conversational framing removed; the
    // Card is still given the raw utterance, so what the room sees is what the
    // room said.
    const canonical = normalizeSpokenQuestion(query).canonical;
    const hits = retrieve(canonical, state.chunks);
    const documents = await documentsForHits(hits);
    const composed = localCard(query, hits, state.pack, Math.round(performance.now() - t0), state.openFile, {
      document: (sourceId) => documents.get(sourceId),
    });
    const resolved = Boolean(opts?.resolved);
    const fallback = withdrawReplay(composed, state.thread, resolved);
    set((s) => ({
      searching: false,
      refining: !fast,
      typedQuery: explicit ?? s.typedQuery,
      ...applyCard(fallback, s.openDocument),
      openFile: firstCitedPath(fallback) ?? s.openFile,
      ledger: [{ query, say: fallback.say, at: Date.now() }, ...s.ledger].slice(0, 12),
      thread: nextThread(s.thread, { query, canonical, card: fallback, pack: s.pack, resolved }),
    }));
    persist({
      card: fallback,
      armed: get().armed,
      listening: get().listening,
      searching: false,
    });

    if (fast) return;
    if (!shouldRefine(hits, fallback)) {
      set({ refining: false });
      return;
    }

    void (async () => {
      try {
        const { craftCard } = await import("@/lib/ai/cardsmith");
        const remote = await Promise.race([
          craftCard({ data: { query, hits: hitPayload(hits) } }),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error("timeout")), 4000);
          }),
        ]);
        if (epoch !== searchEpoch) return;
        if (!remote.say) return;
        const latencyMs = Math.round(performance.now() - t0);
        const card: Card = { ...remote, query, latencyMs };
        set((s) => ({
          ...applyCard(card, s.openDocument),
          openFile: firstCitedPath(card) ?? s.openFile,
          ledger: [{ query, say: card.say, at: Date.now() }, ...s.ledger.slice(1)].slice(0, 12),
          // The thread tracks what was actually said, so the replay guard
          // compares against this line and not the local draft it replaced.
          thread: nextThread(s.thread, { query, canonical, card, pack: s.pack, resolved }),
        }));
        persist({
          card,
          armed: get().armed,
          listening: get().listening,
          searching: false,
        });
      } catch {
        /* keep the grounded local card */
      } finally {
        if (epoch === searchEpoch) set({ refining: false });
      }
    })();
  },
}));

export function readRelaySession(): SessionWire | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionWire;
  } catch {
    return null;
  }
}
