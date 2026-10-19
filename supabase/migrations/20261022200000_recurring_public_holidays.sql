-- Public holidays on the same date every year are kept as "every year" (FIG-918).
--
-- The country's list (public_holidays_for) was added as one-off rows, one per year: Christmas 2026, Christmas 2027...
-- so the Holidays tab showed Christmas, Jamhuri Day and the rest as not recurring, and each year added them again.
-- Most of them fall on the same date every year; only these move:
--   * Good Friday and Easter Monday (Easter);
--   * the "(observed)" days - the Monday after a holiday on a Sunday - which only happen in some years.
-- (The Islamic holidays depend on the moon and are not on the list: HR adds those, one-off.)
--
--   fill_public_holidays(tenant, year)  adds the fixed-date ones as recurring; one already on the list as recurring
--                                       (for that country) covers every year, so later years add only the movable ones
--   the rows added so far               each fixed-date holiday the list added (source 'auto') keeps its earliest row,
--                                       made recurring; its copies in later years on the same day are removed. Rows HR
--                                       added or moved by hand are left alone.
-- Leave and overtime counting already treat a recurring holiday as falling on its day every year, so no day changes.
-- Safe to run again.

-- the list's holidays that fall on another day some years
create or replace function public.public_holiday_moves(p_name text) returns boolean language sql immutable as $$
  select p_name in ('Good Friday', 'Easter Monday') or p_name like '% (observed)'
$$;

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
    select distinct on (h.holiday) p_tenant, h.name, h.holiday, not public.public_holiday_moves(h.name), 'auto', c
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

-- the rows added so far: the earliest of each fixed-date holiday becomes recurring, its later copies go
with firsts as (
  select distinct on (h.tenant_id, coalesce(h.country, ''), h.name, to_char(h.date, 'MM-DD')) h.id
  from public.holidays h
  where h.source = 'auto' and h.date is not null and not public.public_holiday_moves(h.name)
  order by h.tenant_id, coalesce(h.country, ''), h.name, to_char(h.date, 'MM-DD'), h.date, h.id
)
update public.holidays h set recurring = true
from firsts f
where h.id = f.id and not coalesce(h.recurring, false);

delete from public.holidays later
using public.holidays first
where later.source = 'auto' and first.source = 'auto'
  and first.recurring and later.id <> first.id
  and later.tenant_id = first.tenant_id
  and coalesce(later.country, '') = coalesce(first.country, '')
  and later.name = first.name
  and later.date > first.date
  and to_char(later.date, 'MM-DD') = to_char(first.date, 'MM-DD');
