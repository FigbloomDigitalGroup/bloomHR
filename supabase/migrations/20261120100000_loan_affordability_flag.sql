-- Loans over an affordability flag need the approver to confirm they checked it, instead of a hard limit.
--
--   loan_settings.affordability_flag_percent   e.g. 30: a loan whose monthly repayment is over 30% of the borrower's
--                                              net pay, or whose net pay isn't known, is flagged. Empty: no flag.
--   employee_loan_affordability                one per loan: who confirmed they checked the borrower can afford it,
--                                              when, and the net pay and share they saw. loan_confirm_affordability()
--                                              writes it, for whoever manages loans or pays them out (Staff loans,
--                                              Payroll, Payments), never the borrower; it also fills "Affordability
--                                              assessment completed by" on the form when empty.
--   employee_loans.affordability_checked_*     HR setting up a loan (New loan) confirms it on the loan itself.
--   loan_affordability(ids)                    each loan's net pay, repayment share and flag, for the loan cards.
--   employee_loans_within_pay                  (20261119300000's) approving a flagged loan without the confirmation
--                                              is refused, for whoever approves. Loans under the flag are approved as
--                                              before; the limits (20261119300000) are unchanged and are settings.
-- Net pay is loan_net_pay(): the current payslip's, else the form's correction, else what the borrower gave. Safe to
-- run again.

alter table public.loan_settings
  add column if not exists affordability_flag_percent numeric
    check (affordability_flag_percent is null or (affordability_flag_percent > 0 and affordability_flag_percent <= 100));

alter table public.employee_loans
  add column if not exists affordability_checked_by uuid references auth.users(id) on delete set null,
  add column if not exists affordability_checked_at timestamptz;

create table if not exists public.employee_loan_affordability (
  loan_id uuid primary key references public.employee_loans(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  checked_by uuid references auth.users(id) on delete set null,
  checked_by_name text check (checked_by_name is null or length(checked_by_name) <= 200),
  checked_at timestamptz not null default now(),
  net_pay numeric,
  share_percent numeric
);
alter table public.employee_loan_affordability enable row level security;
drop policy if exists tenant_isolation on public.employee_loan_affordability;
create policy tenant_isolation on public.employee_loan_affordability as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists read_staff on public.employee_loan_affordability;
create policy read_staff on public.employee_loan_affordability for select to authenticated
  using ((select public.reads_loan_forms()));
revoke all on public.employee_loan_affordability from anon;
revoke insert, update, delete on public.employee_loan_affordability from authenticated;
drop trigger if exists audit_employee_loan_affordability on public.employee_loan_affordability;
create trigger audit_employee_loan_affordability after insert or update or delete on public.employee_loan_affordability
  for each row execute function public.audit_row_change();

-- the repayment's share of net pay (null: net pay unknown or nothing)
create or replace function public.loan_share_of_net(p_net numeric, p_instalment numeric) returns numeric
language sql immutable as $$
  select case when p_net is null or p_net <= 0 then null else round(coalesce(p_instalment, 0) * 100 / p_net, 1) end
$$;

-- over the flag: the share above it, or net pay unknown
create or replace function public.loan_over_affordability_flag(
  p_tenant uuid, p_employee text, p_loan uuid, p_stated numeric, p_instalment numeric, p_flag numeric
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_share numeric := public.loan_share_of_net(public.loan_net_pay(p_tenant, p_employee, p_loan, p_stated), p_instalment);
begin
  return p_flag is not null and (v_share is null or v_share > p_flag);
end $$;
revoke all on function public.loan_over_affordability_flag(uuid, text, uuid, numeric, numeric, numeric) from public, anon, authenticated;

-- Each loan's net pay, repayment share and whether it is over the flag (for HR and finance's loan cards).
create or replace function public.loan_affordability(p_loans uuid[])
returns table (loan_id uuid, net_pay numeric, share_percent numeric, flag_percent numeric, over_flag boolean,
               checked_by_name text, checked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_flag numeric := (select s.affordability_flag_percent from public.loan_settings s where s.tenant_id = public.current_tenant_id());
begin
  if not public.reads_loan_forms() then
    raise exception 'Only HR and finance see loans'' affordability' using errcode = '42501';
  end if;
  return query
  select l.id, n.net, public.loan_share_of_net(n.net, l.monthly_instalment), v_flag,
         v_flag is not null and (public.loan_share_of_net(n.net, l.monthly_instalment) is null
                                 or public.loan_share_of_net(n.net, l.monthly_instalment) > v_flag),
         coalesce(a.checked_by_name, case when l.affordability_checked_by is not null then 'HR (set up the loan)' end),
         coalesce(a.checked_at, l.affordability_checked_at)
  from public.employee_loans l
  cross join lateral (select public.loan_net_pay(l.tenant_id, l.employee_number, l.id, l.stated_net_pay) as net) n
  left join public.employee_loan_affordability a on a.loan_id = l.id
  where l.tenant_id = public.current_tenant_id() and l.id = any(p_loans);
end $$;
revoke all on function public.loan_affordability(uuid[]) from public, anon;
grant execute on function public.loan_affordability(uuid[]) to authenticated;

-- HR or finance confirm they checked the borrower can afford the loan (before approving a flagged one).
create or replace function public.loan_confirm_affordability(p_loan uuid, p_name text default null)
returns public.employee_loan_affordability
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  a public.employee_loan_affordability;
  v_net numeric;
  v_name text := left(nullif(btrim(coalesce(p_name, '')), ''), 200);
begin
  if not public.reads_loan_forms() then
    raise exception 'Only HR or finance confirm a loan''s affordability' using errcode = '42501';
  end if;
  select * into l from public.employee_loans where id = p_loan and tenant_id = public.current_tenant_id();
  if l.id is null then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if l.employee_number = public.current_employee_number() then
    raise exception 'Someone else must check the affordability of your own loan' using errcode = '42501';
  end if;
  if l.status <> 'requested' then
    raise exception 'Affordability is confirmed before the loan is approved' using errcode = '22023';
  end if;
  v_net := public.loan_net_pay(l.tenant_id, l.employee_number, l.id, l.stated_net_pay);
  insert into public.employee_loan_affordability (loan_id, tenant_id, checked_by, checked_by_name, checked_at, net_pay, share_percent)
  values (l.id, l.tenant_id, auth.uid(), v_name, now(), v_net, public.loan_share_of_net(v_net, l.monthly_instalment))
  on conflict (loan_id) do update set checked_by = excluded.checked_by, checked_by_name = excluded.checked_by_name,
    checked_at = now(), net_pay = excluded.net_pay, share_percent = excluded.share_percent
  returning * into a;
  -- the form's "Affordability assessment completed by", when nobody filled it in
  update public.employee_loan_forms set affordability_by = v_name, updated_at = now()
  where loan_id = l.id and affordability_by is null and v_name is not null;
  return a;
end $$;
revoke all on function public.loan_confirm_affordability(uuid, text) from public, anon;
grant execute on function public.loan_confirm_affordability(uuid, text) to authenticated;

-- (20261119300000's, with the affordability flag)
create or replace function public.employee_loans_within_pay() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.loan_settings;
  v_basic numeric;
  v_net numeric;
  v_room numeric;
  v_cap numeric;
  v_staff_request boolean;
  v_approving boolean;
  v_rule text;
begin
  -- a staff request can't carry a confirmation; HR setting up a loan confirms it as themselves
  if tg_op = 'INSERT' then
    if public.manages_loans() and new.affordability_checked_by is not null then
      new.affordability_checked_by := auth.uid();
      new.affordability_checked_at := now();
    else
      new.affordability_checked_by := null;
      new.affordability_checked_at := null;
    end if;
  end if;
  select * into s from public.loan_settings where tenant_id = new.tenant_id;
  if s.max_instalment_divisor is null and s.min_take_home_divisor is null and s.affordability_flag_percent is null then
    return new;
  end if;
  v_staff_request := new.status = 'requested' and not public.manages_loans()
    and (tg_op = 'INSERT' or (new.principal, new.months, new.annual_rate, new.interest_method, new.stated_net_pay, new.other_loan_repayments)
         is distinct from (old.principal, old.months, old.annual_rate, old.interest_method, old.stated_net_pay, old.other_loan_repayments));
  v_approving := new.status = 'approved' and (tg_op = 'INSERT' or old.status = 'requested');
  if not (v_staff_request or v_approving) then
    return new;
  end if;
  v_basic := coalesce(public.loan_basic_salary(new.tenant_id, new.employee_number), 0);

  -- 1. a share of basic salary (staff requests)
  if v_staff_request and s.max_instalment_divisor is not null then
    v_cap := v_basic / s.max_instalment_divisor;
    v_rule := 'your basic salary divided by ' || trim(to_char(s.max_instalment_divisor, 'FM999990.##'));
  end if;

  -- 2. take-home pay left after the repayment and other loans
  if s.min_take_home_divisor is not null then
    v_net := public.loan_net_pay(new.tenant_id, new.employee_number, new.id, new.stated_net_pay);
    if v_net is null then
      if v_approving then
        raise exception 'Confirm the borrower''s current net pay (Correct details on the loan form) before approving: the repayment must leave them at least % take-home',
          public.kes(v_basic / s.min_take_home_divisor) using errcode = '23514';
      end if;
      raise exception 'Give your current net monthly pay, so we can check you can afford the repayment' using errcode = '23514';
    end if;
    v_room := v_net - coalesce(new.other_loan_repayments, 0) - v_basic / s.min_take_home_divisor;
    if v_cap is null or v_room < v_cap then
      v_cap := greatest(v_room, 0);
      v_rule := 'what your net pay of ' || public.kes(v_net) || ' leaves after other loans and the minimum take-home of '
                || public.kes(v_basic / s.min_take_home_divisor);
    end if;
  end if;

  -- 3. over the flag (or net pay unknown): whoever approves must have confirmed they checked affordability
  if v_approving and s.affordability_flag_percent is not null
     and public.loan_over_affordability_flag(new.tenant_id, new.employee_number, new.id, new.stated_net_pay, new.monthly_instalment,
                                             s.affordability_flag_percent)
     and new.affordability_checked_by is null
     and not exists (select 1 from public.employee_loan_affordability a where a.loan_id = new.id) then
    raise exception 'The repayment of % a month is over % of the borrower''s net pay (or their net pay isn''t known): confirm you have checked they can afford it before approving',
      public.kes(new.monthly_instalment), trim(to_char(s.affordability_flag_percent, 'FM990.##')) || '%' using errcode = '23514';
  end if;

  -- a shilling of rounding in the instalment is allowed
  if v_cap is not null and coalesce(new.monthly_instalment, 0) > v_cap + 1 then
    if v_approving and not v_staff_request then
      raise exception 'The repayment of % a month would leave % less than the minimum take-home pay: % is the most it can be',
        public.kes(new.monthly_instalment), case when new.employee_number = public.current_employee_number() then 'you' else 'the borrower' end,
        public.kes(floor(v_cap)) using errcode = '23514';
    end if;
    raise exception 'Your monthly repayment can be at most % (%): over % months you can borrow up to %',
      public.kes(floor(v_cap)), v_rule, new.months,
      public.kes(public.loan_most_for_instalment(v_cap, new.annual_rate, new.months, new.interest_method))
      using errcode = '23514';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
