import { productState } from "@/lib/product-states";
import { countExcludedSources } from "@/lib/context/exclusions";
import type { StoredSource } from "@/lib/context/types";
import type { RepoPack } from "@/lib/repo/types";

export function SourcesExclusionAlert({
  sources,
  pack,
  onIncludeAll,
}: {
  sources: StoredSource[];
  pack: Pick<RepoPack, "files" | "excludePatterns">;
  onIncludeAll: () => void;
}) {
  const { total, excluded } = countExcludedSources(sources, pack.files, pack.excludePatterns);
  if (excluded === 0) return null;

  const allExcluded = total > 0 && excluded === total;
  const state = productState("sources-excluded");

  return (
    <div
      className="rounded-sm border border-warn/40 bg-warn/10 px-4 py-3"
      role="alert"
      data-testid="sources-exclusion-alert"
      data-all-excluded={allExcluded ? "true" : "false"}
    >
      <p className="text-sm font-medium text-fg">{state.title}</p>
      <p className="mt-1 text-sm text-muted">
        {allExcluded
          ? state.message
          : `${excluded} of ${total} sources are excluded. Answers may miss PDFs, docs, or code until you include them.`}
      </p>
      <button
        type="button"
        className="mt-3 inline-flex h-9 items-center rounded-sm border border-line bg-surface px-3 text-xs font-medium text-fg hover:border-accent"
        data-testid="include-all-sources"
        onClick={onIncludeAll}
      >
        {state.action ?? "Include all sources"}
      </button>
    </div>
  );
}
