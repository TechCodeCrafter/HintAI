import { getDefaultModel, getModelById } from "../ai/models.ts";
import { isDocumentHit, isFileHit, type Citation, type Hit } from "../repo/types.ts";

export const EVIDENCE_SCORE = 3;

export type GeneratedAnswer = {
  say: string | null;
  usedEvidence: boolean;
  citations: Citation[];
  latencyMs: number;
  reason?: string;
  missingKey?: boolean;
  modelName?: string;
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
    return `[${i + 1}] ${where}\n${hit.text.slice(0, 1000)}`;
  });
  const contextText = contextChunks.length > 0 ? contextChunks.join("\n\n") : "(no matching documents)";
  const workers = [
    ...new Set(
      hits
        .map((hit) => hit.path.match(/container-lambdas\/([^/]+)/)?.[1])
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const workerLine =
    workers.length > 0 ? `WORKERS IN THESE PATHS: ${workers.join(", ")}\n\n` : "";
  const threadText =
    threadHistory.length > 0 ? `Previous conversation:\n${threadHistory.slice(-3).join("\n")}\n\n` : "";
  return `${threadText}You own the loaded system. Speak as its staff engineer in a design review.

${workerLine}RETRIEVED FILES:
${contextText}

QUESTION: "${query}"

INSTRUCTIONS:
- Name at least one concrete component from the retrieved files (lambda, store, route, class, or file).
- Answer this system, not a generic architecture lecture.
- Why: constraint, choice, trade-off. How: the real call path and what is stored.
- If they ask why there are N lambdas, name each worker folder above and what it owns.
  A numbered list inside one function is not the fleet. Do not praise modularity.
- Concept questions: one sentence of definition, then how these files use it.
- 3-5 spoken sentences. Paraphrase. Do not invent metrics or services.
- If the files do not cover the question, say they do not, then answer from general knowledge.

SPOKEN RESPONSE:`;
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
  modelId: string;
}) => Promise<{ say: string | null; reason?: string; modelName?: string }>;

export async function generateAnswer(
  query: string,
  hits: Hit[],
  threadHistory: string[],
  t0: number,
  opts?: { cite?: boolean; ask?: AnswerAsk; modelId?: string },
): Promise<GeneratedAnswer | null> {
  const cite = opts?.cite !== false;
  const usedEvidence = cite && hitsGroundAnswer(hits);
  const contextHits = hits.slice(0, 5).map((hit) => ({
    kind: hit.kind,
    path: hit.path,
    startLine: isFileHit(hit) ? hit.startLine : 1,
    text: hit.text.slice(0, 1000),
    sha: isFileHit(hit) ? hit.sha : undefined,
    pr: isFileHit(hit) ? hit.pr : undefined,
    author: isFileHit(hit) ? hit.author : undefined,
    message: isFileHit(hit) ? hit.message : undefined,
  }));
  const prompt = buildAnswerPrompt(query, hits, threadHistory);
  const threadContext = threadHistory.slice(-3).join("\n") || null;
  const model = getModelById(opts?.modelId) ?? getDefaultModel();
  try {
    const remote = await Promise.race([
      opts?.ask
        ? opts.ask({
            query,
            hits: contextHits,
            task: "answer",
            instruction: prompt,
            threadContext,
            modelId: model.id,
          })
        : (async () => {
            const { speakAnswer } = await import("@/lib/ai/cardsmith");
            return speakAnswer({ data: { query, prompt, modelId: model.id } });
          })(),
      new Promise<never>((_, reject) => {
        globalThis.setTimeout(() => reject(new Error("timeout")), 12000);
      }),
    ]);
    const missingKey = /add api key/i.test(remote.reason ?? "");
    if (!remote.say) {
      return {
        say: null,
        usedEvidence: false,
        citations: [],
        latencyMs: Math.round(performance.now() - t0),
        reason: remote.reason,
        missingKey,
        modelName: remote.modelName ?? model.name,
      };
    }
    return {
      say: remote.say,
      usedEvidence,
      citations: usedEvidence ? citationsFromHits(hits) : [],
      latencyMs: Math.round(performance.now() - t0),
      modelName: remote.modelName ?? model.name,
    };
  } catch {
    return null;
  }
}
