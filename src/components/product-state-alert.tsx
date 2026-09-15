import type { ProductState } from "@/lib/product-states";

export function ProductStateAlert({ state }: { state: ProductState }) {
  return (
    <div className="rounded-sm border border-line bg-surface px-4 py-3" role="alert" data-testid={`product-state-${state.code}`}>
      <p className="text-sm font-medium text-fg">{state.title}</p>
      <p className="mt-1 text-sm text-muted">{state.message}</p>
      {state.action ? <p className="mt-2 text-xs text-accent">{state.action}</p> : null}
    </div>
  );
}
