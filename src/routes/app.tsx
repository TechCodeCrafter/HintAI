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

  if (contextStatus === "booting" || contextStatus === "hydrating") {
    return (
      <RequireAuth>
        <p className="p-8 text-sm text-muted">Loading Knowledge Space…</p>
      </RequireAuth>
    );
  }

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
