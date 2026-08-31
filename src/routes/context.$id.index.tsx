import { createFileRoute } from "@tanstack/react-router";
import { ContextDetail } from "@/components/context-detail";

export const Route = createFileRoute("/context/$id/")({
  head: () => ({
    meta: [{ title: "Context — MeetHint" }],
  }),
  component: ContextPage,
});

function ContextPage() {
  const { id } = Route.useParams();
  return <ContextDetail id={id} />;
}
