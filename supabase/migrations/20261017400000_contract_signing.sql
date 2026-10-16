-- Contract signing: HR sends an employee a contract to sign, the employee downloads it and uploads the signed copy,
-- and HR accepts it or sends it back to be fixed.
--
--   employee_contracts   one per contract sent to one employee (sending to several people makes one each)
--       sent -> viewed (the employee first opened it) -> signed (they uploaded the signed copy) -> accepted
--       signed -> sent_back (HR says what needs fixing) -> signed again ...;  anything before accepted -> cancelled (HR)
--   storage bucket employee-contracts (private)
--       <company id>/<contract id>/original-<random>.<ext>   the contract HR sent
--       <company id>/<contract id>/signed-<random>.<ext>     the employee's signed copy (a new file on every upload)
--
-- Who does what (enforced here, not only by the screens):
--   HR ('employees' or 'hr-lifecycle' module, and administrators)   sends, sees every contract in the company and its
--                                                                   files, accepts or sends back, cancels
--   the employee                                                    sees their own contracts (not cancelled ones)
--                                                                   and opens their files; uploads the signed copy,
--                                                                   and may replace it until HR accepts it
-- Sending is an insert (HR only); every later step goes through the functions in section 4, which check who is asking
-- and what the contract allows. Nothing updates or deletes a contract directly.
--
-- Notifications: the employee hears when a contract is sent, sent back or accepted; HR hears when a signed copy comes
-- in (contract_signed, shown in the admin bell and never to the employee).

-- ---------------------------------------------------------------------------------------------
-- 1. who manages contracts
-- ---------------------------------------------------------------------------------------------
create or replace function public.manages_contracts() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_module('employees', 'hr-lifecycle')
$$;
revoke all on function public.manages_contracts() from public, anon;
grant execute on function public.manages_contracts() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. the table
-- ---------------------------------------------------------------------------------------------
create table if not exists public.employee_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  title text not null check (btrim(title) <> '' and length(title) <= 200),
  message text check (message is null or length(message) <= 2000),
  sign_by date,
  -- the contract HR sent, in the employee-contracts bucket, and the name it had on HR's computer
  file_path text not null,
  file_name text check (file_name is null or length(file_name) <= 255),
  -- the employee's latest signed copy
  signed_path text,
  signed_file_name text check (signed_file_name is null or length(signed_file_name) <= 255),
  status text not null default 'sent'
    check (status in ('sent', 'viewed', 'signed', 'accepted', 'sent_back', 'cancelled')),
  -- why HR sent the signed copy back (kept after the employee uploads again, for the record)
  send_back_reason text check (send_back_reason is null or length(send_back_reason) <= 1000),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 1000),
  sent_by uuid default auth.uid() references auth.users(id) on delete set null,
  sent_at timestamptz not null default now(),
  viewed_at timestamptz,
  signed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number") on update cascade on delete cascade,
  check (status <> 'sent_back' or nullif(btrim(send_back_reason), '') is not null),
  check (status not in ('signed', 'accepted') or signed_path is not null)
);
create index if not exists employee_contracts_tenant_status on public.employee_contracts (tenant_id, status);
create index if not exists employee_contracts_tenant_employee on public.employee_contracts (tenant_id, employee_number);

-- the signed-in employee's own contracts that they can see (not cancelled ones), as text for the storage policies
create or replace function public.my_contract_ids() returns setof text
language sql stable security definer set search_path = public as $$
  select c.id::text from public.employee_contracts c
  where c.tenant_id = public.current_tenant_id() and c.employee_number = public.current_employee_number()
    and c.status <> 'cancelled'
$$;
-- ...and those they may still upload a signed copy for
create or replace function public.my_open_contract_ids() returns setof text
language sql stable security definer set search_path = public as $$
  select c.id::text from public.employee_contracts c
  where c.tenant_id = public.current_tenant_id() and c.employee_number = public.current_employee_number()
    and c.status in ('sent', 'viewed', 'signed', 'sent_back')
$$;
revoke all on function public.my_contract_ids() from public, anon;
revoke all on function public.my_open_contract_ids() from public, anon;
grant execute on function public.my_contract_ids() to authenticated;
grant execute on function public.my_open_contract_ids() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. access, and the rules for sending
-- ---------------------------------------------------------------------------------------------
alter table public.employee_contracts enable row level security;
drop policy if exists tenant_isolation on public.employee_contracts;
create policy tenant_isolation on public.employee_contracts as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
revoke all on public.employee_contracts from anon;

-- HR sees every contract in the company; the employee their own, unless HR cancelled it
drop policy if exists hr_or_own_select on public.employee_contracts;
create policy hr_or_own_select on public.employee_contracts for select to authenticated
  using ((select public.manages_contracts())
         or (employee_number = (select public.current_employee_number()) and status <> 'cancelled'));
-- only HR sends (the trigger below sets the rest)
drop policy if exists hr_insert on public.employee_contracts;
create policy hr_insert on public.employee_contracts for insert to authenticated
  with check ((select public.manages_contracts()));
-- no update or delete policies: the steps after sending are the functions in section 4

create or replace function public.employee_contract_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
begin
  if tg_op = 'UPDATE' then
    -- an employee renumbered: the foreign key moves their contracts along and nothing else changes
    if (to_jsonb(new) - 'employee_number') = (to_jsonb(old) - 'employee_number') then
      return new;
    end if;
    if auth.uid() is not null and coalesce(current_setting('figbloom.contract_step', true), '') <> 'on' then
      raise exception 'A contract changes only through its actions (view, upload signed copy, accept, send back, cancel)'
        using errcode = '42501';
    end if;
    if new.tenant_id <> old.tenant_id or new.id <> old.id or new.file_path <> old.file_path then
      raise exception 'A contract''s company and file can''t change' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- sending
  if auth.uid() is not null and not public.manages_contracts() then
    raise exception 'Only HR can send a contract' using errcode = '42501';
  end if;
  select * into v_emp from public.employees where tenant_id = new.tenant_id and "Employee Number" = new.employee_number;
  if v_emp.id is null then
    raise exception 'Unknown employee %', new.employee_number using errcode = '23503';
  end if;
  new.title := btrim(new.title);
  new.message := nullif(btrim(coalesce(new.message, '')), '');
  if new.sign_by is not null and new.sign_by < current_date then
    raise exception 'The sign-by date can''t be in the past' using errcode = '23514';
  end if;
  -- the file sits in this contract's own folder in this company
  if split_part(new.file_path, '/', 1) <> new.tenant_id::text or split_part(new.file_path, '/', 2) <> new.id::text
     or split_part(new.file_path, '/', 3) not like 'original-%' or split_part(new.file_path, '/', 4) <> '' then
    raise exception 'The contract file must be saved in the contract''s own folder' using errcode = '23514';
  end if;
  new.status := 'sent';
  new.sent_by := auth.uid();
  new.sent_at := now();
  new.viewed_at := null;
  new.signed_path := null; new.signed_file_name := null; new.signed_at := null;
  new.send_back_reason := null; new.reviewed_by := null; new.reviewed_at := null;
  new.cancel_reason := null; new.cancelled_by := null; new.cancelled_at := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists employee_contract_rules on public.employee_contracts;
create trigger employee_contract_rules before insert or update on public.employee_contracts
  for each row execute function public.employee_contract_rules();

-- a sent contract: the employee hears of it
create or replace function public.employee_contract_sent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_employee_number(new.tenant_id, new.employee_number, 'contract_sent', 'Contract to sign',
    'HR sent you "' || new.title || '" to sign'
    || coalesce(' by ' || to_char(new.sign_by, 'DD Mon YYYY'), '') || '.'
    || public.with_note('Message', new.message)
    || ' Open Contracts in the staff portal to download it and upload the signed copy.');
  return null;
end $$;

drop trigger if exists employee_contract_sent on public.employee_contracts;
create trigger employee_contract_sent after insert on public.employee_contracts
  for each row execute function public.employee_contract_sent();

-- ---------------------------------------------------------------------------------------------
-- 4. the steps after sending
-- ---------------------------------------------------------------------------------------------
-- The employee opened (or downloaded) their contract: the first time, it becomes viewed. HR opening it changes nothing.
create or replace function public.contract_mark_viewed(p_id uuid) returns public.employee_contracts
language plpgsql security definer set search_path = public as $$
declare
  c public.employee_contracts;
begin
  select * into c from public.employee_contracts where id = p_id and tenant_id = public.current_tenant_id();
  if c.id is null or c.status = 'cancelled' or c.employee_number is distinct from public.current_employee_number() then
    if c.id is not null and public.manages_contracts() then
      return c;
    end if;
    raise exception 'Contract not found' using errcode = 'P0002';
  end if;
  if c.viewed_at is null then
    perform set_config('figbloom.contract_step', 'on', true);
    update public.employee_contracts
    set viewed_at = now(), status = case when status = 'sent' then 'viewed' else status end
    where id = p_id
    returning * into c;
    perform set_config('figbloom.contract_step', 'off', true);
  end if;
  return c;
end $$;

-- The employee uploaded their signed copy (already in storage at p_path): signed, and HR hears of it. They may upload
-- again, replacing it, until HR accepts it.
create or replace function public.contract_submit_signed(p_id uuid, p_path text, p_file_name text default null)
returns public.employee_contracts
language plpgsql security definer set search_path = public as $$
declare
  c public.employee_contracts;
  e public.employees;
  who text;
begin
  select * into c from public.employee_contracts where id = p_id and tenant_id = public.current_tenant_id();
  if c.id is null or c.status = 'cancelled' or c.employee_number is distinct from public.current_employee_number() then
    raise exception 'Contract not found' using errcode = 'P0002';
  end if;
  if c.status = 'accepted' then
    raise exception 'HR has already accepted your signed contract, so it can''t be replaced' using errcode = '42501';
  end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> c.tenant_id::text or split_part(p_path, '/', 2) <> c.id::text
     or split_part(p_path, '/', 3) not like 'signed-%' or split_part(p_path, '/', 4) <> '' then
    raise exception 'The signed copy must be saved in the contract''s own folder' using errcode = '23514';
  end if;

  perform set_config('figbloom.contract_step', 'on', true);
  update public.employee_contracts
  set signed_path = p_path,
      signed_file_name = left(nullif(btrim(coalesce(p_file_name, '')), ''), 255),
      signed_at = now(),
      viewed_at = coalesce(viewed_at, now()),
      status = 'signed',
      reviewed_by = null,
      reviewed_at = null
  where id = p_id
  returning * into c;
  perform set_config('figbloom.contract_step', 'off', true);

  select * into e from public.employees where tenant_id = c.tenant_id and "Employee Number" = c.employee_number;
  who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), c.employee_number);
  insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message)
  values (c.tenant_id, c.employee_number, who, e."Work Email", 'contract_signed', 'Signed contract to review',
    who || ' returned their signed "' || c.title || '". Review it under HR Lifecycle > Contracts.');
  return c;
end $$;

-- HR accepts the signed copy, or sends it back saying what needs fixing (the employee then uploads again).
create or replace function public.contract_review(p_id uuid, p_accept boolean, p_reason text default null)
returns public.employee_contracts
language plpgsql security definer set search_path = public as $$
declare
  c public.employee_contracts;
begin
  if not public.manages_contracts() then
    raise exception 'Only HR can accept or send back a signed contract' using errcode = '42501';
  end if;
  select * into c from public.employee_contracts where id = p_id and tenant_id = public.current_tenant_id();
  if c.id is null then
    raise exception 'Contract not found' using errcode = 'P0002';
  end if;
  if c.status <> 'signed' then
    raise exception 'Only a contract with a signed copy waiting can be accepted or sent back (this one is %)',
      replace(c.status, '_', ' ') using errcode = '23514';
  end if;
  if not coalesce(p_accept, false) and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say what needs fixing, so the employee knows what to change' using errcode = '23514';
  end if;

  perform set_config('figbloom.contract_step', 'on', true);
  update public.employee_contracts
  set status = case when p_accept then 'accepted' else 'sent_back' end,
      send_back_reason = case when p_accept then send_back_reason else left(btrim(p_reason), 1000) end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_id
  returning * into c;
  perform set_config('figbloom.contract_step', 'off', true);

  if p_accept then
    perform public.notify_employee_number(c.tenant_id, c.employee_number, 'contract_accepted', 'Signed contract accepted',
      'HR accepted your signed "' || c.title || '". Thank you.');
  else
    perform public.notify_employee_number(c.tenant_id, c.employee_number, 'contract_sent_back', 'Contract sent back',
      'HR sent back your signed "' || c.title || '".' || public.with_note('What to fix', c.send_back_reason)
      || ' Please upload a corrected signed copy under Contracts.');
  end if;
  return c;
end $$;

-- HR withdraws a contract that hasn't been accepted yet. The employee no longer sees it.
create or replace function public.contract_cancel(p_id uuid, p_reason text default null)
returns public.employee_contracts
language plpgsql security definer set search_path = public as $$
declare
  c public.employee_contracts;
begin
  if not public.manages_contracts() then
    raise exception 'Only HR can cancel a contract' using errcode = '42501';
  end if;
  select * into c from public.employee_contracts where id = p_id and tenant_id = public.current_tenant_id();
  if c.id is null then
    raise exception 'Contract not found' using errcode = 'P0002';
  end if;
  if c.status in ('accepted', 'cancelled') then
    raise exception 'This contract is already %', c.status using errcode = '23514';
  end if;

  perform set_config('figbloom.contract_step', 'on', true);
  update public.employee_contracts
  set status = 'cancelled',
      cancel_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 1000),
      cancelled_by = auth.uid(),
      cancelled_at = now()
  where id = p_id
  returning * into c;
  perform set_config('figbloom.contract_step', 'off', true);
  return c;
end $$;

revoke all on function public.contract_mark_viewed(uuid) from public, anon;
revoke all on function public.contract_submit_signed(uuid, text, text) from public, anon;
revoke all on function public.contract_review(uuid, boolean, text) from public, anon;
revoke all on function public.contract_cancel(uuid, text) from public, anon;
grant execute on function public.contract_mark_viewed(uuid) to authenticated;
grant execute on function public.contract_submit_signed(uuid, text, text) to authenticated;
grant execute on function public.contract_review(uuid, boolean, text) to authenticated;
grant execute on function public.contract_cancel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. notifications
-- ---------------------------------------------------------------------------------------------
alter table public.hr_notifications drop constraint if exists hr_notifications_notification_type_check;
alter table public.hr_notifications add constraint hr_notifications_notification_type_check check (notification_type in (
  'contract_expiring', 'probation_expiring', 'leave_recommended', 'leave_approved', 'leave_rejected', 'leave_year_end_reminder',
  'document_accepted', 'document_rejected', 'onboarding_approved', 'onboarding_changes_requested', 'photo_removed',
  'document_requested',
  'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
  'payslip_ready', 'salary_paid', 'expense_approved', 'expense_rejected', 'phone_change_approved', 'phone_change_rejected',
  'incident_update', 'warning_issued', 'suspended', 'reactivated', 'employment_update', 'leave_scheduled', 'policy_to_accept',
  'task_assigned', 'asset_assigned',
  -- from the approval workflows (20261015800000): every type added since must stay in this list
  'approval_needed', 'approval_progress',
  'exit_requested', 'exit_approved', 'exit_declined',
  'application_received',
  'loan_requested', 'loan_disbursed', 'loan_repaid',
  'contract_sent', 'contract_sent_back', 'contract_accepted', 'contract_signed'
));

-- a signed copy to review is for HR (the employee's bell doesn't show it, and it isn't emailed to them)
create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed')
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. the files: a private bucket, per company and per contract
-- ---------------------------------------------------------------------------------------------
-- Storage only signs a download link for a file the caller may select, so the select policy decides who can open one.
-- Skipped where there is no storage schema (the test database applies this to a stand-in).
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public) values ('employee-contracts', 'employee-contracts', false)
  on conflict (id) do update set public = false;
  -- PDFs, Word documents and scans/photos of a signed page, up to 20 MB (where storage has these settings)
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $u$update storage.buckets set file_size_limit = 20971520, allowed_mime_types = array[
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg', 'image/png'] where id = 'employee-contracts'$u$;
  end if;

  drop policy if exists employee_contracts_select on storage.objects;
  drop policy if exists employee_contracts_insert on storage.objects;
  drop policy if exists employee_contracts_delete on storage.objects;

  -- HR: every contract's files in the company; the employee: their own contracts' files
  create policy employee_contracts_select on storage.objects for select to authenticated
    using (
      bucket_id = 'employee-contracts'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((select public.manages_contracts())
           or (storage.foldername(name))[2] in (select public.my_contract_ids()))
    );

  -- HR saves the contracts it sends; the employee saves signed copies, only for their own contracts still open
  create policy employee_contracts_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'employee-contracts'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and array_length(storage.foldername(name), 1) = 2
      and ((select public.manages_contracts())
           or ((storage.foldername(name))[2] in (select public.my_open_contract_ids())
               and storage.filename(name) like 'signed-%'))
    );

  -- HR may remove files; the employee their own earlier signed copies while the contract is still open
  create policy employee_contracts_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'employee-contracts'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((select public.manages_contracts())
           or ((storage.foldername(name))[2] in (select public.my_open_contract_ids())
               and storage.filename(name) like 'signed-%'))
    );
end $$;

notify pgrst, 'reload schema';
