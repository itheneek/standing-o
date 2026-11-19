-- Standing O — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query)
-- after creating your project. Safe to run once on a fresh project.

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  created_at timestamptz not null default now()
);

-- ---------- diary entries ----------
create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  production_title text not null,
  production_region text,
  venue text,
  city text,
  date_seen date not null,
  rating numeric check (rating >= 0.5 and rating <= 5.0),
  seat text,
  review text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists diary_entries_user_id_idx on public.diary_entries (user_id);
create index if not exists diary_entries_date_seen_idx on public.diary_entries (user_id, date_seen desc);

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.diary_entries enable row level security;

-- profiles: own row only
drop policy if exists "Profiles: select own" on public.profiles;
create policy "Profiles: select own" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "Profiles: insert own" on public.profiles;
create policy "Profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);
drop policy if exists "Profiles: update own" on public.profiles;
create policy "Profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Profiles: delete own" on public.profiles;
create policy "Profiles: delete own" on public.profiles
  for delete using (auth.uid() = id);

-- diary_entries: full CRUD, own rows only (user_id = auth.uid())
drop policy if exists "Diary: select own" on public.diary_entries;
create policy "Diary: select own" on public.diary_entries
  for select using (auth.uid() = user_id);
drop policy if exists "Diary: insert own" on public.diary_entries;
create policy "Diary: insert own" on public.diary_entries
  for insert with check (auth.uid() = user_id);
drop policy if exists "Diary: update own" on public.diary_entries;
create policy "Diary: update own" on public.diary_entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Diary: delete own" on public.diary_entries;
create policy "Diary: delete own" on public.diary_entries
  for delete using (auth.uid() = user_id);

-- ---------- auto-create a profile row on signup ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
