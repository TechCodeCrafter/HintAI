import type { ModelProvider, ProviderKeys } from "./models.ts";

export type { ProviderKeys };

const KEYS_STORAGE = "meethint.providerKeys";

export function readClientKeys(): ProviderKeys {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEYS_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ProviderKeys;
    return {
      openai: typeof parsed.openai === "string" ? parsed.openai.trim() : undefined,
      anthropic: typeof parsed.anthropic === "string" ? parsed.anthropic.trim() : undefined,
      xai: typeof parsed.xai === "string" ? parsed.xai.trim() : undefined,
    };
  } catch {
    return {};
  }
}

export function writeClientKeys(keys: ProviderKeys) {
  if (typeof localStorage === "undefined") return;
  const next: ProviderKeys = {};
  for (const provider of ["openai", "anthropic", "xai"] as const) {
    const value = keys[provider]?.trim();
    if (value) next[provider] = value;
  }
  try {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

export function clientHasKey(provider: ModelProvider, keys = readClientKeys()): boolean {
  return Boolean(keys[provider]);
}
