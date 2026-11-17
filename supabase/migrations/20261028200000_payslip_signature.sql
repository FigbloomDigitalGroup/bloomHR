-- The payslip carries the approver's signature, and statutory numbers become optional (Figbloom finance, Oct 28).
--
--   payroll_run_countries.approved_signature / approved_signer
--                                     approving a country keeps the approver's drawn signature (a PNG data: URL, from
--                                     their My signature) and name, as sending an offer does. Payslips in that country
--                                     show them as the authorised signatory. Only approving sets them (through
--                                     set_payroll_countries_status); reopening clears them. A later redraw doesn't
--                                     change payslips already approved.
--   set_payroll_countries_status(run, countries, status, signature, signer)
--                                     gains the signature and name (both optional; kept only when approving).
--   payslip_run_signature(employee, pay period)
--                                     the signature and name on that month's payslip, for whoever may read the payslip.
--   payslip_settings.show_statutory_numbers
--                                     the payslip shows NSSF, SHA and ID numbers only when this is on (default off). The
--                                     employee's tax PIN always shows, under Employee information.
--
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. the design switch
-- ---------------------------------------------------------------------------------------------
alter table public.payslip_settings add column if not exists show_statutory_numbers boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- 2. the approver's signature on each country of the run
-- ---------------------------------------------------------------------------------------------
alter table public.payroll_run_countries
  add column if not exists approved_signature text,
  add column if not exists approved_signer text;

alter table public.payroll_run_countries drop constraint if exists payroll_run_countries_approved_signature_check;
alter table public.payroll_run_countries add constraint payroll_run_countries_approved_signature_check
  check (public.is_signature_image(approved_signature));

-- set only on approval (from app.payroll_signature / app.payroll_signer, which set_payroll_countries_status sets),
-- cleared on reopening, never changed by hand (runs after payroll_run_country_rules, which checks the move)
create or replace function public.payroll_run_country_signature() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.approved_signature := null;
    new.approved_signer := null;
  elsif old.status = 'draft' and new.status = 'approved' then
    new.approved_signature := nullif(current_setting('app.payroll_signature', true), '');
    new.approved_signer := left(nullif(btrim(coalesce(current_setting('app.payroll_signer', true), '')), ''), 200);
  elsif new.status = 'draft' then
    new.approved_signature := null;
    new.approved_signer := null;
  else
    new.approved_signature := old.approved_signature;
    new.approved_signer := old.approved_signer;
  end if;
  return new;
end $$;
revoke all on function public.payroll_run_country_signature() from public, anon, authenticated;
drop trigger if exists payroll_run_country_signature on public.payroll_run_countries;
create trigger payroll_run_country_signature before insert or update on public.payroll_run_countries
  for each row execute function public.payroll_run_country_signature();

-- ---------------------------------------------------------------------------------------------
-- 3. approving with a signature
-- ---------------------------------------------------------------------------------------------
drop function if exists public.set_payroll_countries_status(uuid, text[], text);
create or replace function public.set_payroll_countries_status(
  p_run uuid, p_countries text[], p_status text, p_signature text default null, p_signer text default null
) returns text[]
language plpgsql security invoker set search_path = public as $$
declare
  v_done text[] := '{}';
  c text;
  v_from text;
begin
  if not public.has_module('payroll') then
    raise exception 'Only payroll can approve payroll' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'approved', 'paid') then
    raise exception 'Choose draft, approved or paid' using errcode = '22023';
  end if;
  if not public.is_signature_image(p_signature) then
    raise exception 'The signature should be a PNG image' using errcode = '22023';
  end if;
  v_from := case p_status when 'approved' then 'draft' when 'draft' then 'approved' else 'approved' end;
  perform set_config('app.payroll_signature', case when p_status = 'approved' then coalesce(p_signature, '') else '' end, true);
  perform set_config('app.payroll_signer', case when p_status = 'approved' then coalesce(p_signer, '') else '' end, true);
  foreach c in array coalesce(p_countries, '{}') loop
    update public.payroll_run_countries set status = p_status
    where run_id = p_run and lower(country) = lower(btrim(c)) and status = v_from;
    if found then
      v_done := v_done || public.tidy_country(c);
    end if;
  end loop;
  perform set_config('app.payroll_signature', '', true);
  perform set_config('app.payroll_signer', '', true);
  return v_done;
end $$;
revoke all on function public.set_payroll_countries_status(uuid, text[], text, text, text) from public, anon;
grant execute on function public.set_payroll_countries_status(uuid, text[], text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. the payslip reads them (payslip_run_details stays as it is: its migration must run again)
-- ---------------------------------------------------------------------------------------------
create or replace function public.payslip_run_signature(p_employee text, p_pay_period text)
returns table (approved_signature text, approved_signer text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    return;
  end if;
  if not public.payslip_details_allowed(p_employee) then
    raise exception 'You can only see your own payslips' using errcode = '42501';
  end if;
  return query
  select c.approved_signature, c.approved_signer
  from public.salary_history h
  join public.payroll_run_countries c
    on c.run_id = h.run_id and c.tenant_id = h.tenant_id and lower(c.country) = lower(coalesce(nullif(btrim(h.country), ''), 'Kenya'))
  where h.tenant_id = v_tenant and h.employee_id = p_employee and h.pay_period = p_pay_period
    and c.status in ('approved', 'paid')
  limit 1;
end $$;
revoke all on function public.payslip_run_signature(text, text) from public, anon;
grant execute on function public.payslip_run_signature(text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
