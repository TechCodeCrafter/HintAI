import { isDocumentHit, isFileHit, type Citation, type Hit } from "../repo/types.ts";

export const EVIDENCE_SCORE = 3;

export type GeneratedAnswer = {
  say: string;
  usedEvidence: boolean;
  citations: Citation[];
  latencyMs: number;
};

export function hitsGroundAnswer(hits: Hit[]): boolean {
  return hits.length > 0 && (hits[0]?.score ?? 0) > EVIDENCE_SCORE;
}

export function citationsFromHits(hits: Hit[]): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (out.length >= 2) break;
    const key = isDocumentHit(hit) ? `${hit.path}:${hit.page}` : hit.path;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isDocumentHit(hit)) {
      out.push({
        kind: "document",
        sourceId: hit.sourceId,
        path: hit.path,
        page: hit.page,
        heading: hit.heading,
        label: `${hit.path} · p. ${hit.page}`,
      });
      continue;
    }
    if (isFileHit(hit)) {
      out.push({
        kind: "file",
        path: hit.path,
        line: hit.startLine,
        sha: hit.sha,
        pr: hit.pr,
        label: hit.path,
      });
    }
  }
  return out;
}

export function buildAnswerPrompt(query: string, hits: Hit[], threadHistory: string[]): string {
  const contextChunks = hits.slice(0, 5).map((hit, i) => {
    const where = isFileHit(hit)
      ? `${hit.path}:${hit.startLine}`
      : `${hit.path} (page ${hit.page})`;
    return `[${i + 1}] ${where}\n${hit.text.slice(0, 800)}`;
  });
  const contextText = contextChunks.length > 0 ? contextChunks.join("\n\n") : "(no matching documents)";
  const threadText =
    threadHistory.length > 0 ? `Recent conversation:\n${threadHistory.slice(-3).join("\n")}\n\n` : "";
  return `${threadText}User's documents:
${contextText}

Question: "${query}"

INSTRUCTIONS:
You are helping someone answer a question in a live meeting. Generate a natural, spoken response.

RULES:
1. If the documents above contain the answer, paraphrase it naturally. Do NOT read verbatim.
2. If the documents do NOT contain the answer, answer from general knowledge.
3. Keep it to 1-2 sentences. Sound conversational, not robotic.
4. NEVER invent specific facts that aren't in the documents or general knowledge.
5. If unsure, say "I'm not sure, but I can follow up on that."

Respond with ONLY the spoken answer. No quotes, no prefixes.`;
}

export type AnswerAsk = (payload: {
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
  task: "answer";
  instruction: string;
  threadContext: string | null;
}) => Promise<{ say: string | null }>;

export async function generateAnswer(
  query: string,
  hits: Hit[],
  threadHistory: string[],
  t0: number,
  opts?: { cite?: boolean; ask?: AnswerAsk },
): Promise<GeneratedAnswer | null> {
  const cite = opts?.cite !== false;
  const usedEvidence = cite && hitsGroundAnswer(hits);
  const contextHits = hits.slice(0, 5).map((hit) => ({
    kind: hit.kind,
    path: hit.path,
    startLine: isFileHit(hit) ? hit.startLine : 1,
    text: hit.text.slice(0, 800),
    sha: isFileHit(hit) ? hit.sha : undefined,
    pr: isFileHit(hit) ? hit.pr : undefined,
    author: isFileHit(hit) ? hit.author : undefined,
    message: isFileHit(hit) ? hit.message : undefined,
  }));
  const prompt = buildAnswerPrompt(query, hits, threadHistory);
  const threadContext = threadHistory.slice(-3).join("\n") || null;
  try {
    const remote = await Promise.race([
      opts?.ask
        ? opts.ask({
            query,
            hits: contextHits,
            task: "answer",
            instruction: prompt,
            threadContext,
          })
        : (async () => {
            const { speakAnswer } = await import("@/lib/ai/cardsmith");
            return speakAnswer({ data: { query, prompt } });
          })(),
      new Promise<never>((_, reject) => {
        globalThis.setTimeout(() => reject(new Error("timeout")), 8000);
      }),
    ]);
    if (!remote.say) return null;
    return {
      say: remote.say,
      usedEvidence,
      citations: usedEvidence ? citationsFromHits(hits) : [],
      latencyMs: Math.round(performance.now() - t0),
    };
  } catch {
    return null;
  }
}
