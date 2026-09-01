import { craftCard, speakAnswer } from "@/lib/ai/cardsmith";
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
    useGround?: { getState: () => { heard: (event: unknown) => void; appendUtterance: (u: unknown) => void; search: (q?: string, opts?: { fast?: boolean }) => Promise<void>; autoAnswer: boolean } };
    __mockCraftCard?: (payload: MockCraftPayload) => Promise<Pick<Card, "say"> | null>;
    __mockEmbedder?: (text: string) => Promise<number[]>;
  }
}

export async function callCraftCard(payload: MockCraftPayload): Promise<{ say: string | null }> {
  if (typeof window !== "undefined" && window.__mockCraftCard) {
    const mocked = await window.__mockCraftCard(payload);
    return { say: mocked?.say ?? null };
  }
  if (payload.task === "answer") {
    return speakAnswer({
      data: {
        query: payload.query,
        prompt: payload.instruction ?? `Question: "${payload.query}"`,
        modelId: payload.modelId,
      },
    });
  }
  return craftCard({ data: payload });
}
