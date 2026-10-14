-- Salary advances can be repaid over several months, and the screens record who marked one paid.
--
--   * repayment_months: how many monthly parts payroll takes the advance back in. 1 (every existing row, and the
--     default) keeps today's behaviour: the whole amount comes off the pay of the month it was asked for. N > 1
--     takes amount / N a month from that month on (the app works the parts out; the last part evens out the cents).
--   * paid_by / paid_by_email: who marked the advance paid when finance paid it outside the app (payment_date is
--     already there). Marking it paid (status 'paid', payment_processed 'true') is what makes payroll deduct it.
--
-- Access is unchanged: the table's own policies (staff insert and read their own requests, the salary advance,
-- payroll and reports screens manage them, each company only its own) already cover the new columns.

alter table public.salary_advance add column if not exists repayment_months integer not null default 1;
alter table public.salary_advance drop constraint if exists salary_advance_repayment_months_check;
alter table public.salary_advance add constraint salary_advance_repayment_months_check
  check (repayment_months between 1 and 12);

alter table public.salary_advance add column if not exists paid_by text;
alter table public.salary_advance add column if not exists paid_by_email text;

-- payroll reads every paid advance; the queue lists by status
create index if not exists salary_advance_tenant_status_idx on public.salary_advance (tenant_id, status);
