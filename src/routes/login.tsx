import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Sign in — MeetHint" }],
  }),
  component: lazyRouteComponent(() =>
    import("@/components/login-page").then((mod) => ({ default: mod.LoginPage })),
  ),
});
