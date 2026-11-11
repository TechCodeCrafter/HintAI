import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../auth/middleware.ts";
import { enforceRateLimit } from "./rate-limit.server.ts";

const MAX_BYTES = 1_500_000;

type Clip = {
  audio: string;
  mime: string;
  keyterms?: string[];
};

export const transcribeAvailable = createServerFn({ method: "GET" }).handler(async () =>
  Boolean(process.env.XAI_API_KEY),
);

const MIME_OK = /^audio\/[a-z0-9.+-]{1,40}$/i;
// base64 of MAX_BYTES, plus slack for padding.
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4 + 8;

/** Reject anything that is not a well-formed clip before it reaches the handler. */
export function parseClip(input: unknown): Clip {
  const raw = (input ?? {}) as Record<string, unknown>;
  const audio = typeof raw.audio === "string" ? raw.audio : "";
  if (!audio || audio.length > MAX_BASE64) throw new Error("Invalid clip");
  const mime = typeof raw.mime === "string" && MIME_OK.test(raw.mime) ? raw.mime : "audio/wav";
  const keyterms = Array.isArray(raw.keyterms)
    ? raw.keyterms.filter((t): t is string => typeof t === "string").slice(0, 8)
    : undefined;
  return { audio, mime, keyterms };
}

/**
 * Server-side dictation through xAI STT. Requires a signed-in user and counts
 * against a per-user hourly budget (TRANSCRIBE_RATE_LIMIT_PER_HOUR, default 240),
 * because every call spends the server's XAI_API_KEY.
 */
export const transcribeClip = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseClip(input))
  .handler(async ({ data, context }): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "Dictate is not available here. Type or paste the question, then Search." };
    }
    try {
      await enforceRateLimit("transcribe", context.userId);
    } catch {
      return { ok: false, error: "Dictate limit reached for this hour. Type the question, then Search." };
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(data.audio, "base64");
    } catch {
      return { ok: false, error: "Could not read that clip." };
    }
    if (bytes.length < 400) {
      return { ok: false, error: "That clip was empty. Hold Dictate and ask the question." };
    }
    if (bytes.length > MAX_BYTES) {
      return { ok: false, error: "Keep the clip under 20 seconds." };
    }

    const form = new FormData();
    form.append("format", "true");
    form.append("language", "en");
    for (const term of (data.keyterms ?? []).slice(0, 8)) {
      if (term.length > 1 && term.length <= 50) form.append("keyterm", term);
    }
    const name = data.mime.includes("wav") ? "clip.wav" : "clip.m4a";
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    form.append("file", new Blob([copy], { type: data.mime || "audio/wav" }), name);

    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/stt", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
        body: form,
      });
    } catch {
      return { ok: false, error: "Dictate timed out. Type the question, then Search." };
    }

    if (!res.ok) {
      return { ok: false, error: "Dictate could not hear that. Type or paste the question, then Search." };
    }

    const body = (await res.json()) as { text?: string };
    const text = (body.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) {
      return { ok: false, error: "No words in that clip. Ask again, or type it." };
    }
    return { ok: true, text: text.slice(0, 400) };
  });
