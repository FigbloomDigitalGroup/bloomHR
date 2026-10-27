-- Staff ID cards ("job cards", as the client calls them): a digital staff ID card for every employee.
--
--   staff_id_cards           one row per employee who has had a card: an opaque token (the QR code on the card opens
--                            <app>/verify/<token>), when it was issued and by whom. Created the first time the card is
--                            opened; reissuing gives a new token, so the old card's QR code stops working.
--   staff_id_card_settings   one row per company: whether cards show the date of birth (off: it's personal data), and
--                            the authorised signatory printed on the back (name, title, signature image).
--
-- Who:
--   * every employee sees their own card (my_staff_id_card()).
--   * the 'staff-id-cards' module ("Staff ID cards") views and prints anyone's card, reissues cards and changes the
--     settings. It is given once to ADMIN and HR (and custom roles based on them); running this again grants nothing,
--     so a company that unticks it keeps it unticked.
--   * anyone, signed in or not, can check a card with verify_staff_id_card(token): only whether the person is a
--     current employee, their name, photo and job title, and the company's name and logo. Nothing else.
--
-- The tables are only written through the functions below; the card's details are read from the employee record each
-- time, so a new job title shows without reissuing. Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the module
-- ---------------------------------------------------------------------------------------------
do $$
begin
  perform public.seed_module_once('staff-id-cards', 'Staff ID cards',
    'View, print and reissue any employee''s staff ID card, and choose what the cards show', 'people',
    array['ADMIN', 'HR']);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.staff_id_cards (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  -- 32 random hex characters (a random UUID without its dashes): not the employee number, and not guessable
  token text not null unique check (token ~ '^[0-9a-f]{32}$'),
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users(id) on delete set null
);
create index if not exists staff_id_cards_tenant on public.staff_id_cards (tenant_id);

create table if not exists public.staff_id_card_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  show_date_of_birth boolean not null default false,
  signatory_name text check (signatory_name is null or length(signatory_name) <= 120),
  signatory_title text check (signatory_title is null or length(signatory_title) <= 120),
  -- a PNG data: URL, as on offer letters (is_signature_image(), 20261026200000)
  signature text check (public.is_signature_image(signature)),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);

-- ---------------------------------------------------------------------------------------------
-- 3. access
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['staff_id_cards', 'staff_id_card_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- the cards: read by the card holder and the module; never written directly (the token must come from the functions,
-- or anyone could pick one)
revoke insert, update, delete on public.staff_id_cards from authenticated;
drop policy if exists read on public.staff_id_cards;
create policy read on public.staff_id_cards for select to authenticated
  using (employee_id = (select public.current_employee_id()) or (select public.has_module('staff-id-cards')));

-- the settings: everyone in the company reads them (their own card shows the signatory); the module changes them
drop policy if exists read on public.staff_id_card_settings;
create policy read on public.staff_id_card_settings for select to authenticated using (true);
drop policy if exists manage on public.staff_id_card_settings;
create policy manage on public.staff_id_card_settings for all to authenticated
  using ((select public.has_module('staff-id-cards'))) with check ((select public.has_module('staff-id-cards')));

create or replace function public.staff_id_card_settings_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists staff_id_card_settings_touch on public.staff_id_card_settings;
create trigger staff_id_card_settings_touch before insert or update on public.staff_id_card_settings
  for each row execute function public.staff_id_card_settings_touch();

-- ---------------------------------------------------------------------------------------------
-- 4. reading cards
-- ---------------------------------------------------------------------------------------------
-- A current employee: their status is Active and they are not suspended. Used on the card and by the public check.
create or replace function public.staff_id_card_active(p_tenant uuid, p_number text, p_status text) returns boolean
language sql stable security definer set search_path = public as $$
  select lower(btrim(coalesce(p_status, 'Active'))) = 'active'
     and not exists (select 1 from public.hr_suspensions s
                     where s.tenant_id = p_tenant and s."Employee Number" = p_number and coalesce(s.is_active, false))
$$;
revoke all on function public.staff_id_card_active(uuid, text, text) from public, anon, authenticated;

-- The cards of these employees in the current company, each given a token the first time. Not callable from the API:
-- my_staff_id_card() and staff_id_cards() decide who may see which cards.
create or replace function public.staff_id_card_rows(p_employees uuid[])
returns table (
  employee_id uuid, employee_number text, first_name text, middle_name text, last_name text, job_title text,
  department text, branch text, work_phone text, work_email text, date_of_birth text, date_joined text,
  contract_end_date text, photo_url text, is_active boolean, token text, issued_at timestamptz
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
         public.staff_id_card_active(e.tenant_id, e."Employee Number", e."Status"), c.token, c.issued_at
  from public.employees e
  join public.staff_id_cards c on c.employee_id = e.id and c.tenant_id = t
  left join public.branches b on b.id = e.branch_id and b.tenant_id = t
  where e.tenant_id = t and e.id = any (p_employees)
  order by e."First Name", e."Last Name", e."Employee Number";
end $$;
revoke all on function public.staff_id_card_rows(uuid[]) from public, anon, authenticated;

-- the signed-in person's own card (none when they have no employee record in this company)
create or replace function public.my_staff_id_card()
returns table (
  employee_id uuid, employee_number text, first_name text, middle_name text, last_name text, job_title text,
  department text, branch text, work_phone text, work_email text, date_of_birth text, date_joined text,
  contract_end_date text, photo_url text, is_active boolean, token text, issued_at timestamptz
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

-- anyone's cards in the company (one, a selection, a department): the module only
create or replace function public.staff_id_cards(p_employee_ids uuid[])
returns table (
  employee_id uuid, employee_number text, first_name text, middle_name text, last_name text, job_title text,
  department text, branch text, work_phone text, work_email text, date_of_birth text, date_joined text,
  contract_end_date text, photo_url text, is_active boolean, token text, issued_at timestamptz
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

-- ---------------------------------------------------------------------------------------------
-- 5. reissuing a card: a new token, so the old card no longer verifies
-- ---------------------------------------------------------------------------------------------
create or replace function public.regenerate_staff_id_card(p_employee_id uuid)
returns table (token text, issued_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
begin
  if not public.has_module('staff-id-cards') then
    raise exception 'Only people with Staff ID cards can reissue a card' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee_id and e.tenant_id = t) then
    raise exception 'No such employee' using errcode = 'P0002';
  end if;
  return query
  insert into public.staff_id_cards as c (employee_id, tenant_id, token, issued_by)
  values (p_employee_id, t, replace(gen_random_uuid()::text, '-', ''), auth.uid())
  on conflict on constraint staff_id_cards_pkey do update
    set token = excluded.token, issued_at = now(), issued_by = excluded.issued_by
  returning c.token, c.issued_at;
end $$;
revoke all on function public.regenerate_staff_id_card(uuid) from public, anon;
grant execute on function public.regenerate_staff_id_card(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. the public check behind the QR code
-- ---------------------------------------------------------------------------------------------
-- Only what someone holding the card needs to trust it. An unknown or reissued token returns no row.
create or replace function public.verify_staff_id_card(p_token text)
returns table (company_name text, company_logo_url text, full_name text, photo_url text, job_title text, is_active boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return;
  end if;
  return query
  select coalesce(nullif(btrim(cp.company_name), ''), tn.name), cp.logo_url,
         coalesce(nullif(btrim(concat_ws(' ', nullif(btrim(e."First Name"), ''), nullif(btrim(e."Middle Name"), ''),
                                         nullif(btrim(e."Last Name"), ''))), ''), 'Unnamed employee'),
         nullif(btrim(e."Profile Image"), ''), nullif(btrim(e."Job Title"), ''),
         public.staff_id_card_active(e.tenant_id, e."Employee Number", e."Status")
  from public.staff_id_cards c
  join public.employees e on e.id = c.employee_id and e.tenant_id = c.tenant_id
  join public.tenants tn on tn.id = c.tenant_id
  left join public.company_profile cp on cp.tenant_id = c.tenant_id
  where c.token = p_token;
end $$;
revoke all on function public.verify_staff_id_card(text) from public;
grant execute on function public.verify_staff_id_card(text) to anon, authenticated;

notify pgrst, 'reload schema';
