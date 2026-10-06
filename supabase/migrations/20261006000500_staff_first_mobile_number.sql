-- A staff member could not add their own primary mobile number, even when the record had none: the self-update guard
-- (20261002000700) treats "Mobile Number" as an HR-only field. That left a new employee unable to complete their
-- own profile (the staff portal also requires the number to save). They may now set it ONCE, while it is empty;
-- any later change still needs HR. Everything else about the guard is unchanged.

create or replace function public.guard_employee_self_update()
returns trigger
language plpgsql
as $$
declare
  k text;
  allowed text[] := array[
    'First Name', 'Middle Name', 'Last Name', 'Personal Mobile', 'Alternative Mobile Number', 'Personal Email',
    'Date of Birth', 'Gender', 'Marital Status', 'Country', 'Postal Address', 'Postal Code', 'Postal Location',
    'City', 'Area', 'Road', 'House Number', 'passport_number', 'blood_group', 'religion',
    'Type of Identification', 'ID Number', 'Profile Image',
    'Tax PIN', 'NHIF Number', 'SHIF Number', 'NSSF Number', 'WIBA', 'Pension Start Date', 'Employee AVC',
    'Employer AVC', 'Pension Deduction', 'NSSF Deduction', 'NHIF Deduction', 'Housing Levy Deduction',
    'Tax Exempted', 'Disability Cert No', 'NITA', 'NITA Deductions', 'HELB', 'HELB option'
  ];
begin
  -- the backend (service role / migrations) and people who manage employees are not limited
  if auth.uid() is null or public.can_write_employees() then
    return new;
  end if;

  for k in
    select o.key from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n on n.key = o.key
    where o.value is distinct from n.value
  loop
    -- the primary mobile number may be set once, while it is still empty (a new employee adding their own number);
    -- changing it afterwards goes through HR, as before
    if k = 'Mobile Number' and coalesce(btrim(old."Mobile Number"), '') = '' then
      continue;
    end if;
    if k <> all (allowed) then
      raise exception 'You can only change your own personal details (not "%")', k
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

notify pgrst, 'reload schema';
