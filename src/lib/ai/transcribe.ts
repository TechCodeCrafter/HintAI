import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../auth/middleware.ts";
import { takeTranscribeQuota } from "./synthesis-rate-limit.server.ts";

const MAX_BYTES = 1_500_000;
// Base64 is 4 chars per 3 bytes; reject oversized payloads before decoding them.
const MAX_BASE64_CHARS = Math.ceil(MAX_BYTES / 3) * 4 + 4;

type Clip = {
  audio: string;
  mime: string;
  keyterms?: string[];
};

/** Accept `{ data: clip }` or the bare clip, and drop anything not shaped like one. */
export function asClip(input: unknown): Clip {
  const raw = (input && typeof input === "object" && "data" in input ? (input as { data: unknown }).data : input) as
    | Record<string, unknown>
    | null
    | undefined;
  const audio = typeof raw?.audio === "string" ? raw.audio : "";
  const mime = typeof raw?.mime === "string" ? raw.mime : "";
  const keyterms = Array.isArray(raw?.keyterms)
    ? raw.keyterms.filter((term): term is string => typeof term === "string")
    : undefined;
  return { audio, mime, keyterms };
}

export const transcribeAvailable = createServerFn({ method: "GET" }).handler(async () =>
  Boolean(process.env.XAI_API_KEY),
);

export const transcribeClip = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: Clip) => asClip(input))
  .handler(async ({ data, context }): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "Dictate is not available here. Type or paste the question, then Search." };
    }
    if (data.audio.length > MAX_BASE64_CHARS) {
      return { ok: false, error: "Keep the clip under 20 seconds." };
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
    if (!takeTranscribeQuota(context.userId)) {
      return { ok: false, error: "Dictate is busy right now. Type the question, then Search." };
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
