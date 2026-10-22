-- A door scanner's clock that is ahead (FIG-1197).
--
-- A ZKTeco scanner takes its time from the server when it connects, but applies its own time zone, and only learns
-- ours (TimeZone=3 in the hello, iclock_routes.js) once it is registered and restarted. Figbloom's scanner ran on its
-- factory time zone (UTC+8) for a while, so its punches arrived stamped five hours ahead (a 12:33 arrival as 17:33).
-- The receiver allowed punches up to a day ahead (20261023600000), so they were kept as they were.
--
--   attendance_scanner_punches.skipped_reason  + 'clock_ahead': stamped more than 10 minutes after it actually arrived.
--                                               Kept, but neither applied to attendance nor offered for matching.
--   attendance_devices.clock_warning           what HR sees on the Scanners tab while that happens ("The clock is about
--   attendance_devices.clock_warning_at        5 hours ahead ... restart it"), cleared when punches arrive on time
--                                               again. Written by the receiver only (people may write only the columns
--                                               20261023600000 grants).
--   attendance_scanner_receive                  20261023600000's, plus that check.
--
-- And once: the punches already received ahead of time, not yet applied, are moved back by their whole-hour gap
-- (stamped minus received, rounded to the hour) when that gap is within 10 minutes of a whole number of hours (a time
-- zone mistake); any other is held back as 'clock_ahead' rather than guessed.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. columns
-- ---------------------------------------------------------------------------------------------
alter table public.attendance_scanner_punches drop constraint if exists attendance_scanner_punches_skipped_check;
alter table public.attendance_scanner_punches add constraint attendance_scanner_punches_skipped_check
  check (skipped_reason is null or skipped_reason in ('hr_corrected', 'clock_ahead'));

alter table public.attendance_devices add column if not exists clock_warning text;
alter table public.attendance_devices add column if not exists clock_warning_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- 2. the receiver: punches stamped ahead of their arrival are held back
-- ---------------------------------------------------------------------------------------------
-- (20261023600000's, plus the clock check)
create or replace function public.attendance_scanner_receive(p_serial text, p_ip text, p_lines text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.attendance_devices;
  v_received integer;
  v_from date;
  v_ids uuid[];
  v_id uuid;
  v_applied integer := 0;
  v_unmatched integer := 0;
  v_ahead integer := 0;
  v_ahead_hours numeric;
  v_on_time integer := 0;
begin
  select count(*)::integer into v_received
  from regexp_split_to_table(coalesce(p_lines, ''), E'\n') l
  where btrim(l, E' \t\r') <> '';
  d := public.attendance_scanner_contact(p_serial, p_ip);
  if d.id is null then
    return jsonb_build_object('accepted', false, 'received', v_received, 'stored', 0, 'applied', 0, 'unmatched', 0);
  end if;
  v_from := public.attendance_tracking_from(d.tenant_id);

  with lines as (
    select string_to_array(btrim(l, E' \r'), E'\t') as f
    from regexp_split_to_table(coalesce(p_lines, ''), E'\n') l
  ),
  parsed as (
    select distinct btrim(f[1]) as pin,
           public.attendance_scanner_time(f[2]) as at,
           case when btrim(coalesce(f[3], '')) ~ '^\d{1,3}$' then btrim(f[3])::smallint end as status,
           case when btrim(coalesce(f[4], '')) ~ '^\d{1,3}$' then btrim(f[4])::smallint end as verify
    from lines
    where cardinality(f) >= 2
  ),
  kept as (
    -- one row per punch (a line repeated in one upload counts once); not before attendance counts, not in the future
    select distinct on (p.pin, p.at) p.*,
           -- stamped more than 10 minutes after now: the scanner's clock is ahead
           (p.at > now() + interval '10 minutes') as ahead
    from parsed p
    where public.attendance_scanner_pin_ok(p.pin) and p.at is not null
      and (v_from is null or (p.at at time zone 'Africa/Nairobi')::date >= v_from)
      and p.at <= now() + interval '1 day'
    order by p.pin, p.at
  ),
  stored as (
    insert into public.attendance_scanner_punches
      (tenant_id, device_id, scanner_user_id, punched_at, status, verify, employee_number, skipped_reason)
    select d.tenant_id, d.id, k.pin, k.at, k.status, k.verify, m.employee_number,
           case when k.ahead then 'clock_ahead' end
    from kept k
    left join public.attendance_scanner_users m on m.tenant_id = d.tenant_id and m.scanner_user_id = k.pin
    on conflict (device_id, scanner_user_id, punched_at) do nothing
    returning id, employee_number, punched_at, skipped_reason
  )
  select coalesce(array_agg(s.id order by s.punched_at) filter (where s.skipped_reason is null), '{}'),
         count(*) filter (where s.employee_number is null and s.skipped_reason is null)::integer,
         count(*) filter (where s.skipped_reason = 'clock_ahead')::integer,
         max(extract(epoch from (s.punched_at - now())) / 3600.0) filter (where s.skipped_reason = 'clock_ahead'),
         count(*) filter (where s.skipped_reason is null)::integer
  into v_ids, v_unmatched, v_ahead, v_ahead_hours, v_on_time
  from stored s;

  foreach v_id in array v_ids loop
    if public.attendance_scanner_apply(v_id) then
      v_applied := v_applied + 1;
    end if;
  end loop;

  -- what HR sees: a warning while punches arrive ahead of time, gone once they arrive on time
  if v_ahead > 0 then
    update public.attendance_devices
    set clock_warning = format(
          'The scanner''s clock is about %s ahead of Nairobi time, so %s %s held back. Restart the scanner so it '
          'takes the time zone again; punches from then on count.',
          case when round(v_ahead_hours) >= 1 then round(v_ahead_hours)::text || ' hour' || case when round(v_ahead_hours) = 1 then '' else 's' end
               else 'a few minutes' end,
          v_ahead, case when v_ahead = 1 then 'punch was' else 'punches were' end),
        clock_warning_at = now()
    where id = d.id;
  elsif v_on_time > 0 and d.clock_warning is not null then
    update public.attendance_devices set clock_warning = null, clock_warning_at = null where id = d.id;
  end if;

  return jsonb_build_object('accepted', true, 'received', v_received, 'stored', cardinality(v_ids) + v_ahead,
                            'applied', v_applied, 'unmatched', v_unmatched, 'held', v_ahead);
end $$;
revoke all on function public.attendance_scanner_receive(text, text, text) from public, anon, authenticated;
grant execute on function public.attendance_scanner_receive(text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. once: the punches already received ahead of time
-- ---------------------------------------------------------------------------------------------
-- Not yet applied, stamped more than 10 minutes after they arrived. A gap within 10 minutes of a whole number of hours
-- (1 to 14) is a time zone mistake: moved back by those hours (unless that would repeat a punch already there).
-- Anything else is held back. Running again finds nothing more to do.
with ahead as (
  select p.id, p.device_id, p.scanner_user_id, p.punched_at,
         extract(epoch from (p.punched_at - p.received_at)) / 3600.0 as gap
  from public.attendance_scanner_punches p
  where p.applied_at is null and p.skipped_reason is null
    and p.punched_at > p.received_at + interval '10 minutes'
),
fixable as (
  select a.id, a.punched_at - make_interval(hours => round(a.gap)::int) as corrected
  from ahead a
  where round(a.gap) between 1 and 14 and abs(a.gap - round(a.gap)) <= 10.0 / 60
    and not exists (
      select 1 from public.attendance_scanner_punches q
      where q.device_id = a.device_id and q.scanner_user_id = a.scanner_user_id
        and q.punched_at = a.punched_at - make_interval(hours => round(a.gap)::int))
)
update public.attendance_scanner_punches p
set punched_at = f.corrected
from fixable f
where p.id = f.id;

update public.attendance_scanner_punches p
set skipped_reason = 'clock_ahead'
where p.applied_at is null and p.skipped_reason is null
  and p.punched_at > p.received_at + interval '10 minutes';

notify pgrst, 'reload schema';
