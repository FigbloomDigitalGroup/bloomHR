-- The witness is optional: a loan form signed in the app is ready for HR to review once the borrower has signed and
-- (when the company requires the form) the guarantor has. A witness who signs still goes on the form. After HR sends a
-- form back, it is ready again once something on it changed (a signature, a witness) since. Forms waiting only for a
-- witness are ready now; HR hears of them when the borrower or guarantor next signs, or sees them on the Loans page.
-- (20261118200000's loan_form_signed_in_app and accepted-form check.) Safe to run again.

create or replace function public.loan_form_signed_in_app(f public.employee_loan_forms) returns boolean
language sql stable security definer set search_path = public as $$
  select f.status in ('none', 'sent_back') and f.borrower_signature is not null
    and (f.reviewed_at is null or f.updated_at > f.reviewed_at)
    and (not f.required or exists (select 1 from public.employee_loan_guarantors g where g.loan_id = f.loan_id and g.status = 'signed'))
$$;
grant execute on function public.loan_form_signed_in_app(public.employee_loan_forms) to authenticated;

-- an accepted form has an uploaded copy or the borrower's signature in the app (no longer the witness's too)
alter table public.employee_loan_forms drop constraint if exists employee_loan_forms_accepted_is_signed;
alter table public.employee_loan_forms add constraint employee_loan_forms_accepted_is_signed
  check (status <> 'accepted' or file_path is not null or borrower_signature is not null);

notify pgrst, 'reload schema';
