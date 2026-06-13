create table if not exists public.assets (
  id text primary key,
  user_id text not null,
  type text not null check (type in ('image', 'video', 'script', 'audio')),
  url text not null,
  name text not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists assets_user_created_at_idx
  on public.assets (user_id, created_at desc);

create index if not exists assets_user_type_idx
  on public.assets (user_id, type);

alter table public.assets enable row level security;

drop policy if exists "assets_select_own" on public.assets;
create policy "assets_select_own"
  on public.assets
  for select
  using (user_id = auth.uid()::text);

drop policy if exists "assets_insert_own" on public.assets;
create policy "assets_insert_own"
  on public.assets
  for insert
  with check (user_id = auth.uid()::text);

drop policy if exists "assets_update_own" on public.assets;
create policy "assets_update_own"
  on public.assets
  for update
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

drop policy if exists "assets_delete_own" on public.assets;
create policy "assets_delete_own"
  on public.assets
  for delete
  using (user_id = auth.uid()::text);
