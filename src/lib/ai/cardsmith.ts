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

export const craftCard = createServerFn({ method: "POST" })
  .validator((input: Payload) => input)
  .handler(async ({ data }): Promise<Omit<Card, "latencyMs" | "query">> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { say: null, citations: [], source: "grok", reason: "AI is not available" };
    }
    if (data.hits.length === 0) {
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
          temperature: 0.2,
          max_tokens: 220,
          messages: [
            {
              role: "system",
              content:
                "You write what an engineer should say in a live meeting. " +
                "Reply with JSON only: {\"say\": string|null, \"citations\":[{\"path\",\"line\",\"sha\",\"pr\",\"label\"}]}. " +
                "say is at most two short spoken sentences. Cite only files/commits from the evidence. " +
                "If evidence does not support a true answer, set say to null and citations to []. " +
                "Never invent a SHA, PR number, or file path. " +
                "Start with the answer itself. Never open with 'Based on', 'According to', " +
                "'It appears that', or any reference to context, evidence, or documentation.",
            },
            {
              role: "user",
              content: `Question from the room:\n${data.query}\n\nEvidence:\n${evidence}`,
            },
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

    // The model may only cite files it was shown, and only as file citations:
    // it never sees commit evidence, so it has no standing to produce one.
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
