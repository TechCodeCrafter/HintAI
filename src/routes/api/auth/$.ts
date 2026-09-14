import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";

/** Same-origin Better Auth handler — session cookies and OAuth callbacks land here. */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
