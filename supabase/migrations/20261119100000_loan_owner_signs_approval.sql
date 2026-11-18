-- The lender approval on a loan form can be signed by whoever manages loans (Staff loans, Payroll, administrators: e.g.
-- the company's owner or operations), not only the person who gave the final approval, while it is unsigned. Also on
-- loans already paid out, and on loans approved before the form existed (their form is made then). They give their
-- designation (e.g. "Owner"). A signed approval is never replaced, and nobody signs the approval of their own loan.
-- Safe to run again.

create or replace function public.loan_form_sign_approver(p_loan uuid, p_signature text, p_name text, p_title text default null)
returns public.employee_loan_forms
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  f public.employee_loan_forms;
begin
  select * into l from public.employee_loans where id = p_loan and tenant_id = public.current_tenant_id();
  if l.id is null or not (l.decided_by = auth.uid() or public.manages_loans()) then
    raise exception 'Only the approver, or someone who manages loans, signs the approval' using errcode = '42501';
  end if;
  if l.employee_number = public.current_employee_number() then
    raise exception 'Someone else must sign the approval of your own loan' using errcode = '42501';
  end if;
  if l.status not in ('approved', 'disbursed', 'repaying', 'completed') then
    raise exception 'The loan is not approved' using errcode = '22023';
  end if;
  -- a loan approved before the form existed gets its form now (nothing holds its payout)
  insert into public.employee_loan_forms (loan_id, tenant_id, required)
  values (l.id, l.tenant_id, false)
  on conflict (loan_id) do nothing;
  perform public.loan_form_check(p_loan);
  select * into f from public.employee_loan_forms where loan_id = p_loan;
  if f.approver_signature is not null then
    raise exception 'The approval is already signed' using errcode = '22023';
  end if;
  if p_signature is null or not public.is_signature_image(p_signature) then
    raise exception 'Draw your signature under My signature first' using errcode = '22023';
  end if;
  update public.employee_loan_forms
  set approver_signature = p_signature, approver_name = left(nullif(btrim(coalesce(p_name, '')), ''), 200),
      approver_title = left(nullif(btrim(coalesce(p_title, '')), ''), 200), approver_signed_at = now(), updated_at = now()
  where loan_id = p_loan returning * into f;
  return f;
end $$;

notify pgrst, 'reload schema';
