import { llmDebug } from "../debug.ts";
import { getDefaultModel, getModelById, type ModelOption, type ModelProvider, type ProviderKeys } from "./models.ts";

export type SpeakPolicy = "extract" | "synthesize";

function envKey(provider: ModelProvider): string | undefined {
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  return process.env.XAI_API_KEY;
}

function resolveKey(provider: ModelProvider, keys?: ProviderKeys): string | undefined {
  const fromClient = keys?.[provider]?.trim();
  return fromClient || envKey(provider);
}

function providerHttpReason(provider: ModelProvider, status: number): string {
  const name = provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : "xAI";
  if (status === 401 || status === 403) return `${name} rejected the API key`;
  if (status === 429) return `${name} rate limit — try again in a moment`;
  return `${name} ${status}`;
}

function buildRequest(model: ModelOption, system: string, user: string, apiKey: string, maxTokens = model.maxTokens) {
  if (model.provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      } as Record<string, string>,
      body: {
        model: model.modelId,
        max_tokens: maxTokens,
        temperature: 0.3,
        system,
        messages: [{ role: "user", content: user }],
      },
    };
  }
  const url =
    model.provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.x.ai/v1/chat/completions";
  return {
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    } as Record<string, string>,
    body: {
      model: model.modelId,
      temperature: 0.3,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
  };
}

function readCompletion(provider: ModelProvider, body: unknown): string {
  if (!body || typeof body !== "object") return "";
  if (provider === "anthropic") {
    const blocks = (body as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
    return blocks
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("");
  }
  return (body as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
}

export async function completeChat(
  system: string,
  user: string,
  model: ModelOption,
  keys?: ProviderKeys,
  timeoutMs = 12000,
  maxTokens?: number,
) {
  const apiKey = resolveKey(model.provider, keys);
  llmDebug("[completeChat] user message length:", user.length, "head:", user.slice(0, 60));
  llmDebug("[completeChat] provider:", model.provider, "apiKey present:", Boolean(apiKey));
  if (!user.trim()) return { raw: null as string | null, reason: "empty prompt" };
  if (!apiKey) return { raw: null as string | null, reason: "Add API key" };
  const request = buildRequest(model, system, user, apiKey, maxTokens ?? model.maxTokens);
  try {
    const res = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(request.body),
    });
    if (!res.ok) {
      llmDebug("[completeChat] status:", model.provider, res.status);
      return { raw: null, reason: providerHttpReason(model.provider, res.status) };
    }
    const raw = readCompletion(model.provider, await res.json());
    return { raw, reason: undefined };
  } catch {
    return { raw: null, reason: "timeout" };
  }
}

export type StreamTiming = {
  ttftMs: number | null;
  firstSentenceMs: number | null;
  completionMs: number;
};

export type SynthesisDirectInput = {
  query?: string;
  prompt: string;
  modelId?: string;
  maxTokens?: number;
  policy?: SpeakPolicy;
  keys?: ProviderKeys;
  /** Observation-only: measure OpenAI streaming latencies without changing UI. */
  measureStream?: boolean;
};

const SENTENCE_END = /[.!?](?:\s|$)/;

async function completeOpenAiStream(
  model: ModelOption,
  system: string,
  user: string,
  apiKey: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<{ raw: string | null; reason?: string; stream?: StreamTiming }> {
  const started = performance.now();
  let ttftMs: number | null = null;
  let firstSentenceMs: number | null = null;
  let raw = "";
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model.modelId,
        temperature: 0.3,
        max_tokens: maxTokens,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      return { raw: null, reason: providerHttpReason("openai", res.status) };
    }
    const reader = res.body?.getReader();
    if (!reader) return { raw: null, reason: "empty stream" };
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const chunk = parsed.choices?.[0]?.delta?.content ?? "";
          if (!chunk) continue;
          if (ttftMs == null) ttftMs = Math.round(performance.now() - started);
          raw += chunk;
          if (firstSentenceMs == null && SENTENCE_END.test(raw)) {
            firstSentenceMs = Math.round(performance.now() - started);
          }
        } catch {
          /* skip malformed SSE chunk */
        }
      }
    }
    return {
      raw,
      stream: {
        ttftMs,
        firstSentenceMs,
        completionMs: Math.round(performance.now() - started),
      },
    };
  } catch {
    return { raw: null, reason: "timeout" };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function systemFor(_policy: SpeakPolicy): string {
  return "Follow the user instructions exactly. Use only the document chunks in the prompt. Never use general knowledge. Reply with only the spoken answer or INSUFFICIENT.";
}

/** Production synthesis call shared by server fn and flight capture harness. */
export async function completeSynthesisDirect(
  data: SynthesisDirectInput,
): Promise<{ text: string | null; reason?: string; modelName?: string; stream?: StreamTiming }> {
  const model = getModelById(data.modelId) ?? getDefaultModel();
  const user = data.prompt || data.query || "";
  const system = systemFor(data.policy ?? "extract");
  const maxTokens = data.maxTokens ?? model.maxTokens;
  const apiKey = resolveKey(model.provider, data.keys);

  if (data.measureStream && model.provider === "openai" && apiKey) {
    const streamed = await completeOpenAiStream(model, system, user, apiKey, maxTokens, 12000);
    if (streamed.raw == null) return { text: null, reason: streamed.reason, modelName: model.name, stream: streamed.stream };
    const text = streamed.raw.replace(/\s+/g, " ").trim();
    return text
      ? { text: text.slice(0, 1800), modelName: model.name, stream: streamed.stream }
      : { text: null, reason: "empty", modelName: model.name, stream: streamed.stream };
  }

  const { raw, reason } = await completeChat(system, user, model, data.keys, 12000, data.maxTokens);
  if (raw == null) return { text: null, reason, modelName: model.name };
  const text = raw.replace(/\s+/g, " ").trim();
  return text ? { text: text.slice(0, 1800), modelName: model.name } : { text: null, reason: "empty", modelName: model.name };
}

export function hasLlmProviderKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || process.env.XAI_API_KEY?.trim());
}
