/**
 * Server-side corpus storage (server-only: imports @/lib/db).
 *
 * Called exclusively from createServerFn handlers in api.ts, which scope
 * every call by the verified userId. No function here trusts its caller.
 */
import type { Sql } from "@/lib/db";
import type { DocumentChunk, NormalizedPage } from "../document/types.ts";
import {
  SERVER_CORPUS_LIMITS,
  quotaAfterUpload,
  type ServerCorpusUsage,
  type ServerDocMeta,
  type ServerSourceStatus,
  type ServerUploadBatch,
} from "./contract.ts";

async function userPageTotal(sql: Sql, userId: string): Promise<number> {
  const rows = await sql<{ pages: number }>`
    select coalesce(sum(page_count), 0)::int as pages
    from server_sources
    where user_id = ${userId} and status = 'ready'
  `;
  return rows[0]?.pages ?? 0;
}

export async function storeUploadBatch(
  sql: Sql,
  userId: string,
  batch: ServerUploadBatch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const meta: ServerDocMeta = batch.meta;
  if (batch.batchIndex === 0) {
    // A re-upload of the same bytes resumes cleanly: drop the prior attempt.
    await sql`
      delete from server_chunks
      where user_id = ${userId} and space_id = ${meta.spaceId}
        and source_id = ${meta.sourceId} and content_hash = ${meta.contentHash}
    `;
    await sql`
      delete from server_pages
      where user_id = ${userId} and space_id = ${meta.spaceId}
        and source_id = ${meta.sourceId} and content_hash = ${meta.contentHash}
    `;
    await sql`
      insert into server_sources
        (user_id, space_id, source_id, path, kind, content_hash,
         parser_version, normalizer_version, page_count, chunk_count, status)
      values (${userId}, ${meta.spaceId}, ${meta.sourceId}, ${meta.path}, ${meta.kind},
        ${meta.contentHash}, ${meta.parserVersion ?? 0}, ${meta.normalizerVersion ?? 0},
        0, 0, 'uploading')
      on conflict (user_id, space_id, source_id, content_hash)
      do update set path = excluded.path, status = 'uploading',
        page_count = 0, chunk_count = 0, updated_at = now()
    `;
  }

  const existing = await sql<{ page_count: number; chunk_count: number; status: string }>`
    select page_count, chunk_count, status from server_sources
    where user_id = ${userId} and space_id = ${meta.spaceId}
      and source_id = ${meta.sourceId} and content_hash = ${meta.contentHash}
  `;
  const row = existing[0];
  if (!row) return { ok: false, reason: "Upload session not started." };
  const nextPages = row.page_count + batch.pages.length;
  const nextChunks = row.chunk_count + batch.chunks.length;
  if (nextPages > SERVER_CORPUS_LIMITS.maxPagesPerSource) {
    return { ok: false, reason: "Source exceeds the per-document page limit." };
  }
  if (nextChunks > SERVER_CORPUS_LIMITS.maxChunksPerSource) {
    return { ok: false, reason: "Source exceeds the per-document chunk limit." };
  }
  if (batch.isLast) {
    const current = await userPageTotal(sql, userId);
    // Pages already counted for a resumed re-upload of this source are
    // replaced, not added — but v1 keeps the simple conservative check.
    const quota = quotaAfterUpload(current, nextPages);
    if (!quota.ok) return quota;
  }

  for (const page of batch.pages) {
    await sql`
      insert into server_pages
        (user_id, space_id, source_id, content_hash, page_number, page)
      values (${userId}, ${meta.spaceId}, ${meta.sourceId}, ${meta.contentHash},
        ${page.pageNumber}, ${JSON.stringify(page)}::jsonb)
      on conflict (user_id, space_id, source_id, content_hash, page_number)
      do update set page = excluded.page
    `;
  }
  for (const chunk of batch.chunks) {
    await sql`
      insert into server_chunks
        (user_id, space_id, source_id, content_hash, chunk)
      values (${userId}, ${meta.spaceId}, ${meta.sourceId}, ${meta.contentHash},
        ${JSON.stringify(chunk)}::jsonb)
    `;
  }
  await sql`
    update server_sources
    set page_count = ${nextPages}, chunk_count = ${nextChunks},
      status = ${batch.isLast ? "ready" : "uploading"}, updated_at = now()
    where user_id = ${userId} and space_id = ${meta.spaceId}
      and source_id = ${meta.sourceId} and content_hash = ${meta.contentHash}
  `;
  return { ok: true };
}

export async function corpusStatus(
  sql: Sql,
  userId: string,
  spaceId: string,
): Promise<ServerCorpusUsage> {
  const sources = await sql<ServerSourceStatus>`
    select source_id as "sourceId", path, kind, status,
      page_count as "pageCount", chunk_count as "chunkCount"
    from server_sources
    where user_id = ${userId} and space_id = ${spaceId}
    order by updated_at desc
  `;
  return {
    sources,
    totalPages: await userPageTotal(sql, userId),
    pageBudget: SERVER_CORPUS_LIMITS.maxPagesPerUser,
  };
}

/**
 * Recall leg: full-text search over the user's space, top chunks plus the
 * pages they came from so the client can rebuild coordinates and run the
 * unchanged card/verify pipeline. Empty results mean silence downstream —
 * this function never invents.
 */
export async function retrieveChunks(
  sql: Sql,
  userId: string,
  spaceId: string,
  query: string,
  limit: number,
): Promise<{ chunks: DocumentChunk[]; pages: NormalizedPage[] }> {
  const clean = query.trim().slice(0, 500);
  if (!clean) return { chunks: [], pages: [] };
  const top = Math.max(1, Math.min(SERVER_CORPUS_LIMITS.maxRetrieveLimit, Math.floor(limit) || 8));
  const hits = await sql<{ chunk: DocumentChunk }>`
    select c.chunk as chunk
    from server_chunks c
    join server_sources s
      on s.user_id = c.user_id and s.space_id = c.space_id
      and s.source_id = c.source_id and s.content_hash = c.content_hash
    cross join websearch_to_tsquery('english', ${clean}) as q
    where c.user_id = ${userId} and c.space_id = ${spaceId}
      and s.status = 'ready'
      and c.search_vec @@ q
    order by ts_rank_cd(c.search_vec, q) desc
    limit ${top}
  `;
  const chunks = hits.map((hit) => hit.chunk);
  if (chunks.length === 0) return { chunks: [], pages: [] };
  const seen = new Set<string>();
  const pages: NormalizedPage[] = [];
  for (const chunk of chunks) {
    const key = JSON.stringify([chunk.sourceId, chunk.contentHash, chunk.page]);
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = await sql<{ page: NormalizedPage }>`
      select p.page as page from server_pages p
      where p.user_id = ${userId} and p.space_id = ${spaceId}
        and p.source_id = ${chunk.sourceId}
        and p.content_hash = ${chunk.contentHash}
        and p.page_number = ${chunk.page}
      limit 1
    `;
    if (rows[0]) pages.push(rows[0].page);
  }
  return { chunks, pages };
}

export async function deleteSource(
  sql: Sql,
  userId: string,
  spaceId: string,
  sourceId: string,
  contentHash: string,
): Promise<void> {
  await sql`
    delete from server_chunks
    where user_id = ${userId} and space_id = ${spaceId}
      and source_id = ${sourceId} and content_hash = ${contentHash}
  `;
  await sql`
    delete from server_pages
    where user_id = ${userId} and space_id = ${spaceId}
      and source_id = ${sourceId} and content_hash = ${contentHash}
  `;
  await sql`
    delete from server_sources
    where user_id = ${userId} and space_id = ${spaceId}
      and source_id = ${sourceId} and content_hash = ${contentHash}
  `;
}
