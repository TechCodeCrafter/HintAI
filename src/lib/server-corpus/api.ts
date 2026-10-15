/**
 * Server corpus API (Phase 2 Milestone A).
 *
 * Every function here requires the verified caller (authMiddleware) and scopes
 * all storage by context.userId. Uploads are explicit: the client only calls
 * uploadBatch for spaces the user toggled to server backup (COMPANY MANAGED
 * consent lives in that toggle's copy, not here).
 */
import { createServerFn } from "@tanstack/react-start";

import { authMiddleware } from "@/lib/auth/middleware";
import {
  validateUploadBatch,
  type ServerCorpusUsage,
  type ServerUploadBatch,
} from "./contract.ts";
import type { DocumentChunk, NormalizedPage } from "../document/types.ts";

async function sql() {
  // Dynamic import: @/lib/db boots PGLite on import, which a built server
  // without pglite.data cannot survive. Handlers pay the import cost; the
  // landing page never does (same pattern as waitlist.ts).
  const { getSql } = await import("@/lib/db");
  return getSql();
}

const noDatabase = (where: string) => {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(`[server-corpus] DATABASE_URL is not set — refusing ${where}`);
    return true;
  }
  return false;
};

/** One batch of an upload session. Each call is one tick of the progress bar. */
export const uploadBatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: ServerUploadBatch) => input)
  .handler(async ({ context, data }): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const valid = validateUploadBatch(data);
    if (!valid.ok) return valid;
    if (noDatabase("upload")) {
      return { ok: false, reason: "Server backup needs a database. Set DATABASE_URL and retry." };
    }
    try {
      const { storeUploadBatch } = await import("./store.server");
      return await Promise.race([
        storeUploadBatch(await sql(), context.userId, data),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("upload insert timed out")), 25_000);
        }),
      ]);
    } catch (error) {
      console.error("[server-corpus] upload failed:", error);
      return { ok: false, reason: "Upload failed. Check your connection and retry." };
    }
  });

/** Per-space source states plus the user-wide page budget. */
export const serverCorpusStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { spaceId: string }) => input)
  .handler(async ({ context, data }): Promise<ServerCorpusUsage> => {
    const empty: ServerCorpusUsage = { sources: [], totalPages: 0, pageBudget: 10_000 };
    if (typeof data?.spaceId !== "string" || !data.spaceId) return empty;
    if (noDatabase("status")) return empty;
    try {
      const { corpusStatus } = await import("./store.server");
      return await corpusStatus(await sql(), context.userId, data.spaceId);
    } catch (error) {
      console.error("[server-corpus] status failed:", error);
      return empty;
    }
  });

/**
 * Recall leg for server-backed spaces. Returns chunks + their pages; the
 * client rebuilds coordinates and runs the unchanged card/verify pipeline.
 */
export const retrieveServerChunks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { spaceId: string; query: string; limit?: number }) => input)
  .handler(
    async ({
      context,
      data,
    }): Promise<{ chunks: DocumentChunk[]; pages: NormalizedPage[] }> => {
      const none = { chunks: [], pages: [] };
      if (typeof data?.spaceId !== "string" || typeof data?.query !== "string") return none;
      if (noDatabase("retrieve")) return none;
      try {
        const { retrieveChunks } = await import("./store.server");
        return await retrieveChunks(await sql(), context.userId, data.spaceId, data.query, data.limit ?? 8);
      } catch (error) {
        console.error("[server-corpus] retrieve failed:", error);
        return none;
      }
    },
  );

/** User-initiated deletion (backlog #12): removes every server row for a source. */
export const deleteServerSource = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { spaceId: string; sourceId: string; contentHash: string }) => input)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    if (
      typeof data?.spaceId === "string" &&
      typeof data?.sourceId === "string" &&
      typeof data?.contentHash === "string" &&
      process.env.DATABASE_URL?.trim()
    ) {
      try {
        const { deleteSource } = await import("./store.server");
        await deleteSource(await sql(), context.userId, data.spaceId, data.sourceId, data.contentHash);
      } catch (error) {
        console.error("[server-corpus] delete failed:", error);
      }
    }
    return { ok: true };
  });
