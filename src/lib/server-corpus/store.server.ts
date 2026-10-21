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
  buildFtsQuery,
  quotaAfterUpload,
  type ServerCorpusUsage,
  type ServerDocMeta,
  type ServerSourceStatus,
  type ServerUploadBatch,
} from "./contract.ts";

/**
 * Pages the user is storing, in every state: an upload that never sends its
 * last batch still occupies rows, so counting only `ready` let it bypass the
 * budget. `except` leaves out the source being written, whose pages the caller
 * counts itself.
 */
async function userPageTotal(sql: Sql, userId: string, except?: ServerDocMeta): Promise<number> {
  const rows = except
    ? await sql<{ pages: number }>`
        select coalesce(sum(page_count), 0)::int as pages
        from server_sources
        where user_id = ${userId}
          and not (space_id = ${except.spaceId} and source_id = ${except.sourceId}
            and content_hash = ${except.contentHash})
      `
    : await sql<{ pages: number }>`
        select coalesce(sum(page_count), 0)::int as pages
        from server_sources
        where user_id = ${userId}
      `;
  return rows[0]?.pages ?? 0;
}

type UploadResult = { ok: true } | { ok: false; reason: string };

/** Ends the transaction with a rollback, then becomes the batch's result. */
class UploadRejected extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export const UPLOAD_TIMED_OUT = "Upload timed out. Retry this batch.";

/**
 * `tx`, but every statement first checks the deadline. Past it, the next
 * statement throws instead of running, so the transaction rolls back.
 */
function withDeadline(tx: Sql, deadline: number | undefined): Sql {
  if (deadline === undefined) return tx;
  const check = () => {
    if (Date.now() >= deadline) throw new UploadRejected(UPLOAD_TIMED_OUT);
  };
  const guarded = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    check();
    return tx(strings, ...values);
  }) as Sql;
  guarded.query = async (text, params) => {
    check();
    return tx.query(text, params);
  };
  guarded.transaction = (fn) => fn(guarded);
  return guarded;
}

/**
 * Store one batch, all or nothing: every write runs in a single transaction, so
 * a batch that fails, is rejected, or runs past `deadline` (epoch ms) leaves
 * the source exactly as it was — counts and rows always agree. Retrying a batch
 * is safe; it replaces its own rows.
 */
export async function storeUploadBatch(
  sql: Sql,
  userId: string,
  batch: ServerUploadBatch,
  options: { deadline?: number } = {},
): Promise<UploadResult> {
  try {
    return await sql.transaction(async (tx) => {
      const db = withDeadline(tx, options.deadline);
      if (options.deadline !== undefined) {
        // Also bound each statement, so one slow query cannot run past the deadline.
        const remaining = Math.max(1, options.deadline - Date.now());
        await db`select set_config('statement_timeout', ${String(remaining)}, true)`;
      }
      const result = await writeUploadBatch(db, userId, batch);
      if (!result.ok) throw new UploadRejected(result.reason);
      return result;
    });
  } catch (error) {
    if (error instanceof UploadRejected) return { ok: false, reason: error.reason };
    throw error;
  }
}

async function writeUploadBatch(sql: Sql, userId: string, batch: ServerUploadBatch): Promise<UploadResult> {
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

  // `for update` holds the source row until commit, so two batches of one
  // source take turns instead of both counting the rows before either writes.
  const existing = await sql<{ status: string }>`
    select status from server_sources
    where user_id = ${userId} and space_id = ${meta.spaceId}
      and source_id = ${meta.sourceId} and content_hash = ${meta.contentHash}
    for update
  `;
  if (!existing[0]) return { ok: false, reason: "Upload session not started." };

  // A retried batch replaces its own pages and chunks rather than adding to
  // them, so counts come from the rows outside this batch plus the batch.
  const pageNumbers = [...new Set(batch.pages.map((page) => page.pageNumber))];
  const chunkIds = [...new Set(batch.chunks.map((chunk) => chunk.id).filter((id) => typeof id === "string"))];
  const [{ pages: otherPages } = { pages: 0 }] = await sql<{ pages: number }>`
    select count(*)::int as pages from server_pages
    where user_id = ${userId} and space_id = ${meta.spaceId}
      and source_id = ${meta.sourceId} and content_hash = ${meta.contentHash}
      and not (page_number = any(${pageNumbers}::int[]))
  `;
  const [{ chunks: otherChunks } = { chunks: 0 }] = await sql<{ chunks: number }>`
    select count(*)::int as chunks from server_chunks
    where user_id = ${userId} and space_id = ${meta.spaceId}
      and source_id = ${meta.sourceId} and content_hash = ${meta.contentHash}
      and not (coalesce(chunk->>'id', '') = any(${chunkIds}::text[]))
  `;
  const nextPages = otherPages + pageNumbers.length;
  const nextChunks = otherChunks + batch.chunks.length;
  if (nextPages > SERVER_CORPUS_LIMITS.maxPagesPerSource) {
    return { ok: false, reason: "Source exceeds the per-document page limit." };
  }
  if (nextChunks > SERVER_CORPUS_LIMITS.maxChunksPerSource) {
    return { ok: false, reason: "Source exceeds the per-document chunk limit." };
  }
  // Every batch, not just the last: a client that never sends `isLast` used
  // to store without limit.
  const quota = quotaAfterUpload(await userPageTotal(sql, userId, meta), nextPages);
  if (!quota.ok) return quota;

  if (chunkIds.length > 0) {
    await sql`
      delete from server_chunks
      where user_id = ${userId} and space_id = ${meta.spaceId}
        and source_id = ${meta.sourceId} and content_hash = ${meta.contentHash}
        and chunk->>'id' = any(${chunkIds}::text[])
    `;
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
  // OR-ed content tokens (see buildFtsQuery): a field question must recall
  // the value line even when the question's field words aren't in the chunk.
  const fts = buildFtsQuery(clean);
  if (!fts) return { chunks: [], pages: [] };
  const top = Math.max(1, Math.min(SERVER_CORPUS_LIMITS.maxRetrieveLimit, Math.floor(limit) || 8));
  const hits = await sql<{ chunk: DocumentChunk }>`
    select c.chunk as chunk
    from server_chunks c
    join server_sources s
      on s.user_id = c.user_id and s.space_id = c.space_id
      and s.source_id = c.source_id and s.content_hash = c.content_hash
    cross join to_tsquery('english', ${fts}) as q
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
