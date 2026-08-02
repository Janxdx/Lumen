PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE users (
  id            text primary key,
  email         text not null unique,
  -- lower-cased email, the form every lookup uses
  email_key     text not null unique,
  created_at    integer not null,
  -- there is no unverified state here: the only way to obtain an account is
  -- to open a link sent to the address, so possession is proven at signup
  verified_at   integer not null,
  seq           integer not null default 0
);
CREATE TABLE auth_sessions (
  token_hash text primary key,
  user_id    text not null references users(id) on delete cascade,
  created_at integer not null,
  expires_at integer not null,
  -- rough provenance, shown on the account screen so a stolen session is
  -- something you can notice and revoke
  user_agent text
);
CREATE TABLE login_tokens (
  token_hash text primary key,
  email_key  text not null,
  created_at integer not null,
  expires_at integer not null
);
CREATE TABLE credentials (
  id           text primary key,          -- base64url credential id
  user_id      text not null references users(id) on delete cascade,
  public_key   text not null,             -- base64url COSE key
  counter      integer not null default 0,
  transports   text,                      -- json array, hints for the next prompt
  label        text,                      -- e.g. "iPad", shown when revoking
  created_at   integer not null,
  last_used_at integer
);
CREATE TABLE challenges (
  challenge  text primary key,
  -- null for a sign-in attempt: we don't know who it is until they answer
  user_id    text,
  purpose    text not null,               -- 'register' | 'login'
  created_at integer not null,
  expires_at integer not null
);
CREATE TABLE rate_limits (
  key        text primary key,
  count      integer not null default 0,
  window_at  integer not null
);
CREATE TABLE books (
  user_id     text    not null references users(id) on delete cascade,
  id          text    not null,
  title       text    not null default '',
  author      text    not null default '',
  meta        text    not null default '{}',
  spine       text    not null default '[]',
  toc         text    not null default '[]',
  total_words integer not null default 0,
  hue         integer not null default 0,
  added_at    integer not null default 0,
  finished_at integer,
  file_path   text,
  file_size   integer,
  cover_path  text,
  updated_at  integer not null default 0,   -- client clock, drives last-write-wins
  deleted     integer not null default 0,
  row_seq     integer not null default 0,   -- server counter, drives the cursor
  primary key (user_id, id)
);
CREATE TABLE progress (
  user_id     text    not null references users(id) on delete cascade,
  book_id     text    not null,
  spine_index integer not null default 0,
  word_index  integer not null default 0,
  percent     real    not null default 0,
  updated_at  integer not null default 0,
  row_seq     integer not null default 0,
  primary key (user_id, book_id)
);
CREATE TABLE read_sessions (
  user_id  text    not null references users(id) on delete cascade,
  uid      text    not null,
  book_id  text    not null,
  start_at integer not null,
  end_at   integer not null,
  ms       integer not null default 0,
  words    integer not null default 0,
  pages    integer not null default 0,
  paced_ms integer not null default 0,
  source   text    not null default 'app',
  row_seq  integer not null default 0,
  primary key (user_id, uid)
);
CREATE TABLE device_books (
  user_id      text    not null references users(id) on delete cascade,
  id           text    not null,
  title        text    not null default '',
  author       text    not null default '',
  pages        integer not null default 1,
  start_page   integer not null default 1,
  current_page integer not null default 0,
  book_id      text,
  link_pinned  integer not null default 0,
  device       text,
  added_at     integer not null default 0,
  finished_at  integer,
  hue          integer not null default 0,
  updated_at   integer not null default 0,
  deleted      integer not null default 0,
  row_seq      integer not null default 0,
  primary key (user_id, id)
);
CREATE TABLE device_sessions (
  user_id        text    not null references users(id) on delete cascade,
  uid            text    not null,
  device_book_id text    not null,
  start_at       integer not null,
  end_at         integer not null,
  ms             integer not null default 0,
  from_page      integer not null default 0,
  to_page        integer not null default 0,
  pages          integer not null default 0,
  words          integer not null default 0,
  mirror_uid     text,
  note           text,
  updated_at     integer not null default 0,
  deleted        integer not null default 0,
  row_seq        integer not null default 0,
  primary key (user_id, uid)
);
CREATE TABLE bookmarks (
  user_id     text    not null references users(id) on delete cascade,
  uid         text    not null,
  book_id     text    not null,
  spine_index integer not null default 0,
  word_index  integer not null default 0,
  excerpt     text    not null default '',
  created_at  integer not null default 0,
  updated_at  integer not null default 0,
  deleted     integer not null default 0,
  row_seq     integer not null default 0,
  primary key (user_id, uid)
);
CREATE TABLE ratings (
  user_id        text    not null references users(id) on delete cascade,
  id             text    not null,
  book_id        text,
  device_book_id text,
  title          text    not null default '',
  author         text    not null default '',
  overall        real    not null default 0,
  axes           text    not null default '{}',   -- json, as everywhere here
  mood           text,
  note           text,
  favourite      integer not null default 0,
  words          integer,
  rated_at       integer not null default 0,
  updated_at     integer not null default 0,
  deleted        integer not null default 0,
  row_seq        integer not null default 0,
  primary key (user_id, id)
);
CREATE TABLE settings (
  user_id    text    primary key references users(id) on delete cascade,
  data       text    not null default '{}',
  updated_at integer not null default 0,
  row_seq    integer not null default 0
);
CREATE INDEX auth_sessions_user_idx on auth_sessions (user_id);
CREATE INDEX auth_sessions_expiry_idx on auth_sessions (expires_at);
CREATE INDEX login_tokens_email_idx on login_tokens (email_key);
CREATE INDEX login_tokens_expiry_idx on login_tokens (expires_at);
CREATE INDEX credentials_user_idx on credentials (user_id);
CREATE INDEX challenges_expiry_idx on challenges (expires_at);
CREATE INDEX books_seq_idx on books (user_id, row_seq);
CREATE INDEX progress_seq_idx on progress (user_id, row_seq);
CREATE INDEX read_sessions_seq_idx on read_sessions (user_id, row_seq);
CREATE INDEX read_sessions_start_idx on read_sessions (user_id, start_at);
CREATE INDEX device_books_seq_idx on device_books (user_id, row_seq);
CREATE INDEX device_sessions_seq_idx on device_sessions (user_id, row_seq);
CREATE INDEX device_sessions_book_idx on device_sessions (user_id, device_book_id);
CREATE INDEX bookmarks_seq_idx on bookmarks (user_id, row_seq);
CREATE INDEX ratings_seq_idx on ratings (user_id, row_seq);
CREATE INDEX ratings_book_idx on ratings (user_id, book_id);
