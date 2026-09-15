import { createFileRoute } from "@tanstack/react-router";
import { Cockpit } from "@/components/cockpit";
import { RequireAuth } from "@/components/require-auth";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [{ title: "MeetHint" }],
  }),
  component: Home,
});

function Home() {
  return (
    <RequireAuth>
      <Cockpit />
    </RequireAuth>
  );
}
