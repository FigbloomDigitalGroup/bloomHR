-- HR attaches the signed form of a loan already paid out: signed on paper by someone not on the platform (a guarantor,
-- witness or approver), scanned to PDF. It is kept as the loan's signed form and counts as accepted (the loan was paid
-- out already, so nothing else changes). A loan without a form (approved before the form existed) gets one. A loan
-- whose signed copy was accepted already keeps it: it isn't replaced. Approved loans not yet paid out go on as before
-- (an upload, then HR's review). The file is in the loan-forms bucket like any signed copy (signed-<random>.pdf in the
-- loan's folder, which HR may upload to). Safe to run again.

create or replace function public.loan_form_attach(p_loan uuid, p_path text, p_file_name text default null)
returns public.employee_loan_forms
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  f public.employee_loan_forms;
begin
  if not public.manages_loans() then
    raise exception 'Only HR attaches a signed form' using errcode = '42501';
  end if;
  select * into l from public.employee_loans where id = p_loan and tenant_id = public.current_tenant_id();
  if l.id is null then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if l.status not in ('disbursed', 'repaying', 'completed') then
    raise exception 'Attach a signed form to a loan already paid out; before payout, upload it for review' using errcode = '22023';
  end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> l.tenant_id::text or split_part(p_path, '/', 2) <> l.id::text
     or split_part(p_path, '/', 3) not like 'signed-%' or split_part(p_path, '/', 4) <> '' then
    raise exception 'The signed form must be saved in the loan''s own folder' using errcode = '23514';
  end if;
  if lower(p_path) !~ '\.pdf$' then
    raise exception 'The signed form must be a PDF' using errcode = '23514';
  end if;
  insert into public.employee_loan_forms (loan_id, tenant_id, required)
  values (l.id, l.tenant_id, false)
  on conflict (loan_id) do nothing;
  select * into f from public.employee_loan_forms where loan_id = p_loan for update;
  if f.status = 'accepted' and f.file_path is not null then
    raise exception 'This loan already has its signed form: it isn''t replaced' using errcode = '22023';
  end if;
  update public.employee_loan_forms
  set status = 'accepted', file_path = p_path, file_name = left(nullif(btrim(coalesce(p_file_name, '')), ''), 255),
      uploaded_by = auth.uid(), uploaded_at = now(), send_back_reason = null,
      reviewed_by = coalesce(reviewed_by, auth.uid()), reviewed_at = coalesce(reviewed_at, now()), updated_at = now()
  where loan_id = p_loan returning * into f;
  return f;
end $$;
revoke all on function public.loan_form_attach(uuid, text, text) from public, anon;
grant execute on function public.loan_form_attach(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
