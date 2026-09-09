import type { Card } from "@/lib/repo/types";

export type MockCraftPayload = {
  query: string;
  hits: Array<{
    kind: "code" | "why" | "document";
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
  modelId?: string;
};

declare global {
  interface Window {
    useMeetHint?: {
      getState: () => {
        heard: (event: unknown) => void;
        appendUtterance: (u: unknown) => void;
        search: (q?: string, opts?: { fast?: boolean }) => Promise<void>;
        autoAnswer: boolean;
        setSubscription: (tier: "free" | "pro" | "team" | "enterprise") => void;
        openAudit?: () => Promise<void>;
        restoreAnswer?: (id: string) => void;
        reviewMeeting?: (id: string) => Promise<void>;
        setSelectedModelId?: (id: string) => void;
        activeContextId?: string | null;
        resetForAccountChange?: () => void;
      };
    };
    __mockCraftCard?: (payload: MockCraftPayload) => Promise<Pick<Card, "say"> | null>;
    __mockEmbedder?: (text: string) => Promise<number[]>;
    __meethintSwitchAccount?: (accountId: string | null) => Promise<void>;
    __MEETHINT_E2E__?: boolean;
  }
}

export async function callCraftCard(payload: MockCraftPayload): Promise<{ say: string | null }> {
  if (typeof window !== "undefined" && window.__mockCraftCard) {
    const mocked = await window.__mockCraftCard(payload);
    return { say: mocked?.say ?? null };
  }
  return { say: null };
}
