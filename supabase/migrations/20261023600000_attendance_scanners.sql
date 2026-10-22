-- Door scanners: fingerprint terminals that send attendance by themselves (biometric attendance, after FIG-986).
--
-- A ZKTeco terminal on the office network uses ZKTeco's push protocol ("ADMS" / "iclock"): it calls this app over HTTP
-- (/iclock/..., iclock_routes.js) with its serial number, says hello, checks in every few seconds and uploads each
-- fingerprint punch. Any company can register its own scanners:
--
--   attendance_devices                 a company's scanners: a name, the serial number (unique across all companies,
--                                      kept trimmed and in capitals), the brand ('zkteco'), an optional office IP lock
--                                      (allowed_ip: one address or a range like 41.90.12.0/24; the scanner is refused
--                                      from anywhere else), active, and what the app saw last (last_seen_at, last_ip,
--                                      last_error). HR (manages_attendance) adds, changes and switches them off; the
--                                      people who see attendance (sees_attendance) read them.
--   attendance_scanner_users           which employee each scanner user ID (the "PIN" the scanner knows them by) is. One
--                                      list per company, not per scanner: ZKTeco setups with several scanners share
--                                      the same IDs. Saving one applies that ID's punches that weren't matched yet;
--                                      removing one doesn't undo attendance already recorded.
--   attendance_scanner_punches         every punch received: which scanner, the scanner user ID, when (the scanner's
--                                      clock is Africa/Nairobi time, like the rest of the app), the employee when
--                                      matched, when it was applied to attendance_logs, or why not (skipped_reason
--                                      'hr_corrected'). The same punch sent again is ignored. Punches before the
--                                      company's attendance_tracking_from (20261023400000) aren't stored at all: a
--                                      scanner uploads its whole history (thousands of punches) the first time it
--                                      connects, and only the days attendance counts from matter.
--   attendance_scanner_unregistered    serial numbers that called in without being registered (the serial, the IP and
--                                      when; never what they sent), so HR can check "has my scanner tried to
--                                      connect?" with attendance_scanner_tried(serial). Nobody can list them.
--
-- How a punch becomes attendance (one attendance_logs record per employee per Nairobi day):
--   no record yet          the punch is the clock-in (source 'scanner')
--   'app' or 'scanner'     clock-in = the earliest of the record's and the punch; clock-out = the latest scanner punch
--                          after the clock-in (an earlier clock-out from the app is kept when it is later)
--   'hr'                   HR corrected the day: left alone, the punch marked skipped_reason 'hr_corrected'
--
-- For the receiver only (service_role): attendance_scanner_receive(serial, ip, lines) stores and applies an upload,
-- attendance_scanner_seen(serial, ip) records a check-in. An unknown serial, a switched-off scanner, or one calling from
-- outside its IP lock stores nothing.
--
-- Written to run again safely (if not exists / or replace / drop ... if exists).

-- ---------------------------------------------------------------------------------------------
-- 1. small helpers
-- ---------------------------------------------------------------------------------------------
-- a serial number as stored: trimmed, in capitals
create or replace function public.attendance_scanner_serial(p text) returns text
language sql immutable as $$
  select nullif(upper(btrim(coalesce(p, ''))), '')
$$;

-- what a scanner serial number looks like (letters, digits, - and _), so junk is never stored
create or replace function public.attendance_scanner_serial_ok(p text) returns boolean
language sql immutable as $$
  select coalesce(p ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$', false)
$$;

-- a scanner user ID (PIN): letters and digits, up to 24
create or replace function public.attendance_scanner_pin_ok(p text) returns boolean
language sql immutable as $$
  select coalesce(p ~ '^[A-Za-z0-9]{1,24}$', false)
$$;

-- "YYYY-MM-DD HH:MM[:SS]" on the scanner's clock (Africa/Nairobi) as a moment; null when it isn't a real time
create or replace function public.attendance_scanner_time(p text) returns timestamptz
language plpgsql stable as $$
declare
  m text[] := regexp_match(btrim(coalesce(p, '')), '^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$');
  y integer;
  mo integer;
  d integer;
begin
  if m is null then
    return null;
  end if;
  y := m[1]::integer;
  mo := m[2]::integer;
  d := m[3]::integer;
  if y not between 2000 and 2100 or mo not between 1 and 12 or m[4]::integer > 23 or m[5]::integer > 59
     or coalesce(m[6], '0')::integer > 59 then
    return null;
  end if;
  if d < 1 or d > extract(day from (make_date(y, mo, 1) + interval '1 month - 1 day'))::integer then
    return null;
  end if;
  return make_timestamptz(y, mo, d, m[4]::integer, m[5]::integer, coalesce(m[6], '0')::integer, 'Africa/Nairobi');
end $$;

-- an IP address (or range) as Postgres reads it; null when it isn't one
create or replace function public.attendance_scanner_inet(p text) returns inet
language plpgsql immutable as $$
begin
  if p is null or btrim(p) = '' or length(p) > 64 then
    return null;
  end if;
  return btrim(p)::inet;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. the scanners
-- ---------------------------------------------------------------------------------------------
create table if not exists public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  serial_number text not null,
  brand text not null default 'zkteco',
  allowed_ip text,
  active boolean not null default true,
  last_seen_at timestamptz,
  last_ip text,
  last_error text,
  last_error_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.attendance_devices drop constraint if exists attendance_devices_name_check;
alter table public.attendance_devices add constraint attendance_devices_name_check check (length(name) between 1 and 80);
alter table public.attendance_devices drop constraint if exists attendance_devices_serial_check;
alter table public.attendance_devices add constraint attendance_devices_serial_check
  check (public.attendance_scanner_serial_ok(serial_number));
alter table public.attendance_devices drop constraint if exists attendance_devices_brand_check;
alter table public.attendance_devices add constraint attendance_devices_brand_check check (brand in ('zkteco'));
-- one company per scanner
create unique index if not exists attendance_devices_serial_key on public.attendance_devices (serial_number);
create index if not exists attendance_devices_tenant_idx on public.attendance_devices (tenant_id);

create or replace function public.attendance_devices_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ip inet;
begin
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.name := btrim(coalesce(new.name, ''));
  if new.name = '' then
    raise exception 'Give the scanner a name, like "Front door"' using errcode = '23514';
  end if;
  new.serial_number := public.attendance_scanner_serial(new.serial_number);
  if not public.attendance_scanner_serial_ok(new.serial_number) then
    raise exception 'Enter the serial number as it shows on the scanner (letters and digits)' using errcode = '23514';
  end if;
  new.allowed_ip := nullif(btrim(coalesce(new.allowed_ip, '')), '');
  if new.allowed_ip is not null then
    v_ip := public.attendance_scanner_inet(new.allowed_ip);
    if v_ip is null then
      raise exception 'Enter the office IP address like 41.90.12.34 (or leave it empty)' using errcode = '23514';
    end if;
    new.allowed_ip := v_ip::text;
  end if;
  -- a new serial hasn't been seen under this record yet
  if tg_op = 'UPDATE' and new.serial_number is distinct from old.serial_number then
    new.last_seen_at := null;
    new.last_ip := null;
    new.last_error := null;
    new.last_error_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.attendance_devices_rules() from public, anon, authenticated;
drop trigger if exists attendance_devices_rules on public.attendance_devices;
create trigger attendance_devices_rules before insert or update on public.attendance_devices
  for each row execute function public.attendance_devices_rules();

alter table public.attendance_devices enable row level security;
drop policy if exists tenant_isolation on public.attendance_devices;
create policy tenant_isolation on public.attendance_devices as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists hr_read on public.attendance_devices;
create policy hr_read on public.attendance_devices for select to authenticated
  using ((select public.sees_attendance()));
drop policy if exists hr_write on public.attendance_devices;
create policy hr_write on public.attendance_devices for all to authenticated
  using ((select public.manages_attendance()))
  with check ((select public.manages_attendance()));
-- people change the name, serial, IP lock and on/off; what the scanner last did is written by the receiver only
revoke all on public.attendance_devices from anon;
revoke insert, update, truncate on public.attendance_devices from authenticated;
grant select, delete on public.attendance_devices to authenticated;
grant insert (name, serial_number, brand, allowed_ip, active) on public.attendance_devices to authenticated;
grant update (name, serial_number, allowed_ip, active) on public.attendance_devices to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. serial numbers that called in without being registered
-- ---------------------------------------------------------------------------------------------
create table if not exists public.attendance_scanner_unregistered (
  serial_number text primary key,
  last_ip text,
  last_seen_at timestamptz not null default now()
);
alter table public.attendance_scanner_unregistered enable row level security;
revoke all on public.attendance_scanner_unregistered from public, anon, authenticated;

-- once registered, a serial is no longer "unregistered"
create or replace function public.attendance_devices_registered() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.attendance_scanner_unregistered u where u.serial_number = new.serial_number;
  return null;
end $$;
revoke all on function public.attendance_devices_registered() from public, anon, authenticated;
drop trigger if exists attendance_devices_registered on public.attendance_devices;
create trigger attendance_devices_registered after insert or update of serial_number on public.attendance_devices
  for each row execute function public.attendance_devices_registered();

-- HR typing a serial number: has a scanner with it called in without being registered (and when, last)? Only that
-- one serial is answered, never a list, so no company learns about another's scanners.
create or replace function public.attendance_scanner_tried(p_serial text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_serial text := public.attendance_scanner_serial(p_serial);
  v_at timestamptz;
begin
  if auth.uid() is null or public.current_tenant_id() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.manages_attendance() then
    raise exception 'Only HR can set up scanners' using errcode = '42501';
  end if;
  select u.last_seen_at into v_at from public.attendance_scanner_unregistered u where u.serial_number = v_serial;
  return jsonb_build_object('tried', v_at is not null, 'last_seen_at', v_at);
end $$;
revoke all on function public.attendance_scanner_tried(text) from public, anon;
grant execute on function public.attendance_scanner_tried(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. scanner user IDs -> employees
-- ---------------------------------------------------------------------------------------------
create table if not exists public.attendance_scanner_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  scanner_user_id text not null,
  employee_number text not null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists attendance_scanner_users_key on public.attendance_scanner_users (tenant_id, scanner_user_id);

create or replace function public.attendance_scanner_users_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
  end if;
  new.scanner_user_id := btrim(coalesce(new.scanner_user_id, ''));
  if not public.attendance_scanner_pin_ok(new.scanner_user_id) then
    raise exception 'Enter the scanner user ID as the scanner shows it (letters and digits)' using errcode = '23514';
  end if;
  new.employee_number := btrim(coalesce(new.employee_number, ''));
  if not exists (select 1 from public.employees e where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_number) then
    raise exception 'Unknown employee' using errcode = '23503';
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.attendance_scanner_users_rules() from public, anon, authenticated;
drop trigger if exists attendance_scanner_users_rules on public.attendance_scanner_users;
create trigger attendance_scanner_users_rules before insert or update on public.attendance_scanner_users
  for each row execute function public.attendance_scanner_users_rules();

alter table public.attendance_scanner_users enable row level security;
drop policy if exists tenant_isolation on public.attendance_scanner_users;
create policy tenant_isolation on public.attendance_scanner_users as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists hr_read on public.attendance_scanner_users;
create policy hr_read on public.attendance_scanner_users for select to authenticated
  using ((select public.sees_attendance()));
drop policy if exists hr_write on public.attendance_scanner_users;
create policy hr_write on public.attendance_scanner_users for all to authenticated
  using ((select public.manages_attendance()))
  with check ((select public.manages_attendance()));
revoke all on public.attendance_scanner_users from anon;
revoke truncate on public.attendance_scanner_users from authenticated;
grant select, insert, update, delete on public.attendance_scanner_users to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. the punches received
-- ---------------------------------------------------------------------------------------------
create table if not exists public.attendance_scanner_punches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  scanner_user_id text not null,
  punched_at timestamptz not null,
  -- what the scanner says the punch was (0 check in, 1 check out, ...) and how it was verified (1 fingerprint, ...);
  -- kept for reference, not used: the first punch of the day is the clock-in, the last the clock-out
  status smallint,
  verify smallint,
  received_at timestamptz not null default now(),
  employee_number text,
  applied_at timestamptz,
  skipped_reason text
);
alter table public.attendance_scanner_punches drop constraint if exists attendance_scanner_punches_skipped_check;
alter table public.attendance_scanner_punches add constraint attendance_scanner_punches_skipped_check
  check (skipped_reason is null or skipped_reason in ('hr_corrected'));
-- the same punch sent again is ignored
create unique index if not exists attendance_scanner_punches_once
  on public.attendance_scanner_punches (device_id, scanner_user_id, punched_at);
create index if not exists attendance_scanner_punches_waiting_idx
  on public.attendance_scanner_punches (tenant_id, scanner_user_id) where applied_at is null;
create index if not exists attendance_scanner_punches_emp_idx
  on public.attendance_scanner_punches (tenant_id, employee_number, punched_at);

alter table public.attendance_scanner_punches enable row level security;
drop policy if exists tenant_isolation on public.attendance_scanner_punches;
create policy tenant_isolation on public.attendance_scanner_punches as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists hr_read on public.attendance_scanner_punches;
create policy hr_read on public.attendance_scanner_punches for select to authenticated
  using ((select public.sees_attendance()));
-- written only by the receiver and the functions below
revoke all on public.attendance_scanner_punches from anon;
revoke insert, update, delete, truncate on public.attendance_scanner_punches from authenticated;
grant select on public.attendance_scanner_punches to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. applying a punch to attendance_logs
-- ---------------------------------------------------------------------------------------------
-- Applies one matched punch to its employee's day. True when attendance changed (or was confirmed); false when the
-- punch can't be applied (not matched, already applied, or HR corrected the day).
create or replace function public.attendance_scanner_apply(p_punch uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  p public.attendance_scanner_punches;
  r public.attendance_logs;
  v_day date;
  v_start timestamptz;
  v_in timestamptz;
  v_last timestamptz;
  v_out timestamptz;
begin
  select * into p from public.attendance_scanner_punches x where x.id = p_punch for update;
  if p.id is null or p.employee_number is null or p.applied_at is not null then
    return false;
  end if;
  v_day := (p.punched_at at time zone 'Africa/Nairobi')::date;
  v_start := v_day::timestamp at time zone 'Africa/Nairobi';

  -- the first punch of the day: the clock-in
  insert into public.attendance_logs (tenant_id, employee_number, work_date, login_time, status, source)
  values (p.tenant_id, p.employee_number, v_day, p.punched_at, 'clocked_in', 'scanner')
  on conflict (tenant_id, employee_number, work_date) where source <> 'legacy' do nothing
  returning * into r;
  if r.id is not null then
    update public.attendance_scanner_punches set applied_at = now(), skipped_reason = null where id = p.id;
    return true;
  end if;

  select * into r from public.attendance_logs a
  where a.tenant_id = p.tenant_id and a.employee_number = p.employee_number and a.work_date = v_day and a.source <> 'legacy'
  for update;
  if r.source = 'hr' then
    update public.attendance_scanner_punches set skipped_reason = 'hr_corrected' where id = p.id;
    return false;
  end if;

  v_in := least(coalesce(r.login_time, p.punched_at), p.punched_at);
  -- the clock-out: the latest of this employee's scanner punches that day after the clock-in
  select max(x.punched_at) into v_last
  from public.attendance_scanner_punches x
  where x.tenant_id = p.tenant_id and x.employee_number = p.employee_number
    and x.punched_at >= v_start and x.punched_at < v_start + interval '1 day'
    and (x.applied_at is not null or x.id = p.id)
    and x.punched_at > v_in;
  v_out := case when v_last is null then r.logout_time else greatest(coalesce(r.logout_time, v_last), v_last) end;
  update public.attendance_logs
  set login_time = v_in, logout_time = v_out, work_date = v_day,
      status = case when v_out is null then 'clocked_in' else 'clocked_out' end
  where id = r.id;
  update public.attendance_scanner_punches set applied_at = now(), skipped_reason = null where id = p.id;
  return true;
end $$;
revoke all on function public.attendance_scanner_apply(uuid) from public, anon, authenticated;

-- Applies every punch of one scanner user ID that wasn't matched yet, as the employee it now is. The number applied.
create or replace function public.attendance_scanner_apply_user(p_tenant uuid, p_scanner_user text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_emp text;
  v_id uuid;
  v_n integer := 0;
begin
  select m.employee_number into v_emp from public.attendance_scanner_users m
  where m.tenant_id = p_tenant and m.scanner_user_id = p_scanner_user;
  if v_emp is null then
    return 0;
  end if;
  update public.attendance_scanner_punches x set employee_number = v_emp
  where x.tenant_id = p_tenant and x.scanner_user_id = p_scanner_user and x.applied_at is null and x.skipped_reason is null;
  for v_id in
    select x.id from public.attendance_scanner_punches x
    where x.tenant_id = p_tenant and x.scanner_user_id = p_scanner_user and x.applied_at is null and x.skipped_reason is null
    order by x.punched_at
  loop
    if public.attendance_scanner_apply(v_id) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.attendance_scanner_apply_user(uuid, text) from public, anon, authenticated;

-- a scanner user ID matched (or changed) to an employee: their waiting punches become attendance
create or replace function public.attendance_scanner_users_matched() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.attendance_scanner_apply_user(new.tenant_id, new.scanner_user_id);
  return null;
end $$;
revoke all on function public.attendance_scanner_users_matched() from public, anon, authenticated;
drop trigger if exists attendance_scanner_users_matched on public.attendance_scanner_users;
create trigger attendance_scanner_users_matched after insert or update on public.attendance_scanner_users
  for each row execute function public.attendance_scanner_users_matched();

-- The scanner user IDs whose punches aren't matched to anyone yet, for the Scanners tab (what the person may read).
create or replace function public.attendance_scanner_unmatched()
returns table (scanner_user_id text, punches integer, first_at timestamptz, last_at timestamptz)
language sql stable set search_path = public as $$
  select x.scanner_user_id, count(*)::integer, min(x.punched_at), max(x.punched_at)
  from public.attendance_scanner_punches x
  where x.employee_number is null and x.applied_at is null and x.skipped_reason is null
    and not exists (
      select 1 from public.attendance_scanner_users m where m.tenant_id = x.tenant_id and m.scanner_user_id = x.scanner_user_id)
  group by x.scanner_user_id
  order by x.scanner_user_id
$$;
revoke all on function public.attendance_scanner_unmatched() from public, anon;
grant execute on function public.attendance_scanner_unmatched() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. the receiver (service_role only)
-- ---------------------------------------------------------------------------------------------
-- A scanner called in: the active scanner with this serial, after checking its IP lock, with when and from where it
-- was seen; null when the serial is unknown (remembered as unregistered), the scanner is switched off, or it called
-- from outside its IP lock (the reason kept in last_error).
create or replace function public.attendance_scanner_contact(p_serial text, p_ip text) returns public.attendance_devices
language plpgsql security definer set search_path = public as $$
declare
  v_serial text := public.attendance_scanner_serial(p_serial);
  v_ip text := left(nullif(btrim(coalesce(p_ip, '')), ''), 64);
  d public.attendance_devices;
begin
  if not public.attendance_scanner_serial_ok(v_serial) then
    return null;
  end if;
  select * into d from public.attendance_devices x where x.serial_number = v_serial;
  if d.id is null then
    -- only the serial, the address and when (written at most once a minute per serial); forgotten after 30 days
    insert into public.attendance_scanner_unregistered as u (serial_number, last_ip, last_seen_at)
    values (v_serial, v_ip, now())
    on conflict (serial_number) do update set last_ip = excluded.last_ip, last_seen_at = excluded.last_seen_at
      where u.last_seen_at < now() - interval '1 minute' or u.last_ip is distinct from excluded.last_ip;
    delete from public.attendance_scanner_unregistered u where u.last_seen_at < now() - interval '30 days';
    return null;
  end if;
  if not d.active then
    return null;
  end if;
  if d.allowed_ip is not null
     and (public.attendance_scanner_inet(v_ip) is null or not (public.attendance_scanner_inet(v_ip) <<= d.allowed_ip::inet)) then
    update public.attendance_devices
    set last_error = format('Refused a connection from %s: this scanner is locked to %s', coalesce(v_ip, 'an unknown address'), d.allowed_ip),
        last_error_at = now()
    where id = d.id;
    return null;
  end if;
  -- a check-in every few seconds: written when something changed or a minute has passed
  if d.last_seen_at is null or d.last_seen_at < now() - interval '1 minute'
     or d.last_ip is distinct from v_ip or d.last_error is not null then
    update public.attendance_devices
    set last_seen_at = now(), last_ip = v_ip, last_error = null, last_error_at = null
    where id = d.id
    returning * into d;
  end if;
  return d;
end $$;
revoke all on function public.attendance_scanner_contact(text, text) from public, anon, authenticated;

-- The scanner's check-in (and hello): {"accepted": true} when it is a registered, active scanner allowed from here.
create or replace function public.attendance_scanner_seen(p_serial text, p_ip text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.attendance_devices := public.attendance_scanner_contact(p_serial, p_ip);
begin
  return jsonb_build_object('accepted', d.id is not null);
end $$;
revoke all on function public.attendance_scanner_seen(text, text) from public, anon, authenticated;
grant execute on function public.attendance_scanner_seen(text, text) to service_role;

-- An attendance upload: lines of "PIN<tab>YYYY-MM-DD HH:MM:SS<tab>status<tab>verify<tab>..." on the scanner's clock.
-- Lines that don't read as a punch are ignored. Returns how many lines came (received), how many new punches were
-- kept (stored), how many became attendance (applied) and how many wait for their scanner user to be matched.
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
    select distinct on (p.pin, p.at) p.*
    from parsed p
    where public.attendance_scanner_pin_ok(p.pin) and p.at is not null
      and (v_from is null or (p.at at time zone 'Africa/Nairobi')::date >= v_from)
      and p.at <= now() + interval '1 day'
    order by p.pin, p.at
  ),
  stored as (
    insert into public.attendance_scanner_punches (tenant_id, device_id, scanner_user_id, punched_at, status, verify, employee_number)
    select d.tenant_id, d.id, k.pin, k.at, k.status, k.verify, m.employee_number
    from kept k
    left join public.attendance_scanner_users m on m.tenant_id = d.tenant_id and m.scanner_user_id = k.pin
    on conflict (device_id, scanner_user_id, punched_at) do nothing
    returning id, employee_number, punched_at
  )
  select coalesce(array_agg(s.id order by s.punched_at), '{}'), count(*) filter (where s.employee_number is null)::integer
  into v_ids, v_unmatched
  from stored s;

  foreach v_id in array v_ids loop
    if public.attendance_scanner_apply(v_id) then
      v_applied := v_applied + 1;
    end if;
  end loop;

  return jsonb_build_object('accepted', true, 'received', v_received, 'stored', cardinality(v_ids), 'applied', v_applied,
                            'unmatched', v_unmatched);
end $$;
revoke all on function public.attendance_scanner_receive(text, text, text) from public, anon, authenticated;
grant execute on function public.attendance_scanner_receive(text, text, text) to service_role;

notify pgrst, 'reload schema';
