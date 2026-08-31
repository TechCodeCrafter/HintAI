import { createFileRoute } from "@tanstack/react-router";
import { Cockpit } from "@/components/cockpit";

export const Route = createFileRoute("/context/$id/live")({
  head: () => ({
    meta: [{ title: "Live session — MeetHint" }],
  }),
  component: LivePage,
});

function LivePage() {
  const { id } = Route.useParams();
  return <Cockpit contextId={id} />;
}
