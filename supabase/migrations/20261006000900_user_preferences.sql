-- Per-login preferences: the colour theme (so it follows the person to any device) and a profile picture for logins
-- that have no employee record (an owner or admin who set the company up).
--
--   user_preferences(user_id, theme, avatar_url)   one row per login, readable/writable by that login only
--   company_members()                              now also returns each colleague's picture, for the chat
--   storage: <company id>/user_avatars/<login id>.<ext>  a login may add, replace or remove only its own picture

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme jsonb,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists own_preferences on public.user_preferences;
create policy own_preferences on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.user_preferences from anon;
grant select, insert, update, delete on public.user_preferences to authenticated;

-- colleagues' pictures are shown in the chat; only the picture, never the theme
drop function if exists public.company_members();
create function public.company_members()
returns table (user_id uuid, email text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, u.email, p.avatar_url
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.user_preferences p on p.user_id = m.user_id
  where m.tenant_id = (select public.current_tenant_id())
    and m.account_status = 'ACTIVE'
$$;

revoke all on function public.company_members() from public, anon;
grant execute on function public.company_members() to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  drop policy if exists useravatar_insert on storage.objects;
  drop policy if exists useravatar_update on storage.objects;
  drop policy if exists useravatar_delete on storage.objects;

  create policy useravatar_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'employeeavatar'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] = 'user_avatars'
      and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select auth.uid())::text
    );

  create policy useravatar_update on storage.objects for update to authenticated
    using (
      bucket_id = 'employeeavatar'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] = 'user_avatars'
      and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select auth.uid())::text
    )
    with check (
      bucket_id = 'employeeavatar'
      and (storage.foldername(name))[2] = 'user_avatars'
      and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select auth.uid())::text
    );

  create policy useravatar_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'employeeavatar'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] = 'user_avatars'
      and regexp_replace(storage.filename(name), '\.[^.]*$', '') = (select auth.uid())::text
    );
end $$;

notify pgrst, 'reload schema';
