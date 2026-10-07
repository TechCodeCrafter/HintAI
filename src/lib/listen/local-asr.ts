type Progress = { status?: string; progress?: number; file?: string };
type Waiter = {
  done: (text: string) => void;
  fail: (err: Error) => void;
  partial?: (text: string) => void;
};

// Local Whisper ships as a Vite-bundled module worker (src/lib/listen/asr.worker.ts),
// so @huggingface/transformers loads same-origin. The old static public/ worker
// imported @xenova/transformers from the jsdelivr CDN, which the app CSP blocks —
// it could never boot, so local ASR was gated behind this flag as a dead path.
// Default ON now: set VITE_LOCAL_ASR=0 to opt out.
// import.meta.env is undefined outside Vite (node tests, SSR); treat unset as enabled.
export const LOCAL_ASR_ENABLED = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_LOCAL_ASR !== "0";

let worker: Worker | null = null;
let ready: Promise<boolean> | null = null;
let lastBootError: string | null = null;
let seq = 0;
const waits = new Map<number, Waiter>();

function setNote(text: string) {
  void import("@/lib/store").then(
    ({ useMeetHint }) => {
      useMeetHint.getState().setAsrNote(text);
    },
    () => {
      /* no store outside the app (tests, SSR) — the note is best-effort */
    },
  );
}

/**
 * Loud failure surface: always console.error, and push a user-visible ASR note
 * throttled so a wedged worker can't spam the UI once per preview.
 */
let lastProblemAt = 0;
export function reportAsrProblem(message: string): void {
  console.error(`[local-asr] ${message}`);
  const now = Date.now();
  if (now - lastProblemAt < 15_000) return;
  lastProblemAt = now;
  setNote(message);
}

function progressLine(data: Progress): string {
  const file = String(data.file ?? "").split("/").pop() ?? "";
  if (data.status === "progress" && typeof data.progress === "number") {
    return `Downloading captions ${Math.round(data.progress)}%${file ? ` · ${file}` : ""}`;
  }
  if (data.status === "done") return "Starting captions…";
  return "Loading captions…";
}

function attach(next: Worker) {
  next.onmessage = (event: MessageEvent) => {
    const msg = event.data ?? {};
    if (msg.type === "progress") {
      setNote(progressLine(msg.data ?? {}));
      return;
    }
    if (msg.type === "ready") {
      setNote("");
      return;
    }
    if (msg.type === "partial") {
      waits.get(msg.id)?.partial?.(String(msg.text ?? ""));
      return;
    }
    if (msg.type === "text") {
      const wait = waits.get(msg.id);
      waits.delete(msg.id);
      wait?.done(String(msg.text ?? ""));
      return;
    }
    if (msg.type === "error") {
      const wait = waits.get(msg.id);
      waits.delete(msg.id);
      wait?.fail(new Error(String(msg.error ?? "Captions failed")));
      if (msg.id == null) {
        lastBootError = String(msg.error ?? "Captions failed");
        setNote(`Captions unavailable: ${lastBootError}`);
      }
    }
  };
}

function ensureWorker(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!LOCAL_ASR_ENABLED) return Promise.resolve(false);
  if (ready) return ready;
  ready = new Promise((resolve) => {
    try {
      // Vite bundles asr.worker.ts (with @huggingface/transformers) into a
      // same-origin chunk — no CDN import, no CSP violation.
      const next = new Worker(new URL("./asr.worker.ts", import.meta.url), { type: "module" });
      worker = next;
      attach(next);
      const bootWait = (event: MessageEvent) => {
        if (event.data?.type === "ready") {
          next.removeEventListener("message", bootWait);
          lastBootError = null;
          resolve(true);
          return;
        }
        if (event.data?.type === "error" && event.data.id == null) {
          next.removeEventListener("message", bootWait);
          lastBootError = String(event.data.error ?? "Captions failed");
          reportAsrProblem(`Captions failed to load: ${lastBootError}`);
          ready = null;
          resolve(false);
        }
      };
      next.addEventListener("message", bootWait);
      next.onerror = () => {
        lastBootError = "caption worker script failed to load";
        reportAsrProblem(`Captions failed to load: ${lastBootError}`);
        ready = null;
        resolve(false);
      };
      setNote("Loading captions…");
      next.postMessage({ type: "boot" });
    } catch {
      lastBootError = "could not spawn caption worker";
      ready = null;
      resolve(false);
    }
  });
  return ready;
}

export function warmupAsr(): Promise<boolean> {
  return ensureWorker();
}

/**
 * `final` marks the line that will be committed to the transcript. Those are
 * queued and always answered; previews are disposable and a newer one cancels
 * an older one.
 *
 * Throws (loudly) when the worker can't boot, errors, or times out — callers
 * must surface that instead of treating the utterance as silence.
 */
export async function transcribeLocal(
  pcm16k: Float32Array,
  timeoutMs = 8000,
  onPartial?: (text: string) => void,
  final = false,
): Promise<string> {
  if (pcm16k.length < 1600) return "";
  const ok = await ensureWorker();
  if (!ok || !worker) {
    const reason = lastBootError ?? "local captions unavailable";
    reportAsrProblem(`Captions failed: ${reason}`);
    throw new Error(reason);
  }
  const id = (seq += 1);
  const copy = pcm16k.slice();
  return new Promise((resolve, reject) => {
    const finish = (fn: () => void) => {
      window.clearTimeout(timer);
      waits.delete(id);
      fn();
    };
    const timer = window.setTimeout(() => {
      finish(() => {
        const err = new Error("local captions timed out");
        reportAsrProblem(`Captions failed: ${err.message}`);
        reject(err);
      });
    }, timeoutMs);
    waits.set(id, {
      partial: onPartial,
      done: (text) => {
        finish(() => resolve(text.replace(/\s+/g, " ").trim()));
      },
      fail: (err) => {
        finish(() => {
          reportAsrProblem(`Captions failed: ${err.message}`);
          reject(err);
        });
      },
    });
    worker?.postMessage({ type: "pcm", id, final, buffer: copy.buffer }, [copy.buffer]);
  });
}
