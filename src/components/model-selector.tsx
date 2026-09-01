"use client";

import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { providerKeyStatus } from "@/lib/ai/cardsmith";
import { clientHasKey, readClientKeys } from "@/lib/ai/client-keys";
import { AVAILABLE_MODELS, getDefaultModel, getModelById, type ModelProvider } from "@/lib/ai/models";
import { cn } from "@/lib/cn";
import { useGround } from "@/lib/store";
import { ApiKeySettings } from "@/components/api-key-settings";

const EMPTY_STATUS: Record<ModelProvider, boolean> = {
  openai: false,
  anthropic: false,
  xai: false,
};

export function ModelSelector() {
  const selectedModel = useGround((s) => s.selectedModel);
  const setSelectedModel = useGround((s) => s.setSelectedModel);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [server, setServer] = useState(EMPTY_STATUS);
  const [keysTick, setKeysTick] = useState(0);
  const model = getModelById(selectedModel) ?? getDefaultModel();
  const ready = clientHasKey(model.provider, readClientKeys()) || server[model.provider];

  useEffect(() => {
    void providerKeyStatus()
      .then((status) =>
        setServer({
          openai: Boolean(status.openai),
          anthropic: Boolean(status.anthropic),
          xai: Boolean(status.xai),
        }),
      )
      .catch(() => setServer(EMPTY_STATUS));
  }, [keysTick]);

  return (
    <div className="model-selector" data-testid="model-selector">
      <label className="sr-only" htmlFor="model-select">
        Model
      </label>
      <select
        id="model-select"
        value={model.id}
        onChange={(event) => setSelectedModel(event.target.value)}
        className="model-selector-field"
        title={model.description}
      >
        {AVAILABLE_MODELS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} — {option.description}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={cn("model-selector-status", ready ? "is-ready" : "is-missing")}
        data-testid="model-status"
        onClick={() => setSettingsOpen(true)}
      >
        {ready ? "Ready" : "Add API key"}
      </button>
      <button
        type="button"
        className="model-selector-settings"
        aria-label="API key settings"
        title="API key settings"
        onClick={() => setSettingsOpen(true)}
      >
        <Settings className="size-3.5" />
      </button>
      {settingsOpen ? (
        <ApiKeySettings
          onClose={() => {
            setSettingsOpen(false);
            setKeysTick((tick) => tick + 1);
          }}
        />
      ) : null}
    </div>
  );
}
