import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The landing page moved to the root when meethint.ai was pointed at it. This
 * route stays behind so links already shared as /soon keep resolving instead of
 * 404ing.
 */
export const Route = createFileRoute("/soon")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
