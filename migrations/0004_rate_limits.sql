-- Fixed-window counters for server-paid endpoints (LLM synthesis, dictation).
--
-- Serverless instances do not share memory, so an in-process Map lets a caller
-- multiply their budget by the number of warm instances. One row per
-- (scope, user, window) bucket keeps the count in the database instead.

create table if not exists rate_limits (
  bucket text primary key,
  count integer not null,
  reset_at timestamptz not null
);

create index if not exists rate_limits_reset_at_idx on rate_limits (reset_at);

-- Same reasoning as waitlist: no policy, so PostgREST's anon role sees nothing.
alter table rate_limits enable row level security;
