import { createServerFn } from "@tanstack/react-start";
import { getDefaultModel, getModelById, type ModelOption, type ModelProvider, type ProviderKeys } from "@/lib/ai/models";
import type { Card, Citation, FileCitation, Hit } from "@/lib/repo/types";
import { sayable } from "@/lib/search/say";

type Payload = {
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
  evidenceSay?: string;
  instruction?: string;
  threadContext?: string | null;
  task?: "refine" | "polish" | "assist" | "answer";
};

function parseJson(raw: string): { say: string | null; citations?: Citation[] } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as {
      say: string | null;
      citations?: Citation[];
    };
  } catch {
    return null;
  }
}

function refineSystem(): string {
  return (
    "You write what an engineer should say in a live meeting. " +
    "Reply with JSON only: {\"say\": string|null, \"citations\":[{\"path\",\"line\",\"sha\",\"pr\",\"label\"}]}. " +
    "say is at most two short spoken sentences. Cite only files/commits from the evidence. " +
    "If evidence does not support a true answer, set say to null and citations to []. " +
    "Never invent a SHA, PR number, or file path. " +
    "Start with the answer itself. Never open with 'Based on', 'According to', " +
    "'It appears that', or any reference to context, evidence, or documentation."
  );
}

function polishSystem(): string {
  return (
    "You rewrite a meeting answer so it sounds natural when spoken. " +
    "Reply with JSON only: {\"say\": string|null}. " +
    "Do not change any facts. Do not add claims. Do not invent files, SHAs, or PRs. " +
    "Keep the answer to at most two short spoken sentences. " +
    "If you cannot rewrite without changing facts, return the original wording."
  );
}

function assistSystem(): string {
  return (
    "You are in Free mode. Suggest a brief spoken meeting answer. " +
    "Reply with JSON only: {\"say\": string|null}. " +
    "Do not cite files. Do not claim the answer came from the user's material. " +
    "Never invent a file path, SHA, or PR. If you cannot answer, return say null."
  );
}

function answerSystem(): string {
  return `You are the staff engineer who built the loaded system. You are in a design review.
Speak in first person as the person who owns this code. The Card is what you say out loud.

HARD RULES:
1. If the retrieved files name a service, lambda, store, route, class, or file, say that name.
   A correct answer that never names a component from the files is a fail.
2. Do not give a textbook definition, a modularity/scalability lecture, or "reach out for support".
   Those are junior answers. Answer THIS system.
3. Why questions: the constraint, what we chose, what we accepted. Name the pieces.
   If they ask why there are N lambdas or workers, name each distinct
   container-lambdas/<name> folder you can see and what that worker owns.
   A numbered list (1) 2) 3)) inside one function is a procedure, not the fleet.
   Do not say modularity, scalability, isolate failures, or independent scale
   unless those words appear in the files. Speak in first person: I split X from Y because...
4. How / what questions: the real path — who calls whom, what is written, what happens on failure.
5. Concept questions (hash map, queue, cache): one short definition, then how THIS repo uses it.
   If the files show hashing, dictionaries, or a registry, talk about that use.
6. 3-5 spoken sentences. Specific beats short.
7. Paraphrase. Do not read the files verbatim.
8. Do not invent metrics, companies, or services that are not in the files.
   If a number is missing, describe the behavior without making one up.
9. If the files do not cover the question, return nothing. Not a polite sentence. Null.
   Do not answer from general knowledge, experience, or "what one would typically do".
10. Never open with "Based on", "According to", or any reference to documents or context.

Respond with ONLY the spoken answer. No quotes, no prefixes, no JSON.`;
}

function parseSpoken(raw: string): string | null {
  const parsed = parseJson(raw);
  if (parsed?.say) return sayable(parsed.say);
  return sayable(raw.replace(/^["“]|["”]$/g, ""));
}

function asPayload(input: Payload | { data?: Payload }): Payload {
  if (input && typeof input === "object" && "query" in input && typeof input.query === "string") {
    return input;
  }
  if (input && typeof input === "object" && "data" in input && input.data && typeof input.data.query === "string") {
    return input.data;
  }
  return { query: "", hits: [] };
}

function envKey(provider: ModelProvider): string | undefined {
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  return process.env.XAI_API_KEY;
}

function resolveKey(provider: ModelProvider, keys?: ProviderKeys): string | undefined {
  const fromClient = keys?.[provider]?.trim();
  return fromClient || envKey(provider);
}

function missingKeyReason(): string {
  return "Add API key";
}

function buildRequest(model: ModelOption, system: string, user: string, apiKey: string): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  if (model.provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: model.modelId,
        max_tokens: model.maxTokens,
        temperature: 0.3,
        system,
        messages: [{ role: "user", content: user }],
      },
    };
  }
  const url =
    model.provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.x.ai/v1/chat/completions";
  return {
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: {
      model: model.modelId,
      temperature: 0.3,
      max_tokens: model.maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
  };
}

function readCompletion(provider: ModelProvider, body: unknown): string {
  if (!body || typeof body !== "object") return "";
  if (provider === "anthropic") {
    const blocks = (body as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
    return blocks
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("");
  }
  return (body as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
}

async function completeChat(
  system: string,
  user: string,
  model: ModelOption,
  keys?: ProviderKeys,
  timeoutMs = 8000,
) {
  const apiKey = resolveKey(model.provider, keys);
  console.info("[completeChat] provider:", model.provider, "apiKey present:", Boolean(apiKey));
  if (!apiKey) return { raw: null as string | null, reason: missingKeyReason() };
  const request = buildRequest(model, system, user, apiKey);
  try {
    const res = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(request.body),
    });
    if (!res.ok) {
      console.info("[completeChat] status:", model.provider, res.status);
      return { raw: null, reason: `${model.provider} ${res.status}` };
    }
    const raw = readCompletion(model.provider, await res.json());
    return { raw, reason: undefined };
  } catch {
    return { raw: null, reason: "timeout" };
  }
}

const GROK_MODEL: ModelOption = {
  id: "grok-4.5",
  name: "Grok 4.5",
  provider: "xai",
  modelId: "grok-4.5",
  description: "xAI",
  maxTokens: 220,
  default: false,
};

export const providerKeyStatus = createServerFn({ method: "GET" }).handler(async () => ({
  openai: Boolean(process.env.OPENAI_API_KEY),
  anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  xai: Boolean(process.env.XAI_API_KEY),
}));

type SpeakInput = {
  query?: string;
  prompt?: string;
  modelId?: string;
  keys?: ProviderKeys;
  data?: { query?: string; prompt?: string; modelId?: string; keys?: ProviderKeys };
};

function speakInput(input: SpeakInput) {
  const inner = input && typeof input.query === "string" ? input : (input?.data ?? {});
  return {
    query: typeof inner.query === "string" ? inner.query : "",
    prompt: typeof inner.prompt === "string" ? inner.prompt : "",
    modelId: typeof inner.modelId === "string" ? inner.modelId : undefined,
    keys: inner.keys,
  };
}

/** Raw completion for grounded synthesis. Search never calls this. */
export const completeSynthesis = createServerFn({ method: "POST" })
  .validator((input: SpeakInput) => speakInput(input))
  .handler(async ({ data }): Promise<{ text: string | null; reason?: string; modelName?: string }> => {
    const model = getModelById(data.modelId) ?? getDefaultModel();
    const { raw, reason } = await completeChat(
      "Follow the user instructions exactly. Use only the document chunks in the prompt. Never use general knowledge. Reply with only the spoken answer or INSUFFICIENT.",
      data.prompt || data.query,
      model,
      data.keys,
      12000,
    );
    if (raw == null) return { text: null, reason, modelName: model.name };
    const text = raw.replace(/\s+/g, " ").trim();
    return text ? { text: text.slice(0, 1800), modelName: model.name } : { text: null, reason: "empty", modelName: model.name };
  });

/** Explicit Free-mode / rewrite path only. Search never calls this. */
export const speakAnswer = createServerFn({ method: "POST" })
  .validator((input: SpeakInput) => speakInput(input))
  .handler(async ({ data }): Promise<{ say: string | null; reason?: string; modelName?: string }> => {
    const model = getModelById(data.modelId) ?? getDefaultModel();
    const { raw, reason } = await completeChat(
      answerSystem(),
      `${data.prompt}\n\nQuestion: ${data.query}`,
      model,
      data.keys,
      12000,
    );
    if (raw == null) return { say: null, reason, modelName: model.name };
    const say = parseSpoken(raw);
    return say ? { say: say.slice(0, 1800), modelName: model.name } : { say: null, reason: "empty", modelName: model.name };
  });

export const craftCard = createServerFn({ method: "POST" })
  .validator((input: Payload | { data?: Payload }) => asPayload(input))
  .handler(async ({ data }): Promise<Omit<Card, "latencyMs" | "query">> => {
    const payload = asPayload(data);
    const apiKey = process.env.XAI_API_KEY;
    const task = payload.task ?? "refine";
    const hits = payload.hits ?? [];
    if (!apiKey) {
      return { say: null, citations: [], source: "grok", reason: "AI is not available" };
    }
    if (task !== "assist" && task !== "answer" && hits.length === 0) {
      return { say: null, citations: [], source: "grok" };
    }

    const evidence = hits
      .slice(0, 6)
      .map(
        (h, i) =>
          `[${i + 1}] ${h.kind} ${h.path}:${h.startLine}` +
          `${h.sha ? ` sha ${h.sha}` : ""}${h.pr ? ` PR #${h.pr}` : ""}` +
          `${h.author ? ` ${h.author}` : ""}\n${h.message ? h.message + "\n" : ""}${h.text.slice(0, 700)}`,
      )
      .join("\n\n");

    const userParts = [`Question from the room:\n${payload.query}`];
    if (payload.evidenceSay) userParts.push(`Evidence-backed wording to rewrite:\n${payload.evidenceSay}`);
    if (payload.instruction) userParts.push(`Instruction:\n${payload.instruction}`);
    if (payload.threadContext) userParts.push(`Open thread:\n${payload.threadContext}`);
    if (evidence) userParts.push(`Evidence:\n${evidence}`);

    const system =
      task === "answer"
        ? answerSystem()
        : task === "assist"
          ? assistSystem()
          : task === "polish"
            ? polishSystem()
            : refineSystem();

    const { raw, reason } = await completeChat(
      system,
      userParts.join("\n\n"),
      GROK_MODEL,
      undefined,
      task === "answer" ? 8000 : 3500,
    );
    if (raw == null) {
      return { say: null, citations: [], source: "grok", reason };
    }

    const parsed = parseJson(raw);
    const say = task === "answer" ? parseSpoken(raw) : sayable(parsed?.say);
    if (!say) {
      return { say: null, citations: [], source: "grok" };
    }

    if (task === "assist" || task === "polish" || task === "answer") {
      return {
        say: say.slice(0, 280),
        citations: [],
        source: "grok",
      };
    }

    const allowed = new Set(hits.map((h) => h.path));
    const citations: Citation[] = (parsed?.citations ?? []).filter(
      (c): c is FileCitation => c.kind === "file" && allowed.has(c.path),
    );
    // A ranked hit is not provenance. If the model did not name admitted
    // evidence, there is no citation and no spoken line.
    if (citations.length === 0) {
      return { say: null, citations: [], source: "grok" };
    }

    return {
      say: say.slice(0, 280),
      citations,
      source: "grok",
    };
  });
