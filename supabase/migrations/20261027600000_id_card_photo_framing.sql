-- Framing the photo on a staff ID card: move it inside the hexagon and zoom, without changing the photo itself.
--
-- Each card keeps which point of the photo sits in the middle of the hexagon (photo_x, photo_y: 0 is the left/top edge,
-- 1 the right/bottom) and how far it is zoomed in (photo_zoom: 1 fills the hexagon, up to 4). The framing belongs to the
-- photo it was set for (photo_framed_url): when the employee's photo changes, the card shows the new one centred.
--
-- The card holder frames their own card's photo; the 'staff-id-cards' module frames anyone's
-- (set_staff_id_card_photo_framing()). Written to run again safely.

alter table public.staff_id_cards
  add column if not exists photo_x numeric(5, 4) not null default 0.5 check (photo_x between 0 and 1),
  add column if not exists photo_y numeric(5, 4) not null default 0.5 check (photo_y between 0 and 1),
  add column if not exists photo_zoom numeric(5, 3) not null default 1 check (photo_zoom between 1 and 4),
  add column if not exists photo_framed_url text;

-- the card rows gain the framing (centred when it was set for another photo); the return type changes, so the three
-- functions are dropped and made again, with their grants
drop function if exists public.my_staff_id_card();
drop function if exists public.staff_id_cards(uuid[]);
drop function if exists public.staff_id_card_rows(uuid[]);

create function public.staff_id_card_rows(p_employees uuid[])
returns table (
  employee_id uuid, employee_number text, first_name text, middle_name text, last_name text, job_title text,
  department text, branch text, work_phone text, work_email text, date_of_birth text, date_joined text,
  contract_end_date text, photo_url text, is_active boolean, token text, issued_at timestamptz,
  photo_x numeric, photo_y numeric, photo_zoom numeric
)
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
  dob boolean := coalesce((select s.show_date_of_birth from public.staff_id_card_settings s where s.tenant_id = t), false);
begin
  if t is null then
    return;
  end if;
  insert into public.staff_id_cards as c (employee_id, tenant_id, token, issued_by)
  select e.id, t, replace(gen_random_uuid()::text, '-', ''), auth.uid()
  from public.employees e
  where e.tenant_id = t and e.id = any (p_employees)
  on conflict on constraint staff_id_cards_pkey do nothing;

  return query
  select e.id, e."Employee Number", nullif(btrim(e."First Name"), ''), nullif(btrim(e."Middle Name"), ''),
         nullif(btrim(e."Last Name"), ''), nullif(btrim(e."Job Title"), ''), nullif(btrim(e."Job Level"), ''),
         coalesce(b.name, nullif(btrim(e."Branch"), '')), nullif(btrim(e."Work Mobile"), ''),
         nullif(btrim(e."Work Email"), ''), case when dob then nullif(btrim(e."Date of Birth"), '') end,
         nullif(btrim(e."Start Date"), ''), nullif(btrim(e."Contract End Date"), ''), nullif(btrim(e."Profile Image"), ''),
         public.staff_id_card_active(e.tenant_id, e."Employee Number", e."Status"), c.token, c.issued_at,
         case when framed then c.photo_x else 0.5 end::numeric,
         case when framed then c.photo_y else 0.5 end::numeric,
         case when framed then c.photo_zoom else 1 end::numeric
  from public.employees e
  join public.staff_id_cards c on c.employee_id = e.id and c.tenant_id = t
  cross join lateral (select c.photo_framed_url is not distinct from nullif(btrim(e."Profile Image"), '') as framed) f
  left join public.branches b on b.id = e.branch_id and b.tenant_id = t
  where e.tenant_id = t and e.id = any (p_employees)
  order by e."First Name", e."Last Name", e."Employee Number";
end $$;
revoke all on function public.staff_id_card_rows(uuid[]) from public, anon, authenticated;

create function public.my_staff_id_card()
returns table (
  employee_id uuid, employee_number text, first_name text, middle_name text, last_name text, job_title text,
  department text, branch text, work_phone text, work_email text, date_of_birth text, date_joined text,
  contract_end_date text, photo_url text, is_active boolean, token text, issued_at timestamptz,
  photo_x numeric, photo_y numeric, photo_zoom numeric
)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_employee_id();
begin
  if me is null then
    return;
  end if;
  return query select * from public.staff_id_card_rows(array[me]);
end $$;
revoke all on function public.my_staff_id_card() from public, anon;
grant execute on function public.my_staff_id_card() to authenticated;

create function public.staff_id_cards(p_employee_ids uuid[])
returns table (
  employee_id uuid, employee_number text, first_name text, middle_name text, last_name text, job_title text,
  department text, branch text, work_phone text, work_email text, date_of_birth text, date_joined text,
  contract_end_date text, photo_url text, is_active boolean, token text, issued_at timestamptz,
  photo_x numeric, photo_y numeric, photo_zoom numeric
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_module('staff-id-cards') then
    raise exception 'Only people with Staff ID cards can see other employees'' cards' using errcode = '42501';
  end if;
  if coalesce(array_length(p_employee_ids, 1), 0) > 5000 then
    raise exception 'Print at most 5000 cards at a time' using errcode = '22023';
  end if;
  return query select * from public.staff_id_card_rows(p_employee_ids);
end $$;
revoke all on function public.staff_id_cards(uuid[]) from public, anon;
grant execute on function public.staff_id_cards(uuid[]) to authenticated;

-- framing a card's photo: the card holder their own, the module anyone's. Out-of-range values are brought into range.
create or replace function public.set_staff_id_card_photo_framing(p_employee_id uuid, p_x numeric, p_y numeric, p_zoom numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
  v_photo text;
begin
  if t is null or not (p_employee_id = public.current_employee_id() or public.has_module('staff-id-cards')) then
    raise exception 'You can only frame the photo on your own card' using errcode = '42501';
  end if;
  select nullif(btrim(e."Profile Image"), '') into v_photo from public.employees e where e.id = p_employee_id and e.tenant_id = t;
  if not found then
    raise exception 'No such employee' using errcode = 'P0002';
  end if;
  if v_photo is null then
    raise exception 'This employee has no photo to frame' using errcode = '22023';
  end if;
  update public.staff_id_cards c
  set photo_x = least(1, greatest(0, coalesce(p_x, 0.5))),
      photo_y = least(1, greatest(0, coalesce(p_y, 0.5))),
      photo_zoom = least(4, greatest(1, coalesce(p_zoom, 1))),
      photo_framed_url = v_photo
  where c.employee_id = p_employee_id and c.tenant_id = t;
  if not found then
    raise exception 'Open the card once before framing its photo' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.set_staff_id_card_photo_framing(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.set_staff_id_card_photo_framing(uuid, numeric, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
