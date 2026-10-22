-- Door scanners: the name each scanner user has on the scanner, scanner user 0, and "Not staff, ignore" (FIG-1198).
--
-- Figbloom's scanner (Oct 22) showed that scanner user IDs don't follow employee numbers (ID 3 is "Esther", Esther
-- Nalenyi, FBL-000010, not FBL-000003), so matching by number guessed wrong every time. But the scanner keeps a name
-- for each ID ("Esther", "Katam", "Franciskiprono"...), and ZKTeco's push protocol can send it:
--
--   attendance_scanner_names          the name each scanner user ID has on one scanner (device, ID, name, when it was
--                                     last received). Written only by the receiver; read by the people who see
--                                     attendance (sees_attendance). The Scanners tab shows "Scanner user 3 · Esther"
--                                     and "Match automatically" suggests by that name (src/lib/attendanceScanners.ts).
--   attendance_devices.users_requested_at / users_received_at
--                                     when the receiver last asked the scanner for its user list, and when user records
--                                     last arrived. A scanner is asked (on its check-in, /iclock/getrequest) when it
--                                     hasn't sent them in a day, and never more than once a day, even when it ignores
--                                     the question. Receiver-only (people may write only the columns 20261023600000
--                                     grants). Changing a scanner's serial number (a different scanner) starts over.
--   attendance_scanner_ignored        scanner user IDs HR marked "Not staff, ignore" (the cook, a visitor's finger),
--                                     with the reason. They leave "Waiting for a match"; their punches are kept but
--                                     never applied (they are never matched). Undo deletes the row; matching the ID to
--                                     an employee later removes it too, and that ID's waiting punches then count.
--                                     HR (manages_attendance) writes it; sees_attendance reads it.
--   scanner user 0                    not a person: ZKTeco reports the exit button, door events and unrecognised
--                                     fingers as user 0 (seen with punch code 201). Its punches are still stored as
--                                     sent (nothing about them is ever applied: they can't be matched), but it is never
--                                     offered in "Waiting for a match", can't be matched or ignored, and its name isn't
--                                     kept.
--
-- For the receiver only (service_role):
--   attendance_scanner_receive_users(serial, ip, lines)  user records ("USER PIN=3<tab>Name=Esther<tab>Pri=0..." or
--                                                        "PIN=3<tab>Name=Esther..."): keeps each name
--   attendance_scanner_poll(serial, ip)                  the check-in: {accepted, commands}, the user-list question
--                                                        when one is due
-- Both go through attendance_scanner_contact, so an unknown serial, a switched-off scanner or one outside its IP lock
-- stores nothing and is asked nothing.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. asking a scanner for its users
-- ---------------------------------------------------------------------------------------------
alter table public.attendance_devices add column if not exists users_requested_at timestamptz;
alter table public.attendance_devices add column if not exists users_received_at timestamptz;

-- scanner user 0 (or 00...) isn't a person
create or replace function public.attendance_scanner_pin_is_person(p text) returns boolean
language sql immutable as $$
  select public.attendance_scanner_pin_ok(btrim(coalesce(p, ''))) and btrim(coalesce(p, '')) !~ '^0+$'
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. the names
-- ---------------------------------------------------------------------------------------------
create table if not exists public.attendance_scanner_names (
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  scanner_user_id text not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  updated_at timestamptz not null default now(),
  primary key (device_id, scanner_user_id)
);
alter table public.attendance_scanner_names drop constraint if exists attendance_scanner_names_name_check;
alter table public.attendance_scanner_names add constraint attendance_scanner_names_name_check check (length(name) between 1 and 64);
create index if not exists attendance_scanner_names_tenant_idx on public.attendance_scanner_names (tenant_id, scanner_user_id);

alter table public.attendance_scanner_names enable row level security;
drop policy if exists tenant_isolation on public.attendance_scanner_names;
create policy tenant_isolation on public.attendance_scanner_names as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists hr_read on public.attendance_scanner_names;
create policy hr_read on public.attendance_scanner_names for select to authenticated
  using ((select public.sees_attendance()));
-- written only by the receiver
revoke all on public.attendance_scanner_names from anon;
revoke insert, update, delete, truncate on public.attendance_scanner_names from authenticated;
grant select on public.attendance_scanner_names to authenticated;

-- a different scanner under the same record (its serial number changed): its names and the user-list timing start over
create or replace function public.attendance_devices_users_reset() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.serial_number is distinct from old.serial_number then
    new.users_requested_at := null;
    new.users_received_at := null;
    delete from public.attendance_scanner_names n where n.device_id = old.id;
  end if;
  return new;
end $$;
revoke all on function public.attendance_devices_users_reset() from public, anon, authenticated;
drop trigger if exists attendance_devices_users_reset on public.attendance_devices;
create trigger attendance_devices_users_reset before update of serial_number on public.attendance_devices
  for each row execute function public.attendance_devices_users_reset();

-- ---------------------------------------------------------------------------------------------
-- 3. "Not staff, ignore"
-- ---------------------------------------------------------------------------------------------
create table if not exists public.attendance_scanner_ignored (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  scanner_user_id text not null,
  reason text not null,
  ignored_by uuid default auth.uid() references auth.users(id) on delete set null,
  ignored_at timestamptz not null default now()
);
create unique index if not exists attendance_scanner_ignored_key on public.attendance_scanner_ignored (tenant_id, scanner_user_id);
alter table public.attendance_scanner_ignored drop constraint if exists attendance_scanner_ignored_reason_check;
alter table public.attendance_scanner_ignored add constraint attendance_scanner_ignored_reason_check
  check (length(reason) between 1 and 300);

create or replace function public.attendance_scanner_ignored_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
    new.scanner_user_id := old.scanner_user_id;
  end if;
  new.scanner_user_id := btrim(coalesce(new.scanner_user_id, ''));
  if not public.attendance_scanner_pin_ok(new.scanner_user_id) then
    raise exception 'Enter the scanner user ID as the scanner shows it (letters and digits)' using errcode = '23514';
  end if;
  if not public.attendance_scanner_pin_is_person(new.scanner_user_id) then
    raise exception 'Scanner user 0 isn''t a person (the exit button or a door event), so it is never counted' using errcode = '23514';
  end if;
  new.reason := btrim(coalesce(new.reason, ''));
  if new.reason = '' then
    raise exception 'Say why this scanner user isn''t staff, like "The cook"' using errcode = '23514';
  end if;
  if length(new.reason) > 300 then
    raise exception 'Keep the reason under 300 characters' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from public.attendance_scanner_users m where m.tenant_id = new.tenant_id and m.scanner_user_id = new.scanner_user_id
  ) then
    raise exception 'Scanner user % is matched to an employee. Remove the match first.', new.scanner_user_id using errcode = '23514';
  end if;
  new.ignored_by := coalesce(auth.uid(), new.ignored_by);
  new.ignored_at := now();
  return new;
end $$;
revoke all on function public.attendance_scanner_ignored_rules() from public, anon, authenticated;
drop trigger if exists attendance_scanner_ignored_rules on public.attendance_scanner_ignored;
create trigger attendance_scanner_ignored_rules before insert or update on public.attendance_scanner_ignored
  for each row execute function public.attendance_scanner_ignored_rules();

alter table public.attendance_scanner_ignored enable row level security;
drop policy if exists tenant_isolation on public.attendance_scanner_ignored;
create policy tenant_isolation on public.attendance_scanner_ignored as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists hr_read on public.attendance_scanner_ignored;
create policy hr_read on public.attendance_scanner_ignored for select to authenticated
  using ((select public.sees_attendance()));
drop policy if exists hr_write on public.attendance_scanner_ignored;
create policy hr_write on public.attendance_scanner_ignored for all to authenticated
  using ((select public.manages_attendance()))
  with check ((select public.manages_attendance()));
revoke all on public.attendance_scanner_ignored from anon;
revoke insert, update, truncate on public.attendance_scanner_ignored from authenticated;
grant select, delete on public.attendance_scanner_ignored to authenticated;
grant insert (scanner_user_id, reason) on public.attendance_scanner_ignored to authenticated;
grant update (reason) on public.attendance_scanner_ignored to authenticated;

-- scanner user 0 can't be matched (checked before attendance_scanner_users_rules, which runs after it by name)
create or replace function public.attendance_scanner_users_not_zero() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.attendance_scanner_pin_ok(btrim(coalesce(new.scanner_user_id, '')))
     and not public.attendance_scanner_pin_is_person(new.scanner_user_id) then
    raise exception 'Scanner user 0 isn''t a person (the exit button or a door event), so it can''t be matched' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.attendance_scanner_users_not_zero() from public, anon, authenticated;
drop trigger if exists attendance_scanner_users_not_zero on public.attendance_scanner_users;
create trigger attendance_scanner_users_not_zero before insert or update on public.attendance_scanner_users
  for each row execute function public.attendance_scanner_users_not_zero();

-- matching an ignored scanner user to an employee: no longer ignored (attendance_scanner_users_matched applies the
-- waiting punches, which were never marked)
create or replace function public.attendance_scanner_users_unignore() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.attendance_scanner_ignored i where i.tenant_id = new.tenant_id and i.scanner_user_id = new.scanner_user_id;
  return null;
end $$;
revoke all on function public.attendance_scanner_users_unignore() from public, anon, authenticated;
drop trigger if exists attendance_scanner_users_unignore on public.attendance_scanner_users;
create trigger attendance_scanner_users_unignore after insert or update on public.attendance_scanner_users
  for each row execute function public.attendance_scanner_users_unignore();

-- The scanner user IDs waiting for a match (20261023600000's): not scanner user 0, not ones marked "Not staff".
create or replace function public.attendance_scanner_unmatched()
returns table (scanner_user_id text, punches integer, first_at timestamptz, last_at timestamptz)
language sql stable set search_path = public as $$
  select x.scanner_user_id, count(*)::integer, min(x.punched_at), max(x.punched_at)
  from public.attendance_scanner_punches x
  where x.employee_number is null and x.applied_at is null and x.skipped_reason is null
    and public.attendance_scanner_pin_is_person(x.scanner_user_id)
    and not exists (
      select 1 from public.attendance_scanner_users m where m.tenant_id = x.tenant_id and m.scanner_user_id = x.scanner_user_id)
    and not exists (
      select 1 from public.attendance_scanner_ignored i where i.tenant_id = x.tenant_id and i.scanner_user_id = x.scanner_user_id)
  group by x.scanner_user_id
  order by x.scanner_user_id
$$;
revoke all on function public.attendance_scanner_unmatched() from public, anon;
grant execute on function public.attendance_scanner_unmatched() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. the receiver (service_role only)
-- ---------------------------------------------------------------------------------------------
-- The user records in an upload: one row per scanner user ID that is a person (the last line for an ID counts), with
-- its name (control characters removed, trimmed, up to 64 characters; '' when it has none). Lines that aren't user
-- records are left out.
create or replace function public.attendance_scanner_user_records(p_lines text)
returns table (pin text, name text)
language sql immutable as $$
  select distinct on (u.pin) u.pin, u.name
  from (
    select x.n, btrim((regexp_match(E'\t' || x.l, E'\tPIN=([^\t]*)', 'i'))[1]) as pin,
           left(btrim(regexp_replace(coalesce((regexp_match(E'\t' || x.l, E'\tName=([^\t]*)', 'i'))[1], ''), '[[:cntrl:]]', '', 'g')), 64) as name
    from (
      select regexp_replace(btrim(t.l, E' \r'), '^USER\s+', '', 'i') as l, t.n
      from regexp_split_to_table(coalesce(p_lines, ''), E'\n') with ordinality as t(l, n)
    ) x
    where x.l ~* '^PIN='
  ) u
  where public.attendance_scanner_pin_is_person(u.pin)
  order by u.pin, u.n desc
$$;
revoke all on function public.attendance_scanner_user_records(text) from public, anon, authenticated;

-- User records from the scanner, one per line, tab-separated key=value: "USER PIN=3<tab>Name=Esther<tab>Pri=0<tab>..."
-- (an OPERLOG upload, or a command's answer) or "PIN=3<tab>Name=Esther<tab>..." (a USERINFO upload). Other lines (the
-- operation log, fingerprint templates) are ignored; iclock_routes.js doesn't even pass them on. Each ID's name is kept
-- (a record with no name forgets the one kept); scanner user 0 isn't. Returns how many lines came (received) and how
-- many user records were read (users).
create or replace function public.attendance_scanner_receive_users(p_serial text, p_ip text, p_lines text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.attendance_devices;
  v_received integer;
  v_users integer;
begin
  select count(*)::integer into v_received
  from regexp_split_to_table(coalesce(p_lines, ''), E'\n') l
  where btrim(l, E' \t\r') <> '';
  d := public.attendance_scanner_contact(p_serial, p_ip);
  if d.id is null then
    return jsonb_build_object('accepted', false, 'received', v_received, 'users', 0);
  end if;

  select count(*)::integer into v_users from public.attendance_scanner_user_records(p_lines);

  insert into public.attendance_scanner_names as k (device_id, scanner_user_id, tenant_id, name, updated_at)
  select d.id, u.pin, d.tenant_id, u.name, now()
  from public.attendance_scanner_user_records(p_lines) u
  where u.name <> ''
  on conflict (device_id, scanner_user_id) do update set name = excluded.name, updated_at = excluded.updated_at;

  delete from public.attendance_scanner_names k
  using public.attendance_scanner_user_records(p_lines) u
  where k.device_id = d.id and k.scanner_user_id = u.pin and u.name = '';

  if v_users > 0 then
    update public.attendance_devices set users_received_at = now() where id = d.id;
  end if;
  return jsonb_build_object('accepted', true, 'received', v_received, 'users', v_users);
end $$;
revoke all on function public.attendance_scanner_receive_users(text, text, text) from public, anon, authenticated;
grant execute on function public.attendance_scanner_receive_users(text, text, text) to service_role;

-- The scanner's check-in (/iclock/getrequest): {"accepted": true|false, "commands": [...]}. When the scanner hasn't sent
-- its users in a day and wasn't asked in a day, the commands ask for them (ZKTeco push: "C:<id>:<command>"):
--   C:<id>:DATA QUERY USERINFO              every user (understood by most push firmware)
--   C:<id>:DATA QUERY USERINFO PIN=<pin>    each scanner user ID that punched here and has no name yet (up to 50), the
--                                           documented one-user form, for firmware that wants a PIN
-- The command IDs are the time in seconds (plus the line), so they don't repeat. Asked at most once a day either way.
create or replace function public.attendance_scanner_poll(p_serial text, p_ip text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.attendance_devices := public.attendance_scanner_contact(p_serial, p_ip);
  v_base bigint;
  v_cmds text[] := '{}';
  v_pin text;
begin
  if d.id is null then
    return jsonb_build_object('accepted', false, 'commands', '[]'::jsonb);
  end if;
  update public.attendance_devices x set users_requested_at = now()
  where x.id = d.id
    and (x.users_received_at is null or x.users_received_at < now() - interval '1 day')
    and (x.users_requested_at is null or x.users_requested_at < now() - interval '1 day');
  if found then
    v_base := extract(epoch from now())::bigint;
    v_cmds := array[format('C:%s:DATA QUERY USERINFO', v_base)];
    for v_pin in
      select x.scanner_user_id
      from public.attendance_scanner_punches x
      where x.device_id = d.id and public.attendance_scanner_pin_is_person(x.scanner_user_id)
        and not exists (select 1 from public.attendance_scanner_names n where n.device_id = d.id and n.scanner_user_id = x.scanner_user_id)
      group by x.scanner_user_id
      order by max(x.punched_at) desc, x.scanner_user_id
      limit 50
    loop
      v_cmds := v_cmds || format('C:%s:DATA QUERY USERINFO PIN=%s', v_base + cardinality(v_cmds), v_pin);
    end loop;
  end if;
  return jsonb_build_object('accepted', true, 'commands', to_jsonb(v_cmds));
end $$;
revoke all on function public.attendance_scanner_poll(text, text) from public, anon, authenticated;
grant execute on function public.attendance_scanner_poll(text, text) to service_role;

notify pgrst, 'reload schema';
