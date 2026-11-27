-- Finance hears of every salary advance request as it is made, as admins do (20261127100000).
--
-- 'salary_advance_requested' now goes to the roles with "Payments to make" (the 'payments' module: finance, who are
-- told by payment_due when an approved advance is ready to pay) as well as to ADMIN, who always gets HR alerts.
-- Someone who both approves advances and pays them hears twice: "awaiting your approval" from the chain, and this.

-- (20261127100000's, with finance for salary_advance_requested)
create or replace function public.hr_alert_modules(p_type text) returns text[] language sql immutable as $$
  select case
    when p_type in ('leave_recommended', 'leave_exhausted', 'leave_document_overdue') then array['leaves']
    when p_type = 'possible_absences' then array['leaves', 'employees']
    when p_type = 'application_received' then array['recruitment']
    when p_type in ('loan_requested', 'contribution_requested') then array['payroll']
    when p_type = 'casual_limit' then array['work-records', 'payroll']
    when p_type in ('payment_due', 'salary_advance_requested') then array['payments']
    when p_type = 'requisition_requested' then array['requisitions']
    -- contract_expiring, probation_expiring, contract_signed, exit_requested, and any HR-facing type added later
    else array['employees', 'hr-lifecycle']
  end
$$;
