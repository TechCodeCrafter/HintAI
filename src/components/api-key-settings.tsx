"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { readClientKeys, writeClientKeys } from "@/lib/ai/client-keys";
import type { ModelProvider, ProviderKeys } from "@/lib/ai/models";
import { Button } from "@/components/ui/button";

const PROVIDERS: Array<{ id: ModelProvider; label: string }> = [
  { id: "openai", label: "OpenAI API key" },
  { id: "anthropic", label: "Anthropic API key" },
  { id: "xai", label: "xAI API key" },
];

export function ApiKeySettings({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const [draft, setDraft] = useState<ProviderKeys>({});
  const [saved, setSaved] = useState<ProviderKeys>({});
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const current = readClientKeys();
    setSaved(current);
    setDraft({});
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  function save(provider: ModelProvider) {
    const next = { ...readClientKeys() };
    const value = draft[provider]?.trim();
    if (value) next[provider] = value;
    writeClientKeys(next);
    setSaved(readClientKeys());
    setDraft((current) => ({ ...current, [provider]: "" }));
    setNotice(`${PROVIDERS.find((item) => item.id === provider)?.label ?? "Key"} saved in this browser.`);
  }

  function clear(provider: ModelProvider) {
    const next = { ...readClientKeys(), [provider]: undefined };
    writeClientKeys(next);
    setSaved(readClientKeys());
    setDraft((current) => ({ ...current, [provider]: "" }));
    setNotice("Key removed from this browser.");
  }

  return (
    <div className="key-settings-backdrop" role="presentation" onClick={onClose}>
      <div
        className="key-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="api-key-settings"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-sm font-medium text-fg">
              API keys
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Keys stay in this browser. They are sent only with a generate request so the selected
              model can answer. Do not save keys on a shared computer.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:text-fg"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          {PROVIDERS.map((provider) => {
            const hasSaved = Boolean(saved[provider.id]);
            return (
              <div key={provider.id} className="space-y-2">
                <label className="block text-xs font-medium text-secondary" htmlFor={`key-${provider.id}`}>
                  {provider.label}
                </label>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <input
                    id={`key-${provider.id}`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft[provider.id] ?? ""}
                    placeholder={hasSaved ? "Key saved — paste to replace" : "Paste key"}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [provider.id]: event.target.value }))
                    }
                    className="key-settings-input"
                  />
                  <Button variant="ghost" size="sm" onClick={() => save(provider.id)}>
                    Save
                  </Button>
                  {hasSaved ? (
                    <Button variant="ghost" size="sm" onClick={() => clear(provider.id)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {notice ? <p className="mt-4 text-xs text-muted">{notice}</p> : null}
      </div>
    </div>
  );
}
