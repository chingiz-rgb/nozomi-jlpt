-- Shiori · database setup. Run once in Supabase → SQL Editor.
-- One row per user holding their progress record (the same JSON the site keeps in the browser).

create table if not exists public.progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;
grant select, insert, update, delete on public.progress to authenticated;

-- each signed-in user can only see and change their own row
create policy "read own progress"   on public.progress for select using (auth.uid() = user_id);
create policy "insert own progress" on public.progress for insert with check (auth.uid() = user_id);
create policy "update own progress" on public.progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own progress" on public.progress for delete using (auth.uid() = user_id);
