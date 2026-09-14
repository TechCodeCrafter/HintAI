import { createFileRoute } from "@tanstack/react-router";
import { AskPanel } from "@/components/ask-panel";

export const Route = createFileRoute("/context/$id/ask")({
  head: () => ({
    meta: [{ title: "Ask — MeetHint" }],
  }),
  component: AskPage,
});

function AskPage() {
  const { id } = Route.useParams();
  return <AskPanel spaceId={id} />;
}
