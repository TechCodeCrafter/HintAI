import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    // NOTE: not AppErrorComponent — it takes ErrorComponentProps, which is
    // not assignable to NotFoundRouteProps (broke `npm run typecheck`).
    defaultNotFoundComponent: () => (
      <div className="p-6 text-sm text-muted">This page couldn't be found.</div>
    ),
  });
}
