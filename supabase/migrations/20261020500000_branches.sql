-- Branches with a country; Tanzania and Uganda public holidays; leave counted by the employee's country (FIG-905
-- stage 1).
--
-- The first multi-country client has staff in Kenya, Tanzania and Uganda. A branch is an office in a country: each
-- company sets up its branches ("Nairobi HQ", "Dar es Salaam", "Kampala"), each with a country, and every employee
-- belongs to one. Public holidays and the minimum wage follow the branch's country; payroll per country comes in later
-- stages (until then everyone's payslip is worked out with Kenya's rules, and the Run tab says so).
--
--   branches                          per company: name, country, currency (KES / TZS / UGX / RWF from the country when
--                                     left out), city, address, active, is_default (exactly one per company). Everyone
--                                     in the company reads them; ADMIN and the Employees or Settings modules change
--                                     them. The default branch can't be deactivated, and another one becomes the
--                                     default by being set as it (the old one stops being it). A branch with people in
--                                     it can't be deactivated until they are moved (move_branch_staff).
--   employees.branch_id               the employee's branch; null means the default branch. A trigger keeps the old
--                                     "Branch" text in step: choosing a branch sets the text; typing a name links the
--                                     branch with that name (ignoring case), or adds one in the default branch's
--                                     country (so imports and bulk edits that send the text keep working). New
--                                     employees go in the default branch when none is given.
--   employee_country(tenant, emp)     the branch's country, else the default branch's, else company_profile.country,
--                                     else Kenya. employee_currency(tenant, emp) the same for the currency.
--   ensure_default_branch(tenant)     the company's default branch, made ("Head office", in the company's country)
--                                     when missing. Every company gets one now and new companies when created. When
--                                     the company's country changes, a default branch still in the old country moves
--                                     with it.
--
-- Seeding (existing companies, safe to run again): a default "Head office" per company in its country; then a branch
-- for each distinct non-empty "Branch" text employees have (trimmed, ignoring case, the spelling most of them use;
-- 'all' and names over 100 characters are skipped), in the company's country; employees linked to theirs by name.
-- Employees with no "Branch" text are left with branch_id null (= the default branch).
--
-- Public holidays per country:
--   holidays.country                  null = every country (the company-wide rows HR added by hand); otherwise the
--                                     holiday is only for staff in that country. Rows added automatically before this
--                                     (Kenya's list, the only one there was) are marked Kenya.
--   public_holidays_for(country, yr)  now Tanzania and Uganda too, besides Kenya:
--     Tanzania (Public Holidays Act, Cap. 35, Schedule; tanzanialaws.com/statutes/principal-legislation/
--       301-public-holidays-act and tanzlii.org/akn/tz/act/ord/1920/2): New Year's Day (1 Jan), Zanzibar Revolution
--       Day (12 Jan), Karume Day (7 Apr), Good Friday, Easter Monday, Union Day (26 Apr), Workers' Day (1 May), Saba
--       Saba (7 Jul), Nane Nane / Peasants' Day (8 Aug), Mwalimu Nyerere Day (14 Oct), Independence Day (9 Dec),
--       Christmas Day, Boxing Day.
--       FLAGGED: Karume Day and Saba Saba are not in the Schedule text we could read; they are kept every year by
--       government notice and listed by every current calendar, so they are included (HR can delete them).
--       FLAGGED: Sunday rule. An older text of section 4 says a holiday on a Saturday or Sunday gives the next day,
--       but in practice Tanzania does not move them, and we could not confirm the current wording: no day in lieu is
--       added. HR adds one when it is announced.
--     Uganda (Public Holidays Act, Cap. 255; ulii.org/akn/ug/act/1965/23, with the dates from the Ministry of Public
--       Service standing orders and Uganda's missions' lists): New Year's Day (1 Jan), NRM Liberation Day (26 Jan),
--       Archbishop Janani Luwum Day (16 Feb), International Women's Day (8 Mar), Good Friday, Easter Monday, Labour Day
--       (1 May), Martyrs' Day (3 Jun), National Heroes' Day (9 Jun), Independence Day (9 Oct), Christmas Day, Boxing
--       Day.
--       FLAGGED: Sunday rule. The Act says nothing about a holiday on a weekend; the Monday is sometimes given by
--       declaration (e.g. Women's Day on Sun 8 Mar 2026), sometimes not: no day in lieu is added. One-off days (e.g. a
--       polling day) are declared by the President: HR adds those.
--     Islamic holidays (Eid al-Fitr; Eid al-Adha; Maulid in Tanzania) depend on the moon and are announced shortly
--     before: as for Kenya, HR adds them (for the right country) when they are announced.
--   add_public_holidays(year) and the yearly cron (both through fill_public_holidays) add the public holidays of every
--     country the company has an active branch in (and of its default / company country). A branch added in a new
--     country, or moved to one, gets that country's holidays for this year and next straight away.
--   leave_days_for(...) (and overtime's kind of day) count only holidays with no country or the employee's country.
--   my_holiday_country()              the signed-in employee's country (the calendars show them their own holidays)
--   public_holidays_country()         also lists each of the company's countries and whether its holidays are known
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the currency of a country
-- ---------------------------------------------------------------------------------------------
create or replace function public.country_currency(p_country text) returns text
language sql immutable as $$
  select case lower(btrim(coalesce(p_country, '')))
    when 'tanzania' then 'TZS'
    when 'uganda' then 'UGX'
    when 'rwanda' then 'RWF'
    else 'KES' end
$$;

-- the countries we know, spelled one way ("tanzania " -> "Tanzania"); others are kept as typed (trimmed)
create or replace function public.tidy_country(p_country text) returns text
language sql immutable as $$
  select case lower(btrim(coalesce(p_country, '')))
    when '' then null
    when 'kenya' then 'Kenya'
    when 'tanzania' then 'Tanzania'
    when 'uganda' then 'Uganda'
    when 'rwanda' then 'Rwanda'
    else btrim(p_country) end
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. holidays get a country (before any branch is made, as a new branch adds its country's holidays)
-- ---------------------------------------------------------------------------------------------
alter table public.holidays add column if not exists country text;
-- the rows added automatically so far were Kenya's (the only list there was)
update public.holidays set country = 'Kenya' where source = 'auto' and country is null;

create or replace function public.holidays_tidy_country() returns trigger
language plpgsql set search_path = public as $$
begin
  new.country := public.tidy_country(new.country);
  return new;
end $$;
drop trigger if exists holidays_tidy_country on public.holidays;
create trigger holidays_tidy_country before insert or update of country on public.holidays
  for each row execute function public.holidays_tidy_country();
revoke all on function public.holidays_tidy_country() from public, anon, authenticated;

-- a holiday with no country is for everyone; one with a country only for staff in it
create or replace function public.holiday_applies(p_holiday_country text, p_country text) returns boolean
language sql immutable as $$
  select nullif(btrim(p_holiday_country), '') is null
      or lower(btrim(p_holiday_country)) = lower(btrim(coalesce(p_country, 'Kenya')))
$$;

-- p_day is one of the company's holidays for staff in p_country (a recurring holiday falls on the same day every year)
create or replace function public.is_holiday(p_tenant uuid, p_country text, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.holidays h
    where h.tenant_id = p_tenant and h.date is not null
      and public.holiday_applies(h.country, p_country)
      and (h.date = p_day or (coalesce(h.recurring, false) and to_char(h.date, 'MM-DD') = to_char(p_day, 'MM-DD'))))
$$;
revoke all on function public.is_holiday(uuid, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Tanzania and Uganda public holidays (Kenya's as before)
-- ---------------------------------------------------------------------------------------------
create or replace function public.public_holidays_for(p_country text, p_year integer)
returns table (name text, holiday date)
language plpgsql immutable as $$
declare
  easter date := public.easter_sunday(p_year);
  c text := lower(btrim(coalesce(p_country, 'Kenya')));
begin
  if c = 'kenya' then
    return query
    with fixed(name, holiday) as (
      values ('New Year''s Day', make_date(p_year, 1, 1)),
             ('Good Friday', easter - 2),
             ('Easter Monday', easter + 1),
             ('Labour Day', make_date(p_year, 5, 1)),
             ('Madaraka Day', make_date(p_year, 6, 1)),
             ('Mazingira Day', make_date(p_year, 10, 10)),
             ('Mashujaa Day', make_date(p_year, 10, 20)),
             ('Jamhuri Day', make_date(p_year, 12, 12)),
             ('Christmas Day', make_date(p_year, 12, 25)),
             ('Boxing Day', make_date(p_year, 12, 26))
    )
    select f.name, f.holiday from fixed f
    union all
    -- a holiday on a Sunday: the Monday after is a holiday too (the Monday after Christmas on a Sunday is Boxing Day's
    -- Tuesday then, as Boxing Day already takes the Monday)
    select f.name || ' (observed)',
           case when f.holiday = make_date(p_year, 12, 25) then f.holiday + 2 else f.holiday + 1 end
    from fixed f
    where extract(isodow from f.holiday) = 7 and f.name not in ('Easter Monday', 'Good Friday');
  elsif c = 'tanzania' then
    -- no day in lieu for a Sunday (see the header)
    return query
    values ('New Year''s Day', make_date(p_year, 1, 1)),
           ('Zanzibar Revolution Day', make_date(p_year, 1, 12)),
           ('Karume Day', make_date(p_year, 4, 7)),
           ('Good Friday', easter - 2),
           ('Easter Monday', easter + 1),
           ('Union Day', make_date(p_year, 4, 26)),
           ('Workers'' Day', make_date(p_year, 5, 1)),
           ('Saba Saba', make_date(p_year, 7, 7)),
           ('Nane Nane (Peasants'' Day)', make_date(p_year, 8, 8)),
           ('Mwalimu Nyerere Day', make_date(p_year, 10, 14)),
           ('Independence Day', make_date(p_year, 12, 9)),
           ('Christmas Day', make_date(p_year, 12, 25)),
           ('Boxing Day', make_date(p_year, 12, 26));
  elsif c = 'uganda' then
    -- no day in lieu for a Sunday (see the header)
    return query
    values ('New Year''s Day', make_date(p_year, 1, 1)),
           ('NRM Liberation Day', make_date(p_year, 1, 26)),
           ('Archbishop Janani Luwum Day', make_date(p_year, 2, 16)),
           ('International Women''s Day', make_date(p_year, 3, 8)),
           ('Good Friday', easter - 2),
           ('Easter Monday', easter + 1),
           ('Labour Day', make_date(p_year, 5, 1)),
           ('Martyrs'' Day', make_date(p_year, 6, 3)),
           ('National Heroes'' Day', make_date(p_year, 6, 9)),
           ('Independence Day', make_date(p_year, 10, 9)),
           ('Christmas Day', make_date(p_year, 12, 25)),
           ('Boxing Day', make_date(p_year, 12, 26));
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. branches
-- ---------------------------------------------------------------------------------------------
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(btrim(name)) <= 100),
  country text not null default 'Kenya' check (btrim(country) <> ''),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  city text,
  address text,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists branches_tenant_name on public.branches (tenant_id, lower(btrim(name)));
create unique index if not exists branches_one_default on public.branches (tenant_id) where is_default;
create unique index if not exists branches_id_tenant on public.branches (id, tenant_id);

-- tidy the name and country; the currency follows the country when left out (or when the country changes and the
-- currency was the old country's); one default per company; the default stays active; a branch with people in it
-- isn't deactivated
create or replace function public.branches_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  new.name := btrim(new.name);
  new.country := coalesce(public.tidy_country(new.country), 'Kenya');
  new.city := nullif(btrim(new.city), '');
  new.address := nullif(btrim(new.address), '');
  if tg_op = 'UPDATE' and new.country is distinct from old.country and new.currency is not distinct from old.currency
     and old.currency = public.country_currency(old.country) then
    new.currency := public.country_currency(new.country);
  end if;
  if new.currency is null or btrim(new.currency) = '' then
    new.currency := public.country_currency(new.country);
  end if;
  new.currency := upper(btrim(new.currency));

  if new.is_default and not new.active then
    raise exception 'The default branch can''t be deactivated: make another branch the default first' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if old.is_default and not new.is_default and coalesce(current_setting('app.branch_default_switch', true), '') <> 'on' then
      raise exception 'Make another branch the default instead' using errcode = '23514';
    end if;
    if old.active and not new.active then
      select count(*) into n from public.employees e where e.tenant_id = new.tenant_id and e.branch_id = new.id;
      if n > 0 then
        raise exception '% in %: move them to another branch first', case when n = 1 then '1 person is' else n || ' people are' end, new.name
          using errcode = '23514';
      end if;
    end if;
  end if;

  -- a new default: the old one stops being it
  if new.is_default and (tg_op = 'INSERT' or not old.is_default) then
    perform set_config('app.branch_default_switch', 'on', true);
    update public.branches set is_default = false where tenant_id = new.tenant_id and is_default and id <> new.id;
    perform set_config('app.branch_default_switch', 'off', true);
  end if;
  return new;
end $$;
drop trigger if exists branches_rules on public.branches;
create trigger branches_rules before insert or update on public.branches
  for each row execute function public.branches_rules();

create or replace function public.branches_no_default_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.is_default and coalesce(current_setting('app.branch_default_switch', true), '') <> 'on'
     and exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    raise exception 'The default branch can''t be removed' using errcode = '23514';
  end if;
  return old;
end $$;
drop trigger if exists branches_no_default_delete on public.branches;
create trigger branches_no_default_delete before delete on public.branches
  for each row execute function public.branches_no_default_delete();

-- a renamed branch is renamed on its employees ("Branch", which other screens show)
create or replace function public.branches_renamed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.employees e set "Branch" = new.name
  where e.branch_id = new.id and e.tenant_id = new.tenant_id and e."Branch" is distinct from new.name;
  return null;
end $$;
drop trigger if exists branches_renamed on public.branches;
create trigger branches_renamed after update of name on public.branches
  for each row when (old.name is distinct from new.name) execute function public.branches_renamed();

revoke all on function public.branches_rules() from public, anon, authenticated;
revoke all on function public.branches_no_default_delete() from public, anon, authenticated;
revoke all on function public.branches_renamed() from public, anon, authenticated;

-- access: everyone in the company reads them (pickers, the directory, holidays by country); ADMIN and the Employees or
-- Settings modules change them
alter table public.branches enable row level security;
drop policy if exists tenant_isolation on public.branches;
create policy tenant_isolation on public.branches as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists read_company on public.branches;
create policy read_company on public.branches for select to authenticated using (true);
drop policy if exists hr_write on public.branches;
create policy hr_write on public.branches for all to authenticated
  using ((select public.has_any_module('employees', 'settings')))
  with check ((select public.has_any_module('employees', 'settings')));
revoke all on public.branches from anon;
revoke truncate on public.branches from authenticated;
grant select, insert, update, delete on public.branches to authenticated;

-- the company's country (Kenya when not set)
create or replace function public.company_country(p_tenant uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(public.tidy_country((select p.country from public.company_profile p where p.tenant_id = p_tenant)), 'Kenya')
$$;
revoke all on function public.company_country(uuid) from public, anon, authenticated;

-- the company's default branch, made when it has none
create or replace function public.ensure_default_branch(p_tenant uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_tenant is null then
    return null;
  end if;
  select b.id into v_id from public.branches b where b.tenant_id = p_tenant and b.is_default;
  if v_id is not null then
    return v_id;
  end if;
  -- a branch already called "Head office" becomes the default; otherwise one is made
  select b.id into v_id from public.branches b where b.tenant_id = p_tenant and lower(b.name) = 'head office';
  if v_id is not null then
    update public.branches set is_default = true, active = true where id = v_id;
    return v_id;
  end if;
  insert into public.branches (tenant_id, name, country, is_default)
  values (p_tenant, 'Head office', public.company_country(p_tenant), true)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.ensure_default_branch(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. the employee's branch
-- ---------------------------------------------------------------------------------------------
alter table public.employees add column if not exists branch_id uuid;
alter table public.employees drop constraint if exists employees_branch_fkey;
alter table public.employees add constraint employees_branch_fkey
  foreign key (branch_id, tenant_id) references public.branches (id, tenant_id) on delete set null (branch_id);
create index if not exists employees_branch on public.employees (branch_id) where branch_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 6. seeding: a default branch per company, a branch per "Branch" text, employees linked
-- ---------------------------------------------------------------------------------------------
select public.ensure_default_branch(t.id) from public.tenants t;

insert into public.branches (tenant_id, name, country)
select x.tenant_id, x.name, coalesce((select b.country from public.branches b where b.tenant_id = x.tenant_id and b.is_default),
                                     public.company_country(x.tenant_id))
from (
  select distinct on (e.tenant_id, lower(btrim(e."Branch"))) e.tenant_id, btrim(e."Branch") as name
  from public.employees e
  where nullif(btrim(e."Branch"), '') is not null and length(btrim(e."Branch")) <= 100 and lower(btrim(e."Branch")) <> 'all'
  group by e.tenant_id, lower(btrim(e."Branch")), btrim(e."Branch")
  order by e.tenant_id, lower(btrim(e."Branch")), count(*) desc, btrim(e."Branch")
) x
on conflict (tenant_id, lower(btrim(name))) do nothing;

update public.employees e set branch_id = b.id
from public.branches b
where e.branch_id is null and b.tenant_id = e.tenant_id
  and nullif(btrim(e."Branch"), '') is not null and lower(btrim(e."Branch")) = lower(b.name);

-- ---------------------------------------------------------------------------------------------
-- 7. keeping the branch and the "Branch" text in step (after the seeding, so that changed only branch_id)
-- ---------------------------------------------------------------------------------------------
create or replace function public.employees_branch() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_insert boolean := tg_op = 'INSERT';
  id_changed boolean;
  text_changed boolean;
  b public.branches;
  txt text := nullif(btrim(new."Branch"), '');
begin
  id_changed := case when is_insert then new.branch_id is not null else new.branch_id is distinct from old.branch_id end;
  text_changed := case when is_insert then txt is not null else new."Branch" is distinct from old."Branch" end;

  -- the branch wins over the text when both change
  if id_changed then
    if new.branch_id is not null then
      select * into b from public.branches where id = new.branch_id;
      if b.id is null or b.tenant_id <> new.tenant_id then
        raise exception 'The branch must be one of this company''s' using errcode = '23503';
      end if;
      new."Branch" := b.name;
    elsif txt is not null and exists (
      select 1 from public.branches x where x.id = old.branch_id and lower(x.name) = lower(txt)) then
      new."Branch" := null;
    end if;
  elsif text_changed then
    if txt is null then
      new.branch_id := null;
    elsif length(txt) <= 100 and lower(txt) <> 'all' then
      select * into b from public.branches where tenant_id = new.tenant_id and lower(name) = lower(txt);
      if b.id is null then
        insert into public.branches (tenant_id, name, country)
        values (new.tenant_id, txt,
                coalesce((select d.country from public.branches d where d.tenant_id = new.tenant_id and d.is_default),
                         public.company_country(new.tenant_id)))
        on conflict (tenant_id, lower(btrim(name))) do nothing
        returning * into b;
        if b.id is null then
          select * into b from public.branches where tenant_id = new.tenant_id and lower(name) = lower(txt);
        end if;
      end if;
      new.branch_id := b.id;
      new."Branch" := b.name;
    end if;
  end if;

  -- a new employee with no branch goes in the default one
  if is_insert and new.branch_id is null and txt is null then
    new.branch_id := public.ensure_default_branch(new.tenant_id);
    select * into b from public.branches where id = new.branch_id;
    new."Branch" := b.name;
  end if;
  return new;
end $$;
drop trigger if exists employees_branch on public.employees;
create trigger employees_branch before insert or update on public.employees
  for each row execute function public.employees_branch();
revoke all on function public.employees_branch() from public, anon, authenticated;

-- HR moves everyone in one branch to another (before deactivating it); returns how many moved
create or replace function public.move_branch_staff(p_from uuid, p_to uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  n integer;
begin
  if not public.has_any_module('employees', 'settings') then
    raise exception 'Only HR can move people between branches' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'Choose another branch to move them to' using errcode = '22023';
  end if;
  if not exists (select 1 from public.branches b where b.id = p_from and b.tenant_id = v_tenant)
     or not exists (select 1 from public.branches b where b.id = p_to and b.tenant_id = v_tenant and b.active) then
    raise exception 'Choose one of this company''s active branches' using errcode = '23503';
  end if;
  update public.employees set branch_id = p_to where tenant_id = v_tenant and branch_id = p_from;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.move_branch_staff(uuid, uuid) from public, anon;
grant execute on function public.move_branch_staff(uuid, uuid) to authenticated;

-- new companies get their default branch when created (named to run before public_holidays_for_new_company)
create or replace function public.branches_for_new_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_default_branch(new.id);
  return null;
end $$;
drop trigger if exists branches_for_new_company on public.tenants;
create trigger branches_for_new_company after insert on public.tenants
  for each row execute function public.branches_for_new_company();
revoke all on function public.branches_for_new_company() from public, anon, authenticated;

-- the company's country changes: a default branch still in the old country moves with it
create or replace function public.branches_follow_company_country() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old text := case when tg_op = 'INSERT' then 'Kenya' else coalesce(public.tidy_country(old.country), 'Kenya') end;
  v_new text := coalesce(public.tidy_country(new.country), 'Kenya');
begin
  if lower(v_old) <> lower(v_new) then
    perform public.ensure_default_branch(new.tenant_id);
    update public.branches set country = v_new
    where tenant_id = new.tenant_id and is_default and lower(country) = lower(v_old);
  end if;
  return null;
end $$;
drop trigger if exists branches_follow_company_country on public.company_profile;
create trigger branches_follow_company_country after insert or update of country on public.company_profile
  for each row execute function public.branches_follow_company_country();
revoke all on function public.branches_follow_company_country() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. an employee's country and currency
-- ---------------------------------------------------------------------------------------------
create or replace function public.employee_country(p_tenant uuid, p_employee_number text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(b.country), '') from public.employees e join public.branches b on b.id = e.branch_id
     where e.tenant_id = p_tenant and e."Employee Number" = p_employee_number limit 1),
    (select nullif(btrim(b.country), '') from public.branches b where b.tenant_id = p_tenant and b.is_default limit 1),
    public.company_country(p_tenant))
$$;
revoke all on function public.employee_country(uuid, text) from public, anon, authenticated;

create or replace function public.employee_currency(p_tenant uuid, p_employee_number text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select b.currency from public.employees e join public.branches b on b.id = e.branch_id
     where e.tenant_id = p_tenant and e."Employee Number" = p_employee_number limit 1),
    (select b.currency from public.branches b where b.tenant_id = p_tenant and b.is_default limit 1),
    public.country_currency(public.company_country(p_tenant)))
$$;
revoke all on function public.employee_currency(uuid, text) from public, anon, authenticated;

-- the signed-in employee's country (null for someone who isn't an employee): the calendars show them their holidays
create or replace function public.my_holiday_country() returns text
language sql stable security definer set search_path = public as $$
  select case when public.current_employee_number() is null then null
              else public.employee_country(public.current_tenant_id(), public.current_employee_number()) end
$$;
revoke all on function public.my_holiday_country() from public, anon;
grant execute on function public.my_holiday_country() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 9. counting leave (and overtime's kind of day) with the employee's country's holidays
-- ---------------------------------------------------------------------------------------------
create or replace function public.leave_days_for(
  p_tenant uuid, p_employee text, p_start date, p_end date, p_calendar boolean, p_half boolean default false
) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_week numeric[];
  v_country text;
  v_days numeric;
begin
  if p_start is null or p_end is null or p_end < p_start then
    return 0;
  end if;
  if p_calendar then
    v_days := (p_end - p_start) + 1;
  else
    v_week := public.work_week_for(p_tenant, p_employee);
    v_country := public.employee_country(p_tenant, p_employee);
    select coalesce(sum(v_week[extract(isodow from g.d)::int]), 0) into v_days
    from generate_series(p_start, p_end, interval '1 day') g(d)
    where not public.is_holiday(p_tenant, v_country, g.d::date);
  end if;
  if p_half and p_start = p_end then
    v_days := v_days / 2;
  end if;
  return trim_scale(v_days);
end $$;
revoke all on function public.leave_days_for(uuid, text, date, date, boolean, boolean) from public, anon;
grant execute on function public.leave_days_for(uuid, text, date, date, boolean, boolean) to authenticated;

create or replace function public.overtime_day_type(p_tenant uuid, p_employee text, p_day date) returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.is_holiday(p_tenant, public.employee_country(p_tenant, p_employee), p_day) then 'holiday'
    when (public.work_week_for(p_tenant, p_employee))[extract(isodow from p_day)::int] > 0 then 'normal'
    else 'rest'
  end
$$;

-- an employee moved to another branch may have other holidays: their open overtime is classified again
create or replace function public.overtime_follow_branch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.overtime_reclassify(new.tenant_id);
  return null;
end $$;
drop trigger if exists overtime_follow_branch on public.employees;
create trigger overtime_follow_branch after update of branch_id on public.employees
  for each row when (old.branch_id is distinct from new.branch_id) execute function public.overtime_follow_branch();
revoke all on function public.overtime_follow_branch() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. public holidays for every country the company is in
-- ---------------------------------------------------------------------------------------------
-- the countries whose public holidays a company gets: its active branches' and its default / company country
create or replace function public.company_countries(p_tenant uuid) returns setof text
language sql stable security definer set search_path = public as $$
  select distinct on (lower(c)) c
  from (
    select btrim(b.country) as c from public.branches b where b.tenant_id = p_tenant and b.active
    union all
    select public.employee_country(p_tenant, null)
  ) x
  where nullif(c, '') is not null
  order by lower(c), c
$$;
revoke all on function public.company_countries(uuid) from public, anon, authenticated;

-- adds a year's public holidays to one company's list, for each of its countries; returns how many were added
create or replace function public.fill_public_holidays(p_tenant uuid, p_year integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  c text;
  n integer;
  total integer := 0;
begin
  for c in select public.company_countries(p_tenant) loop
    insert into public.holidays (tenant_id, name, date, recurring, source, country)
    select distinct on (h.holiday) p_tenant, h.name, h.holiday, false, 'auto', c
    from public.public_holidays_for(c, p_year) h
    where not exists (
      select 1 from public.holidays x
      where x.tenant_id = p_tenant and x.date is not null and public.holiday_applies(x.country, c)
        and (x.date = h.holiday or (coalesce(x.recurring, false) and to_char(x.date, 'MM-DD') = to_char(h.holiday, 'MM-DD'))))
    order by h.holiday, h.name;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end $$;
revoke all on function public.fill_public_holidays(uuid, integer) from public, anon, authenticated;

-- a branch opened in a country (or moved to one, or reactivated): that country's holidays for this year and next
create or replace function public.branches_fill_holidays() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.active and (tg_op = 'INSERT' or new.country is distinct from old.country or not old.active) then
    perform public.fill_public_holidays(new.tenant_id, extract(year from current_date)::int);
    perform public.fill_public_holidays(new.tenant_id, extract(year from current_date)::int + 1);
  end if;
  return null;
end $$;
drop trigger if exists branches_fill_holidays on public.branches;
create trigger branches_fill_holidays after insert or update of country, active on public.branches
  for each row execute function public.branches_fill_holidays();
revoke all on function public.branches_fill_holidays() from public, anon, authenticated;

-- what the Holidays tab shows: the company's country, whether its holidays are known, and each of its countries
create or replace function public.public_holidays_country() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'country', c.country,
    'supported', exists (select 1 from public.public_holidays_for(c.country, extract(year from current_date)::int)),
    'countries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'country', x.country,
        'supported', exists (select 1 from public.public_holidays_for(x.country, extract(year from current_date)::int)))
        order by x.country)
      from (select public.company_countries(public.current_tenant_id()) as country) x), '[]'::jsonb))
  from (select public.employee_country(public.current_tenant_id(), null) as country) c
$$;
revoke all on function public.public_holidays_country() from public, anon;
grant execute on function public.public_holidays_country() to authenticated;

-- every company: this year and next, for each of its countries
select public.fill_public_holidays(t.id, y)
from public.tenants t, (values (extract(year from current_date)::int), (extract(year from current_date)::int + 1)) v(y);

-- the yearly job (1 December, the year after) already calls fill_public_holidays, which now covers every country

-- (employee_directory is left as it is: its "Branch" is the branch's name, kept in step by employees_branch, and an
-- older migration run again would otherwise have to drop the column)

notify pgrst, 'reload schema';
