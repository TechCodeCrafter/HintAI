export const SPACE_SCHEMA_VERSION = 1;

/**
 * Knowledge Space — grouped contexts/sources searched together in a live session.
 * Legacy: space.id often equals the sole member context.id (1:1 migration).
 */
export type SpaceRecord = {
  id: string;
  workspaceId?: string;
  name: string;
  /** Authorized member contexts — retrieval union is scoped to these ids. */
  memberContextIds: string[];
  /** Default context for UI routes and exclude-pattern source. */
  primaryContextId: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
};

export class SpaceNotFoundError extends Error {
  constructor(id: string) {
    super(`Knowledge space ${id} was not found`);
    this.name = "SpaceNotFoundError";
  }
}
