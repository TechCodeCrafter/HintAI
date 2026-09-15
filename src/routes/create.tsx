import { createFileRoute } from "@tanstack/react-router";
import { CreateContextFlow } from "@/components/create-context-flow";
import { RequireAuth } from "@/components/require-auth";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [{ title: "Create Knowledge Space — MeetHint" }],
  }),
  component: CreatePage,
});

function CreatePage() {
  return (
    <RequireAuth>
      <CreateContextFlow />
    </RequireAuth>
  );
}
