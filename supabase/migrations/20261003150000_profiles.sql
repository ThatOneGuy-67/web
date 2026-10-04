create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 2 and 32),
  display_name text not null default '' check (char_length(display_name) <= 64),
  chat_name text check (chat_name is null or char_length(chat_name) between 3 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists chat_name text check (chat_name is null or char_length(chat_name) between 3 and 32);

alter table public.profiles enable row level security;
grant select, insert, update on public.profiles to authenticated;
drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create or replace function public.get_admin_users()
returns table (id uuid, email text, username text, display_name text, chat_name text, created_at timestamptz)
language sql security definer set search_path = public, auth as $$
  select p.id, u.email, p.username, p.display_name, p.chat_name, p.created_at
  from public.profiles p join auth.users u on u.id = p.id
  where public.is_admin() order by p.created_at desc;
$$;
revoke all on function public.get_admin_users() from public, anon;
grant execute on function public.get_admin_users() to authenticated;
