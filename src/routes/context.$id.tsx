import { Outlet, createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";

export const Route = createFileRoute("/context/$id")({
  component: ContextLayout,
});

function ContextLayout() {
  return (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  );
}
