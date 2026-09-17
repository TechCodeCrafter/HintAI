import { createFileRoute } from "@tanstack/react-router";

import { readDeployBuildInfo } from "@/lib/deploy/build-info.server";

/** Lightweight deploy probe — commit SHA/ref for production verification scripts. */
export const Route = createFileRoute("/api/deploy/status")({
  server: {
    handlers: {
      GET: () => {
        const info = readDeployBuildInfo();
        return Response.json(info, {
          headers: { "cache-control": "no-cache" },
        });
      },
    },
  },
});
