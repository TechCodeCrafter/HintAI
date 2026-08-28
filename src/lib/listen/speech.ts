import { useEffect } from "react";
import { markSpeechLive, roleForLane, stopCallShare } from "@/lib/listen/call-share";
import { cleanCaption } from "@/lib/search/question";
import { useGround } from "@/lib/store";

type RecResult = { isFinal: boolean; 0?: { transcript: string } };
type RecEvent = { resultIndex: number; results: ArrayLike<RecResult> };
type RecError = { error?: string };

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((ev: RecEvent) => void) | null;
  onerror: ((ev: RecError) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionCtor = new () => Recognition;

export type ListenBlock = "iframe" | "denied" | "missing" | "speech";

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return recognitionCtor() !== null;
}

/** Chrome/Edge only. Brave exposes the API then fails with network. */
export function liveCaptionsOk(): boolean {
  if (typeof navigator === "undefined") return false;
  if (!recognitionCtor()) return false;
  if (isFramed()) return false;
  const brave = (navigator as Navigator & { brave?: unknown }).brave;
  if (brave) return false;
  return /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/OPR|Opera/.test(navigator.userAgent);
}

export function isFramed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

const MESSAGES: Record<ListenBlock, string> = {
  iframe:
    "This preview cannot hear the mic. Open Live window, allow the mic there, or paste the question.",
  denied: "Microphone is blocked. Allow it in the lock menu, then press Listen.",
  missing: "Press Listen. Allow the mic, then share the call tab with audio.",
  speech: "Press Listen. Allow the mic, then share the call tab with audio.",
};

let rec: Recognition | null = null;
let heldStream: MediaStream | null = null;
let stopped = true;
let running = false;
let restartTimer = 0;
let greetTimer = 0;
let greeted = false;
let lastSpeechError = "";
/**
 * SpeechRecognition numbers its results, and extends the one at the current index
 * as more audio arrives — so the index is the event. The counter scopes it per
 * recognizer, because a restart begins numbering again from zero.
 */
let recSession = 0;

function ingestResult(event: RecEvent) {
  let interim = "";
  let finalText = "";
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const piece = event.results[i]?.[0]?.transcript ?? "";
    if (event.results[i]?.isFinal) finalText += piece;
    else interim += piece;
  }
  markSpeechLive();
  useGround.getState().setLiveDraft(cleanCaption(interim), roleForLane("mic"));
  const text = cleanCaption(finalText);
  if (!text) return;
  // SpeechRecognition can only hear a microphone, so it is always the mic lane.
  useGround.getState().heard({
    id: `speech-${recSession}-${event.resultIndex}`,
    role: roleForLane("mic"),
    text,
  });
}

function greet() {
  if (greeted) return;
  if (useGround.getState().listenError) return;
  greeted = true;
  if (useGround.getState().sharingCall) return;
  useGround.getState().appendUtterance({
    at: Date.now(),
    speaker: "GROUND",
    role: "system",
    text: "Hearing you. When they ask, the Card is what you say.",
  });
}

function scheduleGreet() {
  window.clearTimeout(greetTimer);
  greetTimer = window.setTimeout(() => {
    if (!stopped && running && !useGround.getState().listenError) greet();
  }, 900);
}

function failSoft(reason: ListenBlock) {
  stopped = true;
  running = false;
  window.clearTimeout(restartTimer);
  window.clearTimeout(greetTimer);
  try {
    rec?.stop();
  } catch {
    /* ignore */
  }
  rec = null;
  releaseMic();
  useGround.getState().setListenError(null);
  if (useGround.getState().sharingCall) return;
  useGround.getState().disarm();
  const last = useGround.getState().utterances.at(-1)?.text;
  if (last !== MESSAGES[reason]) {
    useGround.getState().appendUtterance({
      at: Date.now(),
      speaker: "GROUND",
      role: "system",
      text: MESSAGES[reason],
    });
  }
}

function releaseMic() {
  heldStream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  });
  heldStream = null;
}

function hasLiveMic(): boolean {
  return Boolean(heldStream?.getTracks().some((track) => track.readyState === "live"));
}

async function ensureMic(): Promise<ListenBlock | null> {
  if (hasLiveMic()) return null;
  if (!navigator.mediaDevices?.getUserMedia) return "missing";
  try {
    heldStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    return null;
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (isFramed() && (name === "NotAllowedError" || name === "SecurityError")) return "iframe";
    if (name === "NotFoundError") return "missing";
    return "denied";
  }
}

function wire(instance: Recognition) {
  instance.continuous = true;
  instance.interimResults = true;
  instance.maxAlternatives = 1;
  instance.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
  instance.onresult = ingestResult;
  instance.onerror = (event) => {
    const err = event.error ?? "";
    lastSpeechError = err;
    if (err === "no-speech" || err === "aborted") return;
    if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") {
      failSoft(hasLiveMic() ? "speech" : isFramed() ? "iframe" : "denied");
      return;
    }
    // Network errors are transient; onend backs off and restarts.
  };
  instance.onend = () => {
    running = false;
    if (stopped) return;
    const delay = lastSpeechError === "network" ? 350 : 80;
    restartTimer = window.setTimeout(() => {
      if (!stopped && !useGround.getState().listenError) startRecognition();
    }, delay);
  };
}

function startRecognition() {
  const Ctor = recognitionCtor();
  if (!Ctor) return false;
  if (running) return true;
  window.clearTimeout(restartTimer);
  recSession += 1;
  rec = new Ctor();
  wire(rec);
  try {
    rec.start();
    running = true;
    lastSpeechError = "";
    scheduleGreet();
    return true;
  } catch {
    running = false;
    return false;
  }
}

/** Live captions from the default mic. Works even when Brave hides Chrome STT. */
export function startCaptions(): boolean {
  if (!recognitionCtor()) return false;
  stopped = false;
  lastSpeechError = "";
  useGround.getState().setListenError(null);
  return startRecognition();
}

function beginListen() {
  if (!recognitionCtor()) {
    failSoft(isFramed() ? "iframe" : "missing");
    return;
  }
  if (isFramed()) {
    failSoft("iframe");
    return;
  }
  stopped = false;
  lastSpeechError = "";
  useGround.getState().setListenError(null);
  const micPromise = ensureMic();
  const started = startRecognition();
  if (!started && !recognitionCtor()) {
    failSoft(isFramed() ? "iframe" : "missing");
  }
  void micPromise.then((reason) => {
    if (reason) {
      failSoft(reason);
      return;
    }
    if (!running && !stopped && recognitionCtor()) startRecognition();
  });
}

/** Must run in the click handler — keep getUserMedia on the same gesture. */
export function startListening() {
  try {
    beginListen();
  } catch {
    failSoft(isFramed() ? "iframe" : "missing");
  }
}

export function retryListening() {
  if (!liveCaptionsOk()) {
    failSoft(isFramed() ? "iframe" : "speech");
    return;
  }
  stopListeningAndMic();
  resetListenGreeting();
  useGround.getState().arm();
  try {
    beginListen();
  } catch {
    failSoft(isFramed() ? "iframe" : "missing");
  }
}

export function toggleListening() {
  const state = useGround.getState();
  if (state.armed && !state.listenError) {
    stopListeningAndMic();
    stopCallShare();
    state.disarm();
    return;
  }
  retryListening();
}

export function stopListening() {
  stopped = true;
  running = false;
  window.clearTimeout(restartTimer);
  window.clearTimeout(greetTimer);
  try {
    rec?.stop();
  } catch {
    /* ignore */
  }
  rec = null;
  useGround.getState().setLiveDraft("");
}

export function stopListeningAndMic() {
  stopListening();
  releaseMic();
}

export function resetListenGreeting() {
  greeted = false;
}

export function liveWindowHref(): string {
  if (typeof window === "undefined") return "/?overlay=1";
  const url = new URL(window.location.href);
  url.searchParams.set("overlay", "1");
  return url.toString();
}

export function openLiveWindow(): Window | null {
  if (typeof window === "undefined") return null;
  const url = liveWindowHref();
  const opened = window.open(url, `ground-live-${Date.now()}`, "popup,width=560,height=900");
  try {
    opened?.focus();
  } catch {
    /* ignore */
  }
  return opened;
}

export function useLiveListen() {
  const armed = useGround((s) => s.armed);
  const playing = useGround((s) => s.playing);
  const listenError = useGround((s) => s.listenError);
  const sharingCall = useGround((s) => s.sharingCall);

  useEffect(() => {
    if (sharingCall) return;
    if (armed && !playing && !listenError) {
      if (!running && !stopped) startRecognition();
      return;
    }
    if (!armed || playing) stopListening();
    if (!armed) {
      releaseMic();
      resetListenGreeting();
    }
  }, [armed, playing, listenError, sharingCall]);
}
