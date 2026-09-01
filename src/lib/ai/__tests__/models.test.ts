import assert from "node:assert/strict";
import { test } from "node:test";

import { AVAILABLE_MODELS, getDefaultModel, getModelById, readStoredModelId } from "../models.ts";

test("default model is GPT-4o Mini", () => {
  assert.equal(getDefaultModel().id, "gpt-4o-mini");
  assert.equal(getDefaultModel().provider, "openai");
});

test("every listed model has a provider and API name", () => {
  for (const model of AVAILABLE_MODELS) {
    assert.ok(model.id);
    assert.ok(model.modelId);
    assert.ok(["openai", "anthropic", "xai"].includes(model.provider));
    assert.equal(model.maxTokens, 400);
  }
});

test("unknown stored ids fall back to the default", () => {
  assert.equal(readStoredModelId("not-a-model"), "gpt-4o-mini");
  assert.equal(readStoredModelId("gpt-4o"), "gpt-4o");
  assert.equal(getModelById("claude-haiku")?.provider, "anthropic");
});
