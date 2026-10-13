-- A company's payroll settings, starting with the bank account salaries are paid from: the Equity Bank account that
-- the Eazzy Biz bulk-payment file debits ("Debit Account No."). Payroll users read and change it.

create table if not exists public.company_payroll_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  equity_debit_account text check (equity_debit_account is null or equity_debit_account ~ '^\d{6,20}$'),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.company_payroll_settings enable row level security;
drop policy if exists tenant_isolation on public.company_payroll_settings;
create policy tenant_isolation on public.company_payroll_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists payroll_all on public.company_payroll_settings;
create policy payroll_all on public.company_payroll_settings for all to authenticated
  using (public.has_module('payroll')) with check (public.has_module('payroll'));
revoke all on public.company_payroll_settings from anon;

drop trigger if exists audit_company_payroll_settings on public.company_payroll_settings;
create trigger audit_company_payroll_settings after insert or update or delete on public.company_payroll_settings
  for each row execute function public.audit_row_change();

notify pgrst, 'reload schema';
