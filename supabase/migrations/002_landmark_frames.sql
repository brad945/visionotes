-- Skeleton replay frames — run this in the Supabase SQL Editor
-- Stores sampled hand + pose landmark coordinates (~6fps) for each session.
-- One row per session; frames is a JSONB array of {t, hands, pose} objects.

create table if not exists landmark_frames (
  session_id uuid primary key references sessions(id) on delete cascade,
  frames jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- RLS: inherit the same user-scoping rule as fault_events
alter table landmark_frames enable row level security;

create policy "Users can manage landmark frames for their own sessions"
  on landmark_frames for all
  using (session_id in (select id from sessions where user_id = auth.uid()))
  with check (session_id in (select id from sessions where user_id = auth.uid()));
