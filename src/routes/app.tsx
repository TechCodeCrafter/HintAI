import { createFileRoute } from "@tanstack/react-router";
import { Cockpit } from "@/components/cockpit";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [{ title: "MeetHint" }],
  }),
  component: Home,
});

function Home() {
  return <Cockpit />;
}
