-- Baseline: the whole public schema of the live project, as it stood on 2026-10-07.
--
-- Before this, building a database meant running master_schema.sql, eight undated files in a hand-kept order, and
-- loose scripts in database/, and the result still did not match the live project. Those files, and the migrations
-- this baseline already contains (up to 20261006000100), are kept for reference in supabase/archive/.
--
-- A fresh project is now:  supabase db push   (this file, then every later migration in order).
-- The live project already has all of this; it is marked as applied there, never run:
--   supabase migration repair --status applied 20261006000150
--
-- Generated with `supabase db dump --schema public` (structure only, no rows). Parts outside the public schema that
-- the archived files set up are added at the end. Later migrations are written to be safe to run on top of it.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."accept_invitation"("p_token" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_inv public.invitations;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select i.* into v_inv
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.token_hash = public.hash_invite_token(p_token) and i.status = 'pending' and i.expires_at > now()
  for update of i;
  if not found then
    raise exception 'This invitation is not valid any more' using errcode = '22023';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.memberships (user_id, tenant_id, role, account_status)
  values (auth.uid(), v_inv.tenant_id, v_inv.role, 'ACTIVE')
  on conflict (user_id, tenant_id) do update set role = excluded.role, account_status = 'ACTIVE';

  -- they joined to work there: make it their current company
  update public.user_profiles
    set tenant_id = v_inv.tenant_id, role = v_inv.role, account_status = 'ACTIVE'
    where user_id = auth.uid();

  update public.invitations
    set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
    where id = v_inv.id;

  return v_inv.tenant_id;
end;
$$;


ALTER FUNCTION "public"."accept_invitation"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_my_invitation"("p_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_inv public.invitations;
  v_email text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = auth.uid();
  if v_confirmed is null then
    raise exception 'Confirm your email address first' using errcode = '42501';
  end if;

  select i.* into v_inv
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.id = p_id and i.status = 'pending' and i.expires_at > now() and lower(i.email) = v_email
  for update of i;
  if not found then
    raise exception 'This invitation is not valid any more' using errcode = '22023';
  end if;

  insert into public.memberships (user_id, tenant_id, role, account_status)
  values (auth.uid(), v_inv.tenant_id, v_inv.role, 'ACTIVE')
  on conflict (user_id, tenant_id) do update set role = excluded.role, account_status = 'ACTIVE';

  update public.user_profiles
    set tenant_id = v_inv.tenant_id, role = v_inv.role, account_status = 'ACTIVE'
    where user_id = auth.uid();

  update public.invitations
    set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
    where id = v_inv.id;

  return v_inv.tenant_id;
end;
$$;


ALTER FUNCTION "public"."accept_my_invitation"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_channel_members"("p_channel" "uuid", "p_users" "uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_added integer;
begin
  if v_me is null or v_tenant is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.channels c
    where c.id = p_channel
      and c.tenant_id = v_tenant
      and c.type is distinct from 'dm'
      and (c.created_by = v_me or public.current_user_role() = 'ADMIN')
  ) then
    raise exception 'You cannot add people to this channel' using errcode = '42501';
  end if;

  with wanted as (
    select distinct u
    from unnest(coalesce(p_users, '{}'::uuid[])) as u
    where exists (
      select 1 from public.memberships m
      where m.user_id = u and m.tenant_id = v_tenant and m.account_status = 'ACTIVE'
    )
    and not exists (select 1 from public.channel_members x where x.channel_id = p_channel and x.user_id = u)
  ), ins as (
    insert into public.channel_members (channel_id, user_id, role)
    select p_channel, u, 'member' from wanted
    returning 1
  )
  select count(*) into v_added from ins;

  return v_added;
end;
$$;


ALTER FUNCTION "public"."add_channel_members"("p_channel" "uuid", "p_users" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_employees"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.has_any_module(
    'employees', 'recruitment', 'leaves', 'performance', 'training', 'assign-managers', 'staffcheck',
    'hr-lifecycle', 'payroll', 'expenses', 'salaryadmin', 'asset', 'mpesa-zap', 'reports', 'phone-approvals',
    'adminconfirm', 'incident-reports', 'settings', 'sms', 'email-portal', 'ai-assistant')
$$;


ALTER FUNCTION "public"."can_read_employees"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_write_employees"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.has_any_module('employees', 'payroll', 'hr-lifecycle', 'assign-managers', 'phone-approvals')
$$;


ALTER FUNCTION "public"."can_write_employees"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."channel_open_to_me"("p_channel" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.channels c
    where c.id = p_channel
      and c.tenant_id = (select public.current_tenant_id())
      and c.type is distinct from 'dm'
      and (
        coalesce(c.is_private, false) = false
        or c.created_by = auth.uid()
        or c.job_title = (select public.current_job_title())
      )
  )
$$;


ALTER FUNCTION "public"."channel_open_to_me"("p_channel" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_deleted_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.memberships where user_id = old.id;
  delete from public.user_profiles where user_id = old.id;
  return old;
end;
$$;


ALTER FUNCTION "public"."cleanup_deleted_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."company_members"() RETURNS TABLE("user_id" "uuid", "email" "text", "avatar_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select m.user_id, u.email, p.avatar_url
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.user_preferences p on p.user_id = m.user_id
  where m.tenant_id = (select public.current_tenant_id())
    and m.account_status = 'ACTIVE'
$$;


ALTER FUNCTION "public"."company_members"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_company"("p_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_slug text;
  v_tenant uuid;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Company name must be 2 to 80 characters' using errcode = '22023';
  end if;

  -- a person can own a handful of companies; this is a guard against a runaway client, not a business rule
  select count(*) into v_count from public.memberships where user_id = auth.uid() and role = 'ADMIN';
  if v_count >= 10 then
    raise exception 'You already administer 10 companies' using errcode = '22023';
  end if;

  v_base := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base := btrim(v_base, '-');
  if char_length(v_base) < 3 then v_base := v_base || '-co'; end if;
  v_base := left(v_base, 30);
  v_base := btrim(v_base, '-');
  v_slug := v_base;
  while exists (select 1 from public.tenants where slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
  end loop;

  insert into public.tenants (name, slug, plan) values (v_name, v_slug, 'trial') returning id into v_tenant;

  -- the new company starts with the same role permissions as the default one, so its roles work straight away
  insert into public.role_permissions (tenant_id, role_name, permissions)
  select v_tenant, rp.role_name, rp.permissions
  from public.role_permissions rp
  where rp.tenant_id = '00000000-0000-0000-0000-000000000001';

  -- every company starts with a general channel, so the chat is never an empty screen
  insert into public.channels (tenant_id, name, description, type, is_private, created_by, is_default)
  values (v_tenant, 'general', 'Company-wide chat and announcements', 'channel', false, auth.uid(), true);

  -- and a standard set of leave types, which they can edit
  perform public.seed_default_leave_types(v_tenant);

  -- their first membership makes it their current company; with existing ones, switch to the new one
  insert into public.memberships (user_id, tenant_id, role, account_status)
  values (auth.uid(), v_tenant, 'ADMIN', 'ACTIVE');
  update public.user_profiles
    set tenant_id = v_tenant, role = 'ADMIN', account_status = 'ACTIVE'
    where user_id = auth.uid();

  return v_tenant;
end;
$$;


ALTER FUNCTION "public"."create_company"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_invitation"("p_email" "text", "p_role" "text") RETURNS TABLE("invitation_id" "uuid", "token" "text", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_caller_role text;
  v_tenant uuid;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select p.role, p.tenant_id into v_caller_role, v_tenant
  from public.user_profiles p
  join public.tenants t on t.id = p.tenant_id and t.status = 'active'
  where p.user_id = auth.uid() and p.account_status = 'ACTIVE';
  if v_tenant is null or v_caller_role not in ('ADMIN', 'HR') then
    raise exception 'Only an administrator or HR can invite people' using errcode = '42501';
  end if;
  -- HR may invite staff only, the same limit as creating logins
  if v_caller_role <> 'ADMIN' and p_role <> 'STAFF' then
    raise exception 'Only an administrator can invite this role' using errcode = '42501';
  end if;
  if p_role not in ('ADMIN', 'HR', 'CHECKER', 'MANAGER', 'REGIONAL', 'OPERATIONS', 'STAFF') then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 254 then
    raise exception 'A valid email is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.tenant_id = v_tenant and lower(u.email) = v_email
  ) then
    raise exception 'That person is already in this company' using errcode = '23505';
  end if;

  -- one open invitation per address and company: a new one replaces the old link
  update public.invitations set status = 'revoked'
  where tenant_id = v_tenant and lower(email) = v_email and status = 'pending';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.invitations (tenant_id, email, role, token_hash, invited_by)
  values (v_tenant, v_email, p_role, public.hash_invite_token(v_token), auth.uid())
  returning id, invitations.expires_at into v_id, v_expires;

  return query select v_id, v_token, v_expires;
end;
$_$;


ALTER FUNCTION "public"."create_invitation"("p_email" "text", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_employee_number"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select e."Employee Number"
  from public.employees e
  join auth.users u on u.id = auth.uid()
  where e.tenant_id = (select public.current_tenant_id())
    and e."Work Email" = u.email
  limit 1
$$;


ALTER FUNCTION "public"."current_employee_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_job_title"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select e."Job Title"
  from public.employees e
  join auth.users u on u.id = auth.uid()
  where e.tenant_id = (select public.current_tenant_id()) and e."Work Email" = u.email
  limit 1
$$;


ALTER FUNCTION "public"."current_job_title"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.tenant_id
  from public.user_profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.user_id = auth.uid() and t.status = 'active'
$$;


ALTER FUNCTION "public"."current_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_email"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select u.email from auth.users u where u.id = auth.uid()
$$;


ALTER FUNCTION "public"."current_user_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.role from public.user_profiles p where p.user_id = auth.uid()
$$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_permissions"("user_id" "uuid") RETURNS "text"[]
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role text;
  v_tenant uuid;
  v_permissions text[];
begin
  select p.tenant_id, p.role into v_tenant, v_role from public.user_profiles p where p.user_id = get_user_permissions.user_id;
  if v_tenant is null or v_role is null then return array[]::text[]; end if;
  if auth.uid() is not null and v_tenant is distinct from public.current_tenant_id() then return array[]::text[]; end if;

  select rp.permissions into v_permissions
  from public.role_permissions rp
  where rp.role_name = v_role and rp.tenant_id = v_tenant;

  return coalesce(v_permissions, array[]::text[]);
end;
$$;


ALTER FUNCTION "public"."get_user_permissions"("user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_permissions"("user_id" "uuid") IS 'Get all permissions for a user based on their auth metadata role';



CREATE OR REPLACE FUNCTION "public"."guard_employee_self_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  k text;
  allowed text[] := array[
    'First Name', 'Middle Name', 'Last Name', 'Personal Mobile', 'Alternative Mobile Number', 'Personal Email',
    'Date of Birth', 'Gender', 'Marital Status', 'Country', 'Postal Address', 'Postal Code', 'Postal Location',
    'City', 'Area', 'Road', 'House Number', 'passport_number', 'blood_group', 'religion',
    'Type of Identification', 'ID Number', 'Profile Image',
    'Tax PIN', 'NHIF Number', 'SHIF Number', 'NSSF Number', 'WIBA', 'Pension Start Date', 'Employee AVC',
    'Employer AVC', 'Pension Deduction', 'NSSF Deduction', 'NHIF Deduction', 'Housing Levy Deduction',
    'Tax Exempted', 'Disability Cert No', 'NITA', 'NITA Deductions', 'HELB', 'HELB option'
  ];
begin
  -- the backend (service role / migrations) and people who manage employees are not limited
  if auth.uid() is null or public.can_write_employees() then
    return new;
  end if;

  for k in
    select o.key from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n on n.key = o.key
    where o.value is distinct from n.value
  loop
    -- the primary mobile number may be set once, while it is still empty (a new employee adding their own number);
    -- changing it afterwards goes through HR, as before
    if k = 'Mobile Number' and coalesce(btrim(old."Mobile Number"), '') = '' then
      continue;
    end if;
    if k <> all (allowed) then
      raise exception 'You can only change your own personal details (not "%")', k
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_employee_self_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_any_module"(VARIADIC "p_modules" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(bool_or(public.has_module(m)), false) from unnest(p_modules) as m
$$;


ALTER FUNCTION "public"."has_any_module"(VARIADIC "p_modules" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_module"("p_module" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select p.role = 'ADMIN'
        or exists (
          select 1 from public.role_permissions rp
          where rp.tenant_id = p.tenant_id and rp.role_name = p.role and p_module = any (rp.permissions)
        )
    from public.user_profiles p
    where p.user_id = auth.uid()
  ), false)
$$;


ALTER FUNCTION "public"."has_module"("p_module" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_permission"("user_id" "uuid", "required_permission" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role text;
  v_tenant uuid;
  v_permissions text[];
begin
  select p.tenant_id, p.role into v_tenant, v_role from public.user_profiles p where p.user_id = has_permission.user_id;
  if v_tenant is null or v_role is null then return false; end if;
  if auth.uid() is not null and v_tenant is distinct from public.current_tenant_id() then return false; end if;

  select rp.permissions into v_permissions
  from public.role_permissions rp
  where rp.role_name = v_role and rp.tenant_id = v_tenant;

  return coalesce(required_permission = any (v_permissions), false);
end;
$$;


ALTER FUNCTION "public"."has_permission"("user_id" "uuid", "required_permission" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_permission"("user_id" "uuid", "required_permission" "text") IS 'Check if a user has a specific permission based on their auth metadata role';



CREATE OR REPLACE FUNCTION "public"."hash_invite_token"("p_token" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $$;


ALTER FUNCTION "public"."hash_invite_token"("p_token" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."leave_balances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_number" "text" NOT NULL,
    "leave_type_id" "uuid" NOT NULL,
    "year" integer NOT NULL,
    "accrued_days" numeric DEFAULT 0 NOT NULL,
    "used_days" numeric DEFAULT 0 NOT NULL,
    "carried_over_days" numeric DEFAULT 0 NOT NULL,
    "remaining_days" numeric GENERATED ALWAYS AS ((("accrued_days" + "carried_over_days") - "used_days")) STORED,
    "monthly_accrual" numeric DEFAULT 0 NOT NULL,
    "last_accrual_date" "date",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "month" integer DEFAULT 0 NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."leave_balances" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_leave_balance_used_days"("p_employee_number" "text", "p_leave_type_id" "uuid", "p_year" integer, "p_days" numeric, "p_month" integer DEFAULT 0) RETURNS "public"."leave_balances"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_before public.leave_balances;
  v_after  public.leave_balances;
  v_tenant uuid := public.current_tenant_id();
  v_policy record;
  v_yearly numeric;
  v_seed numeric;
begin
  select * into v_before
  from public.leave_balances
  where employee_number = p_employee_number and leave_type_id = p_leave_type_id and year = p_year and month = p_month;

  select cp.days_allotted, cp.accrual_method into v_policy from public.current_leave_policies cp where cp.leave_type_id = p_leave_type_id;
  v_yearly := public.leave_entitlement(v_tenant, p_employee_number, p_leave_type_id, v_policy.days_allotted);
  v_seed := case when v_policy.accrual_method = 'monthly_cumulative'
                 then public.leave_earned_to_date(v_yearly, extract(month from current_date)::int)
                 else v_yearly end;

  insert into public.leave_balances (employee_number, leave_type_id, year, month, accrued_days, used_days)
  values (p_employee_number, p_leave_type_id, p_year, p_month, v_seed, p_days)
  on conflict (employee_number, leave_type_id, year, month)
  do update set used_days = public.leave_balances.used_days + excluded.used_days, updated_at = now()
  returning * into v_after;

  insert into public.leave_balance_adjustments
    (leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
  values
    (v_after.id, 'approval_deduction', p_days,
     coalesce(v_before.used_days, 0), v_after.used_days,
     coalesce(v_before.accrued_days, v_after.accrued_days), v_after.accrued_days,
     'Leave application approved');

  return v_after;
end;
$$;


ALTER FUNCTION "public"."increment_leave_balance_used_days"("p_employee_number" "text", "p_leave_type_id" "uuid", "p_year" integer, "p_days" numeric, "p_month" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invitation_preview"("p_token" "text") RETURNS TABLE("company_name" "text", "email" "text", "role" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select t.name, i.email, i.role
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.token_hash = public.hash_invite_token(p_token) and i.status = 'pending' and i.expires_at > now()
$$;


ALTER FUNCTION "public"."invitation_preview"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_dm_channel"("p_channel" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select exists (select 1 from public.channels c where c.id = p_channel and c.type = 'dm') $$;


ALTER FUNCTION "public"."is_dm_channel"("p_channel" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leave_earned_to_date"("p_yearly" numeric, "p_month" integer) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    AS $$ select round(coalesce(p_yearly, 0) * least(greatest(p_month, 1), 12) / 12.0, 2) $$;


ALTER FUNCTION "public"."leave_earned_to_date"("p_yearly" numeric, "p_month" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leave_entitlement"("p_tenant" "uuid", "p_employee" "text", "p_type" "uuid", "p_policy_days" numeric) RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(
    (select e.days_allotted from public.leave_entitlements e
     where e.tenant_id = p_tenant and e.employee_number = p_employee and e.leave_type_id = p_type),
    p_policy_days, 0)
$$;


ALTER FUNCTION "public"."leave_entitlement"("p_tenant" "uuid", "p_employee" "text", "p_type" "uuid", "p_policy_days" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."membership_removed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_fallback public.memberships;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if not exists (select 1 from public.user_profiles p where p.user_id = old.user_id and p.tenant_id = old.tenant_id) then
    return null;
  end if;

  select m.* into v_fallback
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
  where m.user_id = old.user_id and m.account_status = 'ACTIVE'
  order by m.created_at
  limit 1;

  if found then
    update public.user_profiles
      set tenant_id = v_fallback.tenant_id, role = v_fallback.role, account_status = v_fallback.account_status
      where user_id = old.user_id;
  else
    delete from public.user_profiles where user_id = old.user_id;
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."membership_removed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."membership_to_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_fallback public.memberships;
  v_email text;
begin
  if pg_trigger_depth() > 1 then return null; end if;

  select u.email into v_email from auth.users u where u.id = new.user_id;

  -- a profile for this email that belongs to a login which no longer exists is a leftover: remove it
  if v_email is not null then
    delete from public.user_profiles p
    where lower(p.email) = lower(v_email)
      and p.user_id <> new.user_id
      and not exists (select 1 from auth.users u where u.id = p.user_id);
  end if;

  insert into public.user_profiles (user_id, email, role, account_status, tenant_id)
  values (new.user_id, v_email, new.role, new.account_status, new.tenant_id)
  on conflict (user_id) do update
    set email          = coalesce(excluded.email, public.user_profiles.email),
        role           = case when public.user_profiles.tenant_id = new.tenant_id then new.role else public.user_profiles.role end,
        account_status = case when public.user_profiles.tenant_id = new.tenant_id then new.account_status else public.user_profiles.account_status end;

  if new.account_status <> 'ACTIVE'
     and exists (select 1 from public.user_profiles p where p.user_id = new.user_id and p.tenant_id = new.tenant_id) then
    select m.* into v_fallback
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    where m.user_id = new.user_id and m.tenant_id <> new.tenant_id and m.account_status = 'ACTIVE'
    order by m.created_at
    limit 1;
    if found then
      update public.user_profiles
        set tenant_id = v_fallback.tenant_id, role = v_fallback.role, account_status = v_fallback.account_status
        where user_id = new.user_id;
    end if;
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."membership_to_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mfa_required"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return coalesce((
    select s.mfa_enabled from public.system_settings s
    where s.tenant_id = (select public.current_tenant_id()) and s.id = 1
  ), false);
exception when undefined_table then
  return false;  -- a database without system_settings has no MFA setting
end;
$$;


ALTER FUNCTION "public"."mfa_required"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_companies"() RETURNS TABLE("tenant_id" "uuid", "name" "text", "slug" "text", "role" "text", "is_current" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select t.id, t.name, t.slug, m.role, (p.tenant_id = t.id)
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
  left join public.user_profiles p on p.user_id = m.user_id
  where m.user_id = auth.uid() and m.account_status = 'ACTIVE'
  order by t.name
$$;


ALTER FUNCTION "public"."my_companies"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_direct_messages"() RETURNS TABLE("channel_id" "uuid", "other_user_id" "uuid", "other_email" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select c.id, o.user_id, u.email
  from public.channels c
  join public.channel_members me on me.channel_id = c.id and me.user_id = auth.uid()
  join public.channel_members o on o.channel_id = c.id and o.user_id <> auth.uid()
  join auth.users u on u.id = o.user_id
  where c.type = 'dm' and c.tenant_id = (select public.current_tenant_id())
$$;


ALTER FUNCTION "public"."my_direct_messages"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_pending_invitations"() RETURNS TABLE("id" "uuid", "company_name" "text", "role" "text", "expires_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select i.id, t.name, i.role, i.expires_at
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  join auth.users u on u.id = auth.uid()
  where u.email_confirmed_at is not null
    and lower(u.email) = lower(i.email)
    and i.status = 'pending'
    and i.expires_at > now()
  order by i.created_at desc
$$;


ALTER FUNCTION "public"."my_pending_invitations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profile_to_membership"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if pg_trigger_depth() > 1 or new.tenant_id is null then return null; end if;
  insert into public.memberships (user_id, tenant_id, role, account_status)
  values (new.user_id, new.tenant_id, coalesce(new.role, 'STAFF'), coalesce(new.account_status, 'ACTIVE'))
  on conflict (user_id, tenant_id) do update
    set role = excluded.role, account_status = excluded.account_status;
  return null;
end;
$$;


ALTER FUNCTION "public"."profile_to_membership"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."propagate_employee_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $_$
declare
  target jsonb;
  targets jsonb := '[
    ["attendance_logs", "employee_number"], ["email_logs", "Employee Number"], ["email_logs", "employee_id"],
    ["expenses", "employee_id"], ["hr_notifications", "employee_number"], ["incident_reports", "employee_number"],
    ["job_applications", "employee_number"], ["mpesa_callbacks", "employee_number"], ["mpesa_callbacks", "employee_id"],
    ["notifications", "employee_number"], ["payroll_records", "Employee ID"], ["payroll_records", "employee_id"],
    ["payroll_records_current", "Employee ID"], ["payroll_records_current", "employee_id"],
    ["phone_number_change_requests", "employee_number"], ["salary_history", "employee_id"],
    ["staff_loans", "guarantor1_employee_number"], ["staff_loans", "guarantor2_employee_number"],
    ["termination_requests", "Employee Number"], ["termination_requests", "employee_id"]
  ]';
begin
  for target in select * from jsonb_array_elements(targets) loop
    -- skip tables/columns that do not exist in this database
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = target ->> 0 and column_name = target ->> 1
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = target ->> 0 and column_name = 'tenant_id'
    ) then
      execute format('update public.%I set %I = $1 where tenant_id = $2 and %I = $3', target ->> 0, target ->> 1, target ->> 1)
        using new."Employee Number", new.tenant_id, old."Employee Number";
    end if;
  end loop;
  return new;
end;
$_$;


ALTER FUNCTION "public"."propagate_employee_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_invitation"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_caller_role text;
  v_tenant uuid;
begin
  select p.role, p.tenant_id into v_caller_role, v_tenant
  from public.user_profiles p where p.user_id = auth.uid() and p.account_status = 'ACTIVE';
  if v_tenant is null or v_caller_role not in ('ADMIN', 'HR') then
    raise exception 'Only an administrator or HR can cancel invitations' using errcode = '42501';
  end if;
  update public.invitations set status = 'revoked'
  where id = p_id and tenant_id = v_tenant and status = 'pending';
end;
$$;


ALTER FUNCTION "public"."revoke_invitation"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_annual_leave_reset"("p_year" integer) RETURNS SETOF "public"."leave_balances"
    LANGUAGE "plpgsql"
    AS $$
declare
  r record;
  v_carry numeric;
  v_days numeric;
  v_new_row public.leave_balances;
begin
  for r in
    select
      e.tenant_id as tenant_id,
      e."Employee Number" as employee_number,
      lt.id as leave_type_id,
      cp.days_allotted,
      cp.carry_forward_max_days,
      prev.remaining_days as prev_remaining
    from public.employees e
    join public.leave_types lt on lt.tenant_id = e.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = e.tenant_id
    left join public.leave_balances prev
      on prev.employee_number = e."Employee Number"
     and prev.tenant_id = e.tenant_id
     and prev.leave_type_id = lt.id
     and prev.year = p_year - 1
     and prev.month = 0
    where lt.is_deductible = true
      and cp.accrual_method = 'annual'
  loop
    v_carry := greatest(least(coalesce(r.prev_remaining, 0), r.carry_forward_max_days), 0);
    v_days := public.leave_entitlement(r.tenant_id, r.employee_number, r.leave_type_id, r.days_allotted);

    insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days)
    values (r.tenant_id, r.employee_number, r.leave_type_id, p_year, 0, v_days, 0, v_carry)
    on conflict (employee_number, leave_type_id, year, month) do nothing
    returning * into v_new_row;

    if found then
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_new_row.id, 'annual_reset', v_days + v_carry, 0, 0, 0, v_days,
         format('Annual reset for %s: %s days allotted + %s carried forward from %s', p_year, v_days, v_carry, p_year - 1));
      return next v_new_row;
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "public"."run_annual_leave_reset"("p_year" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_leave_accrual"("p_year" integer, "p_month" integer) RETURNS SETOF "public"."leave_balances"
    LANGUAGE "plpgsql"
    AS $$
declare
  r record;
  v_carry numeric;
  v_due numeric;
  v_row public.leave_balances;
  v_old numeric;
begin
  for r in
    select
      e.tenant_id as tenant_id,
      e."Employee Number" as employee_number,
      lt.id as leave_type_id,
      cp.days_allotted,
      cp.carry_forward_max_days,
      prev.remaining_days as prev_remaining
    from public.employees e
    join public.leave_types lt on lt.tenant_id = e.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = e.tenant_id
    left join public.leave_balances prev
      on prev.employee_number = e."Employee Number"
     and prev.tenant_id = e.tenant_id
     and prev.leave_type_id = lt.id
     and prev.year = p_year - 1
     and prev.month = 0
    where lt.is_deductible = true
      and cp.accrual_method = 'monthly_cumulative'
  loop
    v_due := public.leave_earned_to_date(public.leave_entitlement(r.tenant_id, r.employee_number, r.leave_type_id, r.days_allotted), p_month);

    select * into v_row from public.leave_balances b
    where b.employee_number = r.employee_number and b.leave_type_id = r.leave_type_id and b.year = p_year and b.month = 0;

    if not found then
      v_carry := greatest(least(coalesce(r.prev_remaining, 0), r.carry_forward_max_days), 0);
      insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days, last_accrual_date)
      values (r.tenant_id, r.employee_number, r.leave_type_id, p_year, 0, v_due, 0, v_carry, current_date)
      returning * into v_row;
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_row.id, 'monthly_accrual', v_due + v_carry, 0, 0, 0, v_due,
         format('Year %s started: %s days earned so far + %s carried forward from %s', p_year, v_due, v_carry, p_year - 1));
      return next v_row;
    elsif v_row.accrued_days < v_due then
      v_old := v_row.accrued_days;
      update public.leave_balances set accrued_days = v_due, last_accrual_date = current_date, updated_at = now()
      where id = v_row.id returning * into v_row;
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_row.id, 'monthly_accrual', v_due - v_old, v_row.used_days, v_row.used_days, v_old, v_due,
         format('Earned %s days by month %s of %s', v_due, p_month, p_year));
      return next v_row;
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "public"."run_leave_accrual"("p_year" integer, "p_month" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_leave_year_end_reminders"("p_today" "date" DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
declare
  r record;
  v_year_end date := make_date(extract(year from p_today)::int, 12, 31);
  v_lost numeric;
  v_title text;
  v_sent integer := 0;
begin
  for r in
    select
      b.tenant_id, b.employee_number, b.remaining_days, lt.name as type_name,
      cp.carry_forward_max_days, cp.reminder_days_before_year_end, cp.reminder_min_remaining,
      e."First Name" as first_name, e."Last Name" as last_name, e."Work Email" as work_email
    from public.leave_balances b
    join public.leave_types lt on lt.id = b.leave_type_id and lt.tenant_id = b.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = b.tenant_id
    join public.employees e on e."Employee Number" = b.employee_number and e.tenant_id = b.tenant_id
    where b.year = extract(year from p_today)::int
      and b.month = 0
      and cp.accrual_method in ('annual', 'monthly_cumulative')
      and cp.reminder_days_before_year_end > 0
      and p_today >= v_year_end - cp.reminder_days_before_year_end
      and b.remaining_days >= cp.reminder_min_remaining
  loop
    -- only what would actually be lost matters: days above the carry-forward cap
    v_lost := greatest(r.remaining_days - coalesce(r.carry_forward_max_days, 0), 0);
    continue when v_lost <= 0;

    v_title := format('Take your %s before the year ends', r.type_name);
    continue when exists (
      select 1 from public.hr_notifications n
      where n.tenant_id = r.tenant_id and n.employee_number = r.employee_number
        and n.notification_type = 'leave_year_end_reminder' and n.title = v_title
        and n.created_at >= date_trunc('month', p_today)
    );

    insert into public.hr_notifications
      (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date, days_remaining, is_read_admin)
    values
      (r.tenant_id, r.employee_number, btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), r.work_email,
       'leave_year_end_reminder', v_title,
       format('You have %s unused %s day(s). %s will be lost on %s%s. Please plan to take some leave before then.',
              r.remaining_days, r.type_name, v_lost, to_char(v_year_end, 'DD Mon YYYY'),
              case when coalesce(r.carry_forward_max_days, 0) > 0 then format(' (only %s can be carried forward)', r.carry_forward_max_days) else '' end),
       v_year_end, v_year_end - p_today, true);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;


ALTER FUNCTION "public"."run_leave_year_end_reminders"("p_today" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_monthly_leave_reset"("p_year" integer, "p_month" integer) RETURNS SETOF "public"."leave_balances"
    LANGUAGE "plpgsql"
    AS $$
declare
  r record;
  v_new_row public.leave_balances;
begin
  for r in
    select
      e.tenant_id as tenant_id,
      e."Employee Number" as employee_number,
      lt.id as leave_type_id,
      cp.days_allotted
    from public.employees e
    join public.leave_types lt on lt.tenant_id = e.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = e.tenant_id
    where lt.is_deductible = true
      and cp.accrual_method = 'monthly_non_cumulative'
  loop
    insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days)
    values (r.tenant_id, r.employee_number, r.leave_type_id, p_year, p_month, coalesce(r.days_allotted, 0), 0, 0)
    on conflict (employee_number, leave_type_id, year, month) do nothing
    returning * into v_new_row;

    if found then
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_new_row.id, 'monthly_reset', coalesce(r.days_allotted, 0), 0, 0, 0, coalesce(r.days_allotted, 0),
         format('Monthly reset for %s-%s: %s days, does not carry over', p_year, p_month, coalesce(r.days_allotted, 0)));
      return next v_new_row;
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "public"."run_monthly_leave_reset"("p_year" integer, "p_month" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_default_leave_types"("p_tenant" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.leave_types (tenant_id, name, description, is_deductible, is_continuous, icon)
  values
    (p_tenant, 'Annual Leave', 'Yearly leave, earned month by month', true, true, 'Sun'),
    (p_tenant, 'Sick Leave', 'Time off when unwell', true, true, 'Heart'),
    (p_tenant, 'Compassionate Leave', 'Bereavement and family emergencies', true, true, 'HeartHandshake'),
    (p_tenant, 'Maternity Leave', 'Leave for new mothers', false, true, 'Baby'),
    (p_tenant, 'Paternity Leave', 'Leave for new fathers', false, true, 'Baby'),
    (p_tenant, 'Study/Exam Leave', 'Time off for study or examinations', true, true, 'book'),
    (p_tenant, 'Unpaid Leave', 'Leave without pay', true, true, 'calendar')
  on conflict (tenant_id, name) where tenant_id is not null do nothing;

  -- (days, method, carry-forward cap, remind this many days before year end, ...if at least this many days are left)
  insert into public.leave_policies (tenant_id, leave_type_id, days_allotted, accrual_method, carry_forward_max_days, reminder_days_before_year_end, reminder_min_remaining)
  select p_tenant, lt.id, v.days, v.method, v.carry, v.remind_days, v.remind_min
  from public.leave_types lt
  join (values
    ('Annual Leave', 24::numeric, 'monthly_cumulative', 0::numeric, 60, 14::numeric),
    ('Sick Leave', 14::numeric, 'annual', 0::numeric, 0, 0::numeric),
    ('Compassionate Leave', 3::numeric, 'monthly_non_cumulative', 0::numeric, 0, 0::numeric),
    ('Maternity Leave', 90::numeric, 'annual', 0::numeric, 0, 0::numeric),
    ('Paternity Leave', 14::numeric, 'annual', 0::numeric, 0, 0::numeric),
    ('Study/Exam Leave', 10::numeric, 'annual', 0::numeric, 0, 0::numeric)
  ) as v(name, days, method, carry, remind_days, remind_min) on v.name = lt.name
  where lt.tenant_id = p_tenant
    and not exists (select 1 from public.leave_policies p where p.leave_type_id = lt.id);
end;
$$;


ALTER FUNCTION "public"."seed_default_leave_types"("p_tenant" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_leave_entitlement"("p_employee_number" "text", "p_leave_type_id" "uuid", "p_days" numeric, "p_year" integer DEFAULT NULL::integer) RETURNS "public"."leave_balances"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_year integer := coalesce(p_year, extract(year from current_date)::int);
  v_tenant uuid := public.current_tenant_id();
  v_method text;
  v_new numeric;
  v_row public.leave_balances;
  v_old numeric;
begin
  if p_days is null or p_days < 0 then
    raise exception 'The allowance must be zero or more days' using errcode = '22023';
  end if;

  insert into public.leave_entitlements (tenant_id, employee_number, leave_type_id, days_allotted)
  values (v_tenant, p_employee_number, p_leave_type_id, p_days)
  on conflict (tenant_id, employee_number, leave_type_id)
  do update set days_allotted = excluded.days_allotted, updated_at = now();

  select accrual_method into v_method from public.current_leave_policies where leave_type_id = p_leave_type_id;
  v_new := case when v_method = 'monthly_cumulative'
                then public.leave_earned_to_date(p_days, extract(month from current_date)::int)
                else p_days end;

  select * into v_row from public.leave_balances
  where employee_number = p_employee_number and leave_type_id = p_leave_type_id and year = v_year and month = 0;
  if found and v_method in ('annual', 'monthly_cumulative') then
    v_old := v_row.accrued_days;
    update public.leave_balances set accrued_days = v_new, updated_at = now() where id = v_row.id returning * into v_row;
    insert into public.leave_balance_adjustments
      (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
    values
      (v_row.tenant_id, v_row.id, 'allowance_change', v_new - v_old, v_row.used_days, v_row.used_days, v_old, v_new,
       format('Yearly allowance set to %s days for this employee', p_days));
  end if;
  return v_row;
end;
$$;


ALTER FUNCTION "public"."set_leave_entitlement"("p_employee_number" "text", "p_leave_type_id" "uuid", "p_days" numeric, "p_year" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_direct_message"("p_other" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'You are not in a company' using errcode = '42501';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'Choose someone else to message' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.user_id = p_other and m.tenant_id = v_tenant and m.account_status = 'ACTIVE'
  ) then
    raise exception 'That person is not in your company' using errcode = '22023';
  end if;

  -- the conversation between exactly these two people, if there already is one
  select c.id into v_id
  from public.channels c
  where c.tenant_id = v_tenant and c.type = 'dm'
    and exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = v_me)
    and exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = p_other)
    and (select count(*) from public.channel_members m where m.channel_id = c.id) = 2
  limit 1;

  if v_id is null then
    insert into public.channels (tenant_id, name, type, is_private, created_by)
    values (v_tenant, 'dm', 'dm', true, v_me)
    returning id into v_id;
    insert into public.channel_members (channel_id, user_id, role)
    values (v_id, v_me, 'member'), (v_id, p_other, 'member');
  end if;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."start_direct_message"("p_other" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."switch_company"("p_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_member public.memberships;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select m.* into v_member
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
  where m.user_id = auth.uid() and m.tenant_id = p_tenant_id and m.account_status = 'ACTIVE';
  if not found then
    raise exception 'You are not a member of that company' using errcode = '42501';
  end if;

  update public.user_profiles
    set tenant_id = v_member.tenant_id, role = v_member.role, account_status = v_member.account_status
    where user_id = auth.uid();
  if not found then
    raise exception 'No profile for this user' using errcode = '42501';
  end if;
end;
$$;


ALTER FUNCTION "public"."switch_company"("p_tenant_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Employee_Records_Duplicate" (
    "Employee Number" "text",
    "Official Email" "text",
    "Town" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."Employee_Records_Duplicate" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assets" (
    "model" "text",
    "status" "text",
    "condition" "text",
    "location" "text",
    "assigned_to" "text",
    "notes" "text",
    "purchase_date" "date",
    "purchase_value" numeric,
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "created_at" timestamp without time zone DEFAULT "now"(),
    "next_maintenance" "date",
    "last_maintenance" "date",
    "warranty_expiry" "date",
    "asset_name" "text",
    "asset_tag" "text",
    "category" "text",
    "serial_number" "text",
    "brand" "text",
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_logs" (
    "employee_number" "text",
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "login_time" timestamp with time zone,
    "logout_time" timestamp with time zone,
    "geolocation" "jsonb",
    "status" "text",
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."attendance_logs" OWNER TO "postgres";


ALTER TABLE "public"."attendance_logs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."attendance_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "user_agent" "text",
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "record_id" "uuid",
    "old_data" "jsonb",
    "new_data" "jsonb",
    "performed_by" "uuid",
    "performed_at" timestamp with time zone DEFAULT "now"(),
    "action_type" character varying,
    "table_name" character varying,
    "ip_address" character varying,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branch_performance" (
    "portfolio_at_risk" numeric,
    "total_active_loans" integer,
    "loans_in_arrears" integer,
    "arrears_amount" numeric,
    "new_loans" integer,
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "total_loans_disbursed" integer,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "staff_count" integer,
    "disbursement_target" integer,
    "total_collection" numeric,
    "collection_target" numeric,
    "average_tat" numeric,
    "total_par" numeric,
    "id" integer NOT NULL,
    "branch_id" bigint,
    "date" "date",
    "period" "text",
    "portfolio_quality" "text",
    "portfolio_size" numeric,
    "client_dropout_rate" numeric,
    "new_clients" integer,
    "active_clients" integer,
    "loan_officer_count" integer,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."branch_performance" OWNER TO "postgres";


ALTER TABLE "public"."branch_performance" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."branch_performance_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."channel_members" (
    "channel_id" "uuid",
    "user_id" "uuid",
    "joined_at" timestamp with time zone DEFAULT "now"(),
    "last_read_at" timestamp with time zone,
    "is_muted" boolean DEFAULT false,
    "role" "text" DEFAULT 'member'::"text",
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."channel_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."channels" (
    "is_private" boolean DEFAULT false,
    "created_by" "uuid",
    "job_title" "text",
    "description" "text",
    "type" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "name" "text",
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_visits" (
    "visit_id" bigint NOT NULL,
    "employee_id" "text",
    "client_id" "text",
    "visit_date" "date" DEFAULT CURRENT_DATE,
    "purpose" "text",
    "outcome" "text",
    "next_action" "text",
    "next_visit_date" "date",
    "location" "text",
    "branch_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."client_visits" OWNER TO "postgres";


ALTER TABLE "public"."client_visits" ALTER COLUMN "visit_id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."client_visits_visit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."clients" (
    "client_id" "text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "id_number" "text",
    "date_of_birth" "date",
    "gender" "text",
    "marital_status" "text",
    "phone_number" "text",
    "email" "text",
    "address" "text",
    "town" "text",
    "postal_code" "text",
    "occupation" "text",
    "monthly_income" numeric,
    "registration_date" "date" DEFAULT CURRENT_DATE,
    "status" "text" DEFAULT 'Active'::"text",
    "loan_officer" "text",
    "branch_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "date" "date" NOT NULL,
    "description" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."company_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_logo" (
    "id" bigint NOT NULL,
    "image_url" "text",
    "company_name" "text",
    "company_tagline" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."company_logo" OWNER TO "postgres";


ALTER TABLE "public"."company_logo" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."company_logo_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."leave_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "leave_type_id" "uuid" NOT NULL,
    "days_allotted" numeric,
    "accrual_method" "text" DEFAULT 'annual'::"text" NOT NULL,
    "carry_forward_max_days" numeric DEFAULT 0 NOT NULL,
    "effective_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    "reminder_days_before_year_end" integer DEFAULT 0 NOT NULL,
    "reminder_min_remaining" numeric DEFAULT 0 NOT NULL,
    CONSTRAINT "leave_policies_accrual_method_check" CHECK (("accrual_method" = ANY (ARRAY['annual'::"text", 'monthly_cumulative'::"text", 'monthly_non_cumulative'::"text", 'none'::"text"]))),
    CONSTRAINT "leave_policies_reminder_check" CHECK ((("reminder_days_before_year_end" >= 0) AND ("reminder_min_remaining" >= (0)::numeric)))
);


ALTER TABLE "public"."leave_policies" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."current_leave_policies" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("leave_type_id") "id",
    "leave_type_id",
    "days_allotted",
    "accrual_method",
    "carry_forward_max_days",
    "effective_from",
    "created_at",
    "tenant_id",
    "reminder_days_before_year_end",
    "reminder_min_remaining"
   FROM "public"."leave_policies"
  WHERE ("effective_from" <= CURRENT_DATE)
  ORDER BY "leave_type_id", "effective_from" DESC;


ALTER VIEW "public"."current_leave_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dependents" (
    "id" bigint NOT NULL,
    "Employee Number" "text",
    "full_name" "text",
    "relationship" "text",
    "date_birth" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."dependents" OWNER TO "postgres";


ALTER TABLE "public"."dependents" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."dependents_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."email_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "body" "text",
    "subject" "text",
    "sent_to" "text",
    "email_type" "text",
    "status" "text",
    "error_message" "text",
    "Employee Number" "text",
    "employee_id" "text",
    "sent_at" timestamp with time zone,
    "sent_by" "uuid",
    "bounce_reason" "text",
    "bounced_at" timestamp with time zone,
    "last_webhook_event" "text",
    "webhook_received_at" timestamp with time zone,
    "message_id" "text",
    "resend_id" "text",
    "request_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."email_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."emergency_contact" (
    "id" bigint NOT NULL,
    "Employee Number" "text",
    "full_name" "text",
    "relationship" "text",
    "phone_number" "text",
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."emergency_contact" OWNER TO "postgres";


ALTER TABLE "public"."emergency_contact" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."emergency_contact_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."employees" (
    "Employee Number" "text" NOT NULL,
    "First Name" "text",
    "Middle Name" "text",
    "Last Name" "text",
    "Work Email" "text",
    "Town" "text",
    "Branch" "text",
    "Office" "text",
    "ID Number" bigint,
    "Job Title" "text",
    "Work Mobile" "text",
    "Start Date" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "Personal Mobile" "text",
    "house_allowance" "text",
    "travel_allowance" "text",
    "bonus" "text",
    "overtime" "text",
    "hardship" "text",
    "manager_email" "text",
    "regional_manager" "text",
    "internship_start_date" "date",
    "Basic Salary" numeric,
    "Employee Id" smallint,
    "Entity" "text",
    "Employee Type" "text",
    "Job Group" "text",
    "Job Level" "text",
    "Type of Identification" "text",
    "Payroll Number" "text",
    "Mobile Number" "text",
    "Alternative Mobile Number" "text",
    "Internship End Date" "text",
    "Probation Start Date" "text",
    "Probation End Date" "text",
    "Contract Start Date" "text",
    "Contract End Date" "text",
    "Termination Date" "text",
    "Manager" "text",
    "Leave Approver" "text",
    "Alternate Approver" "text",
    "Personal Email" "text",
    "Date of Birth" "text",
    "Gender" "text",
    "Marital Status" "text",
    "Country" "text" DEFAULT 'Kenya'::"text",
    "Postal Address" "text",
    "Postal Code" "text",
    "Postal Location" "text",
    "City" "text",
    "Area" "text",
    "Road" "text",
    "House Number" "text",
    "Tax PIN" "text",
    "NHIF Number" "text",
    "SHIF Number" "text",
    "NSSF Number" "text",
    "WIBA" "text",
    "Pension Start Date" "text",
    "Employee AVC" "text",
    "Employer AVC" "text",
    "Pension Deduction" "text",
    "NSSF Deduction" "text",
    "NHIF Deduction" "text",
    "Housing Levy Deduction" "text",
    "Tax Exempted" "text",
    "Disability Cert No" "text",
    "Account Number" "text",
    "Bank" "text",
    "Bank Branch" "text",
    "passport_number" "text",
    "blood_group" "text",
    "religion" "text",
    "second_level_leave_approver" "text",
    "alternate_second_level_approver" "text",
    "NITA" "text",
    "NITA Deductions" "text",
    "HELB" "text",
    "HELB option" "text",
    "account_number_name" "text",
    "payment_method" "text",
    "Currency" "text" DEFAULT 'KES'::"text",
    "Profile Image" "text",
    "Status" "text" DEFAULT 'Active'::"text",
    "Role" "text" DEFAULT 'STAFF'::"text",
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."employee_directory" WITH ("security_barrier"='true') AS
 SELECT "tenant_id",
    "Employee Number",
    "Employee Id",
    "First Name",
    "Middle Name",
    "Last Name",
    "Work Email",
    "Work Mobile",
    "Job Title",
    "Job Level",
    "Job Group",
    "Employee Type",
    "Entity",
    "Status",
    "Town",
    "Branch",
    "Office",
    "Area",
    "Manager",
    "manager_email",
    "regional_manager",
    "Leave Approver",
    "Alternate Approver",
    "second_level_leave_approver",
    "alternate_second_level_approver",
    "Date of Birth",
    "Start Date",
    "Profile Image"
   FROM "public"."employees" "e"
  WHERE ("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"));


ALTER VIEW "public"."employee_directory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_performance" (
    "id" bigint NOT NULL,
    "employee_id" "text",
    "full_name" "text",
    "branch" "text",
    "date" "date",
    "period" "text",
    "total_clients" integer,
    "retained_clients" integer,
    "new_clients_active" integer,
    "new_clients_inactive" integer,
    "retained_active" integer,
    "retained_inactive" integer,
    "total_active" integer,
    "total_inactive" integer,
    "no_of_disb" integer,
    "disb_amount" numeric,
    "targeted_disb_no" integer,
    "targeted_disb_amount" numeric,
    "targeted_olb" numeric,
    "actual_olb" numeric,
    "collected_loan_amount" numeric,
    "overdue_loans" integer,
    "average_loan_size" numeric,
    "loan_recovery_rate" numeric,
    "client_satisfaction_score" numeric,
    "portfolio_at_risk" numeric,
    "total_active_loans" integer,
    "loans_in_arrears" integer,
    "arrears_amount" numeric,
    "new_loans" integer,
    "tat_average" numeric,
    "working_days" integer,
    "attendance_days" integer,
    "portfolio_size" numeric,
    "par_amount" numeric,
    "collection_target" numeric,
    "collection_amount" numeric,
    "field_visits_target" integer,
    "disbursement_target" integer,
    "clients_visited" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."employee_performance" OWNER TO "postgres";


ALTER TABLE "public"."employee_performance" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."employee_performance_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" "text",
    "category" "text",
    "amount" numeric,
    "date" "date" DEFAULT CURRENT_DATE,
    "description" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "receipt" "text",
    "submitted_by" "text" DEFAULT 'Expense Proposer'::"text",
    "location" "text",
    "branch" "text",
    "department" "text",
    "expense_type" "text",
    "employee_id" "text",
    "employee_full_name" "text",
    "approved_by" "text",
    "approved_date" "date",
    "rejection_reason" "text",
    "rec_reason" "text",
    "recommended_by" "text",
    "recommended_date" timestamp with time zone,
    "region" "text",
    "avatar" "text" DEFAULT 'EP'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."holidays" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text",
    "date" "date",
    "recurring" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."holidays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hr_contract_settings" (
    "id" integer NOT NULL,
    "legacy_tenant_id" "text",
    "default_probation_months" integer DEFAULT 3,
    "default_contract_months" integer DEFAULT 12,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."hr_contract_settings" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."hr_contract_settings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."hr_contract_settings_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."hr_contract_settings_id_seq" OWNED BY "public"."hr_contract_settings"."id";



CREATE TABLE IF NOT EXISTS "public"."hr_employment_status" (
    "id" integer NOT NULL,
    "Employee Number" "text",
    "employment_type" "text",
    "joining_date" "date",
    "probation_duration_months" integer DEFAULT 3,
    "contract_duration_months" integer DEFAULT 12,
    "probation_end_date" "date",
    "contract_end_date" "date",
    "is_confirmed" boolean DEFAULT false,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    CONSTRAINT "hr_employment_status_employment_type_check" CHECK (("employment_type" = ANY (ARRAY['Attachment'::"text", 'Probation'::"text", 'Contract'::"text", 'Permanent'::"text"])))
);


ALTER TABLE "public"."hr_employment_status" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."hr_employment_status_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."hr_employment_status_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."hr_employment_status_id_seq" OWNED BY "public"."hr_employment_status"."id";



CREATE TABLE IF NOT EXISTS "public"."hr_leave_schedules" (
    "id" integer NOT NULL,
    "Employee Number" "text",
    "leave_type" "text",
    "leave_start_date" "date",
    "leave_end_date" "date",
    "leave_days" integer,
    "status" "text" DEFAULT 'Scheduled'::"text",
    "notify_5days" boolean DEFAULT true,
    "notify_1day" boolean DEFAULT true,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    CONSTRAINT "hr_leave_schedules_status_check" CHECK (("status" = ANY (ARRAY['Scheduled'::"text", 'Approved'::"text", 'Rejected'::"text", 'Completed'::"text"])))
);


ALTER TABLE "public"."hr_leave_schedules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."hr_leave_schedules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."hr_leave_schedules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."hr_leave_schedules_id_seq" OWNED BY "public"."hr_leave_schedules"."id";



CREATE TABLE IF NOT EXISTS "public"."hr_lifecycle_history" (
    "id" integer NOT NULL,
    "Employee Number" "text",
    "event_type" "text",
    "event_date" timestamp with time zone DEFAULT "now"(),
    "old_value" "jsonb",
    "new_value" "jsonb",
    "notes" "text",
    "performed_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    CONSTRAINT "hr_lifecycle_history_event_type_check" CHECK (("event_type" = ANY (ARRAY['branch_transfer'::"text", 'promotion'::"text", 'position_change'::"text", 'salary_revision'::"text", 'status_change'::"text", 'probation_confirmed'::"text", 'probation_extended'::"text", 'contract_renewed'::"text", 'contract_converted'::"text", 'suspension'::"text", 'reactivation'::"text", 'termination'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."hr_lifecycle_history" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."hr_lifecycle_history_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."hr_lifecycle_history_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."hr_lifecycle_history_id_seq" OWNED BY "public"."hr_lifecycle_history"."id";



CREATE TABLE IF NOT EXISTS "public"."hr_notifications" (
    "id" bigint NOT NULL,
    "employee_number" "text" NOT NULL,
    "employee_name" "text",
    "work_email" "text",
    "notification_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "end_date" "date",
    "days_remaining" integer,
    "is_read_admin" boolean DEFAULT false NOT NULL,
    "is_read_staff" boolean DEFAULT false NOT NULL,
    "email_sent" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    CONSTRAINT "hr_notifications_notification_type_check" CHECK (("notification_type" = ANY (ARRAY['contract_expiring'::"text", 'probation_expiring'::"text", 'leave_recommended'::"text", 'leave_approved'::"text", 'leave_rejected'::"text", 'leave_year_end_reminder'::"text"])))
);


ALTER TABLE "public"."hr_notifications" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."hr_notifications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."hr_notifications_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."hr_notifications_id_seq" OWNED BY "public"."hr_notifications"."id";



CREATE TABLE IF NOT EXISTS "public"."hr_salary_advances" (
    "id" integer NOT NULL,
    "Employee Number" "text",
    "advance_date" "date" NOT NULL,
    "advance_amount" numeric(12,2) NOT NULL,
    "monthly_deduction" numeric(12,2) NOT NULL,
    "total_repaid" numeric(12,2) DEFAULT 0,
    "remaining_balance" numeric(12,2) DEFAULT 0,
    "is_completed" boolean DEFAULT false,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."hr_salary_advances" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."hr_salary_advances_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."hr_salary_advances_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."hr_salary_advances_id_seq" OWNED BY "public"."hr_salary_advances"."id";



CREATE TABLE IF NOT EXISTS "public"."hr_suspensions" (
    "id" integer NOT NULL,
    "Employee Number" "text",
    "suspension_date" "date" NOT NULL,
    "suspension_reason" "text",
    "duration_days" integer,
    "auto_reactivate" boolean DEFAULT false,
    "reactivation_date" "date",
    "is_active" boolean DEFAULT true,
    "exclude_from_payroll" boolean DEFAULT false,
    "notes" "text",
    "performed_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."hr_suspensions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."hr_suspensions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."hr_suspensions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."hr_suspensions_id_seq" OWNED BY "public"."hr_suspensions"."id";



CREATE TABLE IF NOT EXISTS "public"."hr_termination_interviews" (
    "id" integer NOT NULL,
    "Employee Number" "text",
    "interview_date" timestamp with time zone,
    "interviewer" "text",
    "interview_notes" "text",
    "document_url" "text",
    "is_completed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."hr_termination_interviews" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."hr_termination_interviews_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."hr_termination_interviews_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."hr_termination_interviews_id_seq" OWNED BY "public"."hr_termination_interviews"."id";



CREATE TABLE IF NOT EXISTS "public"."hr_terminations" (
    "id" integer NOT NULL,
    "Employee Number" "text",
    "termination_date" "date" NOT NULL,
    "termination_type" "text",
    "termination_reason" "text",
    "document_url" "text",
    "final_payroll_status" "text" DEFAULT 'Pending'::"text",
    "clearance_status" "text" DEFAULT 'Pending'::"text",
    "is_archived" boolean DEFAULT false,
    "performed_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    CONSTRAINT "hr_terminations_termination_type_check" CHECK (("termination_type" = ANY (ARRAY['Voluntary'::"text", 'Dismissal'::"text", 'Contract End'::"text", 'Redundancy'::"text"])))
);


ALTER TABLE "public"."hr_terminations" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."hr_terminations_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."hr_terminations_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."hr_terminations_id_seq" OWNED BY "public"."hr_terminations"."id";



CREATE TABLE IF NOT EXISTS "public"."incident_reports" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "employee_number" "text",
    "is_anonymous" boolean DEFAULT false NOT NULL,
    "incident_type" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "incident_date" "date",
    "location" "text",
    "witnesses" "text",
    "evidence_urls" "text"[],
    "status" "text" DEFAULT 'new'::"text",
    "admin_notes" "text",
    "reviewed_by" "text",
    "reviewed_at" timestamp with time zone,
    "resolution" "text",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    CONSTRAINT "incident_reports_incident_type_check" CHECK (("incident_type" = ANY (ARRAY['harassment'::"text", 'discrimination'::"text", 'safety_violation'::"text", 'ethics_violation'::"text", 'fraud'::"text", 'theft'::"text", 'policy_violation'::"text", 'workplace_violence'::"text", 'other'::"text"]))),
    CONSTRAINT "incident_reports_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "incident_reports_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'under_review'::"text", 'investigating'::"text", 'resolved'::"text", 'closed'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."incident_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "accepted_at" timestamp with time zone,
    "accepted_by" "uuid",
    CONSTRAINT "invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_applications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "job_posting_id" "uuid",
    "employee_number" "text",
    "cover_letter" "text",
    "additional_info" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "reviewed_by" "text",
    "reviewed_at" timestamp with time zone,
    "admin_notes" "text",
    "applied_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "first_name" "text",
    "last_name" "text",
    "email" "text",
    "phone" "text",
    "id_number" "text",
    "nationality" "text",
    "county" "text",
    "constituency" "text",
    "postal_code" "text",
    "address" "text",
    "department" "text",
    "position" "text",
    "preferred_location" "text",
    "available_start_date" "text",
    "education" "text",
    "university" "text",
    "graduation_year" "text",
    "work_experience" "text",
    "previous_company" "text",
    "previous_role" "text",
    "previous_salary" "text",
    "expected_salary" "text",
    "skills" "text",
    "languages" "text",
    "markets_worked" "text",
    "resume_file_name" "text",
    "resume_file_url" "text",
    "references" "text",
    "why_joining_us" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."job_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_positions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" "text",
    "department" "text",
    "type" "text",
    "branch" "text",
    "status" "text" DEFAULT 'open'::"text",
    "applications" "text" DEFAULT '0'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."job_positions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_postings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "job_title" "text" NOT NULL,
    "department" "text" NOT NULL,
    "location" "text",
    "job_type" "text" NOT NULL,
    "job_level" "text",
    "description" "text" NOT NULL,
    "requirements" "text" NOT NULL,
    "responsibilities" "text",
    "salary_range" "text",
    "benefits" "text",
    "application_deadline" "date",
    "status" "text" DEFAULT 'open'::"text",
    "posted_by" "text",
    "posted_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."job_postings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kenya_branches" (
    "id" bigint NOT NULL,
    "Town" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "Area" "text",
    "Branch Office" "text",
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."kenya_branches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kenya_branches_duplicate" (
    "id" bigint NOT NULL,
    "Town" "text",
    "Branch Office" "text",
    "Area" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."kenya_branches_duplicate" OWNER TO "postgres";


ALTER TABLE "public"."kenya_branches_duplicate" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."kenya_branches_duplicate_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."kenya_branches" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."kenya_branches_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."kenya_office_locations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text",
    "location" "text",
    "hiring_status" "text" DEFAULT 'active'::"text",
    "total_positions" integer,
    "critically_needed" integer,
    "urgent_positions" integer,
    "contact_email" "text",
    "contact_phone" "text",
    "address" "text",
    "town" "text",
    "county" "text",
    "country" "text" DEFAULT 'Kenya'::"text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."kenya_office_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_application" (
    "recommendation_notes" "text",
    "recstatus" "text",
    "region" "text",
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "Employee Number" "text",
    "Application Type" "text",
    "reason" "text",
    "Leave Type" "text",
    "Start Date" "text",
    "status" "text",
    "Office Branch" "text",
    "time_added" timestamp with time zone DEFAULT "now"(),
    "days" bigint,
    "name" "text",
    "End Date" "text",
    "type" "text",
    "notes" "text",
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."leave_application" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_balance_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "leave_balance_id" "uuid" NOT NULL,
    "change_type" "text" NOT NULL,
    "delta_days" numeric NOT NULL,
    "used_days_before" numeric NOT NULL,
    "used_days_after" numeric NOT NULL,
    "accrued_days_before" numeric NOT NULL,
    "accrued_days_after" numeric NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    CONSTRAINT "leave_balance_adjustments_change_type_check" CHECK (("change_type" = ANY (ARRAY['approval_deduction'::"text", 'annual_reset'::"text", 'monthly_reset'::"text", 'monthly_accrual'::"text", 'allowance_change'::"text"])))
);


ALTER TABLE "public"."leave_balance_adjustments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_entitlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    "employee_number" "text" NOT NULL,
    "leave_type_id" "uuid" NOT NULL,
    "days_allotted" numeric NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "leave_entitlements_days_allotted_check" CHECK (("days_allotted" >= (0)::numeric))
);


ALTER TABLE "public"."leave_entitlements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_types" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_deductible" boolean DEFAULT true,
    "is_continuous" boolean DEFAULT false,
    "max_days" integer,
    "icon" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."leave_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loan_payments" (
    "payment_id" bigint NOT NULL,
    "loan_id" "uuid",
    "amount_paid" numeric,
    "payment_date" "date" DEFAULT CURRENT_DATE,
    "payment_method" "text",
    "received_by" "text",
    "branch_id" bigint,
    "is_on_time" boolean,
    "principal_amount" numeric,
    "interest_amount" numeric,
    "fees_amount" numeric,
    "penalty_amount" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."loan_payments" OWNER TO "postgres";


ALTER TABLE "public"."loan_payments" ALTER COLUMN "payment_id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."loan_payments_payment_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."loan_requests" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "Employee Number" "text",
    "Full Name" "text",
    "Office Branch" "text",
    "Basic Salary" numeric,
    "Loan Amount" numeric,
    "Number of Months" integer,
    "Monthly Deduction" numeric,
    "Repayment Schedule" "text",
    "Reason for Loan" "text",
    "status" "text" DEFAULT 'Pending'::"text",
    "admin_notes" "text",
    "time_added" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."loan_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loans" (
    "loan_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "text",
    "loan_officer" "text",
    "branch_id" bigint,
    "product_type" "text",
    "amount_disbursed" numeric,
    "outstanding_balance" numeric,
    "interest_rate" numeric,
    "term_months" integer,
    "disbursement_date" "date",
    "maturity_date" "date",
    "repayment_frequency" "text",
    "status" "text" DEFAULT 'Pending'::"text",
    "par_days" integer DEFAULT 0,
    "last_payment_date" "date",
    "next_payment_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."loans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meeting_transcripts" (
    "id" bigint NOT NULL,
    "meeting_code" "text",
    "participant_name" "text",
    "transcript" "text",
    "summary" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."meeting_transcripts" OWNER TO "postgres";


ALTER TABLE "public"."meeting_transcripts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."meeting_transcripts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."memberships" (
    "user_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'STAFF'::"text" NOT NULL,
    "account_status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_reactions" (
    "message_id" "uuid",
    "emoji" "text",
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."message_reactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "reactions" "jsonb" DEFAULT '[]'::"jsonb",
    "channel_id" "uuid",
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "author_id" "uuid",
    "content" "text",
    "mentions" "jsonb" DEFAULT '[]'::"jsonb",
    "attachments" "jsonb" DEFAULT '[]'::"jsonb",
    "reply_to" "uuid",
    "is_edited" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "author_name" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "author_initials" "text",
    "author_avatar" "text",
    "author_town" "text",
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mfa_codes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "email" "text" NOT NULL,
    "code" "text" NOT NULL,
    "phone_number" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."mfa_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mfa_numbers" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "email" "text" NOT NULL,
    "phone_number" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."mfa_numbers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mpesa_callbacks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "full_name" "text",
    "transaction_id" "text",
    "employee_number" "text",
    "employee_id" "text",
    "phone_number" "text",
    "result_code" integer,
    "result_type" "text",
    "result_desc" "text",
    "status" "text" DEFAULT 'Pending'::"text",
    "amount" numeric,
    "originator_conversation_id" "text",
    "conversation_id" "text",
    "raw_response" "jsonb",
    "callback_date" timestamp with time zone DEFAULT "now"(),
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."mpesa_callbacks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mpesa_transactions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "loan_id" "text",
    "transaction_date" "date",
    "transaction_time" "text",
    "amount" numeric,
    "mpesa_code" "text",
    "phone_number" "text",
    "status" "text" DEFAULT 'Pending'::"text",
    "purpose" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."mpesa_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" "text",
    "message" "text",
    "type" "text",
    "priority" "text" DEFAULT 'medium'::"text",
    "employee_number" "text",
    "related_entity" "text",
    "related_entity_id" "text",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_flows" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "type" "text" DEFAULT 'single'::"text",
    "employee_data" "jsonb",
    "employees_data" "jsonb",
    "justification" "text",
    "total_amount" numeric,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'pending'::"text",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "approval_comment" "text",
    "processed_by" "uuid",
    "processed_at" timestamp with time zone,
    "metadata" "jsonb",
    "rejected_by" "uuid",
    "rejected_at" timestamp with time zone,
    "rejection_reason" "text",
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."payment_flows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payroll_records" (
    "id" bigint NOT NULL,
    "Employee ID" "text",
    "Employee Name" "text",
    "Department" "text",
    "Position" "text",
    "Basic Salary" "text",
    "House Allowance" "text",
    "Transport Allowance" "text",
    "Medical Allowance" "text",
    "PAYE Tax" "text",
    "Net Pay" "text",
    "NHIF" "text",
    "NSSF" "text",
    "Total Deductions" "text",
    "Housing Levy" "text",
    "Overtime Hours" "text",
    "Pay Period" "text",
    "Overtime Pay" "text",
    "Gross Pay" "text",
    "employee_id" "text",
    "pay_period" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."payroll_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payroll_records_current" (
    "id" bigint NOT NULL,
    "Employee ID" "text",
    "Employee Name" "text",
    "Department" "text",
    "Position" "text",
    "Basic Salary" "text",
    "House Allowance" "text",
    "Transport Allowance" "text",
    "Branch" "text",
    "Job Group" "text",
    "Pay Period" "text",
    "employee_id" "text",
    "pay_period" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."payroll_records_current" OWNER TO "postgres";


ALTER TABLE "public"."payroll_records_current" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."payroll_records_current_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."payroll_records" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."payroll_records_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."performance_targets" (
    "id" bigint NOT NULL,
    "target_for" "text",
    "target_type" "text",
    "employee_id" "text",
    "branch_id" bigint,
    "product_type" "text",
    "period" "text",
    "target_value" numeric,
    "start_date" "date",
    "end_date" "date",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    CONSTRAINT "performance_targets_target_for_check" CHECK (("target_for" = ANY (ARRAY['employee'::"text", 'branch'::"text", 'product'::"text"])))
);


ALTER TABLE "public"."performance_targets" OWNER TO "postgres";


ALTER TABLE "public"."performance_targets" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."performance_targets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "module_id" character varying(100) NOT NULL,
    "module_name" character varying(200) NOT NULL,
    "description" "text",
    "category" character varying(50) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


COMMENT ON TABLE "public"."permissions" IS 'Stores all available system permissions/modules';



CREATE TABLE IF NOT EXISTS "public"."phone_number_change_requests" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "employee_number" "text" NOT NULL,
    "current_phone" "text",
    "requested_phone" "text" NOT NULL,
    "reason" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"(),
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "text",
    "admin_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL,
    CONSTRAINT "phone_number_change_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."phone_number_change_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text",
    "full_name" "text",
    "avatar_url" "text",
    "email" "text",
    "role" "text" DEFAULT 'STAFF'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regional_managers" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "employee_number" "text",
    "full_name" "text",
    "email" "text",
    "region" "text",
    "branch" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."regional_managers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "role_name" "text",
    "permissions" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


COMMENT ON TABLE "public"."role_permissions" IS 'Maps roles to their granted permissions';



CREATE TABLE IF NOT EXISTS "public"."salary_advance" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "Employee Number" "text",
    "Full Name" "text",
    "Office Branch" "text",
    "Basic Salary" "text",
    "Amount Requested" numeric,
    "Net Salary" "text",
    "Reason for Advance" "text",
    "Region" "text",
    "Town" "text",
    "status" "text" DEFAULT 'Pending'::"text",
    "time_added" timestamp with time zone DEFAULT "now"(),
    "last_updated" timestamp with time zone DEFAULT "now"(),
    "admin_notes" "text",
    "admin_approval" "text",
    "admin_approval_date" timestamp with time zone,
    "admin_adjusted_amount" numeric,
    "admin_rejection_date" timestamp with time zone,
    "approved_by" "text",
    "approved_by_email" "text",
    "rejected_by" "text",
    "rejected_by_email" "text",
    "branch_manager_recommendation" "text",
    "branch_manager_notes" "text",
    "branch_manager_approval" boolean DEFAULT false,
    "branch_manager_approval_date" timestamp with time zone,
    "branch_manager_adjusted_amount" numeric,
    "regional_manager_recommendation" "text",
    "regional_manager_notes" "text",
    "regional_manager_comment" "text",
    "regional_manager_comment_date" timestamp with time zone,
    "regional_manager_approval" boolean DEFAULT false,
    "regional_manager_approval_date" timestamp with time zone,
    "regional_manager_adjusted_amount" numeric,
    "payment_processed" "text" DEFAULT 'false'::"text",
    "payment_date" timestamp with time zone,
    "mpesa_transaction_id" "text",
    "mpesa_result_desc" "text",
    "mpesa_conversation_id" "text",
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."salary_advance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salary_advance_payment_flows" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "type" "text" DEFAULT 'bulk'::"text",
    "advances_data" "jsonb" DEFAULT '[]'::"jsonb",
    "justification" "text",
    "total_amount" numeric,
    "created_by" "uuid",
    "created_by_email" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "approved_by_email" "text",
    "processed_at" timestamp with time zone,
    "metadata" "jsonb",
    "rejected_by" "uuid",
    "rejected_at" timestamp with time zone,
    "rejection_reason" "text",
    "rejected_by_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."salary_advance_payment_flows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salary_advance_settings" (
    "id" integer DEFAULT 1 NOT NULL,
    "applications_active" boolean DEFAULT true,
    "closed_until" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "closed_by" "text",
    "reopened_at" timestamp with time zone,
    "schedule_type" "text" DEFAULT 'manual'::"text",
    "scheduled_close" timestamp with time zone,
    "scheduled_open" timestamp with time zone,
    "custom_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."salary_advance_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salary_history" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "employee_id" "text",
    "employee_name" "text",
    "pay_period" "text",
    "basic_salary" numeric,
    "gross_pay" numeric,
    "net_pay" numeric,
    "total_deductions" numeric,
    "nssf_deduction" numeric,
    "nhif_deduction" numeric,
    "paye_tax" numeric,
    "housing_levy" numeric,
    "house_allowance" numeric,
    "transport_allowance" numeric,
    "medical_allowance" numeric,
    "other_allowances" numeric,
    "overtime_hours" numeric,
    "overtime_rate" numeric,
    "commission" numeric,
    "bonus" numeric,
    "per_diem" numeric,
    "tax_relief" numeric,
    "loan_deduction" numeric,
    "advance_deduction" numeric,
    "welfare_deduction" numeric,
    "other_deductions" numeric,
    "payment_method" "text",
    "bank_name" "text",
    "account_number" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."salary_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sender_id_configs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "text",
    "sender_id_type" "text" DEFAULT 'default'::"text",
    "custom_sender_id" "text",
    "business_certificate_url" "text",
    "consent_letter_url" "text",
    "provider" "text" DEFAULT 'safaricom'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."sender_id_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sms_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "message" "text",
    "recipient_phone" "text",
    "status" "text" DEFAULT 'sent'::"text",
    "error_message" "text",
    "message_id" "text",
    "sender_id" "text",
    "sms_type" "text",
    "cost" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."sms_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sms_templates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text",
    "category" "text",
    "content" "text",
    "variables" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."sms_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_loans" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "employee_number" "text",
    "loan_type" "text",
    "application_date" "date",
    "application_time" "text",
    "loan_amount" numeric,
    "approved_amount" numeric,
    "interest_rate" numeric,
    "repayment_period" integer,
    "purpose" "text",
    "status" "text" DEFAULT 'Pending'::"text",
    "approved_by" "text",
    "approval_date" "date",
    "approval_time" "text",
    "disbursement_date" "date",
    "disbursement_time" "text",
    "disbursement_method" "text",
    "bank_account" "text",
    "bank_name" "text",
    "cheque_number" "text",
    "mpesa_code" "text",
    "monthly_deduction" numeric,
    "total_repayable" numeric,
    "amount_deducted" numeric DEFAULT 0,
    "amount_remaining" numeric,
    "last_deduction_date" "date",
    "next_deduction_date" "date",
    "deduction_status" "text" DEFAULT 'Active'::"text",
    "security_details" "text",
    "guarantor1_name" "text",
    "guarantor1_employee_number" "text",
    "guarantor2_name" "text",
    "guarantor2_employee_number" "text",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."staff_loans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_signup_requests" (
    "id" bigint NOT NULL,
    "email" "text",
    "branch" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."staff_signup_requests" OWNER TO "postgres";


ALTER TABLE "public"."staff_signup_requests" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."staff_signup_requests_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."statutory_deductions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "employee_number" "text",
    "deduction_type" "text",
    "deduction_period" "text",
    "nssf_number" "text",
    "nssf_tier" "text",
    "nssf_employee_contribution" numeric,
    "nssf_employer_contribution" numeric,
    "nssf_total_contribution" numeric,
    "nhif_number" "text",
    "nhif_amount" numeric,
    "nhif_dependents" integer,
    "nhif_tier" "text",
    "paye_amount" numeric,
    "personal_relief" numeric,
    "insurance_relief" numeric,
    "taxable_income" numeric,
    "tax_band" "text",
    "ahl_employee_contribution" numeric,
    "ahl_employer_contribution" numeric,
    "ahl_total_contribution" numeric,
    "ahl_number" "text",
    "nita_amount" numeric,
    "nita_training_levy" numeric,
    "nita_number" "text",
    "total_statutory_deductions" numeric,
    "status" "text" DEFAULT 'Pending'::"text",
    "processed_date" "date",
    "submitted_date" "date",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."statutory_deductions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."statutory_settings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "settings" "jsonb",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."statutory_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "id" integer DEFAULT 1 NOT NULL,
    "gmail_access_token" "text",
    "gmail_refresh_token" "text",
    "gmail_token_expiry" timestamp with time zone,
    "mfa_enabled" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "plan" "text" DEFAULT 'trial'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "max_employees" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tenants_slug_check" CHECK (("slug" ~ '^[a-z0-9-]{3,40}$'::"text")),
    CONSTRAINT "tenants_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."termination_requests" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "Employee Number" "text",
    "employee_id" "text",
    "employee_name" "text",
    "employee_email" "text",
    "employee_position" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "termination_date" "date",
    "termination_reason" "text",
    "exit_interview" "text",
    "requested_by" "uuid",
    "approved_by" "uuid",
    "rejected_by" "uuid",
    "reversed_by" "uuid",
    "approved_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "reversed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."termination_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."todos" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "title" "text",
    "description" "text",
    "completed" boolean DEFAULT false,
    "priority" "text" DEFAULT 'medium'::"text",
    "due_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "assigned_to" "text",
    "assigne" "uuid",
    "branch" "text",
    "department" "text",
    "county" "text",
    "status" "text" DEFAULT 'not-started'::"text",
    "important" boolean DEFAULT false,
    "category" "text",
    "repeat" "text" DEFAULT 'none'::"text",
    "repeat_pattern" "text",
    "completed_comment" "text",
    "completed_at" timestamp with time zone,
    "requires_approval" boolean DEFAULT false,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "tags" "text",
    "progress" "text",
    "time_estimate" "text",
    "actual_time_spent" integer,
    "timer_started_at" timestamp with time zone,
    "timer_running" boolean DEFAULT false,
    "is_private" boolean DEFAULT false,
    "loan_amount" numeric,
    "loan_stage" "text",
    "loan_reference" "text",
    "client_name" "text",
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."todos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_documents" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" "text",
    "description" "text",
    "url" "text",
    "file_name" "text",
    "file_size" bigint,
    "file_type" "text",
    "required" boolean DEFAULT false,
    "order" integer DEFAULT 0,
    "category" "text",
    "quiz_required" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."training_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_progress" (
    "id" bigint NOT NULL,
    "document_id" "text",
    "employee_number" "text",
    "completed" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "time_spent" integer DEFAULT 0,
    "last_accessed" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "quiz_passed" boolean,
    "quiz_score" integer,
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."training_progress" OWNER TO "postgres";


ALTER TABLE "public"."training_progress" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."training_progress_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."training_videos" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" "text",
    "description" "text",
    "url" "text",
    "duration" bigint,
    "required" boolean DEFAULT false,
    "order" smallint DEFAULT 0,
    "category" "text",
    "thumbnail_url" "text",
    "quiz_required" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."training_videos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_channel_states" (
    "user_id" "uuid" NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."user_channel_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "user_id" "uuid" NOT NULL,
    "theme" "jsonb",
    "avatar_url" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "user_id" "uuid" NOT NULL,
    "full_name" "text",
    "email" "text",
    "role" "text" DEFAULT 'STAFF'::"text",
    "department" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "account_status" "text" DEFAULT 'ACTIVE'::"text",
    "tenant_id" "uuid" NOT NULL
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."users" WITH ("security_invoker"='true') AS
 SELECT "user_id" AS "id",
    "email",
    "full_name",
    "role",
    "department",
    "account_status",
    "created_at"
   FROM "public"."user_profiles";


ALTER VIEW "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."warnings" (
    "id" bigint NOT NULL,
    "employee_id" "text",
    "type" "text",
    "severity" "text",
    "message" "text",
    "issued_at" "date" DEFAULT CURRENT_DATE,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" DEFAULT "public"."current_tenant_id"() NOT NULL
);


ALTER TABLE "public"."warnings" OWNER TO "postgres";


ALTER TABLE "public"."warnings" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."warnings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."hr_contract_settings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."hr_contract_settings_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."hr_employment_status" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."hr_employment_status_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."hr_leave_schedules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."hr_leave_schedules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."hr_lifecycle_history" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."hr_lifecycle_history_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."hr_notifications" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."hr_notifications_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."hr_salary_advances" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."hr_salary_advances_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."hr_suspensions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."hr_suspensions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."hr_termination_interviews" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."hr_termination_interviews_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."hr_terminations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."hr_terminations_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_logs"
    ADD CONSTRAINT "attendance_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branch_performance"
    ADD CONSTRAINT "branch_performance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channel_members"
    ADD CONSTRAINT "channel_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_visits"
    ADD CONSTRAINT "client_visits_pkey" PRIMARY KEY ("visit_id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("client_id");



ALTER TABLE ONLY "public"."company_events"
    ADD CONSTRAINT "company_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_logo"
    ADD CONSTRAINT "company_logo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dependents"
    ADD CONSTRAINT "dependents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_logs"
    ADD CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."emergency_contact"
    ADD CONSTRAINT "emergency_contact_Employee Number_key" UNIQUE ("tenant_id", "Employee Number");



ALTER TABLE ONLY "public"."emergency_contact"
    ADD CONSTRAINT "emergency_contact_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_performance"
    ADD CONSTRAINT "employee_performance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_Work Email_key" UNIQUE ("tenant_id", "Work Email");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_id_key" UNIQUE ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("tenant_id", "Employee Number");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hr_contract_settings"
    ADD CONSTRAINT "hr_contract_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hr_employment_status"
    ADD CONSTRAINT "hr_employment_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hr_leave_schedules"
    ADD CONSTRAINT "hr_leave_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hr_lifecycle_history"
    ADD CONSTRAINT "hr_lifecycle_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hr_notifications"
    ADD CONSTRAINT "hr_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hr_salary_advances"
    ADD CONSTRAINT "hr_salary_advances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hr_suspensions"
    ADD CONSTRAINT "hr_suspensions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hr_termination_interviews"
    ADD CONSTRAINT "hr_termination_interviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hr_terminations"
    ADD CONSTRAINT "hr_terminations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incident_reports"
    ADD CONSTRAINT "incident_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_positions"
    ADD CONSTRAINT "job_positions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_postings"
    ADD CONSTRAINT "job_postings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kenya_branches_duplicate"
    ADD CONSTRAINT "kenya_branches_duplicate_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kenya_branches"
    ADD CONSTRAINT "kenya_branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kenya_office_locations"
    ADD CONSTRAINT "kenya_office_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_application"
    ADD CONSTRAINT "leave_application_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_balance_adjustments"
    ADD CONSTRAINT "leave_balance_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_unique_bucket" UNIQUE ("employee_number", "leave_type_id", "year", "month");



ALTER TABLE ONLY "public"."leave_entitlements"
    ADD CONSTRAINT "leave_entitlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_entitlements"
    ADD CONSTRAINT "leave_entitlements_tenant_id_employee_number_leave_type_id_key" UNIQUE ("tenant_id", "employee_number", "leave_type_id");



ALTER TABLE ONLY "public"."leave_policies"
    ADD CONSTRAINT "leave_policies_leave_type_id_effective_from_key" UNIQUE ("leave_type_id", "effective_from");



ALTER TABLE ONLY "public"."leave_policies"
    ADD CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_types"
    ADD CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loan_payments"
    ADD CONSTRAINT "loan_payments_pkey" PRIMARY KEY ("payment_id");



ALTER TABLE ONLY "public"."loan_requests"
    ADD CONSTRAINT "loan_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loans"
    ADD CONSTRAINT "loans_pkey" PRIMARY KEY ("loan_id");



ALTER TABLE ONLY "public"."meeting_transcripts"
    ADD CONSTRAINT "meeting_transcripts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_pkey" PRIMARY KEY ("user_id", "tenant_id");



ALTER TABLE ONLY "public"."message_reactions"
    ADD CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mfa_codes"
    ADD CONSTRAINT "mfa_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mfa_numbers"
    ADD CONSTRAINT "mfa_numbers_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."mfa_numbers"
    ADD CONSTRAINT "mfa_numbers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpesa_callbacks"
    ADD CONSTRAINT "mpesa_callbacks_originator_conversation_id_key" UNIQUE ("originator_conversation_id");



ALTER TABLE ONLY "public"."mpesa_callbacks"
    ADD CONSTRAINT "mpesa_callbacks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mpesa_transactions"
    ADD CONSTRAINT "mpesa_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_flows"
    ADD CONSTRAINT "payment_flows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_records_current"
    ADD CONSTRAINT "payroll_records_current_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_records"
    ADD CONSTRAINT "payroll_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."performance_targets"
    ADD CONSTRAINT "performance_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_module_id_key" UNIQUE ("module_id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phone_number_change_requests"
    ADD CONSTRAINT "phone_number_change_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regional_managers"
    ADD CONSTRAINT "regional_managers_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."regional_managers"
    ADD CONSTRAINT "regional_managers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_name_key" UNIQUE ("tenant_id", "role_name");



ALTER TABLE ONLY "public"."salary_advance_payment_flows"
    ADD CONSTRAINT "salary_advance_payment_flows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salary_advance"
    ADD CONSTRAINT "salary_advance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salary_advance_settings"
    ADD CONSTRAINT "salary_advance_settings_pkey" PRIMARY KEY ("tenant_id", "id");



ALTER TABLE ONLY "public"."salary_history"
    ADD CONSTRAINT "salary_history_employee_id_pay_period_key" UNIQUE ("tenant_id", "employee_id", "pay_period");



ALTER TABLE ONLY "public"."salary_history"
    ADD CONSTRAINT "salary_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sender_id_configs"
    ADD CONSTRAINT "sender_id_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sms_logs"
    ADD CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sms_templates"
    ADD CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_loans"
    ADD CONSTRAINT "staff_loans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_signup_requests"
    ADD CONSTRAINT "staff_signup_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."statutory_deductions"
    ADD CONSTRAINT "statutory_deductions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."statutory_settings"
    ADD CONSTRAINT "statutory_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("tenant_id", "id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."termination_requests"
    ADD CONSTRAINT "termination_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_documents"
    ADD CONSTRAINT "training_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_progress"
    ADD CONSTRAINT "training_progress_document_id_employee_number_key" UNIQUE ("document_id", "employee_number");



ALTER TABLE ONLY "public"."training_progress"
    ADD CONSTRAINT "training_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_videos"
    ADD CONSTRAINT "training_videos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_channel_states"
    ADD CONSTRAINT "user_channel_states_pkey" PRIMARY KEY ("user_id", "channel_id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."warnings"
    ADD CONSTRAINT "warnings_pkey" PRIMARY KEY ("id");



CREATE INDEX "assets_tenant_id_idx" ON "public"."assets" USING "btree" ("tenant_id");



CREATE INDEX "attendance_logs_tenant_id_idx" ON "public"."attendance_logs" USING "btree" ("tenant_id");



CREATE INDEX "audit_log_tenant_id_idx" ON "public"."audit_log" USING "btree" ("tenant_id");



CREATE INDEX "branch_performance_tenant_id_idx" ON "public"."branch_performance" USING "btree" ("tenant_id");



CREATE INDEX "channel_members_tenant_id_idx" ON "public"."channel_members" USING "btree" ("tenant_id");



CREATE INDEX "channels_tenant_id_idx" ON "public"."channels" USING "btree" ("tenant_id");



CREATE INDEX "client_visits_tenant_id_idx" ON "public"."client_visits" USING "btree" ("tenant_id");



CREATE INDEX "clients_tenant_id_idx" ON "public"."clients" USING "btree" ("tenant_id");



CREATE INDEX "company_events_date_idx" ON "public"."company_events" USING "btree" ("date");



CREATE INDEX "company_events_tenant_id_idx" ON "public"."company_events" USING "btree" ("tenant_id");



CREATE INDEX "company_logo_tenant_id_idx" ON "public"."company_logo" USING "btree" ("tenant_id");



CREATE INDEX "dependents_tenant_id_idx" ON "public"."dependents" USING "btree" ("tenant_id");



CREATE INDEX "email_logs_tenant_id_idx" ON "public"."email_logs" USING "btree" ("tenant_id");



CREATE INDEX "emergency_contact_tenant_id_idx" ON "public"."emergency_contact" USING "btree" ("tenant_id");



CREATE INDEX "employee_performance_tenant_id_idx" ON "public"."employee_performance" USING "btree" ("tenant_id");



CREATE INDEX "employees_tenant_id_idx" ON "public"."employees" USING "btree" ("tenant_id");



CREATE INDEX "expenses_tenant_id_idx" ON "public"."expenses" USING "btree" ("tenant_id");



CREATE INDEX "holidays_tenant_id_idx" ON "public"."holidays" USING "btree" ("tenant_id");



CREATE INDEX "hr_contract_settings_tenant_id_idx" ON "public"."hr_contract_settings" USING "btree" ("tenant_id");



CREATE INDEX "hr_employment_status_tenant_id_idx" ON "public"."hr_employment_status" USING "btree" ("tenant_id");



CREATE INDEX "hr_leave_schedules_tenant_id_idx" ON "public"."hr_leave_schedules" USING "btree" ("tenant_id");



CREATE INDEX "hr_lifecycle_history_tenant_id_idx" ON "public"."hr_lifecycle_history" USING "btree" ("tenant_id");



CREATE INDEX "hr_notifications_created_at_idx" ON "public"."hr_notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "hr_notifications_employee_number_idx" ON "public"."hr_notifications" USING "btree" ("employee_number");



CREATE INDEX "hr_notifications_tenant_id_idx" ON "public"."hr_notifications" USING "btree" ("tenant_id");



CREATE INDEX "hr_notifications_type_idx" ON "public"."hr_notifications" USING "btree" ("notification_type");



CREATE INDEX "hr_salary_advances_tenant_id_idx" ON "public"."hr_salary_advances" USING "btree" ("tenant_id");



CREATE INDEX "hr_suspensions_tenant_id_idx" ON "public"."hr_suspensions" USING "btree" ("tenant_id");



CREATE INDEX "hr_termination_interviews_tenant_id_idx" ON "public"."hr_termination_interviews" USING "btree" ("tenant_id");



CREATE INDEX "hr_terminations_tenant_id_idx" ON "public"."hr_terminations" USING "btree" ("tenant_id");



CREATE INDEX "idx_permissions_category" ON "public"."permissions" USING "btree" ("category");



CREATE INDEX "idx_permissions_module_id" ON "public"."permissions" USING "btree" ("module_id");



CREATE INDEX "idx_role_permissions_role_name" ON "public"."role_permissions" USING "btree" ("role_name");



CREATE INDEX "incident_reports_tenant_id_idx" ON "public"."incident_reports" USING "btree" ("tenant_id");



CREATE INDEX "invitations_email_idx" ON "public"."invitations" USING "btree" ("lower"("email"));



CREATE INDEX "invitations_tenant_id_idx" ON "public"."invitations" USING "btree" ("tenant_id");



CREATE INDEX "job_applications_tenant_id_idx" ON "public"."job_applications" USING "btree" ("tenant_id");



CREATE INDEX "job_positions_tenant_id_idx" ON "public"."job_positions" USING "btree" ("tenant_id");



CREATE INDEX "job_postings_tenant_id_idx" ON "public"."job_postings" USING "btree" ("tenant_id");



CREATE INDEX "kenya_branches_tenant_id_idx" ON "public"."kenya_branches" USING "btree" ("tenant_id");



CREATE INDEX "kenya_office_locations_tenant_id_idx" ON "public"."kenya_office_locations" USING "btree" ("tenant_id");



CREATE INDEX "leave_application_tenant_id_idx" ON "public"."leave_application" USING "btree" ("tenant_id");



CREATE INDEX "leave_balance_adjustments_balance_idx" ON "public"."leave_balance_adjustments" USING "btree" ("leave_balance_id");



CREATE INDEX "leave_balance_adjustments_tenant_id_idx" ON "public"."leave_balance_adjustments" USING "btree" ("tenant_id");



CREATE INDEX "leave_balances_employee_idx" ON "public"."leave_balances" USING "btree" ("employee_number");



CREATE INDEX "leave_balances_leave_type_idx" ON "public"."leave_balances" USING "btree" ("leave_type_id");



CREATE INDEX "leave_balances_tenant_id_idx" ON "public"."leave_balances" USING "btree" ("tenant_id");



CREATE INDEX "leave_balances_year_idx" ON "public"."leave_balances" USING "btree" ("year");



CREATE INDEX "leave_balances_year_month_idx" ON "public"."leave_balances" USING "btree" ("year", "month");



CREATE INDEX "leave_policies_leave_type_idx" ON "public"."leave_policies" USING "btree" ("leave_type_id");



CREATE INDEX "leave_policies_tenant_id_idx" ON "public"."leave_policies" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "leave_types_name_no_tenant_idx" ON "public"."leave_types" USING "btree" ("name") WHERE ("tenant_id" IS NULL);



CREATE INDEX "leave_types_tenant_id_idx" ON "public"."leave_types" USING "btree" ("tenant_id");



CREATE INDEX "leave_types_tenant_idx" ON "public"."leave_types" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "leave_types_tenant_name_idx" ON "public"."leave_types" USING "btree" ("tenant_id", "name") WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "loan_payments_tenant_id_idx" ON "public"."loan_payments" USING "btree" ("tenant_id");



CREATE INDEX "loan_requests_tenant_id_idx" ON "public"."loan_requests" USING "btree" ("tenant_id");



CREATE INDEX "loans_tenant_id_idx" ON "public"."loans" USING "btree" ("tenant_id");



CREATE INDEX "meeting_transcripts_tenant_id_idx" ON "public"."meeting_transcripts" USING "btree" ("tenant_id");



CREATE INDEX "memberships_tenant_id_idx" ON "public"."memberships" USING "btree" ("tenant_id");



CREATE INDEX "message_reactions_tenant_id_idx" ON "public"."message_reactions" USING "btree" ("tenant_id");



CREATE INDEX "messages_tenant_id_idx" ON "public"."messages" USING "btree" ("tenant_id");



CREATE INDEX "mfa_codes_tenant_id_idx" ON "public"."mfa_codes" USING "btree" ("tenant_id");



CREATE INDEX "mfa_numbers_tenant_id_idx" ON "public"."mfa_numbers" USING "btree" ("tenant_id");



CREATE INDEX "mpesa_callbacks_tenant_id_idx" ON "public"."mpesa_callbacks" USING "btree" ("tenant_id");



CREATE INDEX "mpesa_transactions_tenant_id_idx" ON "public"."mpesa_transactions" USING "btree" ("tenant_id");



CREATE INDEX "notifications_tenant_id_idx" ON "public"."notifications" USING "btree" ("tenant_id");



CREATE INDEX "payment_flows_tenant_id_idx" ON "public"."payment_flows" USING "btree" ("tenant_id");



CREATE INDEX "payroll_records_current_tenant_id_idx" ON "public"."payroll_records_current" USING "btree" ("tenant_id");



CREATE INDEX "payroll_records_tenant_id_idx" ON "public"."payroll_records" USING "btree" ("tenant_id");



CREATE INDEX "performance_targets_tenant_id_idx" ON "public"."performance_targets" USING "btree" ("tenant_id");



CREATE INDEX "phone_number_change_requests_tenant_id_idx" ON "public"."phone_number_change_requests" USING "btree" ("tenant_id");



CREATE INDEX "profiles_tenant_id_idx" ON "public"."profiles" USING "btree" ("tenant_id");



CREATE INDEX "regional_managers_tenant_id_idx" ON "public"."regional_managers" USING "btree" ("tenant_id");



CREATE INDEX "role_permissions_tenant_id_idx" ON "public"."role_permissions" USING "btree" ("tenant_id");



CREATE INDEX "salary_advance_payment_flows_tenant_id_idx" ON "public"."salary_advance_payment_flows" USING "btree" ("tenant_id");



CREATE INDEX "salary_advance_settings_tenant_id_idx" ON "public"."salary_advance_settings" USING "btree" ("tenant_id");



CREATE INDEX "salary_advance_tenant_id_idx" ON "public"."salary_advance" USING "btree" ("tenant_id");



CREATE INDEX "salary_history_tenant_id_idx" ON "public"."salary_history" USING "btree" ("tenant_id");



CREATE INDEX "sender_id_configs_tenant_id_idx" ON "public"."sender_id_configs" USING "btree" ("tenant_id");



CREATE INDEX "sms_logs_tenant_id_idx" ON "public"."sms_logs" USING "btree" ("tenant_id");



CREATE INDEX "sms_templates_tenant_id_idx" ON "public"."sms_templates" USING "btree" ("tenant_id");



CREATE INDEX "staff_loans_tenant_id_idx" ON "public"."staff_loans" USING "btree" ("tenant_id");



CREATE INDEX "staff_signup_requests_tenant_id_idx" ON "public"."staff_signup_requests" USING "btree" ("tenant_id");



CREATE INDEX "statutory_deductions_tenant_id_idx" ON "public"."statutory_deductions" USING "btree" ("tenant_id");



CREATE INDEX "statutory_settings_tenant_id_idx" ON "public"."statutory_settings" USING "btree" ("tenant_id");



CREATE INDEX "system_settings_tenant_id_idx" ON "public"."system_settings" USING "btree" ("tenant_id");



CREATE INDEX "termination_requests_tenant_id_idx" ON "public"."termination_requests" USING "btree" ("tenant_id");



CREATE INDEX "todos_tenant_id_idx" ON "public"."todos" USING "btree" ("tenant_id");



CREATE INDEX "training_documents_tenant_id_idx" ON "public"."training_documents" USING "btree" ("tenant_id");



CREATE INDEX "training_progress_tenant_id_idx" ON "public"."training_progress" USING "btree" ("tenant_id");



CREATE INDEX "training_videos_tenant_id_idx" ON "public"."training_videos" USING "btree" ("tenant_id");



CREATE INDEX "user_channel_states_tenant_id_idx" ON "public"."user_channel_states" USING "btree" ("tenant_id");



CREATE INDEX "user_profiles_tenant_id_idx" ON "public"."user_profiles" USING "btree" ("tenant_id");



CREATE INDEX "warnings_tenant_id_idx" ON "public"."warnings" USING "btree" ("tenant_id");



CREATE OR REPLACE TRIGGER "employees_guard_self_update" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."guard_employee_self_update"();



CREATE OR REPLACE TRIGGER "employees_propagate_employee_number" AFTER UPDATE OF "Employee Number" ON "public"."employees" FOR EACH ROW WHEN (("old"."Employee Number" IS DISTINCT FROM "new"."Employee Number")) EXECUTE FUNCTION "public"."propagate_employee_number"();



CREATE OR REPLACE TRIGGER "memberships_removed" AFTER DELETE ON "public"."memberships" FOR EACH ROW EXECUTE FUNCTION "public"."membership_removed"();



CREATE OR REPLACE TRIGGER "memberships_to_profile" AFTER INSERT OR UPDATE ON "public"."memberships" FOR EACH ROW EXECUTE FUNCTION "public"."membership_to_profile"();



CREATE OR REPLACE TRIGGER "user_profiles_to_membership" AFTER INSERT OR UPDATE OF "tenant_id", "role", "account_status" ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."profile_to_membership"();



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."attendance_logs"
    ADD CONSTRAINT "attendance_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."branch_performance"
    ADD CONSTRAINT "branch_performance_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."kenya_branches"("id");



ALTER TABLE ONLY "public"."branch_performance"
    ADD CONSTRAINT "branch_performance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."channel_members"
    ADD CONSTRAINT "channel_members_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channel_members"
    ADD CONSTRAINT "channel_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."client_visits"
    ADD CONSTRAINT "client_visits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."kenya_branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_visits"
    ADD CONSTRAINT "client_visits_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_visits"
    ADD CONSTRAINT "client_visits_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE SET NULL ("employee_id");



ALTER TABLE ONLY "public"."client_visits"
    ADD CONSTRAINT "client_visits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."kenya_branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_loan_officer_fkey" FOREIGN KEY ("tenant_id", "loan_officer") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE SET NULL ("loan_officer");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."company_events"
    ADD CONSTRAINT "company_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."company_logo"
    ADD CONSTRAINT "company_logo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."dependents"
    ADD CONSTRAINT "dependents_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dependents"
    ADD CONSTRAINT "dependents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."email_logs"
    ADD CONSTRAINT "email_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."emergency_contact"
    ADD CONSTRAINT "emergency_contact_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."emergency_contact"
    ADD CONSTRAINT "emergency_contact_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."employee_performance"
    ADD CONSTRAINT "employee_performance_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_performance"
    ADD CONSTRAINT "employee_performance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."hr_contract_settings"
    ADD CONSTRAINT "hr_contract_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."hr_employment_status"
    ADD CONSTRAINT "hr_employment_status_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hr_employment_status"
    ADD CONSTRAINT "hr_employment_status_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."hr_leave_schedules"
    ADD CONSTRAINT "hr_leave_schedules_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hr_leave_schedules"
    ADD CONSTRAINT "hr_leave_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."hr_lifecycle_history"
    ADD CONSTRAINT "hr_lifecycle_history_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hr_lifecycle_history"
    ADD CONSTRAINT "hr_lifecycle_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."hr_notifications"
    ADD CONSTRAINT "hr_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."hr_salary_advances"
    ADD CONSTRAINT "hr_salary_advances_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hr_salary_advances"
    ADD CONSTRAINT "hr_salary_advances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."hr_suspensions"
    ADD CONSTRAINT "hr_suspensions_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hr_suspensions"
    ADD CONSTRAINT "hr_suspensions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."hr_termination_interviews"
    ADD CONSTRAINT "hr_termination_interviews_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hr_termination_interviews"
    ADD CONSTRAINT "hr_termination_interviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."hr_terminations"
    ADD CONSTRAINT "hr_terminations_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hr_terminations"
    ADD CONSTRAINT "hr_terminations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."incident_reports"
    ADD CONSTRAINT "incident_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_job_posting_id_fkey" FOREIGN KEY ("job_posting_id") REFERENCES "public"."job_postings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."job_positions"
    ADD CONSTRAINT "job_positions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."job_postings"
    ADD CONSTRAINT "job_postings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."kenya_branches"
    ADD CONSTRAINT "kenya_branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."kenya_office_locations"
    ADD CONSTRAINT "kenya_office_locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."leave_application"
    ADD CONSTRAINT "leave_application_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."leave_application"
    ADD CONSTRAINT "leave_application_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."leave_balance_adjustments"
    ADD CONSTRAINT "leave_balance_adjustments_leave_balance_id_fkey" FOREIGN KEY ("leave_balance_id") REFERENCES "public"."leave_balances"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_balance_adjustments"
    ADD CONSTRAINT "leave_balance_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_employee_number_fkey" FOREIGN KEY ("tenant_id", "employee_number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."leave_entitlements"
    ADD CONSTRAINT "leave_entitlements_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_policies"
    ADD CONSTRAINT "leave_policies_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_policies"
    ADD CONSTRAINT "leave_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."leave_types"
    ADD CONSTRAINT "leave_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."loan_payments"
    ADD CONSTRAINT "loan_payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."kenya_branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."loan_payments"
    ADD CONSTRAINT "loan_payments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("loan_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loan_payments"
    ADD CONSTRAINT "loan_payments_received_by_fkey" FOREIGN KEY ("tenant_id", "received_by") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE SET NULL ("received_by");



ALTER TABLE ONLY "public"."loan_payments"
    ADD CONSTRAINT "loan_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."loan_requests"
    ADD CONSTRAINT "loan_requests_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loan_requests"
    ADD CONSTRAINT "loan_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."loans"
    ADD CONSTRAINT "loans_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."kenya_branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."loans"
    ADD CONSTRAINT "loans_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."loans"
    ADD CONSTRAINT "loans_loan_officer_fkey" FOREIGN KEY ("tenant_id", "loan_officer") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE SET NULL ("loan_officer");



ALTER TABLE ONLY "public"."loans"
    ADD CONSTRAINT "loans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."meeting_transcripts"
    ADD CONSTRAINT "meeting_transcripts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_reactions"
    ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_reactions"
    ADD CONSTRAINT "message_reactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."mfa_codes"
    ADD CONSTRAINT "mfa_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."mfa_numbers"
    ADD CONSTRAINT "mfa_numbers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."mpesa_callbacks"
    ADD CONSTRAINT "mpesa_callbacks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."mpesa_transactions"
    ADD CONSTRAINT "mpesa_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."payment_flows"
    ADD CONSTRAINT "payment_flows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."payroll_records_current"
    ADD CONSTRAINT "payroll_records_current_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."payroll_records"
    ADD CONSTRAINT "payroll_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."performance_targets"
    ADD CONSTRAINT "performance_targets_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."kenya_branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."performance_targets"
    ADD CONSTRAINT "performance_targets_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE SET NULL ("employee_id");



ALTER TABLE ONLY "public"."performance_targets"
    ADD CONSTRAINT "performance_targets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."phone_number_change_requests"
    ADD CONSTRAINT "phone_number_change_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."regional_managers"
    ADD CONSTRAINT "regional_managers_employee_number_fkey" FOREIGN KEY ("tenant_id", "employee_number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE SET NULL ("employee_number");



ALTER TABLE ONLY "public"."regional_managers"
    ADD CONSTRAINT "regional_managers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."salary_advance"
    ADD CONSTRAINT "salary_advance_Employee Number_fkey" FOREIGN KEY ("tenant_id", "Employee Number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salary_advance_payment_flows"
    ADD CONSTRAINT "salary_advance_payment_flows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."salary_advance_settings"
    ADD CONSTRAINT "salary_advance_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."salary_advance"
    ADD CONSTRAINT "salary_advance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."salary_history"
    ADD CONSTRAINT "salary_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."sender_id_configs"
    ADD CONSTRAINT "sender_id_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."sms_logs"
    ADD CONSTRAINT "sms_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."sms_templates"
    ADD CONSTRAINT "sms_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."staff_loans"
    ADD CONSTRAINT "staff_loans_employee_number_fkey" FOREIGN KEY ("tenant_id", "employee_number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_loans"
    ADD CONSTRAINT "staff_loans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."staff_signup_requests"
    ADD CONSTRAINT "staff_signup_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."statutory_deductions"
    ADD CONSTRAINT "statutory_deductions_employee_number_fkey" FOREIGN KEY ("tenant_id", "employee_number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."statutory_deductions"
    ADD CONSTRAINT "statutory_deductions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."statutory_settings"
    ADD CONSTRAINT "statutory_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."termination_requests"
    ADD CONSTRAINT "termination_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."training_documents"
    ADD CONSTRAINT "training_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."training_progress"
    ADD CONSTRAINT "training_progress_employee_number_fkey" FOREIGN KEY ("tenant_id", "employee_number") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_progress"
    ADD CONSTRAINT "training_progress_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."training_videos"
    ADD CONSTRAINT "training_videos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."user_channel_states"
    ADD CONSTRAINT "user_channel_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."warnings"
    ADD CONSTRAINT "warnings_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "public"."employees"("tenant_id", "Employee Number") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."warnings"
    ADD CONSTRAINT "warnings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



CREATE POLICY "Admins can modify role permissions" ON "public"."role_permissions" TO "authenticated" USING ((( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text")) WITH CHECK ((( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text"));



ALTER TABLE "public"."Employee_Records_Duplicate" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Signed-in users can view role permissions" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "add_reactions" ON "public"."message_reactions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."messages" "m"
  WHERE ("m"."id" = "message_reactions"."message_id")))));



ALTER TABLE "public"."assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branch_performance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."channel_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."channels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_visits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_logo" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "create_channels" ON "public"."channels" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = "auth"."uid"()) AND ("type" IS DISTINCT FROM 'dm'::"text") AND (NOT COALESCE("is_default", false)) AND (( SELECT "public"."current_user_role"() AS "current_user_role") = ANY (ARRAY['ADMIN'::"text", 'HR'::"text", 'MANAGER'::"text"]))));



CREATE POLICY "create_tasks" ON "public"."todos" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "delete_channels" ON "public"."channels" FOR DELETE TO "authenticated" USING ((("type" IS DISTINCT FROM 'dm'::"text") AND (NOT COALESCE("is_default", false)) AND (("created_by" = "auth"."uid"()) OR (( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text"))));



CREATE POLICY "delete_messages" ON "public"."messages" FOR DELETE TO "authenticated" USING ((("author_id" = "auth"."uid"()) OR ((( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text") AND (NOT "public"."is_dm_channel"("channel_id")))));



CREATE POLICY "delete_notifications" ON "public"."notifications" FOR DELETE TO "authenticated" USING ((("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) OR "public"."has_any_module"(VARIADIC ARRAY['settings'::"text", 'employees'::"text"])));



CREATE POLICY "delete_tasks" ON "public"."todos" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text")));



ALTER TABLE "public"."dependents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "edit_messages" ON "public"."messages" FOR UPDATE TO "authenticated" USING ((("author_id" = "auth"."uid"()) OR ((( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text") AND (NOT "public"."is_dm_channel"("channel_id"))))) WITH CHECK ((("author_id" = "auth"."uid"()) OR ((( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text") AND (NOT "public"."is_dm_channel"("channel_id")))));



ALTER TABLE "public"."email_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."emergency_contact" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_performance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."holidays" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hr_contract_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hr_employment_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hr_leave_schedules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hr_lifecycle_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hr_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hr_salary_advances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hr_suspensions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hr_termination_interviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hr_terminations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."incident_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_admin_read" ON "public"."invitations" FOR SELECT TO "authenticated" USING ((( SELECT "public"."current_user_role"() AS "current_user_role") = ANY (ARRAY['ADMIN'::"text", 'HR'::"text"])));



ALTER TABLE "public"."job_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_positions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_postings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kenya_branches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kenya_branches_duplicate" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kenya_office_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_application" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_balance_adjustments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_balances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_entitlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loan_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loan_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "manage_channels" ON "public"."channels" FOR UPDATE TO "authenticated" USING ((("type" IS DISTINCT FROM 'dm'::"text") AND (NOT COALESCE("is_default", false)) AND (("created_by" = "auth"."uid"()) OR (( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text")))) WITH CHECK ((("type" IS DISTINCT FROM 'dm'::"text") AND (NOT COALESCE("is_default", false)) AND (("created_by" = "auth"."uid"()) OR (( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text"))));



ALTER TABLE "public"."meeting_transcripts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."memberships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "memberships_own_read" ON "public"."memberships" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."message_reactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mfa_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mfa_numbers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "module_access" ON "public"."assets" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{asset}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{asset}'::"text"[]));



CREATE POLICY "module_access" ON "public"."attendance_logs" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text", 'hr-lifecycle'::"text", 'reports'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text", 'hr-lifecycle'::"text", 'reports'::"text"]));



CREATE POLICY "module_access" ON "public"."branch_performance" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{performance}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{performance}'::"text"[]));



CREATE POLICY "module_access" ON "public"."client_visits" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{performance}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{performance}'::"text"[]));



CREATE POLICY "module_access" ON "public"."clients" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{performance}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{performance}'::"text"[]));



CREATE POLICY "module_access" ON "public"."company_events" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{settings,employees,hr-lifecycle}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{settings,employees,hr-lifecycle}'::"text"[]));



CREATE POLICY "module_access" ON "public"."company_logo" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{settings}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{settings}'::"text"[]));



CREATE POLICY "module_access" ON "public"."dependents" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text"]));



CREATE POLICY "module_access" ON "public"."email_logs" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text", 'adminconfirm'::"text", 'email-portal'::"text", 'settings'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text", 'adminconfirm'::"text", 'email-portal'::"text", 'settings'::"text"]));



CREATE POLICY "module_access" ON "public"."emergency_contact" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text"]));



CREATE POLICY "module_access" ON "public"."employee_performance" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['performance'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['performance'::"text"]));



CREATE POLICY "module_access" ON "public"."expenses" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['expenses'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['expenses'::"text"]));



CREATE POLICY "module_access" ON "public"."holidays" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{leaves}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{leaves}'::"text"[]));



CREATE POLICY "module_access" ON "public"."hr_contract_settings" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."hr_employment_status" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."hr_leave_schedules" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."hr_lifecycle_history" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."hr_notifications" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['leaves'::"text", 'hr-lifecycle'::"text", 'employees'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['leaves'::"text", 'hr-lifecycle'::"text", 'employees'::"text"]));



CREATE POLICY "module_access" ON "public"."hr_salary_advances" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."hr_suspensions" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."hr_termination_interviews" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."hr_terminations" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."incident_reports" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['incident-reports'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['incident-reports'::"text"]));



CREATE POLICY "module_access" ON "public"."job_applications" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['recruitment'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['recruitment'::"text"]));



CREATE POLICY "module_access" ON "public"."job_positions" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['recruitment'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['recruitment'::"text"]));



CREATE POLICY "module_access" ON "public"."job_postings" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['recruitment'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['recruitment'::"text"]));



CREATE POLICY "module_access" ON "public"."kenya_branches" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{settings}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{settings}'::"text"[]));



CREATE POLICY "module_access" ON "public"."kenya_office_locations" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{recruitment}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{recruitment}'::"text"[]));



CREATE POLICY "module_access" ON "public"."leave_application" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['leaves'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['leaves'::"text"]));



CREATE POLICY "module_access" ON "public"."leave_balance_adjustments" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['leaves'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['leaves'::"text"]));



CREATE POLICY "module_access" ON "public"."leave_balances" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['leaves'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['leaves'::"text"]));



CREATE POLICY "module_access" ON "public"."leave_entitlements" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['leaves'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['leaves'::"text"]));



CREATE POLICY "module_access" ON "public"."leave_policies" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{leaves}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{leaves}'::"text"[]));



CREATE POLICY "module_access" ON "public"."leave_types" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{leaves}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{leaves}'::"text"[]));



CREATE POLICY "module_access" ON "public"."loan_payments" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{performance}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{performance}'::"text"[]));



CREATE POLICY "module_access" ON "public"."loan_requests" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['salaryadmin'::"text", 'settings'::"text", 'payroll'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['salaryadmin'::"text", 'settings'::"text", 'payroll'::"text"]));



CREATE POLICY "module_access" ON "public"."loans" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{performance}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{performance}'::"text"[]));



CREATE POLICY "module_access" ON "public"."meeting_transcripts" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['teams'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['teams'::"text"]));



CREATE POLICY "module_access" ON "public"."mfa_numbers" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['settings'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['settings'::"text"]));



CREATE POLICY "module_access" ON "public"."mpesa_callbacks" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['mpesa-zap'::"text", 'salaryadmin'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['mpesa-zap'::"text", 'salaryadmin'::"text"]));



CREATE POLICY "module_access" ON "public"."mpesa_transactions" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['mpesa-zap'::"text", 'reports'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['mpesa-zap'::"text", 'reports'::"text"]));



CREATE POLICY "module_access" ON "public"."payment_flows" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['payroll'::"text", 'mpesa-zap'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['payroll'::"text", 'mpesa-zap'::"text"]));



CREATE POLICY "module_access" ON "public"."payroll_records" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['payroll'::"text", 'hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['payroll'::"text", 'hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."payroll_records_current" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['payroll'::"text", 'hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['payroll'::"text", 'hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."performance_targets" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['performance'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['performance'::"text"]));



CREATE POLICY "module_access" ON "public"."phone_number_change_requests" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['phone-approvals'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['phone-approvals'::"text"]));



CREATE POLICY "module_access" ON "public"."regional_managers" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{assign-managers}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{assign-managers}'::"text"[]));



CREATE POLICY "module_access" ON "public"."salary_advance" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['salaryadmin'::"text", 'payroll'::"text", 'reports'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['salaryadmin'::"text", 'payroll'::"text", 'reports'::"text"]));



CREATE POLICY "module_access" ON "public"."salary_advance_payment_flows" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['salaryadmin'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['salaryadmin'::"text"]));



CREATE POLICY "module_access" ON "public"."salary_advance_settings" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{salaryadmin,settings}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{salaryadmin,settings}'::"text"[]));



CREATE POLICY "module_access" ON "public"."salary_history" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['payroll'::"text", 'hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['payroll'::"text", 'hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."sender_id_configs" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{sms}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{sms}'::"text"[]));



CREATE POLICY "module_access" ON "public"."sms_logs" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['sms'::"text", 'salaryadmin'::"text", 'employees'::"text", 'hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['sms'::"text", 'salaryadmin'::"text", 'employees'::"text", 'hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."sms_templates" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{sms}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{sms}'::"text"[]));



CREATE POLICY "module_access" ON "public"."staff_loans" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['reports'::"text", 'payroll'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['reports'::"text", 'payroll'::"text"]));



CREATE POLICY "module_access" ON "public"."staff_signup_requests" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['adminconfirm'::"text", 'employees'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['adminconfirm'::"text", 'employees'::"text"]));



CREATE POLICY "module_access" ON "public"."statutory_deductions" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['reports'::"text", 'payroll'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['reports'::"text", 'payroll'::"text"]));



CREATE POLICY "module_access" ON "public"."statutory_settings" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{payroll,reports}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{payroll,reports}'::"text"[]));



CREATE POLICY "module_access" ON "public"."system_settings" TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{settings,adminconfirm,email-portal}'::"text"[])) WITH CHECK ("public"."has_any_module"(VARIADIC '{settings,adminconfirm,email-portal}'::"text"[]));



CREATE POLICY "module_access" ON "public"."termination_requests" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text", 'hr-lifecycle'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text", 'hr-lifecycle'::"text"]));



CREATE POLICY "module_access" ON "public"."training_documents" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['training'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['training'::"text"]));



CREATE POLICY "module_access" ON "public"."training_progress" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['training'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['training'::"text"]));



CREATE POLICY "module_access" ON "public"."training_videos" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['training'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['training'::"text"]));



CREATE POLICY "module_access" ON "public"."warnings" TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['staffcheck'::"text"])) WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['staffcheck'::"text"]));



CREATE POLICY "module_delete" ON "public"."employees" FOR DELETE TO "authenticated" USING ("public"."has_module"('employees'::"text"));



CREATE POLICY "module_insert" ON "public"."employees" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text", 'payroll'::"text"]));



CREATE POLICY "module_read" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ("public"."has_any_module"(VARIADIC '{settings}'::"text"[]));



CREATE POLICY "module_read" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."has_any_module"(VARIADIC ARRAY['employees'::"text", 'settings'::"text"]));



CREATE POLICY "module_select" ON "public"."employees" FOR SELECT TO "authenticated" USING (( SELECT "public"."can_read_employees"() AS "can_read_employees"));



CREATE POLICY "module_update" ON "public"."employees" FOR UPDATE TO "authenticated" USING (( SELECT "public"."can_write_employees"() AS "can_write_employees")) WITH CHECK (( SELECT "public"."can_write_employees"() AS "can_write_employees"));



ALTER TABLE "public"."mpesa_callbacks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mpesa_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "open_postings" ON "public"."job_postings" FOR SELECT TO "authenticated" USING (("status" = 'open'::"text"));



CREATE POLICY "own_all" ON "public"."dependents" TO "authenticated" USING (("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number"))) WITH CHECK (("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_all" ON "public"."emergency_contact" TO "authenticated" USING (("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number"))) WITH CHECK (("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_all" ON "public"."training_progress" TO "authenticated" USING (("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number"))) WITH CHECK (("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_cancel" ON "public"."phone_number_change_requests" FOR DELETE TO "authenticated" USING ((("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) AND ("status" = 'pending'::"text")));



CREATE POLICY "own_codes" ON "public"."mfa_codes" TO "authenticated" USING (("email" = ( SELECT "public"."current_user_email"() AS "current_user_email"))) WITH CHECK (("email" = ( SELECT "public"."current_user_email"() AS "current_user_email")));



CREATE POLICY "own_insert" ON "public"."attendance_logs" FOR INSERT TO "authenticated" WITH CHECK (("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_insert" ON "public"."incident_reports" FOR INSERT TO "authenticated" WITH CHECK (((COALESCE("status", 'new'::"text") = 'new'::"text") AND ("reviewed_by" IS NULL) AND ("admin_notes" IS NULL) AND (("is_anonymous" AND ("employee_number" IS NULL)) OR ((NOT "is_anonymous") AND ("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number"))))));



CREATE POLICY "own_insert" ON "public"."job_applications" FOR INSERT TO "authenticated" WITH CHECK ((("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) AND (COALESCE("status", 'pending'::"text") = 'pending'::"text") AND ("reviewed_by" IS NULL) AND ("admin_notes" IS NULL)));



CREATE POLICY "own_insert" ON "public"."leave_application" FOR INSERT TO "authenticated" WITH CHECK ((("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) AND ("lower"(COALESCE("status", 'pending'::"text")) = 'pending'::"text") AND ("recstatus" IS NULL) AND ("recommendation_notes" IS NULL)));



CREATE POLICY "own_insert" ON "public"."loan_requests" FOR INSERT TO "authenticated" WITH CHECK ((("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) AND (COALESCE("status", 'Pending'::"text") = 'Pending'::"text")));



CREATE POLICY "own_insert" ON "public"."phone_number_change_requests" FOR INSERT TO "authenticated" WITH CHECK ((("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) AND (COALESCE("status", 'pending'::"text") = 'pending'::"text")));



CREATE POLICY "own_insert" ON "public"."salary_advance" FOR INSERT TO "authenticated" WITH CHECK ((("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) AND (COALESCE("status", 'Pending'::"text") = 'Pending'::"text") AND ("payment_processed" IS DISTINCT FROM 'true'::"text")));



CREATE POLICY "own_membership" ON "public"."channel_members" TO "authenticated" USING (((("user_id" = "auth"."uid"()) OR (( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text")) AND (NOT "public"."is_dm_channel"("channel_id")))) WITH CHECK (((NOT "public"."is_dm_channel"("channel_id")) AND ((( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text") OR (("user_id" = "auth"."uid"()) AND "public"."channel_open_to_me"("channel_id")))));



CREATE POLICY "own_membership_read" ON "public"."channel_members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "own_number" ON "public"."mfa_numbers" FOR SELECT TO "authenticated" USING (("email" = ( SELECT "public"."current_user_email"() AS "current_user_email")));



CREATE POLICY "own_preferences" ON "public"."user_preferences" TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "own_profile" ON "public"."profiles" TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "own_select" ON "public"."attendance_logs" FOR SELECT TO "authenticated" USING (("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_select" ON "public"."employees" FOR SELECT TO "authenticated" USING (("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_select" ON "public"."hr_notifications" FOR SELECT TO "authenticated" USING (("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_select" ON "public"."incident_reports" FOR SELECT TO "authenticated" USING ((("is_anonymous" = false) AND ("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number"))));



CREATE POLICY "own_select" ON "public"."job_applications" FOR SELECT TO "authenticated" USING (("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_select" ON "public"."leave_application" FOR SELECT TO "authenticated" USING (("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_select" ON "public"."loan_requests" FOR SELECT TO "authenticated" USING (("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_select" ON "public"."payroll_records" FOR SELECT TO "authenticated" USING (("Employee ID" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_select" ON "public"."payroll_records_current" FOR SELECT TO "authenticated" USING (("Employee ID" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_select" ON "public"."phone_number_change_requests" FOR SELECT TO "authenticated" USING (("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_select" ON "public"."salary_advance" FOR SELECT TO "authenticated" USING (("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_select" ON "public"."salary_history" FOR SELECT TO "authenticated" USING (("employee_id" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_select" ON "public"."warnings" FOR SELECT TO "authenticated" USING (("employee_id" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_state" ON "public"."user_channel_states" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "own_update" ON "public"."attendance_logs" FOR UPDATE TO "authenticated" USING (("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number"))) WITH CHECK (("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_update" ON "public"."employees" FOR UPDATE TO "authenticated" USING (("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number"))) WITH CHECK (("Employee Number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_update" ON "public"."hr_notifications" FOR UPDATE TO "authenticated" USING (("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number"))) WITH CHECK (("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")));



CREATE POLICY "own_withdraw" ON "public"."job_applications" FOR UPDATE TO "authenticated" USING ((("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) AND ("status" = 'pending'::"text"))) WITH CHECK ((("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) AND ("status" = 'withdrawn'::"text")));



ALTER TABLE "public"."payment_flows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payroll_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payroll_records_current" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."performance_targets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permissions_read" ON "public"."permissions" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."phone_number_change_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_all" ON "public"."company_events" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_all" ON "public"."company_logo" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_all" ON "public"."holidays" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_all" ON "public"."kenya_branches" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_all" ON "public"."leave_policies" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_all" ON "public"."leave_types" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_all" ON "public"."regional_managers" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_all" ON "public"."salary_advance_settings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_all" ON "public"."training_documents" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_all" ON "public"."training_videos" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_messages" ON "public"."messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."channels" "c"
  WHERE ("c"."id" = "messages"."channel_id"))));



CREATE POLICY "read_notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING ((("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) OR "public"."has_any_module"(VARIADIC ARRAY['settings'::"text", 'employees'::"text"])));



CREATE POLICY "read_reactions" ON "public"."message_reactions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."messages" "m"
  WHERE ("m"."id" = "message_reactions"."message_id"))));



CREATE POLICY "read_tasks" ON "public"."todos" FOR SELECT TO "authenticated" USING (((COALESCE("is_private", false) = false) OR ("user_id" = "auth"."uid"()) OR ("assigne" = "auth"."uid"()) OR ("assigned_to" = ("auth"."uid"())::"text")));



ALTER TABLE "public"."regional_managers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "remove_reactions" ON "public"."message_reactions" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."salary_advance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."salary_advance_payment_flows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."salary_advance_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."salary_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "send_messages" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK ((("author_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."channels" "c"
  WHERE ("c"."id" = "messages"."channel_id")))));



CREATE POLICY "send_notifications" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (true);



ALTER TABLE "public"."sender_id_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sms_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sms_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_loans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_signup_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."statutory_deductions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."statutory_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_isolation" ON "public"."assets" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."attendance_logs" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."audit_log" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."branch_performance" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."channel_members" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."channels" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."client_visits" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."clients" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."company_events" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."company_logo" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."dependents" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."email_logs" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."emergency_contact" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."employee_performance" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."employees" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."expenses" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."holidays" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."hr_contract_settings" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."hr_employment_status" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."hr_leave_schedules" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."hr_lifecycle_history" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."hr_notifications" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."hr_salary_advances" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."hr_suspensions" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."hr_termination_interviews" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."hr_terminations" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."incident_reports" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."invitations" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."job_applications" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."job_positions" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."job_postings" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."kenya_branches" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."kenya_office_locations" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."leave_application" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."leave_balance_adjustments" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."leave_balances" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."leave_entitlements" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."leave_policies" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."leave_types" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."loan_payments" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."loan_requests" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."loans" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."meeting_transcripts" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."message_reactions" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."messages" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."mfa_codes" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."mfa_numbers" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."mpesa_callbacks" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."mpesa_transactions" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."notifications" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."payment_flows" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."payroll_records" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."payroll_records_current" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."performance_targets" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."phone_number_change_requests" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."profiles" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."regional_managers" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."role_permissions" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."salary_advance" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."salary_advance_payment_flows" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."salary_advance_settings" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."salary_history" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."sender_id_configs" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."sms_logs" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."sms_templates" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."staff_loans" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."staff_signup_requests" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."statutory_deductions" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."statutory_settings" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."system_settings" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."termination_requests" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."todos" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."training_documents" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."training_progress" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."training_videos" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."user_channel_states" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_isolation" ON "public"."warnings" AS RESTRICTIVE USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id"))) WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "tenant_self_read" ON "public"."tenants" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."termination_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."todos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_videos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update_notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING ((("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) OR "public"."has_any_module"(VARIADIC ARRAY['settings'::"text", 'employees'::"text"]))) WITH CHECK ((("employee_number" = ( SELECT "public"."current_employee_number"() AS "current_employee_number")) OR "public"."has_any_module"(VARIADIC ARRAY['settings'::"text", 'employees'::"text"])));



CREATE POLICY "update_tasks" ON "public"."todos" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR ("assigne" = "auth"."uid"()) OR ("assigned_to" = ("auth"."uid"())::"text"))) WITH CHECK ((("user_id" = "auth"."uid"()) OR ("assigne" = "auth"."uid"()) OR ("assigned_to" = ("auth"."uid"())::"text")));



ALTER TABLE "public"."user_channel_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_profiles_tenant_read" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "visible_channels" ON "public"."channels" FOR SELECT TO "authenticated" USING (
CASE
    WHEN ("type" = 'dm'::"text") THEN (EXISTS ( SELECT 1
       FROM "public"."channel_members" "m"
      WHERE (("m"."channel_id" = "channels"."id") AND ("m"."user_id" = "auth"."uid"()))))
    ELSE ((COALESCE("is_private", false) = false) OR ("created_by" = "auth"."uid"()) OR ("job_title" = ( SELECT "public"."current_job_title"() AS "current_job_title")) OR (( SELECT "public"."current_user_role"() AS "current_user_role") = 'ADMIN'::"text") OR (EXISTS ( SELECT 1
       FROM "public"."channel_members" "m"
      WHERE (("m"."channel_id" = "channels"."id") AND ("m"."user_id" = "auth"."uid"())))))
END);



ALTER TABLE "public"."warnings" ENABLE ROW LEVEL SECURITY;


-- pg_dump writes the grants below as if a new table or function starts with none. On Supabase a new one starts with
-- everything for anon and authenticated (default privileges), so without this a fresh project would let any signed-in
-- user write tables the live project only lets them read (user_profiles, tenants, memberships...). Take that away
-- first; the grants below then set exactly what the live project has.
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "anon", "authenticated";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "anon", "authenticated";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM "anon", "authenticated";

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_invitation"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_invitation"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_invitation"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_my_invitation"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_my_invitation"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_my_invitation"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_channel_members"("p_channel" "uuid", "p_users" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_channel_members"("p_channel" "uuid", "p_users" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_channel_members"("p_channel" "uuid", "p_users" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_read_employees"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_read_employees"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_employees"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_write_employees"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_write_employees"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_write_employees"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."channel_open_to_me"("p_channel" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."channel_open_to_me"("p_channel" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."channel_open_to_me"("p_channel" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_deleted_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_deleted_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_deleted_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."company_members"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."company_members"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."company_members"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_company"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_company"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_company"("p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_invitation"("p_email" "text", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_invitation"("p_email" "text", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_invitation"("p_email" "text", "p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_employee_number"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_employee_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_employee_number"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_job_title"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_job_title"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_job_title"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_tenant_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "service_role";
GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "anon";



REVOKE ALL ON FUNCTION "public"."current_user_email"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_email"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_permissions"("user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_employee_self_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_employee_self_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_employee_self_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_any_module"(VARIADIC "p_modules" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_any_module"(VARIADIC "p_modules" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_any_module"(VARIADIC "p_modules" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_module"("p_module" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_module"("p_module" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_module"("p_module" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_permission"("user_id" "uuid", "required_permission" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_permission"("user_id" "uuid", "required_permission" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permission"("user_id" "uuid", "required_permission" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."hash_invite_token"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hash_invite_token"("p_token" "text") TO "service_role";



GRANT ALL ON TABLE "public"."leave_balances" TO "anon";
GRANT ALL ON TABLE "public"."leave_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_balances" TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_leave_balance_used_days"("p_employee_number" "text", "p_leave_type_id" "uuid", "p_year" integer, "p_days" numeric, "p_month" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_leave_balance_used_days"("p_employee_number" "text", "p_leave_type_id" "uuid", "p_year" integer, "p_days" numeric, "p_month" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_leave_balance_used_days"("p_employee_number" "text", "p_leave_type_id" "uuid", "p_year" integer, "p_days" numeric, "p_month" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."invitation_preview"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."invitation_preview"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."invitation_preview"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."invitation_preview"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_dm_channel"("p_channel" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_dm_channel"("p_channel" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_dm_channel"("p_channel" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."leave_earned_to_date"("p_yearly" numeric, "p_month" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."leave_earned_to_date"("p_yearly" numeric, "p_month" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."leave_earned_to_date"("p_yearly" numeric, "p_month" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."leave_entitlement"("p_tenant" "uuid", "p_employee" "text", "p_type" "uuid", "p_policy_days" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."leave_entitlement"("p_tenant" "uuid", "p_employee" "text", "p_type" "uuid", "p_policy_days" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."leave_entitlement"("p_tenant" "uuid", "p_employee" "text", "p_type" "uuid", "p_policy_days" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."membership_removed"() TO "anon";
GRANT ALL ON FUNCTION "public"."membership_removed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."membership_removed"() TO "service_role";



GRANT ALL ON FUNCTION "public"."membership_to_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."membership_to_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."membership_to_profile"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mfa_required"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mfa_required"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mfa_required"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_companies"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_companies"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_companies"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_direct_messages"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_direct_messages"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_direct_messages"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_pending_invitations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_pending_invitations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_pending_invitations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."profile_to_membership"() TO "anon";
GRANT ALL ON FUNCTION "public"."profile_to_membership"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."profile_to_membership"() TO "service_role";



GRANT ALL ON FUNCTION "public"."propagate_employee_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."propagate_employee_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."propagate_employee_number"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_invitation"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_invitation"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_invitation"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."run_annual_leave_reset"("p_year" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."run_annual_leave_reset"("p_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_annual_leave_reset"("p_year" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."run_leave_accrual"("p_year" integer, "p_month" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."run_leave_accrual"("p_year" integer, "p_month" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_leave_accrual"("p_year" integer, "p_month" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."run_leave_year_end_reminders"("p_today" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."run_leave_year_end_reminders"("p_today" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_leave_year_end_reminders"("p_today" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."run_monthly_leave_reset"("p_year" integer, "p_month" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."run_monthly_leave_reset"("p_year" integer, "p_month" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_monthly_leave_reset"("p_year" integer, "p_month" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."seed_default_leave_types"("p_tenant" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."seed_default_leave_types"("p_tenant" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_leave_entitlement"("p_employee_number" "text", "p_leave_type_id" "uuid", "p_days" numeric, "p_year" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."set_leave_entitlement"("p_employee_number" "text", "p_leave_type_id" "uuid", "p_days" numeric, "p_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_leave_entitlement"("p_employee_number" "text", "p_leave_type_id" "uuid", "p_days" numeric, "p_year" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_direct_message"("p_other" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_direct_message"("p_other" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_direct_message"("p_other" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."switch_company"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."switch_company"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."switch_company"("p_tenant_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."Employee_Records_Duplicate" TO "anon";
GRANT ALL ON TABLE "public"."Employee_Records_Duplicate" TO "authenticated";
GRANT ALL ON TABLE "public"."Employee_Records_Duplicate" TO "service_role";



GRANT ALL ON TABLE "public"."assets" TO "anon";
GRANT ALL ON TABLE "public"."assets" TO "authenticated";
GRANT ALL ON TABLE "public"."assets" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_logs" TO "anon";
GRANT ALL ON TABLE "public"."attendance_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."attendance_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."attendance_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."attendance_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."branch_performance" TO "anon";
GRANT ALL ON TABLE "public"."branch_performance" TO "authenticated";
GRANT ALL ON TABLE "public"."branch_performance" TO "service_role";



GRANT ALL ON SEQUENCE "public"."branch_performance_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."branch_performance_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."branch_performance_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."channel_members" TO "anon";
GRANT ALL ON TABLE "public"."channel_members" TO "authenticated";
GRANT ALL ON TABLE "public"."channel_members" TO "service_role";



GRANT ALL ON TABLE "public"."channels" TO "anon";
GRANT ALL ON TABLE "public"."channels" TO "authenticated";
GRANT ALL ON TABLE "public"."channels" TO "service_role";



GRANT ALL ON TABLE "public"."client_visits" TO "anon";
GRANT ALL ON TABLE "public"."client_visits" TO "authenticated";
GRANT ALL ON TABLE "public"."client_visits" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_visits_visit_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_visits_visit_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_visits_visit_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."company_events" TO "anon";
GRANT ALL ON TABLE "public"."company_events" TO "authenticated";
GRANT ALL ON TABLE "public"."company_events" TO "service_role";



GRANT ALL ON TABLE "public"."company_logo" TO "anon";
GRANT ALL ON TABLE "public"."company_logo" TO "authenticated";
GRANT ALL ON TABLE "public"."company_logo" TO "service_role";



GRANT ALL ON SEQUENCE "public"."company_logo_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."company_logo_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."company_logo_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."leave_policies" TO "anon";
GRANT ALL ON TABLE "public"."leave_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_policies" TO "service_role";



GRANT ALL ON TABLE "public"."current_leave_policies" TO "anon";
GRANT ALL ON TABLE "public"."current_leave_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."current_leave_policies" TO "service_role";



GRANT ALL ON TABLE "public"."dependents" TO "anon";
GRANT ALL ON TABLE "public"."dependents" TO "authenticated";
GRANT ALL ON TABLE "public"."dependents" TO "service_role";



GRANT ALL ON SEQUENCE "public"."dependents_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."dependents_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."dependents_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."email_logs" TO "anon";
GRANT ALL ON TABLE "public"."email_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."email_logs" TO "service_role";



GRANT ALL ON TABLE "public"."emergency_contact" TO "anon";
GRANT ALL ON TABLE "public"."emergency_contact" TO "authenticated";
GRANT ALL ON TABLE "public"."emergency_contact" TO "service_role";



GRANT ALL ON SEQUENCE "public"."emergency_contact_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."emergency_contact_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."emergency_contact_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



GRANT ALL ON TABLE "public"."employee_directory" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_directory" TO "service_role";



GRANT ALL ON TABLE "public"."employee_performance" TO "anon";
GRANT ALL ON TABLE "public"."employee_performance" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_performance" TO "service_role";



GRANT ALL ON SEQUENCE "public"."employee_performance_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."employee_performance_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."employee_performance_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON TABLE "public"."holidays" TO "anon";
GRANT ALL ON TABLE "public"."holidays" TO "authenticated";
GRANT ALL ON TABLE "public"."holidays" TO "service_role";



GRANT ALL ON TABLE "public"."hr_contract_settings" TO "anon";
GRANT ALL ON TABLE "public"."hr_contract_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."hr_contract_settings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hr_contract_settings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hr_contract_settings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hr_contract_settings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hr_employment_status" TO "anon";
GRANT ALL ON TABLE "public"."hr_employment_status" TO "authenticated";
GRANT ALL ON TABLE "public"."hr_employment_status" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hr_employment_status_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hr_employment_status_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hr_employment_status_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hr_leave_schedules" TO "anon";
GRANT ALL ON TABLE "public"."hr_leave_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."hr_leave_schedules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hr_leave_schedules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hr_leave_schedules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hr_leave_schedules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hr_lifecycle_history" TO "anon";
GRANT ALL ON TABLE "public"."hr_lifecycle_history" TO "authenticated";
GRANT ALL ON TABLE "public"."hr_lifecycle_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hr_lifecycle_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hr_lifecycle_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hr_lifecycle_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hr_notifications" TO "anon";
GRANT ALL ON TABLE "public"."hr_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."hr_notifications" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hr_notifications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hr_notifications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hr_notifications_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hr_salary_advances" TO "anon";
GRANT ALL ON TABLE "public"."hr_salary_advances" TO "authenticated";
GRANT ALL ON TABLE "public"."hr_salary_advances" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hr_salary_advances_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hr_salary_advances_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hr_salary_advances_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hr_suspensions" TO "anon";
GRANT ALL ON TABLE "public"."hr_suspensions" TO "authenticated";
GRANT ALL ON TABLE "public"."hr_suspensions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hr_suspensions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hr_suspensions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hr_suspensions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hr_termination_interviews" TO "anon";
GRANT ALL ON TABLE "public"."hr_termination_interviews" TO "authenticated";
GRANT ALL ON TABLE "public"."hr_termination_interviews" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hr_termination_interviews_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hr_termination_interviews_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hr_termination_interviews_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hr_terminations" TO "anon";
GRANT ALL ON TABLE "public"."hr_terminations" TO "authenticated";
GRANT ALL ON TABLE "public"."hr_terminations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hr_terminations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hr_terminations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hr_terminations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."incident_reports" TO "anon";
GRANT ALL ON TABLE "public"."incident_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."incident_reports" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."job_applications" TO "anon";
GRANT ALL ON TABLE "public"."job_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."job_applications" TO "service_role";



GRANT ALL ON TABLE "public"."job_positions" TO "anon";
GRANT ALL ON TABLE "public"."job_positions" TO "authenticated";
GRANT ALL ON TABLE "public"."job_positions" TO "service_role";



GRANT ALL ON TABLE "public"."job_postings" TO "anon";
GRANT ALL ON TABLE "public"."job_postings" TO "authenticated";
GRANT ALL ON TABLE "public"."job_postings" TO "service_role";



GRANT ALL ON TABLE "public"."kenya_branches" TO "anon";
GRANT ALL ON TABLE "public"."kenya_branches" TO "authenticated";
GRANT ALL ON TABLE "public"."kenya_branches" TO "service_role";



GRANT ALL ON TABLE "public"."kenya_branches_duplicate" TO "anon";
GRANT ALL ON TABLE "public"."kenya_branches_duplicate" TO "authenticated";
GRANT ALL ON TABLE "public"."kenya_branches_duplicate" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kenya_branches_duplicate_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kenya_branches_duplicate_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kenya_branches_duplicate_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kenya_branches_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kenya_branches_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kenya_branches_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kenya_office_locations" TO "anon";
GRANT ALL ON TABLE "public"."kenya_office_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."kenya_office_locations" TO "service_role";



GRANT ALL ON TABLE "public"."leave_application" TO "anon";
GRANT ALL ON TABLE "public"."leave_application" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_application" TO "service_role";



GRANT ALL ON TABLE "public"."leave_balance_adjustments" TO "anon";
GRANT ALL ON TABLE "public"."leave_balance_adjustments" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_balance_adjustments" TO "service_role";



GRANT ALL ON TABLE "public"."leave_entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_entitlements" TO "service_role";



GRANT ALL ON TABLE "public"."leave_types" TO "anon";
GRANT ALL ON TABLE "public"."leave_types" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_types" TO "service_role";



GRANT ALL ON TABLE "public"."loan_payments" TO "anon";
GRANT ALL ON TABLE "public"."loan_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."loan_payments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."loan_payments_payment_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."loan_payments_payment_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."loan_payments_payment_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."loan_requests" TO "anon";
GRANT ALL ON TABLE "public"."loan_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."loan_requests" TO "service_role";



GRANT ALL ON TABLE "public"."loans" TO "anon";
GRANT ALL ON TABLE "public"."loans" TO "authenticated";
GRANT ALL ON TABLE "public"."loans" TO "service_role";



GRANT ALL ON TABLE "public"."meeting_transcripts" TO "anon";
GRANT ALL ON TABLE "public"."meeting_transcripts" TO "authenticated";
GRANT ALL ON TABLE "public"."meeting_transcripts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."meeting_transcripts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."meeting_transcripts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."meeting_transcripts_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."memberships" TO "service_role";



GRANT ALL ON TABLE "public"."message_reactions" TO "anon";
GRANT ALL ON TABLE "public"."message_reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."message_reactions" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."mfa_codes" TO "anon";
GRANT ALL ON TABLE "public"."mfa_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."mfa_codes" TO "service_role";



GRANT ALL ON TABLE "public"."mfa_numbers" TO "anon";
GRANT ALL ON TABLE "public"."mfa_numbers" TO "authenticated";
GRANT ALL ON TABLE "public"."mfa_numbers" TO "service_role";



GRANT ALL ON TABLE "public"."mpesa_callbacks" TO "anon";
GRANT ALL ON TABLE "public"."mpesa_callbacks" TO "authenticated";
GRANT ALL ON TABLE "public"."mpesa_callbacks" TO "service_role";



GRANT ALL ON TABLE "public"."mpesa_transactions" TO "anon";
GRANT ALL ON TABLE "public"."mpesa_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."mpesa_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."payment_flows" TO "anon";
GRANT ALL ON TABLE "public"."payment_flows" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_flows" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_records" TO "anon";
GRANT ALL ON TABLE "public"."payroll_records" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_records" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_records_current" TO "anon";
GRANT ALL ON TABLE "public"."payroll_records_current" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_records_current" TO "service_role";



GRANT ALL ON SEQUENCE "public"."payroll_records_current_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."payroll_records_current_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."payroll_records_current_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."payroll_records_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."payroll_records_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."payroll_records_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."performance_targets" TO "anon";
GRANT ALL ON TABLE "public"."performance_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."performance_targets" TO "service_role";



GRANT ALL ON SEQUENCE "public"."performance_targets_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."performance_targets_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."performance_targets_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."phone_number_change_requests" TO "anon";
GRANT ALL ON TABLE "public"."phone_number_change_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."phone_number_change_requests" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."regional_managers" TO "anon";
GRANT ALL ON TABLE "public"."regional_managers" TO "authenticated";
GRANT ALL ON TABLE "public"."regional_managers" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."salary_advance" TO "anon";
GRANT ALL ON TABLE "public"."salary_advance" TO "authenticated";
GRANT ALL ON TABLE "public"."salary_advance" TO "service_role";



GRANT ALL ON TABLE "public"."salary_advance_payment_flows" TO "anon";
GRANT ALL ON TABLE "public"."salary_advance_payment_flows" TO "authenticated";
GRANT ALL ON TABLE "public"."salary_advance_payment_flows" TO "service_role";



GRANT ALL ON TABLE "public"."salary_advance_settings" TO "anon";
GRANT ALL ON TABLE "public"."salary_advance_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."salary_advance_settings" TO "service_role";



GRANT ALL ON TABLE "public"."salary_history" TO "anon";
GRANT ALL ON TABLE "public"."salary_history" TO "authenticated";
GRANT ALL ON TABLE "public"."salary_history" TO "service_role";



GRANT ALL ON TABLE "public"."sender_id_configs" TO "anon";
GRANT ALL ON TABLE "public"."sender_id_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."sender_id_configs" TO "service_role";



GRANT ALL ON TABLE "public"."sms_logs" TO "anon";
GRANT ALL ON TABLE "public"."sms_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."sms_logs" TO "service_role";



GRANT ALL ON TABLE "public"."sms_templates" TO "anon";
GRANT ALL ON TABLE "public"."sms_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."sms_templates" TO "service_role";



GRANT ALL ON TABLE "public"."staff_loans" TO "anon";
GRANT ALL ON TABLE "public"."staff_loans" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_loans" TO "service_role";



GRANT ALL ON TABLE "public"."staff_signup_requests" TO "anon";
GRANT ALL ON TABLE "public"."staff_signup_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_signup_requests" TO "service_role";



GRANT ALL ON SEQUENCE "public"."staff_signup_requests_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."staff_signup_requests_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."staff_signup_requests_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."statutory_deductions" TO "anon";
GRANT ALL ON TABLE "public"."statutory_deductions" TO "authenticated";
GRANT ALL ON TABLE "public"."statutory_deductions" TO "service_role";



GRANT ALL ON TABLE "public"."statutory_settings" TO "anon";
GRANT ALL ON TABLE "public"."statutory_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."statutory_settings" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."tenants" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."termination_requests" TO "anon";
GRANT ALL ON TABLE "public"."termination_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."termination_requests" TO "service_role";



GRANT ALL ON TABLE "public"."todos" TO "anon";
GRANT ALL ON TABLE "public"."todos" TO "authenticated";
GRANT ALL ON TABLE "public"."todos" TO "service_role";



GRANT ALL ON TABLE "public"."training_documents" TO "anon";
GRANT ALL ON TABLE "public"."training_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."training_documents" TO "service_role";



GRANT ALL ON TABLE "public"."training_progress" TO "anon";
GRANT ALL ON TABLE "public"."training_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."training_progress" TO "service_role";



GRANT ALL ON SEQUENCE "public"."training_progress_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."training_progress_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."training_progress_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."training_videos" TO "anon";
GRANT ALL ON TABLE "public"."training_videos" TO "authenticated";
GRANT ALL ON TABLE "public"."training_videos" TO "service_role";



GRANT ALL ON TABLE "public"."user_channel_states" TO "anon";
GRANT ALL ON TABLE "public"."user_channel_states" TO "authenticated";
GRANT ALL ON TABLE "public"."user_channel_states" TO "service_role";



GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_profiles" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."warnings" TO "anon";
GRANT ALL ON TABLE "public"."warnings" TO "authenticated";
GRANT ALL ON TABLE "public"."warnings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."warnings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."warnings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."warnings_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";









-- ---------------------------------------------------------------------------------------------
-- Outside the public schema (not in the dump)
-- ---------------------------------------------------------------------------------------------

-- Chat updates arrive live (was supabase/migrations/chat_realtime.sql)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'channels'
  ) then
    alter publication supabase_realtime add table public.channels;
  end if;
end $$;

-- Yearly and monthly leave resets (was supabase/migrations/leave_balances_engine.sql). Skipped with a notice where
-- pg_cron is not available; the buttons in the app work either way.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'annual-leave-reset',
      '0 0 1 1 *',
      $c$select public.run_annual_leave_reset(extract(year from current_date)::int);$c$
    );
    perform cron.schedule(
      'monthly-leave-reset',
      '0 0 1 * *',
      $c$select public.run_monthly_leave_reset(extract(year from current_date)::int, extract(month from current_date)::int);$c$
    );
  else
    raise notice 'pg_cron is not available on this project - leave resets are not scheduled.';
  end if;
end $$;
