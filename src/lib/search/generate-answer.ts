import { getDefaultModel, getModelById } from "../ai/models.ts";
import { isFileHit, type Citation, type Hit, type RepoPack } from "../repo/types.ts";
import { provenanceLabel } from "./cite.ts";
import { textEvidence, verifyClaim, type Evidence } from "./evidence.ts";

export type GeneratedAnswer = {
  say: string;
  usedEvidence: true;
  citations: Citation[];
  latencyMs: number;
  modelName?: string;
};

export type SynthesisAsk = (payload: {
  query: string;
  prompt: string;
  modelId: string;
}) => Promise<{ text: string | null; reason?: string; modelName?: string }>;

const INSUFFICIENT = "INSUFFICIENT";
const MARKER = /\[(\d+)\]/g;
const CHUNK_CAP = 5;
const CHUNK_CHARS = 1000;

/** Grounded synthesis prompt. The model may use only the numbered chunks. */
export function buildSynthesisPrompt(query: string, hits: Hit[]): string {
  const chunks = hits.slice(0, CHUNK_CAP).map((hit, i) => {
    const where = isFileHit(hit) ? `${hit.path}:${hit.startLine}` : `${hit.path} (page ${hit.page})`;
    return `[${i + 1}] ${where}\n${hit.text.slice(0, CHUNK_CHARS)}`;
  });
  const documents = chunks.length > 0 ? chunks.join("\n\n") : "(no matching documents)";
  return `You synthesize an answer using ONLY the document chunks below. NEVER use general knowledge.

If the documents do not contain enough information to answer, respond with exactly: INSUFFICIENT

Cite each claim with a chunk marker like [1] or [2] immediately after the claim.
Keep the answer to 1-2 sentences max.

DOCUMENTS:
${documents}

QUESTION: "${query}"`;
}

/** 1-based chunk indexes cited as [N], in first-seen order. */
export function citationIndexes(text: string): number[] {
  const found: number[] = [];
  const seen = new Set<number>();
  for (const match of text.matchAll(MARKER)) {
    const n = Number(match[1]);
    if (!Number.isInteger(n) || n < 1 || seen.has(n)) continue;
    seen.add(n);
    found.push(n);
  }
  return found;
}

export function stripCitationMarkers(text: string): string {
  return text.replace(MARKER, "").replace(/\s+/g, " ").trim();
}

function isInsufficient(text: string): boolean {
  return text.replace(/[.!]+$/g, "").trim().toUpperCase() === INSUFFICIENT;
}

function evidenceFromHit(hit: Hit, pack?: RepoPack): Evidence | null {
  if (isFileHit(hit)) {
    const file = pack?.files.find((item) => item.path === hit.path);
    if (file) {
      const fromOffset = file.content.slice(hit.startOffset, hit.startOffset + hit.text.length);
      const start = fromOffset === hit.text ? hit.startOffset : file.content.indexOf(hit.text);
      if (start >= 0) {
        return textEvidence({
          path: hit.path,
          content: file.content,
          start,
          end: start + hit.text.length,
          normalizedText: hit.text,
        });
      }
    }
  }
  if (!hit.text) return null;
  return textEvidence({
    path: hit.path,
    content: hit.text,
    start: 0,
    end: hit.text.length,
    normalizedText: hit.text,
  });
}

function citationFrom(hit: Hit, evidence: Evidence): Citation {
  if (evidence.kind === "text" && isFileHit(hit)) {
    return {
      kind: "file",
      path: evidence.path,
      line: evidence.startLine,
      endLine: evidence.endLine,
      evidenceId: evidence.id,
      sha: hit.sha,
      pr: hit.pr,
      label: provenanceLabel(hit),
    };
  }
  if (hit.kind === "document") {
    return {
      kind: "document",
      sourceId: hit.sourceId,
      path: hit.path,
      page: hit.page,
      heading: hit.heading,
      evidenceId: evidence.id,
      label: hit.heading ?? "",
    };
  }
  return {
    kind: "file",
    path: hit.path,
    line: isFileHit(hit) ? hit.startLine : 1,
    label: hit.path,
  };
}

function evidenceForMarkers(text: string, hits: Hit[], pack?: RepoPack): { evidence: Evidence[]; citations: Citation[] } {
  const evidence: Evidence[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const index of citationIndexes(text)) {
    const hit = hits[index - 1];
    if (!hit) continue;
    const span = evidenceFromHit(hit, pack);
    if (!span || seen.has(span.id)) continue;
    seen.add(span.id);
    evidence.push(span);
    citations.push(citationFrom(hit, span));
  }
  return { evidence, citations };
}

async function defaultAsk(prompt: string, modelId: string) {
  const { completeSynthesis } = await import("@/lib/ai/cardsmith");
  return completeSynthesis({ data: { prompt, modelId } });
}

/**
 * Combine cited chunks into a short spoken line. Does not invent.
 * Unverified synthesis is silence.
 */
export async function generateAnswer(
  query: string,
  hits: Hit[],
  t0: number,
  opts?: { ask?: SynthesisAsk; modelId?: string; pack?: RepoPack },
): Promise<GeneratedAnswer | null> {
  if (hits.length === 0) return null;
  const model = getModelById(opts?.modelId) ?? getDefaultModel();
  const prompt = buildSynthesisPrompt(query, hits);
  let remote: { text: string | null; reason?: string; modelName?: string };
  try {
    remote = await Promise.race([
      opts?.ask
        ? opts.ask({ query, prompt, modelId: model.id })
        : defaultAsk(prompt, model.id),
      new Promise<never>((_, reject) => {
        globalThis.setTimeout(() => reject(new Error("timeout")), 12000);
      }),
    ]);
  } catch {
    return null;
  }
  const raw = remote.text?.replace(/\s+/g, " ").trim() ?? "";
  if (!raw || isInsufficient(raw)) return null;
  const say = stripCitationMarkers(raw);
  if (!say) return null;
  const { evidence, citations } = evidenceForMarkers(raw, hits, opts?.pack);
  if (evidence.length === 0) return null;
  const check = verifyClaim(say, evidence);
  if (!check.ok || check.checked === 0) return null;
  return {
    say,
    usedEvidence: true,
    citations,
    latencyMs: Math.round(performance.now() - t0),
    modelName: remote.modelName ?? model.name,
  };
}
