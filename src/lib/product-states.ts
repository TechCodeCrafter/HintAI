/** User-facing product states — no stack traces or developer jargon. */

import type { SilenceKind } from "./search/silence.ts";

export type ProductStateCode =
  | "indexing"
  | "no-knowledge"
  | "sources-excluded"
  | "unsupported-answer"
  | "provider-failure"
  | "missing-api-key"
  | "microphone-unavailable"
  | "source-index-failure"
  | "index-unavailable"
  | "session-not-authenticated";

export type ProductState = {
  code: ProductStateCode;
  title: string;
  message: string;
  action?: string;
};

const STATES: Record<ProductStateCode, Omit<ProductState, "code">> = {
  indexing: {
    title: "Indexing your sources",
    message: "Hint is preparing your Knowledge Space. You can ask questions once indexing finishes.",
  },
  "no-knowledge": {
    title: "No knowledge connected",
    message: "Add a repo, folder, or PDF to this Knowledge Space before asking or starting Live.",
    action: "Add sources",
  },
  "sources-excluded": {
    title: "Sources excluded from search",
    message:
      "Every file in this Knowledge Space is excluded, so Hint cannot cite anything. Include all sources again to search PDFs, docs, and code.",
    action: "Include all sources",
  },
  "unsupported-answer": {
    title: "No cited answer",
    message: "Your loaded material does not support a confident answer to that question.",
  },
  "provider-failure": {
    title: "Model provider unavailable",
    message: "Hint did not get a usable response from your model provider. The reason is below.",
  },
  "missing-api-key": {
    title: "API key required",
    message: "Add an API key for your chosen model provider to generate answers.",
    action: "Add API key",
  },
  "microphone-unavailable": {
    title: "Microphone unavailable",
    message: "Hint needs microphone access for Live sessions. Allow access in your browser settings.",
  },
  "source-index-failure": {
    title: "Source could not be indexed",
    message: "One or more files failed to index. Other sources in this Knowledge Space may still work.",
  },
  "index-unavailable": {
    title: "Index needs attention",
    message: "Hint could not search a current index of this Knowledge Space. The reason is below.",
  },
  "session-not-authenticated": {
    title: "Sign in required",
    message: "Sign in to use your Knowledge Spaces on this device.",
    action: "Sign in",
  },
};

export function productState(code: ProductStateCode): ProductState {
  return { code, ...STATES[code] };
}

/**
 * The banner above a silent Card. The Card's own `silence` kind decides it, so
 * a timeout is never shown as "your material does not support an answer". Text
 * sniffing is only the fallback for Cards that carry no kind (store-level
 * states, history saved before kinds existed).
 */
export function productStateForSilence(card: { reason?: string | null; silence?: SilenceKind }): ProductState {
  const reason = card.reason ?? "";
  if (card.silence === "transport") {
    return productState(/api key/i.test(reason) ? "missing-api-key" : "provider-failure");
  }
  if (card.silence === "index") return productState("index-unavailable");
  if (card.silence) return productState("unsupported-answer");
  return inferProductStateFromReason(reason) ?? productState("unsupported-answer");
}

export function inferProductStateFromReason(reason: string | null | undefined): ProductState | null {
  if (!reason) return null;
  const lower = reason.toLowerCase();
  if (lower.includes("api key")) return productState("missing-api-key");
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("provider")) {
    return productState("provider-failure");
  }
  if (lower.includes("excluded from search")) return productState("sources-excluded");
  if (lower.includes("no matching") || lower.includes("doesn't cover") || lower.includes("does not cover")) {
    return productState("unsupported-answer");
  }
  return null;
}
