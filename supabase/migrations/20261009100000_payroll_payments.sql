-- Paying an approved payroll run from the server, by M-Pesa or by bank, one record per employee (FIG-744).
--
-- Bulk M-Pesa pay used to run in the browser with nothing saved per person, so an interrupted run could not be
-- resumed without paying some people twice. Now:
--
--   payroll_payments(run_id, employee_number, channel, where to pay, amount, status, request ids, receipt, result)
--
--   channel  -> 'mpesa' (phone) or 'bank' (bank, branch, account number, account name)
--   queued   -> waiting for the payment worker of its channel (the server that holds the credentials)
--   sending  -> the worker has taken it and is calling M-Pesa or the bank
--   sent     -> the request was accepted; the result comes later
--   paid     -> M-Pesa or the bank confirmed the transfer (receipt is set)
--   failed   -> refused, or reported as failed (result_desc says why); safe to retry
--   unknown  -> the call broke off, so it is not known whether it went through; never sent again automatically
--
-- Only the server writes these rows (service role). Payroll users read them. One row per employee per run, so
-- nobody can be queued twice, and the workers only pay runs that are approved (or already marked paid).

create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  run_id uuid not null references public.payroll_runs(id) on delete restrict,
  employee_number text not null,
  employee_name text,
  channel text not null check (channel in ('mpesa', 'bank')),
  phone text,
  bank_name text,
  bank_branch text,
  account_number text,
  account_name text,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'paid', 'failed', 'unknown')),
  attempts integer not null default 0,
  -- ours, new for every attempt: M-Pesa (OriginatorConversationID) or the bank matches its result to it
  request_id text unique,
  -- theirs: Safaricom's ConversationID or the bank's reference for the accepted request
  provider_ref text,
  -- the M-Pesa receipt or bank transaction reference of a completed payment
  receipt text,
  result_code text,
  result_desc text,
  queued_by uuid references auth.users(id) on delete set null,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (run_id, employee_number),
  constraint payroll_payments_destination check (
    (channel = 'mpesa' and phone ~ '^254[17]\d{8}$')
    or (channel = 'bank' and nullif(trim(bank_name), '') is not null and account_number ~ '^\d{5,20}$')
  )
);

create index if not exists payroll_payments_queue_idx on public.payroll_payments (channel, status, queued_at);
create index if not exists payroll_payments_tenant_run_idx on public.payroll_payments (tenant_id, run_id);

alter table public.payroll_payments enable row level security;

drop policy if exists tenant_isolation on public.payroll_payments;
create policy tenant_isolation on public.payroll_payments as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- read on the payroll page; no insert, update or delete policy: only the server (service role) writes
drop policy if exists module_read on public.payroll_payments;
create policy module_read on public.payroll_payments for select to authenticated
  using (public.has_module('payroll'));

revoke all on public.payroll_payments from anon;

-- ---------------------------------------------------------------------------------------------
-- a worker takes a batch to send
-- ---------------------------------------------------------------------------------------------
-- Marks up to p_limit queued payments of one channel, from approved (or paid) runs, as sending, with a fresh request
-- id each, and returns them. SKIP LOCKED lets two workers run without taking the same payment.
create or replace function public.claim_payroll_payments(p_channel text, p_limit integer)
returns setof public.payroll_payments
language sql security definer set search_path = public as $$
  update public.payroll_payments p
  set status = 'sending',
      attempts = p.attempts + 1,
      request_id = 'PAYROLL-' || gen_random_uuid()::text,
      provider_ref = null,
      result_code = null,
      result_desc = null,
      sent_at = null,
      updated_at = now()
  where p.id in (
    select q.id
    from public.payroll_payments q
    join public.payroll_runs r on r.id = q.run_id
    where q.channel = p_channel and q.status = 'queued' and r.status in ('approved', 'paid')
    order by q.queued_at, q.id
    limit greatest(p_limit, 0)
    for update of q skip locked
  )
  returning p.*;
$$;

revoke all on function public.claim_payroll_payments(text, integer) from public, anon, authenticated;
grant execute on function public.claim_payroll_payments(text, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- an approved run stays approved once money has gone out
-- ---------------------------------------------------------------------------------------------
-- Reopening it would let its payslips change after people were paid. Queued and failed payments do not count (no
-- money moved): reopening removes them, so approving again queues the recalculated amounts, never the old ones.
create or replace function public.payroll_run_reopen_unpaid_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'approved' and new.status = 'draft' then
    if exists (
      select 1 from public.payroll_payments
      where run_id = old.id and status in ('sending', 'sent', 'paid', 'unknown')
    ) then
      raise exception 'Payroll for % can''t be reopened: payments for it have already been sent.', old.pay_period;
    end if;
    delete from public.payroll_payments where run_id = old.id and status in ('queued', 'failed');
  end if;
  return new;
end $$;

drop trigger if exists payroll_run_reopen_unpaid_only on public.payroll_runs;
create trigger payroll_run_reopen_unpaid_only before update on public.payroll_runs
  for each row execute function public.payroll_run_reopen_unpaid_only();
