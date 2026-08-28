import { createServerFn } from "@tanstack/react-start";

const MAX_BYTES = 1_500_000;

type Clip = {
  audio: string;
  mime: string;
  keyterms?: string[];
};

export const transcribeAvailable = createServerFn({ method: "GET" }).handler(async () =>
  Boolean(process.env.XAI_API_KEY),
);

export const transcribeClip = createServerFn({ method: "POST" })
  .validator((input: Clip) => input)
  .handler(async ({ data }): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "Dictate is not available here. Type or paste the question, then Search." };
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
