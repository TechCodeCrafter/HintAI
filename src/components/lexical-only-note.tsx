import { cn } from "@/lib/cn";
import type { Card } from "@/lib/repo/types";
import { LEXICAL_ONLY_DETAIL, LEXICAL_ONLY_NOTE } from "@/lib/search/readiness";

/**
 * The mark on a Card that was ranked on words and structure only, because
 * the space's vectors were not ready when the question was asked. Shown on a
 * Card that speaks and on one that is silent: either way the ranking was
 * narrower than usual. Renders nothing for any other Card.
 */
export function LexicalOnlyNote({ card, className }: { card: Pick<Card, "lexicalOnly"> | null | undefined; className?: string }) {
  if (!card?.lexicalOnly) return null;
  return (
    <span className={cn("lexical-only-note", className)} data-testid="lexical-only-note" title={LEXICAL_ONLY_DETAIL}>
      {LEXICAL_ONLY_NOTE}
    </span>
  );
}
