import { createServerFn } from "@tanstack/react-start";
import { getDefaultModel, getModelById, type ModelOption, type ModelProvider, type ProviderKeys } from "@/lib/ai/models";
import type { Hit } from "@/lib/repo/types";

type Payload = {
  query: string;
  hits: Array<{
    kind: Hit["kind"];
    path: string;
    startLine: number;
    text: string;
    sha?: string;
    pr?: string;
    author?: string;
    message?: string;
  }>;
  evidenceSay?: string;
  instruction?: string;
  threadContext?: string | null;
  task?: "refine" | "polish" | "assist" | "answer";
};

export function asPayload(input: Payload | { data?: Payload }): Payload {
  if (input && typeof input === "object" && "query" in input && typeof input.query === "string") {
    return input;
  }
  if (input && typeof input === "object" && "data" in input && input.data && typeof input.data.query === "string") {
    return input.data;
  }
  return { query: "", hits: [] };
}

function envKey(provider: ModelProvider): string | undefined {
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  return process.env.XAI_API_KEY;
}

function resolveKey(provider: ModelProvider, keys?: ProviderKeys): string | undefined {
  const fromClient = keys?.[provider]?.trim();
  return fromClient || envKey(provider);
}

function missingKeyReason(): string {
  return "Add API key";
}

function buildRequest(model: ModelOption, system: string, user: string, apiKey: string): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  if (model.provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: model.modelId,
        max_tokens: model.maxTokens,
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
    },
    body: {
      model: model.modelId,
      temperature: 0.3,
      max_tokens: model.maxTokens,
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

async function completeChat(
  system: string,
  user: string,
  model: ModelOption,
  keys?: ProviderKeys,
  timeoutMs = 8000,
) {
  const apiKey = resolveKey(model.provider, keys);
  console.info("[completeChat] provider:", model.provider, "apiKey present:", Boolean(apiKey));
  if (!apiKey) return { raw: null as string | null, reason: missingKeyReason() };
  const request = buildRequest(model, system, user, apiKey);
  try {
    const res = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(request.body),
    });
    if (!res.ok) {
      console.info("[completeChat] status:", model.provider, res.status);
      return { raw: null, reason: `${model.provider} ${res.status}` };
    }
    const raw = readCompletion(model.provider, await res.json());
    return { raw, reason: undefined };
  } catch {
    return { raw: null, reason: "timeout" };
  }
}

export const providerKeyStatus = createServerFn({ method: "GET" }).handler(async () => ({
  openai: Boolean(process.env.OPENAI_API_KEY),
  anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  xai: Boolean(process.env.XAI_API_KEY),
}));

type SpeakInput = {
  query?: string;
  prompt?: string;
  modelId?: string;
  keys?: ProviderKeys;
  data?: { query?: string; prompt?: string; modelId?: string; keys?: ProviderKeys };
};

function speakInput(input: SpeakInput) {
  const inner = input && typeof input.query === "string" ? input : (input?.data ?? {});
  return {
    query: typeof inner.query === "string" ? inner.query : "",
    prompt: typeof inner.prompt === "string" ? inner.prompt : "",
    modelId: typeof inner.modelId === "string" ? inner.modelId : undefined,
    keys: inner.keys,
  };
}

/** Raw completion for grounded synthesis. Search never calls this. */
export const completeSynthesis = createServerFn({ method: "POST" })
  .validator((input: SpeakInput) => speakInput(input))
  .handler(async ({ data }): Promise<{ text: string | null; reason?: string; modelName?: string }> => {
    const model = getModelById(data.modelId) ?? getDefaultModel();
    const { raw, reason } = await completeChat(
      "Follow the user instructions exactly. Use only the document chunks in the prompt. Never use general knowledge. Reply with only the spoken answer or INSUFFICIENT.",
      data.prompt || data.query,
      model,
      data.keys,
      12000,
    );
    if (raw == null) return { text: null, reason, modelName: model.name };
    const text = raw.replace(/\s+/g, " ").trim();
    return text ? { text: text.slice(0, 1800), modelName: model.name } : { text: null, reason: "empty", modelName: model.name };
  });
