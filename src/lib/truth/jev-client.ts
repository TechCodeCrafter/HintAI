/**
 * Server-side Jev / TypeSafe System One client.
 * Uses JEV_API_KEY (preferred) or TYPESAFE_API_KEY — never exposed to browser code.
 */

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevRequest = {
  model?: string;
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, JevQuestion>;
};

export type JevNoulAnswer = { noul?: number };
export type JevChoiceAnswer = { choice?: string; probabilities?: Record<string, number>; confidence?: number };
export type JevScoreAnswer = { score?: number; confidence?: number };

export type JevResponse = {
  model?: string;
  answers?: Record<string, JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number };
};

/** Official TypeSafe endpoint (verified against docs, Sep 2026). Reseller mirror: jevtypesafeai.com/api/v1/decide */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

let lastUsage: JevResponse["usage"];
export function consumeJevUsage(): JevResponse["usage"] {
  const u = lastUsage;
  lastUsage = undefined;
  return u;
}
export function peekJevUsage(): JevResponse["usage"] | undefined {
  return lastUsage;
}

export function jevApiKey(): string | undefined {
  if (typeof window !== "undefined") return undefined;
  return process.env.JEV_API_KEY?.trim() || process.env.TYPESAFE_API_KEY?.trim() || undefined;
}

/** Opt-in gate — Jev is disabled until early access. Set JEV_ENABLED=1 to run eval calls. */
export function jevEnabled(): boolean {
  if (typeof window !== "undefined") return false;
  return process.env.JEV_ENABLED?.trim() === "1";
}

export function jevConfigured(): boolean {
  return jevEnabled() && Boolean(jevApiKey());
}

export function jevDisabledReason(): string | undefined {
  if (jevConfigured()) return undefined;
  if (!jevEnabled()) return "Jev disabled — set JEV_ENABLED=1 when TypeSafe early access is available";
  return "JEV_API_KEY (or TYPESAFE_API_KEY) not set";
}

export async function callJev(request: JevRequest, timeoutMs = 15000): Promise<JevResponse> {
  const apiKey = jevApiKey();
  if (!apiKey) {
    throw new Error(jevDisabledReason() ?? "JevTruthJudge is unavailable");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model ?? "jev-latest",
        state: request.state,
        questions: request.questions,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Jev HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
    const body = (await response.json()) as JevResponse;
    lastUsage = body.usage;
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Parse noul answer — official schema uses answers[id].noul (0–1). */
export function readJevNoul(answer: JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer | undefined): number | undefined {
  if (!answer || typeof answer !== "object") return undefined;
  if ("noul" in answer && typeof answer.noul === "number") return answer.noul;
  return undefined;
}

/** Parse choice answer — official schema uses answers[id].choice + probabilities + confidence. */
export function readJevChoice(
  answer: JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer | undefined,
): { choice?: string; confidence?: number; probabilities?: Record<string, number> } {
  if (!answer || typeof answer !== "object" || !("choice" in answer)) return {};
  const row = answer as JevChoiceAnswer;
  return { choice: row.choice, confidence: row.confidence, probabilities: row.probabilities };
}
