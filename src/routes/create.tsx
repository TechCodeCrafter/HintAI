import { createFileRoute } from "@tanstack/react-router";
import { CreateContextFlow } from "@/components/create-context-flow";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [{ title: "Create context — MeetHint" }],
  }),
  component: CreatePage,
});

function CreatePage() {
  return <CreateContextFlow />;
}
