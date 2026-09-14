/**
 * Workspace = account/team boundary (ROADMAP Phase 0).
 *
 * Personal workspaces today: workspaceId equals the bound account id. Every
 * persisted repo row and retrieval pass must carry this id so a wrong vault
 * binding cannot leak across users.
 */
import { currentAccountId, LOCAL_DEV_ACCOUNT_ID } from "./account-boundary.ts";

export type WorkspaceId = string;

export class WorkspaceScopeError extends Error {
  readonly code = "workspace-scope";

  constructor(message: string) {
    super(message);
    this.name = "WorkspaceScopeError";
  }
}

/** Active workspace, or null before account bind. */
export function currentWorkspaceId(): WorkspaceId | null {
  return currentAccountId();
}

/** Workspace for new records when tests run without an explicit bind. */
export function defaultWorkspaceId(): WorkspaceId {
  return currentWorkspaceId() ?? LOCAL_DEV_ACCOUNT_ID;
}

export function requireWorkspaceId(): WorkspaceId {
  const id = currentWorkspaceId();
  if (!id) throw new WorkspaceScopeError("No workspace is bound");
  return id;
}

export function assertWorkspaceMatch(recordWorkspaceId: string | undefined, operation: string): void {
  const expected = currentWorkspaceId();
  if (!expected) return;
  if (recordWorkspaceId && recordWorkspaceId !== expected) {
    throw new WorkspaceScopeError(`${operation}: record workspace ${recordWorkspaceId} ≠ ${expected}`);
  }
}

export function withWorkspaceBackfill<T extends { workspaceId?: string }>(
  record: T,
  fallback: WorkspaceId = defaultWorkspaceId(),
): T & { workspaceId: WorkspaceId } {
  const workspaceId = record.workspaceId ?? fallback;
  assertWorkspaceMatch(workspaceId, "read");
  return workspaceId === record.workspaceId ? (record as T & { workspaceId: WorkspaceId }) : { ...record, workspaceId };
}

export function stampWorkspace<T extends { workspaceId?: string }>(
  record: T,
  workspaceId: WorkspaceId = requireWorkspaceId(),
): T & { workspaceId: WorkspaceId } {
  return { ...record, workspaceId };
}
