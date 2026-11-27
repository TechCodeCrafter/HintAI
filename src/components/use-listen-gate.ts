import { listenGateOf, useMeetHint } from "@/lib/store";

/**
 * Whether Listen may start, and why not when it may not. True exactly when
 * the index chip reports Ready. Selected as two plain values, so a component
 * re-renders when the answer changes and not on every step of the warm-up.
 */
export function useListenGate(): { ready: boolean; reason: string | null } {
  const ready = useMeetHint((s) => listenGateOf(s).ready);
  const reason = useMeetHint((s) => listenGateOf(s).reason);
  return { ready, reason };
}
