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

  // Only redirect once the store has actually loaded the space list — otherwise
  // this route would show "Loading…" forever, since Cockpit is what calls boot().
  if (spaceId && contextStatus === "ready") {
    return (
      <RequireAuth>
        <Navigate to="/context/$id/live" params={{ id: spaceId }} replace />
      </RequireAuth>
    );
  }

  // Cockpit mounts for every non-redirect outcome and owns boot(); never swap
  // it out on "booting"/"hydrating" or it unmounts mid-boot and re-boots in an
  // infinite loop.
  return (
    <RequireAuth>
      <Cockpit />
    </RequireAuth>
  );
}
