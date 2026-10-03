import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Cockpit } from "@/components/cockpit";
import { RequireAuth } from "@/components/require-auth";
import { preferredLiveSpaceId } from "@/lib/context/live-route";
import { useMeetHint } from "@/lib/store";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [{ title: "MeetHint" }],
  }),
  component: Home,
});

function Home() {
  const contexts = useMeetHint((s) => s.contexts);
  const activeSpaceId = useMeetHint((s) => s.activeSpaceId);
  const contextStatus = useMeetHint((s) => s.contextStatus);
  const spaceId = preferredLiveSpaceId(
    activeSpaceId,
    contexts.map((row) => row.id),
  );

  // Cockpit must render even while `contextStatus` is "booting" / "hydrating".
  // Cockpit's mount effect is the ONLY caller of `boot()` (cockpit.tsx), and
  // `boot()` is what clears that status. Gating Cockpit behind the status it is
  // responsible for clearing deadlocked /app on "Loading Knowledge Space…"
  // forever: the initial store state is "booting" (store.ts), so Cockpit never
  // mounted, boot never ran, and the status never changed. It also tore Cockpit
  // down and remounted it on every boot cycle, which re-ran the workspace
  // identity server function and the ASR worker warm-up each time.
  //
  // Cockpit already subscribes to contextStatus and contextUpdating and renders
  // its own indexing/status note, so the loading state is still surfaced.
  if (spaceId) {
    return (
      <RequireAuth>
        <Navigate to="/context/$id/live" params={{ id: spaceId }} replace />
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <Cockpit />
    </RequireAuth>
  );
}
