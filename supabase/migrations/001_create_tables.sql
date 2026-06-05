-- VisioNotes schema — run this in the Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)

-- Sessions table
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int,
  camera_mode text not null default 'side' check (camera_mode in ('side', 'top_down')),
  total_faults int not null default 0
);

-- Fault events table
create table if not exists fault_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  fault_type text not null check (fault_type in ('collapsed_wrist', 'arm_posture')),
  hand text check (hand in ('left', 'right')),
  timestamp_ms int not null,
  value float
);

-- Indexes for common queries
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_fault_events_session_id on fault_events(session_id);

-- Row Level Security: users can only access their own data
alter table sessions enable row level security;
alter table fault_events enable row level security;

create policy "Users can manage their own sessions"
  on sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage faults for their own sessions"
  on fault_events for all
  using (session_id in (select id from sessions where user_id = auth.uid()))
  with check (session_id in (select id from sessions where user_id = auth.uid()));
