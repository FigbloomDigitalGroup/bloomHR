-- Figbloom sign-in (Cognito) for bloomHR (ERP/HR_COGNITO_CONTRACT.md section 2). bloomHR keeps its own Supabase
-- logins and sessions; Cognito only proves who someone is. Each Cognito account (its sub) is linked to one bloomHR
-- login, per pool: customers (the web app) and staff (the console, Figbloom's platform admins).
--
--   identity_links         login <-> Cognito sub, per pool. Only the backend (service role) reads or writes it.
--   identity_sign_in()     the backend's one call after verifying a Cognito ID token: the login to sign in, linking it
--                          on first sign-in by a verified email. auth.uid() stays the Supabase user ID, so RLS, memberships
--                          and every user_id are untouched.
--
-- Safe to run again.

create table if not exists public.identity_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  pool text not null check (pool in ('customers', 'staff')),
  sub text not null check (length(sub) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, pool),
  unique (pool, sub)
);
alter table public.identity_links enable row level security;
-- no policies: nobody but the service role (which bypasses RLS) sees it
revoke all on public.identity_links from anon, authenticated;

/**
 * Who a verified Cognito sign-in is in bloomHR. p_email and p_email_verified come from the ID token the backend has
 * already checked (signature, issuer, audience). Outcomes:
 *   linked             (user_id, newly_linked) the login to sign in; newly_linked on its first Figbloom sign-in
 *   no_account         customers: no bloomHR login for this sub, nor an unlinked one with this verified email
 *   email_in_use       the login with this email is already linked to another Figbloom account in this pool
 *   no_console_access  staff: not (or no longer) a platform admin
 * A login is never handed over on an email Cognito hasn't verified.
 */
create or replace function public.identity_sign_in(p_pool text, p_sub text, p_email text, p_email_verified boolean)
returns table (outcome text, user_id uuid, newly_linked boolean)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid;
  v_other_sub text;
begin
  if p_pool not in ('customers', 'staff') or coalesce(length(p_sub), 0) not between 1 and 200 then
    raise exception 'identity_sign_in: bad pool or sub';
  end if;

  select l.user_id into v_user from public.identity_links l where l.pool = p_pool and l.sub = p_sub;
  if v_user is not null then
    if p_pool = 'staff' and not exists (select 1 from public.platform_admins a where a.user_id = v_user) then
      return query select 'no_console_access'::text, null::uuid, false;
      return;
    end if;
    return query select 'linked'::text, v_user, false;
    return;
  end if;

  if coalesce(p_email_verified, false) and coalesce(p_email, '') <> '' then
    select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  end if;

  if v_user is null then
    return query select (case when p_pool = 'staff' then 'no_console_access' else 'no_account' end)::text, null::uuid, false;
    return;
  end if;
  if p_pool = 'staff' and not exists (select 1 from public.platform_admins a where a.user_id = v_user) then
    return query select 'no_console_access'::text, null::uuid, false;
    return;
  end if;

  select l.sub into v_other_sub from public.identity_links l where l.user_id = v_user and l.pool = p_pool;
  if v_other_sub is not null then
    return query select 'email_in_use'::text, null::uuid, false;
    return;
  end if;

  insert into public.identity_links (user_id, pool, sub) values (v_user, p_pool, p_sub)
  on conflict do nothing;
  -- the same person's first sign-in in two tabs at once: whoever lost the race finds the link made by the other
  if not found then
    select l.user_id into v_user from public.identity_links l where l.pool = p_pool and l.sub = p_sub;
    if v_user is null then
      return query select 'email_in_use'::text, null::uuid, false;
      return;
    end if;
    return query select 'linked'::text, v_user, false;
    return;
  end if;
  return query select 'linked'::text, v_user, true;
end;
$$;

revoke all on function public.identity_sign_in(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.identity_sign_in(text, text, text, boolean) to service_role;
