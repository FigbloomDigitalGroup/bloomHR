-- Public holidays by country, added for each company automatically (FIG-884).
--
-- Each company has its own holidays list (Leave > Holidays), which leave day counting uses (leave_days_for). New
-- companies started with an empty list, and the Leave page showed a sample Kenyan list that nothing counted. Now:
--
--   public_holidays_for(country, year)  the country's public holidays for a year. Kenya (Public Holidays Act): New
--                                       Year's Day, Good Friday, Easter Monday, Labour Day, Madaraka Day, Mazingira Day
--                                       (10 Oct), Mashujaa Day, Jamhuri Day, Christmas Day, Boxing Day; a holiday on a
--                                       Sunday also gives the Monday after. Eid al-Fitr and holidays gazetted at short
--                                       notice can't be worked out: HR adds those. Other countries: none yet.
--   add_public_holidays(year)           adds them to the signed-in company's list (HR, from the Holidays tab); a day
--                                       already on the list is left alone
--   holidays.source                     'manual' (added by hand) or 'auto' (added from the country's list)
-- The company's country is company_profile.country (Kenya when not set). Every company gets this year and next now;
-- new companies when they are created; and every year on 1 December, the year after (pg_cron, best effort).
-- Good Friday and Easter Monday move every year, so old "every year" rows for them are made one-off (they would
-- otherwise fall on the same date every year).

alter table public.holidays add column if not exists source text not null default 'manual';
alter table public.holidays drop constraint if exists holidays_source_check;
alter table public.holidays add constraint holidays_source_check check (source in ('manual', 'auto'));

update public.holidays set recurring = false
where coalesce(recurring, false) and (name ilike 'good friday%' or name ilike 'easter%');

-- Easter Sunday (the Gregorian computus)
create or replace function public.easter_sunday(p_year integer) returns date language plpgsql immutable as $$
declare
  a int := p_year % 19; b int := p_year / 100; c int := p_year % 100;
  d int := b / 4; e int := b % 4; f int := (b + 8) / 25; g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30; i int := c / 4; k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7; m int := (a + 11 * h + 22 * l) / 451;
begin
  return make_date(p_year, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end $$;

create or replace function public.public_holidays_for(p_country text, p_year integer)
returns table (name text, holiday date)
language plpgsql immutable as $$
declare
  easter date := public.easter_sunday(p_year);
begin
  if lower(btrim(coalesce(p_country, 'Kenya'))) <> 'kenya' then
    return;
  end if;
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
end $$;

-- adds a year's public holidays to one company's list; returns how many were added
create or replace function public.fill_public_holidays(p_tenant uuid, p_year integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_country text := coalesce((select nullif(btrim(p.country), '') from public.company_profile p where p.tenant_id = p_tenant), 'Kenya');
  n integer;
begin
  insert into public.holidays (tenant_id, name, date, recurring, source)
  select p_tenant, h.name, h.holiday, false, 'auto'
  from public.public_holidays_for(v_country, p_year) h
  where not exists (
    select 1 from public.holidays x
    where x.tenant_id = p_tenant and x.date is not null
      and (x.date = h.holiday or (coalesce(x.recurring, false) and to_char(x.date, 'MM-DD') = to_char(h.holiday, 'MM-DD'))));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.fill_public_holidays(uuid, integer) from public, anon, authenticated;

-- for HR, from the Holidays tab
create or replace function public.add_public_holidays(p_year integer) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_module('leaves') then
    raise exception 'Only people who run leave can add public holidays' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'Choose a year' using errcode = '22023';
  end if;
  return public.fill_public_holidays(public.current_tenant_id(), p_year);
end $$;
revoke all on function public.add_public_holidays(integer) from public, anon;
grant execute on function public.add_public_holidays(integer) to authenticated;

-- what the Holidays tab shows: the country used and whether its holidays are known
create or replace function public.public_holidays_country() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'country', c.country,
    'supported', exists (select 1 from public.public_holidays_for(c.country, extract(year from current_date)::int)))
  from (select coalesce((select nullif(btrim(p.country), '') from public.company_profile p
                         where p.tenant_id = public.current_tenant_id()), 'Kenya') as country) c
$$;
revoke all on function public.public_holidays_country() from public, anon;
grant execute on function public.public_holidays_country() to authenticated;

-- every company: this year and next
select public.fill_public_holidays(t.id, y)
from public.tenants t, (values (extract(year from current_date)::int), (extract(year from current_date)::int + 1)) v(y);

-- new companies when they are created
create or replace function public.public_holidays_for_new_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.fill_public_holidays(new.id, extract(year from current_date)::int);
  perform public.fill_public_holidays(new.id, extract(year from current_date)::int + 1);
  return null;
end $$;
drop trigger if exists public_holidays_for_new_company on public.tenants;
create trigger public_holidays_for_new_company after insert on public.tenants
  for each row execute function public.public_holidays_for_new_company();

-- and every year on 1 December, the year after, for every company
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('public-holidays-next-year', '0 3 1 12 *',
      $c$select public.fill_public_holidays(t.id, extract(year from current_date)::int + 1) from public.tenants t;$c$);
  else
    raise notice 'pg_cron is not available: add next year''s public holidays from the Leave page instead.';
  end if;
end $$;

notify pgrst, 'reload schema';
