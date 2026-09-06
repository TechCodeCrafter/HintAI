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

function buildRequest(model: ModelOption, system: string, user: string, apiKey: string, maxTokens = model.maxTokens): {
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
    },
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

async function completeChat(
  system: string,
  user: string,
  model: ModelOption,
  keys?: ProviderKeys,
  timeoutMs = 8000,
  maxTokens?: number,
) {
  const apiKey = resolveKey(model.provider, keys);
  console.info("[completeChat] provider:", model.provider, "apiKey present:", Boolean(apiKey));
  if (!apiKey) return { raw: null as string | null, reason: missingKeyReason() };
  const request = buildRequest(model, system, user, apiKey, maxTokens ?? model.maxTokens);
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

type SpeakPolicy = "extract" | "synthesize" | "freely";

type SpeakInput = {
  query?: string;
  prompt?: string;
  modelId?: string;
  maxTokens?: number;
  policy?: SpeakPolicy;
  keys?: ProviderKeys;
  data?: {
    query?: string;
    prompt?: string;
    modelId?: string;
    maxTokens?: number;
    policy?: SpeakPolicy;
    keys?: ProviderKeys;
  };
};

function speakInput(input: SpeakInput): {
  query: string;
  prompt: string;
  modelId?: string;
  maxTokens?: number;
  policy: SpeakPolicy;
  keys?: ProviderKeys;
} {
  const inner = input && typeof input.query === "string" ? input : (input?.data ?? {});
  const policy = inner.policy;
  return {
    query: typeof inner.query === "string" ? inner.query : "",
    prompt: typeof inner.prompt === "string" ? inner.prompt : "",
    modelId: typeof inner.modelId === "string" ? inner.modelId : undefined,
    maxTokens: typeof inner.maxTokens === "number" ? inner.maxTokens : undefined,
    policy: policy === "synthesize" || policy === "freely" ? policy : "extract",
    keys: inner.keys,
  };
}

function systemFor(policy: SpeakPolicy): string {
  if (policy === "freely") {
    return "Follow the user instructions exactly. Answer from general knowledge. Reply with only the spoken answer.";
  }
  if (policy === "synthesize") {
    return "Follow the user instructions exactly. Use the documents when they help; otherwise answer from general knowledge. Reply with only the spoken answer.";
  }
  return "Follow the user instructions exactly. Use only the document chunks in the prompt. Never use general knowledge. Reply with only the spoken answer or INSUFFICIENT.";
}

/** Raw completion for Extract, Synthesize, and generated answers. */
export const completeSynthesis = createServerFn({ method: "POST" })
  .validator((input: SpeakInput) => speakInput(input))
  .handler(async ({ data }): Promise<{ text: string | null; reason?: string; modelName?: string }> => {
    const model = getModelById(data.modelId) ?? getDefaultModel();
    const { raw, reason } = await completeChat(
      systemFor(data.policy),
      data.prompt || data.query,
      model,
      data.keys,
      12000,
      data.maxTokens,
    );
    if (raw == null) return { text: null, reason, modelName: model.name };
    const text = raw.replace(/\s+/g, " ").trim();
    return text ? { text: text.slice(0, 1800), modelName: model.name } : { text: null, reason: "empty", modelName: model.name };
  });

type GeneralInput = {
  query?: string;
  prompt?: string;
  modelId?: string;
  maxTokens?: number;
  keys?: ProviderKeys;
  data?: {
    query?: string;
    prompt?: string;
    modelId?: string;
    maxTokens?: number;
    keys?: ProviderKeys;
  };
};

function generalInput(input: GeneralInput): {
  query: string;
  prompt: string;
  modelId?: string;
  maxTokens?: number;
  keys?: ProviderKeys;
} {
  const inner = input && typeof input.query === "string" ? input : (input?.data ?? {});
  return {
    query: typeof inner.query === "string" ? inner.query : "",
    prompt: typeof inner.prompt === "string" ? inner.prompt : "",
    modelId: typeof inner.modelId === "string" ? inner.modelId : undefined,
    maxTokens: typeof inner.maxTokens === "number" ? inner.maxTokens : undefined,
    keys: inner.keys,
  };
}

const GENERAL_SYSTEM =
  "Answer concisely from general knowledge. 1-2 short spoken sentences. Plain language, no lists, no preamble.";

/** Uncited spoken answer. Does not run the grounded evidence gate. */
export const completeGeneral = createServerFn({ method: "POST" })
  .validator((input: GeneralInput) => generalInput(input))
  .handler(async ({ data }): Promise<{ text: string | null; reason?: string; modelName?: string }> => {
    const model = getModelById(data.modelId) ?? getDefaultModel();
    const { raw, reason } = await completeChat(
      GENERAL_SYSTEM,
      data.prompt || data.query,
      model,
      data.keys,
      12000,
      data.maxTokens,
    );
    if (raw == null) return { text: null, reason, modelName: model.name };
    const text = raw.replace(/\s+/g, " ").trim();
    return text ? { text: text.slice(0, 1800), modelName: model.name } : { text: null, reason: "empty", modelName: model.name };
  });
