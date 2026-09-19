/** Built-in demo pack — not a persisted Knowledge Space. */
export const DEMO_PACK_ID = "northstar-payments";

export function isDemoPackId(id: string | null | undefined): boolean {
  return id === DEMO_PACK_ID;
}

/** Prefer the active real space; otherwise the first saved space. */
export function preferredLiveSpaceId(
  activeSpaceId: string | null | undefined,
  spaceIds: string[],
): string | null {
  if (activeSpaceId && !isDemoPackId(activeSpaceId)) return activeSpaceId;
  return spaceIds[0] ?? null;
}
