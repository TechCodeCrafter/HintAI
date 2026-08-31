import { createFileRoute } from "@tanstack/react-router";
import { AskStub } from "@/components/ask-stub";

export const Route = createFileRoute("/context/$id/ask")({
  head: () => ({
    meta: [{ title: "Ask — MeetHint" }],
  }),
  component: AskPage,
});

function AskPage() {
  const { id } = Route.useParams();
  return <AskStub id={id} />;
}
