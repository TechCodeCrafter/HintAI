import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { preferredLiveSpaceId } from "@/lib/context/live-route";
import { useMeetHint } from "@/lib/store";

/** Live entry — scoped to the user's Knowledge Space when one exists. */
export function LiveNavLink({
  className,
  children,
  onClick,
}: {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  const contexts = useMeetHint((s) => s.contexts);
  const activeSpaceId = useMeetHint((s) => s.activeSpaceId);
  const spaceId = preferredLiveSpaceId(
    activeSpaceId,
    contexts.map((row) => row.id),
  );

  if (spaceId) {
    return (
      <Link
        to="/context/$id/live"
        params={{ id: spaceId }}
        className={className}
        onClick={onClick}
      >
        {children}
      </Link>
    );
  }

  return (
    <Link to="/app" className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
