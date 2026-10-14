-- The company profile (FIG-825): one row per company with its brand, business details, contact details, address and
-- calendar, edited on Settings > Company profile.
--
--   * Everyone in the company reads it (nothing here is sensitive); ADMIN and people with Settings change it.
--   * The employer KRA PIN is not kept here: payroll keeps it in company_payroll_settings and the page edits it there.
--   * company_logo (name, logo, tagline) is still read by payslips, the P9 and emails. The profile keeps it in step:
--     saving the profile writes them to company_logo, and a write to company_logo (an old client) comes back here.
--   * Every existing company gets its row from its latest company_logo row (else its account name); a new company
--     gets one when it is created. created_by is the person who created the company (the page shows them as admin).

create table if not exists public.company_profile (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  company_name text not null check (char_length(btrim(company_name)) between 1 and 120),
  tagline text check (tagline is null or char_length(tagline) <= 120),
  logo_url text,
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- used on documents and templates only, not in the app
  secondary_color text check (secondary_color is null or secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  description text check (description is null or char_length(description) <= 1000),
  registration_no text check (registration_no is null or char_length(registration_no) <= 40),
  business_type text check (business_type is null or business_type in (
    'sole_proprietorship', 'partnership', 'limited_company', 'public_limited_company', 'ngo', 'government', 'other')),
  industry text check (industry is null or industry in (
    'agriculture', 'construction', 'education', 'energy', 'financial_services', 'healthcare', 'hospitality', 'ict',
    'manufacturing', 'media', 'ngo', 'professional_services', 'real_estate', 'retail', 'transport_logistics', 'other')),
  country text not null default 'Kenya' check (char_length(btrim(country)) between 2 and 60),
  base_currency text not null default 'KES' check (base_currency ~ '^[A-Z]{3}$'),
  official_phone text check (official_phone is null or official_phone ~ '^\+?[0-9][0-9 ()-]{6,19}$'),
  official_email text check (official_email is null or official_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website text check (website is null or website ~* '^https?://\S+\.\S+$'),
  address_line1 text check (address_line1 is null or char_length(address_line1) <= 120),
  address_line2 text check (address_line2 is null or char_length(address_line2) <= 120),
  city text check (city is null or char_length(city) <= 60),
  postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  week_start_day text not null default 'monday' check (week_start_day in (
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_profile enable row level security;
drop policy if exists tenant_isolation on public.company_profile;
create policy tenant_isolation on public.company_profile as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists members_read on public.company_profile;
create policy members_read on public.company_profile for select to authenticated using (true);
drop policy if exists settings_insert on public.company_profile;
create policy settings_insert on public.company_profile for insert to authenticated
  with check ((select public.has_any_module('settings')));
drop policy if exists settings_update on public.company_profile;
create policy settings_update on public.company_profile for update to authenticated
  using ((select public.has_any_module('settings')))
  with check ((select public.has_any_module('settings')));
revoke all on public.company_profile from anon;

-- existing companies: the latest company_logo row (what the top bar shows), else the account name
insert into public.company_profile (tenant_id, company_name, logo_url, tagline, created_by)
select t.id,
       left(coalesce(nullif(btrim(l.company_name), ''), t.name), 120),
       nullif(btrim(l.image_url), ''),
       left(nullif(btrim(l.company_tagline), ''), 120),
       coalesce(
         (select m.user_id from public.memberships m
          where m.tenant_id = t.id and m.role = 'ADMIN' and exists (select 1 from auth.users u where u.id = m.user_id)
          order by m.created_at limit 1),
         (select p.user_id from public.user_profiles p
          where p.tenant_id = t.id and p.role = 'ADMIN' and exists (select 1 from auth.users u where u.id = p.user_id)
          order by p.created_at nulls last limit 1))
from public.tenants t
left join lateral (
  select c.company_name, c.image_url, c.company_tagline from public.company_logo c
  where c.tenant_id = t.id order by c.id desc limit 1
) l on true
on conflict (tenant_id) do nothing;

-- who changed it and when; the creator never changes
create or replace function public.company_profile_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists company_profile_stamp on public.company_profile;
create trigger company_profile_stamp before update on public.company_profile
  for each row execute function public.company_profile_stamp();

-- a new company starts with its profile (its name, and the person creating it)
create or replace function public.company_profile_for_new_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.company_profile (tenant_id, company_name, created_by, updated_by)
  values (new.id, left(new.name, 120), auth.uid(), auth.uid())
  on conflict (tenant_id) do nothing;
  return null;
end $$;
drop trigger if exists company_profile_for_new_company on public.tenants;
create trigger company_profile_for_new_company after insert on public.tenants
  for each row execute function public.company_profile_for_new_company();

-- profile -> company_logo (name, logo, tagline). A write made by one of these syncs (depth > 1) goes no further.
create or replace function public.company_profile_to_logo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.company_name is not distinct from old.company_name
     and new.logo_url is not distinct from old.logo_url and new.tagline is not distinct from old.tagline then
    return null;
  end if;
  update public.company_logo set company_name = new.company_name, image_url = new.logo_url, company_tagline = new.tagline
  where tenant_id = new.tenant_id;
  if not found then
    insert into public.company_logo (tenant_id, company_name, image_url, company_tagline)
    values (new.tenant_id, new.company_name, new.logo_url, new.tagline);
  end if;
  return null;
end $$;
drop trigger if exists company_profile_to_logo on public.company_profile;
create trigger company_profile_to_logo after insert or update on public.company_profile
  for each row execute function public.company_profile_to_logo();

-- company_logo -> profile, for anything still writing company_logo; a blank name or logo keeps the profile's
create or replace function public.company_logo_to_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  insert into public.company_profile as p (tenant_id, company_name, logo_url, tagline)
  values (new.tenant_id,
          left(coalesce(nullif(btrim(new.company_name), ''), (select t.name from public.tenants t where t.id = new.tenant_id)), 120),
          nullif(btrim(new.image_url), ''), left(nullif(btrim(new.company_tagline), ''), 120))
  on conflict (tenant_id) do update set
    company_name = coalesce(left(nullif(btrim(new.company_name), ''), 120), p.company_name),
    logo_url = coalesce(nullif(btrim(new.image_url), ''), p.logo_url),
    tagline = left(nullif(btrim(new.company_tagline), ''), 120);
  return null;
end $$;
drop trigger if exists company_logo_to_profile on public.company_logo;
create trigger company_logo_to_profile after insert or update on public.company_logo
  for each row execute function public.company_logo_to_profile();

-- changes are audited; the starting profile a new company gets (written by a trigger) is not a change
drop trigger if exists audit_company_profile on public.company_profile;
create trigger audit_company_profile after update or delete on public.company_profile
  for each row execute function public.audit_row_change();
drop trigger if exists audit_company_profile_insert on public.company_profile;
create trigger audit_company_profile_insert after insert on public.company_profile
  for each row when (pg_trigger_depth() = 0) execute function public.audit_row_change();

-- the company's administrator as shown on the profile: the person who created it (read-only)
create or replace function public.company_profile_admin()
returns table (full_name text, email text)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(up.full_name), ''), nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), u.email), u.email
  from public.company_profile c
  join auth.users u on u.id = c.created_by
  left join public.user_profiles up on up.user_id = u.id
  where c.tenant_id = public.current_tenant_id()
$$;
revoke all on function public.company_profile_admin() from public, anon;
grant execute on function public.company_profile_admin() to authenticated;

-- the P9's company name now comes from the profile (company_logo and the account name stay as fallbacks)
create or replace function public.company_tax_details()
returns table (company_name text, employer_kra_pin text)
language sql stable security definer set search_path = public as $$
  select coalesce(
           (select nullif(btrim(p.company_name), '') from public.company_profile p where p.tenant_id = public.current_tenant_id()),
           (select l.company_name from public.company_logo l
            where l.tenant_id = public.current_tenant_id() and coalesce(btrim(l.company_name), '') <> ''
            order by l.created_at desc limit 1),
           (select t.name from public.tenants t where t.id = public.current_tenant_id())
         ),
         (select s.employer_kra_pin from public.company_payroll_settings s where s.tenant_id = public.current_tenant_id())
$$;
revoke all on function public.company_tax_details() from public, anon;
grant execute on function public.company_tax_details() to authenticated;

notify pgrst, 'reload schema';
