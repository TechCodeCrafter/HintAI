import { createServerFn } from "@tanstack/react-start";
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
  task?: "refine" | "polish" | "assist";
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
    "You suggest a brief meeting answer from general knowledge. " +
    "Reply with JSON only: {\"say\": string|null}. " +
    "Be concise. If unsure, say so. Do not invent facts about the user's files, " +
    "repos, or documents. Never invent a file path, SHA, or PR. " +
    "Do not claim the answer came from their material."
  );
}

export const craftCard = createServerFn({ method: "POST" })
  .validator((input: Payload) => input)
  .handler(async ({ data }): Promise<Omit<Card, "latencyMs" | "query">> => {
    const apiKey = process.env.XAI_API_KEY;
    const task = data.task ?? "refine";
    if (!apiKey) {
      return { say: null, citations: [], source: "grok", reason: "AI is not available" };
    }
    if (task !== "assist" && data.hits.length === 0) {
      return { say: null, citations: [], source: "grok" };
    }

    const evidence = data.hits
      .slice(0, 6)
      .map(
        (h, i) =>
          `[${i + 1}] ${h.kind} ${h.path}:${h.startLine}` +
          `${h.sha ? ` sha ${h.sha}` : ""}${h.pr ? ` PR #${h.pr}` : ""}` +
          `${h.author ? ` ${h.author}` : ""}\n${h.message ? h.message + "\n" : ""}${h.text.slice(0, 700)}`,
      )
      .join("\n\n");

    const userParts = [`Question from the room:\n${data.query}`];
    if (data.evidenceSay) userParts.push(`Evidence-backed wording to rewrite:\n${data.evidenceSay}`);
    if (data.instruction) userParts.push(`Instruction:\n${data.instruction}`);
    if (data.threadContext) userParts.push(`Open thread:\n${data.threadContext}`);
    if (evidence) userParts.push(`Evidence:\n${evidence}`);

    const system = task === "assist" ? assistSystem() : task === "polish" ? polishSystem() : refineSystem();

    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(3500),
        body: JSON.stringify({
          model: "grok-4.5",
          temperature: task === "assist" ? 0.3 : 0.2,
          max_tokens: 220,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userParts.join("\n\n") },
          ],
        }),
      });
    } catch {
      return { say: null, citations: [], source: "grok", reason: "timeout" };
    }

    if (!res.ok) {
      return { say: null, citations: [], source: "grok", reason: `xAI ${res.status}` };
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const parsed = parseJson(body.choices?.[0]?.message?.content ?? "");
    const say = sayable(parsed?.say);
    if (!say) {
      return { say: null, citations: [], source: "grok" };
    }

    if (task === "assist" || task === "polish") {
      return {
        say: say.slice(0, 280),
        citations: [],
        source: "grok",
      };
    }

    const allowed = new Set(data.hits.map((h) => h.path));
    const citations: Citation[] = (parsed?.citations ?? []).filter(
      (c): c is FileCitation => c.kind === "file" && allowed.has(c.path),
    );
    if (citations.length === 0) {
      const top = data.hits[0];
      citations.push({
        kind: "file",
        path: top.path,
        line: top.startLine,
        sha: top.sha,
        pr: top.pr,
        label: top.pr ? `PR #${top.pr}` : top.path,
      });
    }

    return {
      say: say.slice(0, 280),
      citations,
      source: "grok",
    };
  });
