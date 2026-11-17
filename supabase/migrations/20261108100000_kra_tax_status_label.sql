-- Onboarding missing-lists: "Type of employee" is now "KRA tax status (Primary or Secondary)".
-- After 20261107100000_my_hr_api. Written to run again safely. No column or option value changes.
--
-- The KRA P10 field kra_employee_type ('Primary Employee' / 'Secondary Employee') was listed as "Type of employee",
-- which read like the employment type (Permanent, Contract, Casual...). The forms now call it "KRA tax status".
--
--   1. onboarding_missing_details (from 20261021100000_uganda_payroll, unchanged otherwise) names it
--      'KRA tax status (Primary or Secondary)' in Kenya and 'Tax status (Primary or Secondary)' in Tanzania and Uganda
--      (no KRA there, as the tax number is a TIN). onboarding_missing and everything built on it pick that up.
--   2. onboarding_item_key (from 20261021700000_onboarding_essentials) maps both new labels and the old
--      'Type of employee' to 'employee_type', so saved lists and anything still passing the old text keep working.

create or replace function public.onboarding_missing_details(e public.employees, p_part text default 'all') returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  m text[] := '{}';
  blank constant text := '^\s*$';
  by_bank boolean := coalesce(e.payment_method, '') !~* 'mpesa|m-pesa|mobile|airtel|safaricom|cash'
                     and coalesce(btrim(e.payment_method), '') <> '';
  v_country text := public.employee_row_country(e.tenant_id, e.branch_id, e."Branch");
  v_tax text := public.tax_number_label(v_country);
begin
  if p_part in ('employee', 'all') then
    if coalesce(e."Last Name", '') ~ blank then m := m || text 'Surname'; end if;
    if coalesce(e."First Name", '') ~ blank then m := m || text 'First name'; end if;
    if coalesce(e."Date of Birth", '') ~ blank then m := m || text 'Date of birth'; end if;
    if coalesce(e."Gender", '') ~ blank then m := m || text 'Sex'; end if;
    if coalesce(e.nationality, '') ~ blank then m := m || text 'Nationality'; end if;
    if coalesce(e.residential_address, '') ~ blank then m := m || text 'Residential address'; end if;
    if coalesce(e."Personal Email", '') ~ blank then m := m || text 'Personal email'; end if;
    if e."Type of Identification" is null then m := m || text 'Identity type'; end if;
    if e."ID Number" is null then m := m || text 'ID number';
    elsif not public.identity_number_ok_in(v_country, e."Type of Identification", e."ID Number") then m := m || text 'ID number (not valid)'; end if;
    if e."Tax PIN" is null then m := m || v_tax;
    elsif not public.tax_number_ok(v_country, e."Tax PIN") then m := m || (v_tax || ' (not valid)'); end if;
    if public.needs_sha_number(v_country) then
      if e."SHIF Number" is null then m := m || text 'SHA number';
      elsif not public.sha_number_ok(e."SHIF Number") then m := m || text 'SHA number (not valid)'; end if;
    end if;
    if e."NSSF Number" is null then m := m || text 'NSSF number';
    elsif not public.social_security_number_ok(v_country, e."NSSF Number") then m := m || text 'NSSF number (not valid)'; end if;
    if public.tidy_country(v_country) = 'Tanzania' and e.heslb_borrower and e.heslb_index_number is null then
      m := m || text 'HESLB index number';
    end if;
    if e."Mobile Number" is null then m := m || text 'Phone number';
    elsif not public.phone_ok(e."Mobile Number") then m := m || text 'Phone number (not valid)'; end if;
    if e.kra_residency is null then m := m || text 'Residency'; end if;
    if e.is_pwd is null then m := m || text 'Disability (PWD) status';
    elsif e.is_pwd and e."Disability Cert No" is null then m := m || text 'Exemption certificate number'; end if;
    if by_bank then
      if coalesce(e."Bank", '') ~ blank then m := m || text 'Bank name'; end if;
      if coalesce(e."Bank Branch", '') ~ blank then m := m || text 'Bank branch'; end if;
      if coalesce(e.account_number_name, '') ~ blank then m := m || text 'Account name'; end if;
      if coalesce(e."Account Number", '') ~ blank then m := m || text 'Account number'; end if;
    end if;
    if not exists (select 1 from public.emergency_contact c where c.tenant_id = e.tenant_id
                   and c."Employee Number" = e."Employee Number" and coalesce(c.full_name, '') !~ blank
                   and coalesce(c.phone_number, '') !~ blank) then
      m := m || text 'Emergency contact';
    end if;
    if not exists (select 1 from public.next_of_kin k where k.tenant_id = e.tenant_id
                   and k."Employee Number" = e."Employee Number") then
      m := m || text 'Next of kin';
    end if;
  end if;

  if p_part in ('employer', 'all') then
    if coalesce(e."Job Title", '') ~ blank then m := m || text 'Position'; end if;
    if e.kra_employee_type is null then
      m := m || (case when coalesce(public.tidy_country(v_country), 'Kenya') in ('Tanzania', 'Uganda') then 'Tax status'
                      else 'KRA tax status' end || ' (Primary or Secondary)');
    end if;
    if coalesce(e."Basic Salary", 0) <= 0 then m := m || text 'Basic salary'; end if;
    if coalesce(e.payment_method, '') ~ blank then m := m || text 'Payment method'; end if;
  end if;
  return m;
end $$;
revoke all on function public.onboarding_missing_details(public.employees, text) from public, anon, authenticated;

-- the key of an item a missing-list names (its label, as onboarding_missing returns it)
create or replace function public.onboarding_item_key(p_item text) returns text language sql immutable as $$
  select case
    when p_item like 'Document: %' or p_item like 'Review document: %' then 'documents'
    when p_item like 'Agreement: %' then 'policies'
    else case regexp_replace(coalesce(p_item, ''), '\s*\(not valid\)$', '')
      when 'Surname' then 'full_name'
      when 'First name' then 'full_name'
      when 'Date of birth' then 'date_of_birth'
      when 'Sex' then 'sex'
      when 'Nationality' then 'nationality'
      when 'Residential address' then 'residential_address'
      when 'Personal email' then 'personal_email'
      when 'Identity type' then 'identity'
      when 'ID number' then 'identity'
      when 'KRA PIN' then 'tax_number'
      when 'TIN' then 'tax_number'
      when 'SHA number' then 'sha_number'
      when 'NSSF number' then 'nssf_number'
      when 'HESLB index number' then 'heslb_index_number'
      when 'Phone number' then 'phone_number'
      when 'Residency' then 'residency'
      when 'Disability (PWD) status' then 'pwd_status'
      when 'Exemption certificate number' then 'pwd_status'
      when 'Bank name' then 'bank_account'
      when 'Bank branch' then 'bank_account'
      when 'Account name' then 'bank_account'
      when 'Account number' then 'bank_account'
      when 'Emergency contact' then 'emergency_contact'
      when 'Next of kin' then 'next_of_kin'
      when 'Referee' then 'referee'
      when 'Position' then 'position'
      when 'KRA tax status (Primary or Secondary)' then 'employee_type'
      when 'Tax status (Primary or Secondary)' then 'employee_type'
      when 'Type of employee' then 'employee_type'
      when 'Basic salary' then 'basic_salary'
      when 'Payment method' then 'payment_method'
      else lower(btrim(regexp_replace(coalesce(p_item, ''), '[^A-Za-z0-9]+', '_', 'g'), '_'))
    end
  end
$$;
grant execute on function public.onboarding_item_key(text) to authenticated, service_role;
