-- FIG-814: the payslip shows every detail, and the company designs how it looks.
--
--   salary_history.tax_details        how the payslip's taxable pay and PAYE were worked out, as the country's engine
--                                     saved it (jsonb): pay not taxed, taxable benefits, deductions allowed before tax,
--                                     tax before reliefs, reliefs. Each line {key, label, amount}. In the payslip's
--                                     currency (USD on a USD payslip). Null on payslips saved before, and on a
--                                     contractor's (withholding tax on gross).
--
--   payslip-design (module)           "Design the payslip: letterhead, contacts, footer, sections". Given once to
--                                     administrators and to every role (system or custom) that holds payroll; a
--                                     Staff-based role may hold it. Running this again gives nothing.
--
--   payslip_settings (one per company)
--                                     letterhead: 'logo' (the company logo and name, the default), 'company' (the
--                                     letterhead uploaded for offer letters, company_profile.letterhead_header_url) or
--                                     'own' (letterhead_url, an image uploaded for payslips in the company-logo bucket,
--                                     as the logo is); address, phone, email, website (blank: company_profile's);
--                                     footer_text; brand_color (#rrggbb, for headings); employer_tax_numbers (the
--                                     employer's tax number per country, {"Tanzania": "123456789", "Uganda": "1000..."};
--                                     Kenya defaults to the employer KRA PIN payroll keeps); and which optional sections
--                                     show: employer contributions, year to date, bank details, leave balance.
--                                     Statutory deductions and net pay always show.
--   payslip_branch_settings (one per branch, optional)
--                                     a branch's own address, phone, email and website on its staff's payslips.
--     Everyone in the company reads both (staff need them to see their own payslip); only payslip-design changes them.
--
--   payslip_ytd(employee number, pay period)
--                                     the employee's APPROVED (or paid) payslips earlier in the same tax year and the
--                                     same country as that month's payslip, totalled by currency (never mixed): months,
--                                     gross pay, taxable pay (and how many months had it), PAYE, NSSF, net pay. The tax
--                                     year is January to December in Kenya and Tanzania, July to June in Uganda. The
--                                     payslip itself is added by the app (it may still be a draft when payroll views it).
--   payslip_run_details(employee number, pay period)
--                                     the payroll run of that month's payslip: run id, country, status, approved and
--                                     paid dates (the pay date and run reference on the payslip).
--     Both: payroll (payroll or hr-lifecycle) for anyone in the company; everyone else only their own.
--
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. the working of taxable pay and tax on each payslip
-- ---------------------------------------------------------------------------------------------
alter table public.salary_history add column if not exists tax_details jsonb;

-- ---------------------------------------------------------------------------------------------
-- 2. the payslip-design module
-- ---------------------------------------------------------------------------------------------
do $$
begin
  perform public.seed_module_once('payslip-design', 'Payslip design',
    'Design the payslip: letterhead, contacts, footer, sections', 'finance', array['ADMIN'],
    'payroll', public.system_role_names());
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. the company's payslip design, and each branch's own contacts
-- ---------------------------------------------------------------------------------------------
create table if not exists public.payslip_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  letterhead text not null default 'logo',
  letterhead_url text,
  address text,
  phone text,
  email text,
  website text,
  footer_text text,
  brand_color text,
  employer_tax_numbers jsonb not null default '{}'::jsonb,
  show_employer_contributions boolean not null default true,
  show_ytd boolean not null default true,
  show_bank_details boolean not null default true,
  show_leave_balance boolean not null default false,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payslip_settings_letterhead_check') then
    alter table public.payslip_settings add constraint payslip_settings_letterhead_check check (letterhead in ('logo', 'company', 'own'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payslip_settings_letterhead_url_check') then
    alter table public.payslip_settings add constraint payslip_settings_letterhead_url_check
      check (letterhead_url is null or letterhead_url ~* '^https?://\S+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payslip_settings_brand_color_check') then
    alter table public.payslip_settings add constraint payslip_settings_brand_color_check check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payslip_settings_lengths_check') then
    alter table public.payslip_settings add constraint payslip_settings_lengths_check check (
      coalesce(length(address), 0) <= 300 and coalesce(length(phone), 0) <= 50 and coalesce(length(email), 0) <= 200
      and coalesce(length(website), 0) <= 200 and coalesce(length(footer_text), 0) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payslip_settings_tax_numbers_check') then
    alter table public.payslip_settings add constraint payslip_settings_tax_numbers_check check (jsonb_typeof(employer_tax_numbers) = 'object');
  end if;
end $$;

create table if not exists public.payslip_branch_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  address text check (address is null or length(address) <= 300),
  phone text check (phone is null or length(phone) <= 50),
  email text check (email is null or length(email) <= 200),
  website text check (website is null or length(website) <= 200),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id)
);

-- blanks are nulls; a branch override belongs to a branch of the same company; who changed it and when
create or replace function public.payslip_settings_rules() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'payslip_settings' then
    new.letterhead := coalesce(nullif(btrim(new.letterhead), ''), 'logo');
    new.letterhead_url := nullif(btrim(new.letterhead_url), '');
    new.footer_text := nullif(btrim(new.footer_text), '');
    new.brand_color := nullif(btrim(new.brand_color), '');
    new.employer_tax_numbers := coalesce(new.employer_tax_numbers, '{}'::jsonb);
  else
    if not exists (select 1 from public.branches b where b.id = new.branch_id and b.tenant_id = new.tenant_id) then
      raise exception 'Unknown branch' using errcode = '23503';
    end if;
  end if;
  new.address := nullif(btrim(new.address), '');
  new.phone := nullif(btrim(new.phone), '');
  new.email := nullif(btrim(new.email), '');
  new.website := nullif(btrim(new.website), '');
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists payslip_settings_rules on public.payslip_settings;
create trigger payslip_settings_rules before insert or update on public.payslip_settings
  for each row execute function public.payslip_settings_rules();
drop trigger if exists payslip_branch_settings_rules on public.payslip_branch_settings;
create trigger payslip_branch_settings_rules before insert or update on public.payslip_branch_settings
  for each row execute function public.payslip_settings_rules();

alter table public.payslip_settings enable row level security;
alter table public.payslip_branch_settings enable row level security;

drop policy if exists tenant_isolation on public.payslip_settings;
create policy tenant_isolation on public.payslip_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists read_company on public.payslip_settings;
create policy read_company on public.payslip_settings for select to authenticated using (true);
drop policy if exists design_write on public.payslip_settings;
create policy design_write on public.payslip_settings for all to authenticated
  using ((select public.has_module('payslip-design')))
  with check ((select public.has_module('payslip-design')));

drop policy if exists tenant_isolation on public.payslip_branch_settings;
create policy tenant_isolation on public.payslip_branch_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists read_company on public.payslip_branch_settings;
create policy read_company on public.payslip_branch_settings for select to authenticated using (true);
drop policy if exists design_write on public.payslip_branch_settings;
create policy design_write on public.payslip_branch_settings for all to authenticated
  using ((select public.has_module('payslip-design')))
  with check ((select public.has_module('payslip-design')));

revoke all on public.payslip_settings from anon;
revoke all on public.payslip_branch_settings from anon;
grant select, insert, update, delete on public.payslip_settings to authenticated;
grant select, insert, update, delete on public.payslip_branch_settings to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. year to date and the payslip's run
-- ---------------------------------------------------------------------------------------------
-- the country of an employee's payslip for a month (else the employee's country now)
create or replace function public.payslip_country(p_tenant uuid, p_employee text, p_pay_period text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select public.tidy_country(h.country) from public.salary_history h
     where h.tenant_id = p_tenant and h.employee_id = p_employee and h.pay_period = p_pay_period
       and coalesce(btrim(h.country), '') <> '' limit 1),
    public.tidy_country(public.employee_country(p_tenant, p_employee)),
    'Kenya')
$$;
revoke all on function public.payslip_country(uuid, text, text) from public, anon, authenticated;

-- payroll sees everyone's; everyone else only their own
create or replace function public.payslip_details_allowed(p_employee text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.has_any_module('payroll', 'hr-lifecycle')), false)
      or coalesce(p_employee is not null and p_employee = (select public.current_employee_number()), false)
$$;
revoke all on function public.payslip_details_allowed(text) from public, anon, authenticated;

create or replace function public.payslip_ytd(p_employee text, p_pay_period text)
returns table (
  currency text, months integer, gross_pay numeric, taxable_pay numeric, taxable_months integer, paye_tax numeric,
  nssf_deduction numeric, net_pay numeric, country text, tax_year_start text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_country text;
  v_year integer;
  v_month integer;
  v_start text;
begin
  if v_tenant is null or p_pay_period is null or p_pay_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return;
  end if;
  if not public.payslip_details_allowed(p_employee) then
    raise exception 'You can only see your own payslips' using errcode = '42501';
  end if;
  v_country := public.payslip_country(v_tenant, p_employee, p_pay_period);
  v_year := split_part(p_pay_period, '-', 1)::integer;
  v_month := split_part(p_pay_period, '-', 2)::integer;
  -- Uganda's tax year runs July to June; Kenya's and Tanzania's January to December
  if v_country = 'Uganda' then
    v_start := case when v_month >= 7 then v_year else v_year - 1 end::text || '-07';
  else
    v_start := v_year::text || '-01';
  end if;
  return query
  select coalesce(nullif(upper(btrim(h.currency)), ''), 'KES') as currency,
         count(*)::integer,
         coalesce(sum(h.gross_pay), 0)::numeric,
         coalesce(sum(h.taxable_pay), 0)::numeric,
         count(h.taxable_pay)::integer,
         coalesce(sum(h.paye_tax), 0)::numeric,
         coalesce(sum(h.nssf_deduction), 0)::numeric,
         coalesce(sum(h.net_pay), 0)::numeric,
         v_country,
         v_start
  from public.salary_history h
  join public.payroll_run_countries c
    on c.run_id = h.run_id and c.tenant_id = h.tenant_id and lower(c.country) = lower(coalesce(nullif(btrim(h.country), ''), 'Kenya'))
  where h.tenant_id = v_tenant
    and h.employee_id = p_employee
    and c.status in ('approved', 'paid')
    and coalesce(public.tidy_country(h.country), 'Kenya') = v_country
    and h.pay_period >= v_start
    and h.pay_period < p_pay_period
  group by 1
  order by 1;
end $$;
revoke all on function public.payslip_ytd(text, text) from public, anon;
grant execute on function public.payslip_ytd(text, text) to authenticated, service_role;

create or replace function public.payslip_run_details(p_employee text, p_pay_period text)
returns table (run_id uuid, country text, status text, approved_at timestamptz, paid_at timestamptz)
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
  select h.run_id, c.country, c.status, c.approved_at, c.paid_at
  from public.salary_history h
  join public.payroll_run_countries c
    on c.run_id = h.run_id and c.tenant_id = h.tenant_id and lower(c.country) = lower(coalesce(nullif(btrim(h.country), ''), 'Kenya'))
  where h.tenant_id = v_tenant and h.employee_id = p_employee and h.pay_period = p_pay_period
    -- staff only see a payslip once its country is approved, so only then its run
    and ((select public.has_any_module('payroll', 'hr-lifecycle')) or c.status in ('approved', 'paid'))
  limit 1;
end $$;
revoke all on function public.payslip_run_details(text, text) from public, anon;
grant execute on function public.payslip_run_details(text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
