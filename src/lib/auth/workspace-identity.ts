import { createServerFn } from "@tanstack/react-start";

import { authMiddleware } from "./middleware.ts";

/**
 * Server-derived identity for vault binding. Personal workspace id equals userId.
 * Client code must bind IndexedDB to this id — never to an unverified client id alone.
 *
 * Lives outside `*.server.ts` so client hooks can call the RPC bridge without
 * tripping TanStack Start import protection.
 */
export const resolveWorkspaceIdentity = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context }) => ({
    userId: context.userId,
    workspaceId: context.userId,
  }));
