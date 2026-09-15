"use client";

import type { ReactNode } from "react";
import { authEnabled } from "@/lib/auth/client";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

function AuthLoading() {
  return (
    <div className="grid min-h-[40vh] place-items-center p-8" data-testid="auth-loading">
      <div className="h-8 w-8 animate-pulse rounded-full bg-black/10 dark:bg-white/15" aria-hidden />
      <span className="sr-only">Loading session…</span>
    </div>
  );
}

/** Redirect unauthenticated visitors to `/login` when auth is enabled. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (!authEnabled) return <>{children}</>;
  if (isPending) return <AuthLoading />;
  if (!user) return <RedirectToSignIn />;
  return <>{children}</>;
}
