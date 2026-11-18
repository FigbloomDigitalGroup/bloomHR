-- Figbloom sign-in: linking a login HR has just made (ERP/HR_COGNITO_CONTRACT.md section 2: creating a company,
-- accepting an invitation, an admin adding a person). The backend made the Figbloom account itself, so it knows both
-- sides and links them at once, without waiting for a verified email at the first sign-in (identity_sign_in()).
--
--   identity_links.made_here   HR created that Figbloom account (POST /users). Only such an account's first password
--                              can be set from HR (the platform's POST /users/{sub}/initial-password refuses others).
--   identity_link(user, pool, sub, made_here) -> 'linked' (new), 'already' (exactly this link exists), or 'taken' (the
--                              login has another Figbloom account in this pool, or this account is another login's)
--   identity_of(user, pool)    the link: (sub, made_here), or no row
--
-- Safe to run again.

alter table public.identity_links add column if not exists made_here boolean not null default false;

create or replace function public.identity_link(p_user uuid, p_pool text, p_sub text, p_made_here boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_sub text;
begin
  if p_user is null or p_pool not in ('customers', 'staff') or coalesce(length(p_sub), 0) not between 1 and 200 then
    raise exception 'identity_link: bad user, pool or sub';
  end if;
  select l.user_id into v_user from public.identity_links l where l.pool = p_pool and l.sub = p_sub;
  select l.sub into v_sub from public.identity_links l where l.pool = p_pool and l.user_id = p_user;
  if v_user = p_user and v_sub = p_sub then
    return 'already';
  end if;
  if v_user is not null or v_sub is not null then
    return 'taken';
  end if;
  insert into public.identity_links (user_id, pool, sub, made_here) values (p_user, p_pool, p_sub, coalesce(p_made_here, false))
  on conflict do nothing;
  return case when found then 'linked' else 'taken' end;
end;
$$;

revoke all on function public.identity_link(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.identity_link(uuid, text, text, boolean) to service_role;

create or replace function public.identity_of(p_user uuid, p_pool text)
returns table (sub text, made_here boolean)
language sql
stable
security definer
set search_path = public
as $$
  select l.sub, l.made_here from public.identity_links l where l.user_id = p_user and l.pool = p_pool;
$$;

revoke all on function public.identity_of(uuid, text) from public, anon, authenticated;
grant execute on function public.identity_of(uuid, text) to service_role;
