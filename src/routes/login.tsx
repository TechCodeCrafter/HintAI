import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "@/components/login-page";

export const Route = createFileRoute("/login")({
  // Client-only: avoids SSR/client session mismatch on the sign-in surface.
  ssr: false,
  head: () => ({
    meta: [{ title: "Sign in — MeetHint" }],
  }),
  component: LoginPage,
});
