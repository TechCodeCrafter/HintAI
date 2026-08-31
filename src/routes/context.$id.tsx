import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/context/$id")({
  component: ContextLayout,
});

function ContextLayout() {
  return <Outlet />;
}
