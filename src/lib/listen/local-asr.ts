type Progress = { status?: string; progress?: number; file?: string };
type Waiter = {
  done: (text: string) => void;
  partial?: (text: string) => void;
};

let worker: Worker | null = null;
let ready: Promise<boolean> | null = null;
let seq = 0;
const waits = new Map<number, Waiter>();

function setNote(text: string) {
  void import("@/lib/store").then(({ useMeetHint }) => {
    useMeetHint.getState().setAsrNote(text);
  });
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
      wait?.done("");
      setNote(String(msg.error ?? "Captions failed"));
    }
  };
}

function ensureWorker(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (ready) return ready;
  ready = new Promise((resolve) => {
    try {
      const next = new Worker("/meethint-asr-worker.js", { type: "module" });
      worker = next;
      attach(next);
      const bootWait = (event: MessageEvent) => {
        if (event.data?.type === "ready") {
          next.removeEventListener("message", bootWait);
          resolve(true);
          return;
        }
        if (event.data?.type === "error" && event.data.id == null) {
          next.removeEventListener("message", bootWait);
          ready = null;
          resolve(false);
        }
      };
      next.addEventListener("message", bootWait);
      next.onerror = () => {
        ready = null;
        resolve(false);
      };
      setNote("Loading captions…");
      next.postMessage({ type: "boot" });
    } catch {
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
 */
export async function transcribeLocal(
  pcm16k: Float32Array,
  timeoutMs = 8000,
  onPartial?: (text: string) => void,
  final = false,
): Promise<string> {
  if (pcm16k.length < 1600) return "";
  const ok = await ensureWorker();
  if (!ok || !worker) return "";
  const id = (seq += 1);
  const copy = pcm16k.slice();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      waits.delete(id);
      resolve("");
    }, timeoutMs);
    waits.set(id, {
      partial: onPartial,
      done: (text) => {
        window.clearTimeout(timer);
        resolve(text.replace(/\s+/g, " ").trim());
      },
    });
    worker?.postMessage({ type: "pcm", id, final, buffer: copy.buffer }, [copy.buffer]);
  });
}
