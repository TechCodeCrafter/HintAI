export type ModelProvider = "openai" | "anthropic" | "xai";

export type ProviderKeys = Partial<Record<ModelProvider, string>>;

export type ModelOption = {
  id: string;
  name: string;
  provider: ModelProvider;
  modelId: string;
  description: string;
  maxTokens: number;
  default: boolean;
};

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    modelId: "gpt-4o-mini",
    description: "Fast, cheap, great for live meetings",
    maxTokens: 400,
    default: true,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    modelId: "gpt-4o",
    description: "Smarter, slightly slower",
    maxTokens: 400,
    default: false,
  },
  {
    id: "claude-haiku",
    name: "Claude 3.5 Haiku",
    provider: "anthropic",
    modelId: "claude-3-5-haiku-20241022",
    description: "Fast, good reasoning",
    maxTokens: 400,
    default: false,
  },
  {
    id: "grok-4.5",
    name: "Grok 4.5",
    provider: "xai",
    modelId: "grok-4.5",
    description: "xAI's latest model",
    maxTokens: 400,
    default: false,
  },
];

export function getDefaultModel(): ModelOption {
  return AVAILABLE_MODELS.find((m) => m.default) ?? AVAILABLE_MODELS[0]!;
}

export function getModelById(id: string | null | undefined): ModelOption | undefined {
  if (!id) return undefined;
  return AVAILABLE_MODELS.find((m) => m.id === id);
}

export function readStoredModelId(value: string | null | undefined): string {
  return getModelById(value)?.id ?? getDefaultModel().id;
}
