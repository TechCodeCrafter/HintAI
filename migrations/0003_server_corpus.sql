-- Server corpus for Phase 2 docs-at-scale (Milestone A).
--
-- Design: the browser keeps parsing with the proven local pipeline and uploads
-- the *normalized* result once — NormalizedDocument pages plus built
-- DocumentChunks as JSONB. The server never parses PDFs; it stores, full-text
-- indexes, and serves top chunks back. The client rebuilds the document from
-- returned pages and runs the unchanged cite-or-silence card stack, so
-- coordinates stay measured, never invented.
--
-- Every row carries user_id and every server function scopes by it
-- (authMiddleware). RLS with no policy closes the PostgREST door the same way
-- the waitlist table does; the owning role in DATABASE_URL bypasses RLS.

create table if not exists server_sources (
  id bigserial primary key,
  user_id text not null,
  space_id text not null,
  source_id text not null,
  path text not null,
  -- 'pdf' (NormalizedDocument pages) | 'file' (docx/md/txt/pptx/xlsx text)
  kind text not null,
  content_hash text not null,
  parser_version integer not null default 0,
  normalizer_version integer not null default 0,
  page_count integer not null default 0,
  chunk_count integer not null default 0,
  -- uploading (batches in flight) | ready (all batches stored) | stale
  -- (a parser/normalizer bump means one owning device must re-upload once)
  status text not null default 'uploading',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, space_id, source_id, content_hash)
);

create index if not exists server_sources_owner_idx
  on server_sources (user_id, space_id);

alter table server_sources enable row level security;

create table if not exists server_pages (
  id bigserial primary key,
  user_id text not null,
  space_id text not null,
  source_id text not null,
  content_hash text not null,
  page_number integer not null,
  -- NormalizedPage JSON (text + items + segments: coordinates included)
  page jsonb not null,
  unique (user_id, space_id, source_id, content_hash, page_number)
);

create index if not exists server_pages_owner_idx
  on server_pages (user_id, space_id, source_id, content_hash);

alter table server_pages enable row level security;

create table if not exists server_chunks (
  id bigserial primary key,
  user_id text not null,
  space_id text not null,
  source_id text not null,
  content_hash text not null,
  -- DocumentChunk JSON (or file-chunk JSON for kind='file')
  chunk jsonb not null,
  -- Full-text vector over the chunk text, maintained by Postgres so neither
  -- the client nor a worker maintains a separate index structure.
  search_vec tsvector
    generated always as (to_tsvector('english', coalesce(chunk->>'text', ''))) stored
);

create index if not exists server_chunks_owner_idx
  on server_chunks (user_id, space_id, source_id, content_hash);

create index if not exists server_chunks_search_idx
  on server_chunks using gin (search_vec);

alter table server_chunks enable row level security;
