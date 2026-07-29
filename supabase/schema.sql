-- ═══════════════════════════════════════════════════════════════════
--  Lumen — server schema
--
--  Run once in the Supabase SQL editor (Dashboard → SQL → New query).
--  Safe to re-run: every statement is idempotent.
--
--  Portability note: this is plain PostgreSQL apart from `auth.uid()`,
--  which is a Supabase helper reading the user id out of the request JWT.
--  When Lumen moves to your own server, keep every table exactly as it is
--  and replace `auth.uid()` with `current_setting('app.user_id')::uuid`
--  (set per connection from your own JWT). Nothing else changes.
-- ═══════════════════════════════════════════════════════════════════

-- ── books ──────────────────────────────────────────────────────────
-- One row per book in a user's library. `id` is generated on the client
-- so a book keeps its identity across devices, hence the composite key.
create table if not exists public.books (
  user_id     uuid    not null references auth.users(id) on delete cascade,
  id          text    not null,
  title       text    not null default '',
  author      text    not null default '',
  meta        jsonb   not null default '{}'::jsonb,
  spine       jsonb   not null default '[]'::jsonb,
  toc         jsonb   not null default '[]'::jsonb,
  total_words integer not null default 0,
  hue         integer not null default 0,
  added_at    bigint  not null default 0,
  finished_at bigint,
  -- storage object paths, null until the file has been uploaded
  file_path   text,
  file_size   bigint,
  cover_path  text,
  -- sync bookkeeping
  updated_at  bigint  not null default 0,   -- client clock, epoch ms
  deleted     boolean not null default false,
  synced_at   timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── progress ───────────────────────────────────────────────────────
-- Where the reader is in each book. One row per book.
create table if not exists public.progress (
  user_id     uuid    not null references auth.users(id) on delete cascade,
  book_id     text    not null,
  spine_index integer not null default 0,
  word_index  integer not null default 0,
  percent     real    not null default 0,
  updated_at  bigint  not null default 0,
  synced_at   timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- ── sessions ───────────────────────────────────────────────────────
-- Append-only reading history. Every statistic in the app is derived from
-- these rows, so they are never edited — only inserted.
create table if not exists public.sessions (
  user_id  uuid   not null references auth.users(id) on delete cascade,
  uid      text   not null,                -- client-generated, stable across devices
  book_id  text   not null,
  start_at bigint not null,
  end_at   bigint not null,
  ms       integer not null default 0,
  words    integer not null default 0,
  pages    integer not null default 0,
  paced_ms integer not null default 0,
  synced_at timestamptz not null default now(),
  primary key (user_id, uid)
);

create index if not exists sessions_user_start_idx
  on public.sessions (user_id, start_at);

-- `source` marks reading logged from a physical e-reader rather than done
-- in the app. Added separately so an existing database can be upgraded in
-- place by re-running this file.
alter table public.sessions
  add column if not exists source text not null default 'app';

-- ── device books ───────────────────────────────────────────────────
-- The second shelf: books read on an e-ink reader. `pages` is the scale
-- that lets a page number be converted to the percentage the rest of the
-- app speaks in; `book_id` points at the library book it mirrors, when
-- there is one.
create table if not exists public.device_books (
  user_id      uuid    not null references auth.users(id) on delete cascade,
  id           text    not null,
  title        text    not null default '',
  author       text    not null default '',
  pages        integer not null default 1,
  start_page   integer not null default 1,
  current_page integer not null default 0,
  book_id      text,
  link_pinned  boolean not null default false,
  device       text,
  added_at     bigint  not null default 0,
  finished_at  bigint,
  hue          integer not null default 0,
  updated_at   bigint  not null default 0,
  deleted      boolean not null default false,
  synced_at    timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── device sessions ────────────────────────────────────────────────
-- Reading logged by hand. Unlike `sessions` these are editable — a page
-- count gets corrected and every session against it is worth a different
-- number of words — so they carry `updated_at` and merge last-write-wins.
create table if not exists public.device_sessions (
  user_id        uuid    not null references auth.users(id) on delete cascade,
  uid            text    not null,
  device_book_id text    not null,
  start_at       bigint  not null,
  end_at         bigint  not null,
  ms             integer not null default 0,
  from_page      integer not null default 0,
  to_page        integer not null default 0,
  pages          integer not null default 0,
  words          integer not null default 0,
  -- uid of the row in `sessions` this is mirrored into, so statistics count
  -- it once and an edit updates rather than duplicates
  mirror_uid     text,
  note           text,
  updated_at     bigint  not null default 0,
  deleted        boolean not null default false,
  synced_at      timestamptz not null default now(),
  primary key (user_id, uid)
);

create index if not exists device_sessions_book_idx
  on public.device_sessions (user_id, device_book_id);

-- ── bookmarks ──────────────────────────────────────────────────────
create table if not exists public.bookmarks (
  user_id     uuid    not null references auth.users(id) on delete cascade,
  uid         text    not null,
  book_id     text    not null,
  spine_index integer not null default 0,
  word_index  integer not null default 0,
  excerpt     text    not null default '',
  created_at  bigint  not null default 0,
  updated_at  bigint  not null default 0,
  deleted     boolean not null default false,
  synced_at   timestamptz not null default now(),
  primary key (user_id, uid)
);

-- ── settings ───────────────────────────────────────────────────────
-- The whole settings object as one JSON blob: it is small, always written
-- as a unit, and this keeps schema churn out of the server when a new
-- reading preference is added.
create table if not exists public.settings (
  user_id    uuid   primary key references auth.users(id) on delete cascade,
  data       jsonb  not null default '{}'::jsonb,
  updated_at bigint not null default 0,
  synced_at  timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════
--  Sync cursor
--
--  `synced_at` is stamped by the *server* clock on every write. The client
--  pulls with `synced_at > <last cursor>`, which is the only way to page
--  through changes reliably — client clocks disagree, sometimes by minutes,
--  and a device that is behind would otherwise never see its own updates.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.touch_synced_at()
returns trigger language plpgsql as $$
begin
  new.synced_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['books', 'progress', 'sessions', 'bookmarks', 'settings',
                        'device_books', 'device_sessions']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.touch_synced_at()',
      t || '_touch', t
    );
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════
--  Row level security
--
--  Without these policies the anon key would let anyone read everyone's
--  library. With them, the database itself enforces that a request can
--  only ever touch rows whose user_id matches the caller's JWT — the
--  client cannot opt out, so a bug in the app can't leak another user's
--  data.
-- ═══════════════════════════════════════════════════════════════════

alter table public.books     enable row level security;
alter table public.progress  enable row level security;
alter table public.sessions  enable row level security;
alter table public.bookmarks enable row level security;
alter table public.settings  enable row level security;
alter table public.device_books    enable row level security;
alter table public.device_sessions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['books', 'progress', 'sessions', 'bookmarks', 'settings',
                        'device_books', 'device_sessions']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I
         for all
         using (user_id = auth.uid())
         with check (user_id = auth.uid())',
      t || '_owner', t
    );
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════
--  Storage — EPUB files and cover images
--
--  Private bucket. Objects live under <user id>/… and the policies below
--  key off that first path segment, which is the standard Supabase
--  pattern for per-user folders.
-- ═══════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit)
values ('books', 'books', false, 209715200)          -- 200 MB per file
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "books read own"   on storage.objects;
drop policy if exists "books write own"  on storage.objects;
drop policy if exists "books update own" on storage.objects;
drop policy if exists "books delete own" on storage.objects;

create policy "books read own" on storage.objects
  for select using (
    bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "books write own" on storage.objects
  for insert with check (
    bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "books update own" on storage.objects
  for update using (
    bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "books delete own" on storage.objects
  for delete using (
    bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text
  );
