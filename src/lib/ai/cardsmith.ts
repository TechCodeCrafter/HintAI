import { createServerFn } from "@tanstack/react-start";
import { unwrapFnInput } from "@/lib/ai/fn-input";
import { getDefaultModel, getModelById, type ProviderKeys } from "@/lib/ai/models";
import { llmDebug } from "@/lib/debug";
import type { Hit } from "@/lib/repo/types";
import { completeSynthesisDirect, type SpeakPolicy, type SynthesisDirectInput } from "./synthesis-client.ts";

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

export const providerKeyStatus = createServerFn({ method: "GET" }).handler(async () => ({
  openai: Boolean(process.env.OPENAI_API_KEY),
  anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  xai: Boolean(process.env.XAI_API_KEY),
}));

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
  llmDebug("[validator] keys:", Object.keys(input ?? {}), input?.data ? Object.keys(input.data) : "no data");
  const inner = unwrapFnInput(input);
  const policy = inner.policy;
  return {
    query: typeof inner.query === "string" ? inner.query : "",
    prompt: typeof inner.prompt === "string" ? inner.prompt : "",
    modelId: typeof inner.modelId === "string" ? inner.modelId : undefined,
    maxTokens: typeof inner.maxTokens === "number" ? inner.maxTokens : undefined,
    policy: policy === "synthesize" ? policy : "extract",
    keys: inner.keys,
  };
}

export type { SynthesisDirectInput } from "./synthesis-client.ts";
export { completeSynthesisDirect } from "./synthesis-client.ts";

/** Raw completion for grounded extract and weak synthesize prompts. */
export const completeSynthesis = createServerFn({ method: "POST" })
  .validator((input: SpeakInput) => speakInput(input))
  .handler(async ({ data }) => completeSynthesisDirect(data));

