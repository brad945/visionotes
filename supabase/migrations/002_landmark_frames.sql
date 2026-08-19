-- Skeleton replay frames — run this in the Supabase SQL Editor
-- Stores sampled hand + pose landmark coordinates (~6fps) for each session.
--
-- NOTE: this file was edited in place rather than superseded by a 003. It had
-- never been applied to any database, so it was not history yet. If you DID run
-- an earlier copy of it, drop the table first — `create table if not exists`
-- will silently skip it and later writes will fail on the missing chunk_index.
--
-- One row per (session, chunk). The client uploads replay frames in bounded
-- chunks WHILE the session runs instead of one whole-session payload at the end,
-- so the request size stays constant no matter how long someone practises. The
-- composite primary key is what makes that safe: re-posting a chunk (a retry
-- after a lost response) overwrites its own slot instead of duplicating frames,
-- and readers stitch the stream back together with `order by chunk_index`.

create table if not exists landmark_frames (
  session_id uuid not null references sessions(id) on delete cascade,
  chunk_index int not null default 0,
  frames jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (session_id, chunk_index)
);

-- RLS: inherit the same user-scoping rule as fault_events
alter table landmark_frames enable row level security;

create policy "Users can manage landmark frames for their own sessions"
  on landmark_frames for all
  using (session_id in (select id from sessions where user_id = auth.uid()))
  with check (session_id in (select id from sessions where user_id = auth.uid()));
