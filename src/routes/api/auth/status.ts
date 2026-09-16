import { createFileRoute } from "@tanstack/react-router";

import { assessProductionAuthConfig } from "@/lib/auth/production-config.server";

/** Lightweight deploy check — auth mode, OAuth readiness, and fail-closed signals. */
export const Route = createFileRoute("/api/auth/status")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const report = assessProductionAuthConfig(request);
        return Response.json({
          ...report,
          reason: report.blockers[0] ?? null,
        });
      },
    },
  },
});
