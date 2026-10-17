-- Editing a payslip while its payroll run is a draft (FIG-883).
--
--   payslip_overrides      one row per run + employee: the payroll user's edits to that payslip, as jsonb
--                            {"fields": {"basic_salary": 50000, "house_allowance": ...},   amounts typed in
--                             "earning_amounts": {"Commission": 3000},                      an earning line's new amount
--                             "one_off_earnings": [{"label", "amount", "taxable"}],         this month only
--                             "one_off_deductions": [{"label", "amount"}],                  this month only
--                             "note": "..."}                                                shown on the payslip
--                          The browser applies them on top of the calculated payslip every time the run is worked out
--                          again (src/lib/payslipOverrides.ts), so recalculating keeps them. PAYE, NSSF, SHIF, the
--                          housing levy and net pay are never typed in: they are worked out from the edited earnings.
--   payslip_edits          the history: who changed which payslip when, each figure before -> after, and why.
--                          Rows are only ever added (no one can change or delete one); they are kept when a draft run
--                          is discarded, and are found by pay period + employee.
--   salary_history.payslip_note   the note, on the saved payslip staff see.
--   save_payslip_edit / remove_payslip_edits   save (or clear) a payslip's edits and its history row together.
--
-- Edits are saved only while the month's run is a draft, only by people with the payroll module, and each company
-- only sees its own (restrictive tenant_isolation).

-- ---------------------------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.payslip_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id text not null check (btrim(employee_id) <> ''),
  overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides) = 'object'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index if not exists payslip_overrides_tenant_idx on public.payslip_overrides (tenant_id);

create table if not exists public.payslip_edits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  -- no foreign key: the history stays when a draft run is discarded
  run_id uuid not null,
  pay_period text not null check (pay_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  employee_id text not null check (btrim(employee_id) <> ''),
  action text not null default 'edited' check (action in ('edited', 'removed')),
  -- [{"field": "Basic", "before": 50000, "after": 55000}, ...]
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  -- the edits after this change ({} once removed)
  overrides jsonb not null default '{}'::jsonb,
  reason text not null check (btrim(reason) <> ''),
  edited_by uuid default auth.uid() references auth.users(id) on delete set null,
  edited_by_name text,
  edited_at timestamptz not null default now()
);
create index if not exists payslip_edits_lookup_idx on public.payslip_edits (tenant_id, pay_period, employee_id);

alter table public.salary_history add column if not exists payslip_note text;

-- ---------------------------------------------------------------------------------------------
-- access
-- ---------------------------------------------------------------------------------------------
alter table public.payslip_overrides enable row level security;
alter table public.payslip_edits enable row level security;

drop policy if exists tenant_isolation on public.payslip_overrides;
create policy tenant_isolation on public.payslip_overrides as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists module_all on public.payslip_overrides;
create policy module_all on public.payslip_overrides for all to authenticated
  using ((select public.has_module('payroll')))
  with check ((select public.has_module('payroll')));

drop policy if exists tenant_isolation on public.payslip_edits;
create policy tenant_isolation on public.payslip_edits as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists module_read on public.payslip_edits;
create policy module_read on public.payslip_edits for select to authenticated
  using ((select public.has_module('payroll')));
drop policy if exists module_insert on public.payslip_edits;
create policy module_insert on public.payslip_edits for insert to authenticated
  with check ((select public.has_module('payroll')) and edited_by = (select auth.uid()));

revoke all on public.payslip_overrides from anon;
revoke all on public.payslip_edits from anon;
-- the history is only ever added to
revoke update, delete, truncate on public.payslip_edits from authenticated;

-- ---------------------------------------------------------------------------------------------
-- only while the run is a draft
-- ---------------------------------------------------------------------------------------------
create or replace function public.payslip_edit_run_is_draft() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  run public.payroll_runs;
  row_run uuid;
  row_tenant uuid;
begin
  if tg_op = 'DELETE' then
    row_run := old.run_id;
    row_tenant := old.tenant_id;
  else
    row_run := new.run_id;
    row_tenant := new.tenant_id;
  end if;

  -- the company itself is being deleted
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  select * into run from public.payroll_runs where id = row_run;
  -- the run is being deleted (a discarded draft takes its edits with it)
  if not found and tg_op = 'DELETE' then
    return old;
  end if;
  if not found or run.tenant_id <> row_tenant then
    raise exception 'That payroll run was not found';
  end if;
  if run.status <> 'draft' then
    raise exception 'Payroll for % is %, so its payslips can''t be edited. Reopen it first.', run.pay_period, run.status;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.run_id <> old.run_id or new.employee_id <> old.employee_id or new.tenant_id <> old.tenant_id) then
    raise exception 'A payslip edit can''t be moved to another payslip';
  end if;
  if tg_table_name = 'payslip_overrides' and tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  if tg_table_name = 'payslip_edits' then
    new.pay_period := run.pay_period;
    new.edited_at := now();
  end if;
  return new;
end $$;

drop trigger if exists payslip_overrides_draft_only on public.payslip_overrides;
create trigger payslip_overrides_draft_only before insert or update or delete on public.payslip_overrides
  for each row execute function public.payslip_edit_run_is_draft();

drop trigger if exists payslip_edits_draft_only on public.payslip_edits;
create trigger payslip_edits_draft_only before insert on public.payslip_edits
  for each row execute function public.payslip_edit_run_is_draft();

-- ---------------------------------------------------------------------------------------------
-- save / remove, with the history row, in one go (runs as the caller: the policies above apply)
-- ---------------------------------------------------------------------------------------------
create or replace function public.save_payslip_edit(
  p_run_id uuid, p_employee_id text, p_overrides jsonb, p_changes jsonb, p_reason text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  saved uuid;
  period text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the payslip is being changed';
  end if;
  select pay_period into period from public.payroll_runs where id = p_run_id;
  if period is null then
    raise exception 'That payroll run was not found';
  end if;

  insert into public.payslip_overrides (run_id, employee_id, overrides)
  values (p_run_id, p_employee_id, coalesce(p_overrides, '{}'::jsonb))
  on conflict (run_id, employee_id) do update set overrides = excluded.overrides
  returning id into saved;

  insert into public.payslip_edits (run_id, pay_period, employee_id, action, changes, overrides, reason, edited_by_name)
  values (p_run_id, period, p_employee_id, 'edited', coalesce(p_changes, '[]'::jsonb), coalesce(p_overrides, '{}'::jsonb),
          btrim(p_reason), (select coalesce(nullif(btrim(full_name), ''), email) from public.user_profiles where user_id = auth.uid()
            order by (tenant_id = public.current_tenant_id()) desc limit 1));
  return saved;
end $$;

create or replace function public.remove_payslip_edits(
  p_run_id uuid, p_employee_id text, p_changes jsonb, p_reason text
) returns void
language plpgsql security invoker set search_path = public as $$
declare
  period text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the edits are being removed';
  end if;
  select pay_period into period from public.payroll_runs where id = p_run_id;
  if period is null then
    raise exception 'That payroll run was not found';
  end if;

  delete from public.payslip_overrides where run_id = p_run_id and employee_id = p_employee_id;
  if not found then
    raise exception 'That payslip has no edits to remove';
  end if;

  insert into public.payslip_edits (run_id, pay_period, employee_id, action, changes, overrides, reason, edited_by_name)
  values (p_run_id, period, p_employee_id, 'removed', coalesce(p_changes, '[]'::jsonb), '{}'::jsonb, btrim(p_reason),
          (select coalesce(nullif(btrim(full_name), ''), email) from public.user_profiles where user_id = auth.uid()
            order by (tenant_id = public.current_tenant_id()) desc limit 1));
end $$;

revoke all on function public.save_payslip_edit(uuid, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.save_payslip_edit(uuid, text, jsonb, jsonb, text) to authenticated, service_role;
revoke all on function public.remove_payslip_edits(uuid, text, jsonb, text) from public, anon;
grant execute on function public.remove_payslip_edits(uuid, text, jsonb, text) to authenticated, service_role;
