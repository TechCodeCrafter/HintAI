import { create } from "zustand";
import { NORTHSTAR } from "@/lib/repo/northstar";
import type { Card, Chunk, HeardEvent, Hit, RepoPack, Utterance } from "@/lib/repo/types";
import { packFromFiles, preferredOpenFile, prunePack } from "@/lib/repo/folder";
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

const SESSION_KEY = "ground.session";
const PACK_KEY = "ground.pack";
const HERO_QUERY = "Why does that retry three times?";

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

function persistPack(pack: RepoPack) {
  try {
    localStorage.setItem(PACK_KEY, JSON.stringify(pack));
  } catch {
    /* ignore quota */
  }
}

export function readSavedPack(): RepoPack | null {
  try {
    const raw = localStorage.getItem(PACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RepoPack;
    if (!parsed?.id || !Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

type GroundState = {
  pack: RepoPack;
  chunks: Chunk[];
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
  setLiveDraft: (text: string, role?: "them" | "you") => void;
  setHearLevel: (level: number) => void;
  setAsrStatus: (status: GroundState["asrStatus"]) => void;
  setAsrNote: (note: string) => void;
  setListenError: (text: string | null, blocked?: GroundState["listenBlocked"]) => void;
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
  resetPack: () => void;
};

const playTimeouts: number[] = [];
let searchEpoch = 0;

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
  return hits.map((h) => ({
    kind: h.kind,
    path: h.path,
    startLine: h.startLine,
    text: h.text,
    sha: h.sha,
    pr: h.pr,
    author: h.author,
    message: h.message,
  }));
}

const NORTHSTAR_CHUNKS = buildChunks(NORTHSTAR);

export const useGround = create<GroundState>((set, get) => ({
  pack: NORTHSTAR,
  chunks: NORTHSTAR_CHUNKS,
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
  setOpenFile: (path) => set({ openFile: path }),
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
  hydratePack: (pack) => {
    const { pack: next, weak } = prunePack(pack);
    const use = next.files.length > 0 ? next : pack;
    persistPack(use);
    const chunks = buildChunks(use);
    set({
      pack: use,
      chunks,
      vocab: packVocabulary(chunks),
      openFile: preferredOpenFile(use) ?? use.files[0]?.path ?? null,
      card: null,
      // Different material, so nothing a pointer could still be pointing at.
      thread: null,
      folderError: weak
        ? "This pack is mostly CI/config. Open the src folder, not the repo root."
        : null,
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
      card: null,
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
    if (state.autoAnswer) {
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
    set({ loadingFolder: true, folderError: null });
    try {
      const { pack: raw, skipped } = await packFromFiles(list);
      const { pack, weak } = prunePack(raw);
      if (pack.files.length === 0) {
        set({
          loadingFolder: false,
          folderError: "No readable source files in that folder. Pick src or a service folder, not CI or dist.",
        });
        return;
      }
      persistPack(pack);
      const sample = pack.files
        .slice(0, 3)
        .map((f) => f.path)
        .join(", ");
      const chunks = buildChunks(pack);
      set({
        pack,
        chunks,
        vocab: packVocabulary(chunks),
        loadingFolder: false,
        openFile: preferredOpenFile(pack) ?? pack.files[0]?.path ?? null,
        card: null,
        thread: null,
        folderError: weak
          ? "This pack is mostly CI/config. Open the src folder, not the repo root."
          : null,
      });
      get().appendUtterance({
        at: Date.now(),
        speaker: "MeetHint",
        role: "system",
        text: weak
          ? `Loaded ${pack.name}, but these look like CI files. Open the src folder, then Search.`
          : `Loaded ${pack.name} — ${pack.files.length} files${skipped ? `, skipped ${skipped}` : ""}. ${sample ? `Keeping ${sample}. ` : ""}Share the call or type a question — the Card is what you say.`,
      });
    } catch {
      set({ loadingFolder: false, folderError: "Could not read that folder." });
    }
  },
  resetPack: () => {
    try {
      localStorage.removeItem(PACK_KEY);
    } catch {
      /* ignore */
    }
    set({
      pack: NORTHSTAR,
      chunks: NORTHSTAR_CHUNKS,
      vocab: packVocabulary(NORTHSTAR_CHUNKS),
      openFile: "src/exporter/retry.ts",
      card: null,
      thread: null,
      folderError: null,
    });
  },
  search: async (explicit, opts) => {
    const state = get();
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
        card: {
          say: null,
          reason: "No question in the transcript yet. Ask about this repo — or type it.",
          citations: [],
          query: "",
          latencyMs: 0,
          source: "local",
        },
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
    const composed = localCard(query, hits, state.pack, Math.round(performance.now() - t0), state.openFile);
    const resolved = Boolean(opts?.resolved);
    const fallback = withdrawReplay(composed, state.thread, resolved);
    set((s) => ({
      searching: false,
      refining: !fast,
      typedQuery: explicit ?? s.typedQuery,
      card: fallback,
      openFile: fallback.citations[0]?.path ?? s.openFile,
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
          card,
          openFile: card.citations[0]?.path ?? s.openFile,
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
