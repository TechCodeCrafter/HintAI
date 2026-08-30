import { NORTHSTAR } from "../repo/northstar.ts";
import type { RepoPack } from "../repo/types.ts";
import type { ContextRepository } from "./repository.ts";
import { getContextRepository, persistPackAsContext } from "./service.ts";
import type { ContextRecord } from "./types.ts";

export const PACK_KEY = "ground.pack";
export const MIGRATION_MARKER_KEY = "ground.pack.migrating";
export const ACTIVE_CONTEXT_KEY = "ground.activeContextId";

export function readSavedPack(): RepoPack | null {
  try {
    const raw = localStorage.getItem(PACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RepoPack;
    if (!parsed?.id || !Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isNorthstarPack(pack: RepoPack): boolean {
  return pack.id === NORTHSTAR.id;
}

export function readActiveContextId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CONTEXT_KEY);
  } catch {
    return null;
  }
}

export function persistActiveContextId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_CONTEXT_KEY, id);
    else localStorage.removeItem(ACTIVE_CONTEXT_KEY);
  } catch {
    /* ignore quota */
  }
}

function writeMarker(id: string): void {
  try {
    localStorage.setItem(MIGRATION_MARKER_KEY, id);
  } catch {
    /* ignore */
  }
}

function clearMarker(): void {
  try {
    localStorage.removeItem(MIGRATION_MARKER_KEY);
  } catch {
    /* ignore */
  }
}

function clearLegacyPack(): void {
  try {
    localStorage.removeItem(PACK_KEY);
  } catch {
    /* ignore */
  }
}

export type MigrationResult =
  | { kind: "none" }
  | { kind: "ignored-demo" }
  | { kind: "migrated"; context: ContextRecord; pack: RepoPack }
  | { kind: "failed"; error: string };

/**
 * One-shot move from localStorage `ground.pack` into IndexedDB.
 * The legacy key is deleted only after a read-back fingerprint matches.
 */
export async function migrateLegacyPack(
  repo: ContextRepository = getContextRepository(),
): Promise<MigrationResult> {
  const saved = readSavedPack();
  if (!saved) {
    clearMarker();
    return { kind: "none" };
  }
  if (isNorthstarPack(saved)) {
    clearLegacyPack();
    clearMarker();
    return { kind: "ignored-demo" };
  }

  writeMarker(saved.id);
  try {
    const { context, pack } = await persistPackAsContext(saved, repo);
    clearLegacyPack();
    clearMarker();
    persistActiveContextId(context.id);
    return { kind: "migrated", context, pack };
  } catch (error) {
    return {
      kind: "failed",
      error: error instanceof Error ? error.message : "Could not migrate the saved folder",
    };
  }
}
