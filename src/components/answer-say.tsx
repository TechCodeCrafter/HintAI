import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const TOKEN =
  /(`[^`]+`|\b[A-Z][A-Z0-9_]*\s*=\s*\d+\b|\b[A-Z][A-Z0-9_]{2,}\b|\b[a-z][a-zA-Z0-9]*\([^)]{0,48}\))/g;

function kindOf(token: string): "const" | "fn" {
  return token.includes("(") ? "fn" : "const";
}

export function highlightAnswer(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    const token = match[0];
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const bare = token.startsWith("`") ? token.slice(1, -1) : token;
    nodes.push(
      <code key={`${start}-${token}`} className={kindOf(bare) === "fn" ? "answer-code-fn" : "answer-code-const"}>
        {bare}
      </code>,
    );
    cursor = start + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function AnswerSay({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <p data-testid="card-say" className={cn("answer-body", className)}>
      {highlightAnswer(text)}
    </p>
  );
}
