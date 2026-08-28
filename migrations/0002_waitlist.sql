-- Waitlist signups from the coming-soon page.
--
-- Rows are unowned: the app has no accounts, so there is no user_id to scope
-- by. What keeps the list private is that nothing reads it back — the only
-- server function touching this table inserts, so there is no path from the
-- browser to another visitor's address. Read it with SQL, not through the app.

create table if not exists waitlist (
  id bigserial primary key,
  email text not null,
  -- Which form the address came from, so signups can be attributed to the hero
  -- or the closing CTA without a separate analytics call.
  source text,
  created_at timestamptz not null default now()
);

-- One row per address, case-insensitively. A visitor who submits twice is not
-- two signups, and the insert depends on this index to make the retry a no-op.
create unique index if not exists waitlist_email_key on waitlist (lower(email));
