import type { HTMLAttributes, ReactNode } from "react";
import { EvidenceViewContext, useEvidenceView, type EvidenceCardFields } from "@/components/use-evidence-view";

/**
 * A card whose evidence opens when the pointer rests on it or a finger is held
 * on it, as well as from the "Why this answer?" control inside it.
 *
 * It adds listeners and two data attributes to the element it renders and
 * nothing else: no focus, no layout, no request.
 */
export function EvidenceCard({
  card,
  children,
  ...rest
}: { card: EvidenceCardFields | null | undefined; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const { view, cardProps } = useEvidenceView(card);
  return (
    <EvidenceViewContext.Provider value={view}>
      <div
        {...rest}
        {...(card?.say ? cardProps : null)}
        data-evidence-card=""
        data-evidence-open={view.open ? (view.pinned ? "pinned" : "hover") : "closed"}
      >
        {children}
      </div>
    </EvidenceViewContext.Provider>
  );
}
