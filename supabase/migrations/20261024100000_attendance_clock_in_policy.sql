-- Where people may clock in from in the app, and each person's work arrangement (FIG-1200).
--
-- Until now anyone could press Clock in in the staff portal from anywhere. Each company now chooses, and HR sets how
-- each person works on top of that:
--
--   attendance_settings.clock_in_policy     'anywhere' (the default: what the app did before, so nothing changes until a
--                                           company chooses), 'office' (from a company office network, or within
--                                           office_radius_m of a branch's location, from the location the app sends) or
--                                           'scanner_only' (the app's Clock in is refused: people use the door scanner).
--   attendance_settings.office_networks     the office's public IP addresses or ranges ("41.90.12.7", "41.90.12.0/24");
--                                           kept as Postgres writes them, each once, at most 50. Private addresses
--                                           (192.168.x.x ...) and ranges wider than /16 (IPv6 /48) are refused: the
--                                           server only ever sees the office's public address, and a wide range would
--                                           let in half the internet. The Work schedule tab suggests the addresses the
--                                           company's scanners call from.
--   attendance_settings.office_radius_m     how near a branch counts as "at the office": 300 m by default, 25 to 5000.
--   branches.latitude, longitude            where a branch is (optional; both or neither). Set on the Work schedule tab
--                                           (attendance_set_branch_location: HR, or Settings), or by whoever may change
--                                           branches.
--   employees.work_arrangement              'on_site' (the default: follows the policy), 'hybrid' (from anywhere on
--                                           remote_days, the policy on other days), 'remote' (from anywhere, any day) or
--                                           'field' (from anywhere, any day; the location is recorded, and a clock-in
--                                           without one is still taken and noted "No location"). Only HR
--                                           (manages_attendance) changes it; anyone else's change is refused.
--   employees.remote_days                   a hybrid person's remote weekdays (ISO, 1 = Monday); empty otherwise.
--   attendance_logs.place, place_detail     where an app clock-in was made: 'office' (detail "Office network" or "Near
--                                           Nairobi (120 m)"), 'remote' ("Remote day" for a hybrid person's remote day)
--                                           or 'field' ("No location" when there was none). Null for scanner and HR
--                                           days, and for an app clock-in under 'anywhere' when the company has listed
--                                           no office network or branch location (the app can't tell where it was).
--
-- The rule, enforced in the database for every app clock-in and clock-out (attendance_clock_check):
--   remote, field, or hybrid on a remote day    allowed from anywhere
--   otherwise, the company's policy:
--     anywhere        allowed (tagged office when on an office network or near a branch, else remote)
--     office          allowed on an office network or near a branch; otherwise refused: "Turn on location to clock in
--                     on site" (no location, and branches have locations), "Clock in from the office, or ask HR. You're
--                     2.4 km from Nairobi." or "Clock in from the office, or ask HR"
--     scanner_only    refused: "Clock in at the office scanner"
-- Clock-out: the same rule, so a clock-out can't be made from somewhere a clock-in couldn't; but nobody who clocked in
-- legitimately is stranded: a day clocked in in the app from away (place remote or field) can always be clocked out,
-- and a day clocked in in the app at the office before the company switched to scanner only can be clocked out from
-- the office. HR corrections (attendance_set_day) and scanner punches don't go through this at all.
--
-- The office network: the browser calls Supabase directly, so the database never sees the person's IP address. The
-- app's Clock in goes through the backend instead (POST /api/attendance/clock, attendance_routes.js), which checks the
-- person's sign-in and passes the address the request came from, as Vercel's edge saw it, to
-- attendance_clock_for_user (service_role only). attendance_clock_in / attendance_clock_out, still callable from the
-- browser, check with no address at all: only the branch-location route (or anywhere) lets them through. An address
-- sent by the browser is never believed.
--
-- The days (attendance_days_for / attendance_days) gain: the schedule's end_time, clock_out_via (where the clock-out
-- came from: 'scanner' when it is a scanner punch, 'app', 'hr'), and the place, its detail and the clock-in location,
-- so HR sees "App · office" and a scanner's last scan before the end of the day can show as "Last scan", not a clock-out.
-- attendance_today_for adds the same for the portal card. 20261023900000's attendance_days_for otherwise unchanged.
--
-- An app Clock out after the scanner's latest scan moves the clock-out to the later time (the person pressed it).
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the company's policy
-- ---------------------------------------------------------------------------------------------
alter table public.attendance_settings add column if not exists clock_in_policy text not null default 'anywhere';
alter table public.attendance_settings add column if not exists office_networks text[] not null default '{}';
alter table public.attendance_settings add column if not exists office_radius_m integer not null default 300;
alter table public.attendance_settings drop constraint if exists attendance_settings_clock_in_policy_check;
alter table public.attendance_settings add constraint attendance_settings_clock_in_policy_check
  check (clock_in_policy in ('anywhere', 'office', 'scanner_only'));
alter table public.attendance_settings drop constraint if exists attendance_settings_office_radius_check;
alter table public.attendance_settings add constraint attendance_settings_office_radius_check
  check (office_radius_m between 25 and 5000);
alter table public.attendance_settings drop constraint if exists attendance_settings_office_networks_check;
alter table public.attendance_settings add constraint attendance_settings_office_networks_check
  check (cardinality(office_networks) <= 50);

-- is this address or range private (never what the server sees for an office)?
create or replace function public.attendance_private_inet(p inet) returns boolean
language sql immutable as $$
  select p <<= '10.0.0.0/8'::inet or p <<= '172.16.0.0/12'::inet or p <<= '192.168.0.0/16'::inet
      or p <<= '127.0.0.0/8'::inet or p <<= '169.254.0.0/16'::inet or p <<= '100.64.0.0/10'::inet
      or (family(p) = 6 and (p <<= 'fc00::/7'::inet or p <<= 'fe80::/10'::inet or p <<= '::1/128'::inet))
$$;

-- the office networks, tidied and checked
create or replace function public.attendance_settings_clock_policy() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_raw text;
  v_ip inet;
  v_txt text;
  v_out text[] := '{}';
begin
  foreach v_raw in array coalesce(new.office_networks, '{}'::text[]) loop
    continue when v_raw is null or btrim(v_raw) = '';
    v_ip := public.attendance_scanner_inet(v_raw);
    if v_ip is null then
      raise exception '"%" isn''t an IP address or range', btrim(v_raw) using errcode = '22023';
    end if;
    -- a range as its network: 41.90.12.7/24 -> 41.90.12.0/24
    v_ip := network(v_ip)::inet;
    if public.attendance_private_inet(v_ip) then
      raise exception '% is a private address: list the office''s public address (the one its scanners call from)', v_ip
        using errcode = '22023';
    end if;
    if (family(v_ip) = 4 and masklen(v_ip) < 16) or (family(v_ip) = 6 and masklen(v_ip) < 48) then
      raise exception '% is too wide a range for an office', v_ip using errcode = '22023';
    end if;
    -- one address as "41.90.12.7", a range as "41.90.12.0/24"
    v_txt := case when masklen(v_ip) = case when family(v_ip) = 4 then 32 else 128 end then host(v_ip) else text(network(v_ip)) end;
    if not (v_txt = any (v_out)) then
      v_out := v_out || v_txt;
    end if;
  end loop;
  new.office_networks := v_out;
  new.clock_in_policy := coalesce(new.clock_in_policy, 'anywhere');
  new.office_radius_m := coalesce(new.office_radius_m, 300);
  return new;
end $$;
revoke all on function public.attendance_settings_clock_policy() from public, anon, authenticated;
drop trigger if exists attendance_settings_clock_policy on public.attendance_settings;
create trigger attendance_settings_clock_policy before insert or update on public.attendance_settings
  for each row execute function public.attendance_settings_clock_policy();

-- ---------------------------------------------------------------------------------------------
-- 2. where each branch is
-- ---------------------------------------------------------------------------------------------
alter table public.branches add column if not exists latitude double precision;
alter table public.branches add column if not exists longitude double precision;
alter table public.branches drop constraint if exists branches_location_check;
alter table public.branches add constraint branches_location_check check (
  (latitude is null and longitude is null)
  or (latitude between -90 and 90 and longitude between -180 and 180));

-- HR (or Settings) sets a branch's location for clocking in; both null clears it
create or replace function public.attendance_set_branch_location(p_branch uuid, p_latitude double precision, p_longitude double precision)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not (public.manages_attendance() or coalesce(public.has_module('settings'), false)) then
    raise exception 'Only HR can set where a branch is' using errcode = '42501';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Enter a latitude from -90 to 90 and a longitude from -180 to 180' using errcode = '22023';
  end if;
  update public.branches set latitude = p_latitude, longitude = p_longitude
  where id = p_branch and tenant_id = v_tenant;
  if not found then
    raise exception 'Unknown branch' using errcode = '23503';
  end if;
end $$;
revoke all on function public.attendance_set_branch_location(uuid, double precision, double precision) from public, anon;
grant execute on function public.attendance_set_branch_location(uuid, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. each person's work arrangement
-- ---------------------------------------------------------------------------------------------
alter table public.employees add column if not exists work_arrangement text not null default 'on_site';
alter table public.employees add column if not exists remote_days smallint[] not null default '{}';
alter table public.employees drop constraint if exists employees_work_arrangement_check;
alter table public.employees add constraint employees_work_arrangement_check
  check (work_arrangement in ('on_site', 'hybrid', 'remote', 'field'));
alter table public.employees drop constraint if exists employees_remote_days_check;
alter table public.employees add constraint employees_remote_days_check
  check (remote_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]);

create or replace function public.employees_work_arrangement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.work_arrangement := coalesce(nullif(lower(btrim(new.work_arrangement)), ''), 'on_site');
  if new.work_arrangement = 'hybrid' then
    select coalesce(array_agg(distinct d order by d), '{}') into new.remote_days
    from unnest(coalesce(new.remote_days, '{}'::smallint[])) d where d is not null;
  else
    new.remote_days := '{}';
  end if;

  -- only HR sets it: a new record from anyone else starts on site; anyone else's change is refused
  if auth.uid() is not null and not public.manages_attendance() then
    if tg_op = 'INSERT' then
      new.work_arrangement := 'on_site';
      new.remote_days := '{}';
    elsif new.work_arrangement is distinct from old.work_arrangement or new.remote_days is distinct from old.remote_days then
      raise exception 'Only HR can change a work arrangement' using errcode = '42501';
    end if;
  end if;

  if new.work_arrangement = 'hybrid' and cardinality(new.remote_days) = 0 then
    raise exception 'Choose the days a hybrid arrangement works remotely' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.employees_work_arrangement() from public, anon, authenticated;
drop trigger if exists employees_work_arrangement on public.employees;
create trigger employees_work_arrangement before insert or update on public.employees
  for each row execute function public.employees_work_arrangement();

-- ---------------------------------------------------------------------------------------------
-- 4. where each app clock-in was made
-- ---------------------------------------------------------------------------------------------
alter table public.attendance_logs add column if not exists place text;
alter table public.attendance_logs add column if not exists place_detail text;
alter table public.attendance_logs drop constraint if exists attendance_logs_place_check;
alter table public.attendance_logs add constraint attendance_logs_place_check
  check ((place is null or place in ('office', 'remote', 'field')) and (place_detail is null or length(place_detail) <= 200));

-- ---------------------------------------------------------------------------------------------
-- 5. the rule
-- ---------------------------------------------------------------------------------------------
-- metres between two points (haversine)
create or replace function public.attendance_distance_m(lat1 double precision, lon1 double precision,
                                                        lat2 double precision, lon2 double precision)
returns double precision
language sql immutable as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2))))
$$;

-- "450 m", "2.4 km"
create or replace function public.attendance_distance_label(p double precision) returns text
language sql immutable as $$
  select case when p < 1000 then format('%s m', round(p)::int) else format('%s km', to_char(p / 1000.0, 'FM9999990.0')) end
$$;

-- the latitude, longitude and accuracy (metres) of a location the app sent; nulls when it isn't one
create or replace function public.attendance_location_point(p jsonb,
  out latitude double precision, out longitude double precision, out accuracy double precision)
language plpgsql immutable as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'latitude') <> 'number'
     or jsonb_typeof(p -> 'longitude') <> 'number' then
    return;
  end if;
  if (p ->> 'latitude')::double precision not between -90 and 90
     or (p ->> 'longitude')::double precision not between -180 and 180 then
    return;
  end if;
  latitude := (p ->> 'latitude')::double precision;
  longitude := (p ->> 'longitude')::double precision;
  accuracy := case when jsonb_typeof(p -> 'accuracy') = 'number' then greatest(0, (p ->> 'accuracy')::double precision) end;
end $$;

-- May this employee clock in ('in') or out ('out') in the app at p_at, from p_location and the address p_ip (null:
-- not known)? {ok, place, detail, message}. For the system; people go through the functions below.
create or replace function public.attendance_clock_check(
  p_tenant uuid, p_employee text, p_kind text, p_location jsonb, p_ip text, p_at timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := (p_at at time zone 'Africa/Nairobi')::date;
  v_dow smallint := extract(isodow from (p_at at time zone 'Africa/Nairobi'))::smallint;
  v_policy text;
  v_networks text[];
  v_radius integer;
  v_arr text;
  v_remote smallint[];
  v_ip inet := public.attendance_scanner_inet(p_ip);
  v_pt record;
  v_has_loc boolean;
  v_net_ok boolean := false;
  v_near_name text;
  v_near_m double precision;
  v_any_coords boolean;
  v_office boolean;
  v_office_detail text;
  v_verb text := case when p_kind = 'out' then 'Clock out' else 'Clock in' end;
  r public.attendance_logs;
begin
  if p_kind not in ('in', 'out') then
    raise exception 'Unknown clock action' using errcode = '22023';
  end if;
  select s.clock_in_policy, s.office_networks, s.office_radius_m into v_policy, v_networks, v_radius
  from public.attendance_settings s where s.tenant_id = p_tenant;
  v_policy := coalesce(v_policy, 'anywhere');
  v_networks := coalesce(v_networks, '{}');
  v_radius := coalesce(v_radius, 300);
  select e.work_arrangement, e.remote_days into v_arr, v_remote
  from public.employees e where e.tenant_id = p_tenant and e."Employee Number" = p_employee limit 1;
  v_arr := coalesce(v_arr, 'on_site');
  v_remote := coalesce(v_remote, '{}');

  select * into v_pt from public.attendance_location_point(p_location);
  v_has_loc := v_pt.latitude is not null;

  -- at the office: on one of its networks, or near one of its branches
  if v_ip is not null then
    v_net_ok := exists (select 1 from unnest(v_networks) n where v_ip <<= n::inet);
  end if;
  v_any_coords := exists (select 1 from public.branches b
                          where b.tenant_id = p_tenant and b.active and b.latitude is not null);
  if v_has_loc and v_any_coords then
    select b.name, public.attendance_distance_m(v_pt.latitude, v_pt.longitude, b.latitude, b.longitude)
      into v_near_name, v_near_m
    from public.branches b
    where b.tenant_id = p_tenant and b.active and b.latitude is not null
    order by public.attendance_distance_m(v_pt.latitude, v_pt.longitude, b.latitude, b.longitude)
    limit 1;
  end if;
  v_office := v_net_ok
    or (v_near_m is not null and v_near_m <= v_radius + least(coalesce(v_pt.accuracy, 0), 100));
  v_office_detail := case
    when v_net_ok then 'Office network'
    when v_office then format('Near %s (%s)', v_near_name, public.attendance_distance_label(v_near_m))
  end;

  if p_kind = 'out' then
    select * into r from public.attendance_logs a
    where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source <> 'legacy';
    -- clocked in in the app from away: clocks out from anywhere
    if r.place in ('remote', 'field') then
      return jsonb_build_object('ok', true, 'place', r.place, 'detail', null, 'message', null);
    end if;
    -- clocked in in the app (at the office) before the company went scanner only: clocks out from the office
    if v_policy = 'scanner_only' and r.source = 'app' then
      v_policy := 'office';
    end if;
  end if;

  -- the person's arrangement first
  if v_arr = 'remote' then
    return jsonb_build_object('ok', true, 'place', 'remote', 'detail', null, 'message', null);
  end if;
  if v_arr = 'field' then
    return jsonb_build_object('ok', true, 'place', 'field', 'detail', case when v_has_loc then null else 'No location' end, 'message', null);
  end if;
  if v_arr = 'hybrid' and v_dow = any (v_remote) then
    return jsonb_build_object('ok', true, 'place', 'remote', 'detail', 'Remote day', 'message', null);
  end if;

  -- then the company's policy
  if v_policy = 'anywhere' then
    return jsonb_build_object('ok', true,
      'place', case when v_office then 'office' when cardinality(v_networks) > 0 or v_any_coords then 'remote' end,
      'detail', v_office_detail, 'message', null);
  end if;
  if v_policy = 'office' then
    if v_office then
      return jsonb_build_object('ok', true, 'place', 'office', 'detail', v_office_detail, 'message', null);
    end if;
    return jsonb_build_object('ok', false, 'place', null, 'detail', null, 'message', case
      when not v_has_loc and v_any_coords then format('Turn on location to %s on site', lower(v_verb))
      when v_near_m is not null then format('%s from the office, or ask HR. You''re %s from %s.', v_verb,
                                            public.attendance_distance_label(v_near_m), v_near_name)
      else format('%s from the office, or ask HR', v_verb)
    end);
  end if;
  -- scanner only
  return jsonb_build_object('ok', false, 'place', null, 'detail', null,
    'message', format('%s at the office scanner', v_verb));
end $$;
revoke all on function public.attendance_clock_check(uuid, text, text, jsonb, text, timestamptz) from public, anon, authenticated;

-- An app clock-in or clock-out: the rule, then attendance_punch, then where it was made. Refusals carry the hint
-- 'clock_policy' (the backend answers them with 403). For the system and tests.
create or replace function public.attendance_app_punch(
  p_tenant uuid, p_employee text, p_kind text, p_location jsonb, p_ip text, p_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := public.attendance_clock_check(p_tenant, p_employee, p_kind, p_location, p_ip, p_at);
  v_day date := (p_at at time zone 'Africa/Nairobi')::date;
  v_loc jsonb := public.attendance_location(p_location);
  r public.attendance_logs;
begin
  if not coalesce((v ->> 'ok')::boolean, false) then
    raise exception '%', v ->> 'message' using errcode = 'P0001', hint = 'clock_policy';
  end if;

  if p_kind = 'out' then
    -- the person presses Clock out after the scanner's latest scan: their clock-out, at the later time
    select * into r from public.attendance_logs a
    where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source <> 'legacy'
    for update;
    if r.id is not null and r.source <> 'hr' and r.logout_time is not null and p_at > r.logout_time
       and exists (select 1 from public.attendance_scanner_punches x
                   where x.tenant_id = p_tenant and x.employee_number = p_employee and x.punched_at = r.logout_time
                     and x.applied_at is not null and x.skipped_reason is null) then
      update public.attendance_logs
      set logout_time = p_at, status = 'clocked_out',
          geolocation = case when v_loc is not null then coalesce(geolocation, '{}'::jsonb) || jsonb_build_object('out', v_loc) else geolocation end
      where id = r.id;
      return public.attendance_today_for(p_tenant, p_employee, p_at);
    end if;
  end if;

  perform public.attendance_punch(p_tenant, p_employee, p_kind, p_location, p_at);
  if p_kind = 'in' then
    -- only when this punch made the clock-in (not a clock-in again after clocking out, or a scanner's day)
    update public.attendance_logs a
    set place = v ->> 'place', place_detail = v ->> 'detail'
    where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source = 'app'
      and a.login_time = p_at;
  end if;
  return public.attendance_today_for(p_tenant, p_employee, p_at);
end $$;
revoke all on function public.attendance_app_punch(uuid, text, text, jsonb, text, timestamptz) from public, anon, authenticated;

-- (20261023300000's, through the rule; the browser's call has no address: only the branch-location route or anywhere)
create or replace function public.attendance_clock_in(p_location jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me record;
begin
  select * into me from public.attendance_me();
  return public.attendance_app_punch(me.tenant_id, me.employee_number, 'in', p_location, null, now());
end $$;
revoke all on function public.attendance_clock_in(jsonb) from public, anon;
grant execute on function public.attendance_clock_in(jsonb) to authenticated;

create or replace function public.attendance_clock_out(p_location jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me record;
begin
  select * into me from public.attendance_me();
  return public.attendance_app_punch(me.tenant_id, me.employee_number, 'out', p_location, null, now());
end $$;
revoke all on function public.attendance_clock_out(jsonb) from public, anon;
grant execute on function public.attendance_clock_out(jsonb) to authenticated;

-- The backend's clock (attendance_routes.js): p_user's sign-in was checked there, p_ip is the address the request came
-- from as Vercel saw it. The company and employee are p_user's, exactly as current_tenant_id() and
-- current_employee_number() find them. service_role only.
create or replace function public.attendance_clock_for_user(p_user uuid, p_kind text, p_location jsonb, p_ip text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_emp text;
begin
  select p.tenant_id into v_tenant
  from public.user_profiles p join public.tenants t on t.id = p.tenant_id
  where p.user_id = p_user and t.status = 'active';
  if p_user is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select e."Employee Number" into v_emp
  from public.employees e join auth.users u on u.id = p_user
  where e.tenant_id = v_tenant and e."Work Email" = u.email
  limit 1;
  if v_emp is null then
    raise exception 'Your account isn''t linked to an employee record, so attendance can''t be recorded. Please contact HR.'
      using errcode = '42501';
  end if;
  if p_kind not in ('in', 'out') then
    raise exception 'Unknown clock action' using errcode = '22023';
  end if;
  return public.attendance_app_punch(v_tenant, v_emp, p_kind, p_location, p_ip, now());
end $$;
revoke all on function public.attendance_clock_for_user(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.attendance_clock_for_user(uuid, text, jsonb, text) to service_role;

-- What the portal card should offer the signed-in person today: mode 'anywhere' (clock in from anywhere), 'office'
-- (from the office) or 'scanner' (at the scanner); wants_location: their location decides it (field, or near a branch).
create or replace function public.attendance_my_clock_rules() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me record;
  v_policy text;
  v_arr text;
  v_remote smallint[];
  v_dow smallint := extract(isodow from (now() at time zone 'Africa/Nairobi'))::smallint;
  v_away boolean;
  v_coords boolean;
begin
  select * into me from public.attendance_me();
  select coalesce((select s.clock_in_policy from public.attendance_settings s where s.tenant_id = me.tenant_id), 'anywhere')
    into v_policy;
  select e.work_arrangement, e.remote_days into v_arr, v_remote
  from public.employees e where e.tenant_id = me.tenant_id and e."Employee Number" = me.employee_number limit 1;
  v_arr := coalesce(v_arr, 'on_site');
  v_away := v_arr in ('remote', 'field') or (v_arr = 'hybrid' and v_dow = any (coalesce(v_remote, '{}')));
  v_coords := exists (select 1 from public.branches b where b.tenant_id = me.tenant_id and b.active and b.latitude is not null);
  return jsonb_build_object(
    'policy', v_policy,
    'arrangement', v_arr,
    'remote_days', to_jsonb(coalesce(v_remote, '{}')),
    'mode', case when v_away or v_policy = 'anywhere' then 'anywhere' when v_policy = 'office' then 'office' else 'scanner' end,
    'wants_location', v_arr = 'field' or (not v_away and v_policy = 'office' and v_coords));
end $$;
revoke all on function public.attendance_my_clock_rules() from public, anon;
grant execute on function public.attendance_my_clock_rules() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. the days: the end time, where the clock-out came from, and the place
-- ---------------------------------------------------------------------------------------------
-- (20261023900000's, plus end_time, clock_out_via, place, place_detail and place_location as new last columns, so it
-- is dropped and created again with the same grants)
drop function if exists public.attendance_days_for(uuid, date, date, text, date);
create function public.attendance_days_for(
  p_tenant uuid, p_from date, p_to date, p_employee text default null, p_today date default null
) returns table (
  employee_number text, day date, status text, clock_in timestamptz, clock_out timestamptz, hours numeric,
  late_minutes integer, source text, note text, flag text, counted boolean,
  end_time time, clock_out_via text, place text, place_detail text, place_location jsonb
)
language sql stable security definer set search_path = public as $$
  with people as (
    select e."Employee Number" as emp,
           public.employee_start_date(e."Start Date") as hired,
           public.employee_start_date(e."Termination Date") as left_on,
           public.employee_country(p_tenant, e."Employee Number") as country,
           s.work_days, s.start_time, s.end_time, s.grace_minutes
    from public.employees e
    cross join lateral public.work_schedule_for(p_tenant, e."Employee Number") s
    where e.tenant_id = p_tenant
      and (p_employee is null or e."Employee Number" = p_employee)
      and coalesce(e.worker_kind, 'employee') <> 'casual'
      -- still here, or left during (or after) the range
      and (lower(coalesce(e."Status", 'active')) not in ('terminated', 'inactive')
           or public.employee_start_date(e."Termination Date") >= p_from)
  ),
  days as (
    select g::date as day from generate_series(p_from, p_to, interval '1 day') g
  ),
  counting as (
    select public.attendance_tracking_from(p_tenant) as from_day
  ),
  grid as (
    select p.*, d.day,
           (extract(isodow from d.day)::smallint = any (p.work_days)) as working,
           public.is_holiday(p_tenant, p.country, d.day) as holiday,
           exists (
             select 1 from public.leave_application l
             where l.tenant_id = p_tenant and l."Employee Number" = p.emp
               and lower(coalesce(l.status, '')) = 'approved'
               and public.leave_parse_date(l."Start Date") <= d.day
               and public.leave_parse_date(l."End Date") >= d.day
           ) as on_leave,
           a.login_time, a.logout_time, a.source, a.note, a.flag,
           a.place as a_place, a.place_detail as a_place_detail, a.geolocation -> 'in' as a_location,
           case
             when a.logout_time is null then null
             when a.source = 'hr' then 'hr'
             when exists (
               select 1 from public.attendance_scanner_punches x
               where x.tenant_id = p_tenant and x.employee_number = p.emp and x.punched_at = a.logout_time
                 and x.applied_at is not null and x.skipped_reason is null) then 'scanner'
             else 'app'
           end as out_via,
           date_trunc('minute', a.login_time at time zone 'Africa/Nairobi') as in_local
    from people p
    cross join days d
    left join public.attendance_logs a
      on a.tenant_id = p_tenant and a.employee_number = p.emp and a.work_date = d.day and a.source <> 'legacy'
    where (p.hired is null or d.day >= p.hired)
      and (p.left_on is null or d.day <= p.left_on)
  )
  select g.emp,
         g.day,
         case
           -- before attendance counts: nothing (not off, holiday, leave, present, late or absent)
           when not g.counted then null
           when not g.working then 'off'
           when g.holiday then 'holiday'
           when g.on_leave then 'leave'
           when g.login_time is not null then
             case when g.in_local > g.day + g.start_time + make_interval(mins => g.grace_minutes) then 'late' else 'present' end
           when g.day < coalesce(p_today, (now() at time zone 'Africa/Nairobi')::date) then 'absent'
           else null
         end,
         g.login_time,
         g.logout_time,
         case when g.login_time is not null and g.logout_time is not null
              then round((extract(epoch from (g.logout_time - g.login_time)) / 3600.0)::numeric, 2) end,
         case
           when g.login_time is null or not g.counted then null
           when g.working and not g.holiday and not g.on_leave
                and g.in_local > g.day + g.start_time + make_interval(mins => g.grace_minutes)
             -- minutes after the late mark (start + grace): 8:39 with an 8:00 start and 30 minutes' grace is 9
             then (extract(epoch from (g.in_local - (g.day + g.start_time + make_interval(mins => g.grace_minutes)))) / 60)::integer
           else 0
         end,
         g.source,
         g.note,
         case when g.counted then g.flag end,
         g.counted,
         g.end_time,
         g.out_via,
         case when g.source = 'app' then g.a_place end,
         case when g.source = 'app' then g.a_place_detail end,
         case when g.source = 'app' then g.a_location end
  from (select x.*, (c.from_day is null or x.day >= c.from_day) as counted from grid x cross join counting c) g
  order by g.emp, g.day
$$;
revoke all on function public.attendance_days_for(uuid, date, date, text, date) from public, anon, authenticated;

-- (20261023800000's, plus the new columns)
drop function if exists public.attendance_days(date, date, text);
create function public.attendance_days(p_from date, p_to date, p_employee text default null)
returns table (
  employee_number text, day date, status text, clock_in timestamptz, clock_out timestamptz, hours numeric,
  late_minutes integer, source text, note text, flag text, counted boolean,
  end_time time, clock_out_via text, place text, place_detail text, place_location jsonb
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_all boolean := true;
  v_me text;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a start date on or before the end date' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Choose a range of a year or less' using errcode = '22023';
  end if;
  if auth.uid() is not null then
    if v_tenant is null then
      raise exception 'Sign in first' using errcode = '42501';
    end if;
    v_all := public.sees_attendance();
    if not v_all then
      v_me := public.current_employee_number();
      if p_employee is not null and p_employee is distinct from v_me
         and p_employee not in (select public.supervised_employee_numbers()) then
        raise exception 'You can see your own attendance and your team''s only' using errcode = '42501';
      end if;
    end if;
  end if;
  return query
    select d.employee_number, d.day, d.status, d.clock_in, d.clock_out, d.hours, d.late_minutes, d.source, d.note, d.flag, d.counted,
           d.end_time, d.clock_out_via, d.place, d.place_detail, d.place_location
    from public.attendance_days_for(v_tenant, p_from, p_to, p_employee, null) d
    where v_all
       or d.employee_number = v_me
       or d.employee_number in (select public.supervised_employee_numbers());
end $$;
revoke all on function public.attendance_days(date, date, text) from public, anon;
grant execute on function public.attendance_days(date, date, text) to authenticated, service_role;

-- (20261023300000's, plus where the clock-out came from and the place)
create or replace function public.attendance_today_for(p_tenant uuid, p_employee text, p_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := (p_at at time zone 'Africa/Nairobi')::date;
  s record;
  d record;
  r public.attendance_logs;
begin
  select * into s from public.work_schedule_for(p_tenant, p_employee);
  select * into d from public.attendance_days_for(p_tenant, v_day, v_day, p_employee, v_day);
  select * into r from public.attendance_logs a
  where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source <> 'legacy';
  return jsonb_build_object(
    'date', v_day,
    'employee_number', p_employee,
    'status', d.status,
    'clock_in', r.login_time,
    'clock_out', r.logout_time,
    'clock_out_via', d.clock_out_via,
    'late_minutes', d.late_minutes,
    'source', r.source,
    'place', d.place,
    'place_detail', d.place_detail,
    'note', r.note,
    'working_day', extract(isodow from v_day)::smallint = any (s.work_days),
    'work_days', to_jsonb(s.work_days),
    'start_time', to_char(s.start_time, 'HH24:MI'),
    'end_time', to_char(s.end_time, 'HH24:MI'),
    'grace_minutes', s.grace_minutes,
    'late_after', to_char(s.start_time + make_interval(mins => s.grace_minutes), 'HH24:MI'));
end $$;
revoke all on function public.attendance_today_for(uuid, text, timestamptz) from public, anon, authenticated;

notify pgrst, 'reload schema';
