"use client";

import { Link } from "@tanstack/react-router";
import { authEnabled } from "@/lib/auth/client";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useClientMounted } from "@/lib/use-client-mounted";

/** Signed-in account chip + sign out (or sign-in link when auth is on). */
export function AuthChrome() {
  const mounted = useClientMounted();
  const { isPending } = useCurrentUserState();
  if (!authEnabled) return null;
  if (!mounted || isPending) {
    return <div className="h-8 w-8 animate-pulse rounded-full bg-black/10 dark:bg-white/15" aria-hidden />;
  }
  return (
    <>
      <SignedOut>
        <Link to="/login" className="text-sm font-medium text-muted hover:text-fg">
          Sign in
        </Link>
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </>
  );
}
