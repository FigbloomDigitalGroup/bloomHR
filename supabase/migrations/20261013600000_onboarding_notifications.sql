-- Employees hear about what HR does with their onboarding (FIG-776): a notification in the staff portal's bell (the
-- shared hr_notifications, where leave decisions already go) when HR
--   * accepts a document, or doesn't accept it (with HR's reason);
--   * approves their onboarding, or sends it back for changes (with HR's comment);
--   * removes their photo;
--   * asks them for another document.
-- Written by triggers, so every way of doing these (the app, the API) notifies, and only when someone other than the
-- employee did it. The email_sent column is there for the email notifications that come later (FIG-771).

alter table public.hr_notifications drop constraint if exists hr_notifications_notification_type_check;
alter table public.hr_notifications add constraint hr_notifications_notification_type_check check (notification_type in (
  'contract_expiring', 'probation_expiring', 'leave_recommended', 'leave_approved', 'leave_rejected', 'leave_year_end_reminder',
  'document_accepted', 'document_rejected', 'onboarding_approved', 'onboarding_changes_requested', 'photo_removed',
  'document_requested'
));

-- a notification for an employee, in their company
create or replace function public.notify_employee(p_employee uuid, p_type text, p_title text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null or coalesce(btrim(e."Employee Number"), '') = '' then
    return;
  end if;
  insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message)
  values (
    e.tenant_id, e."Employee Number",
    nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), e."Work Email",
    p_type, p_title, p_message
  );
end $$;
revoke all on function public.notify_employee(uuid, text, text, text) from public, anon, authenticated;

-- whether the person doing this is someone other than the employee (HR, an admin); not the backend or a migration
create or replace function public.acting_on_someone_else(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not public.is_own_employee(p_employee)
$$;
revoke all on function public.acting_on_someone_else(uuid) from public, anon, authenticated;

-- a document accepted or not accepted
create or replace function public.notify_document_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  what text;
begin
  if new.status is not distinct from old.status or new.status not in ('accepted', 'rejected')
     or not public.acting_on_someone_else(new.employee_id) then
    return new;
  end if;
  select t.label into what from public.document_types t where t.code = new.code;
  what := coalesce(what, 'document') || ' (' || new.file_name || ')';
  if new.status = 'accepted' then
    perform public.notify_employee(new.employee_id, 'document_accepted', 'Document accepted',
      'HR accepted your ' || what || '.');
  else
    perform public.notify_employee(new.employee_id, 'document_rejected', 'Document not accepted',
      'HR did not accept your ' || what || '.'
      || coalesce(' Reason: ' || nullif(btrim(new.review_note), '') || '.', '')
      || ' Please upload it again.');
  end if;
  return new;
end $$;
drop trigger if exists employee_documents_notify on public.employee_documents;
create trigger employee_documents_notify after update of status on public.employee_documents
  for each row execute function public.notify_document_review();

-- onboarding approved or sent back
create or replace function public.notify_onboarding_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  note text := nullif(btrim(new.comment), '');
begin
  if not public.acting_on_someone_else(new.employee_id) then
    return new;
  end if;
  if new.action = 'approved' then
    perform public.notify_employee(new.employee_id, 'onboarding_approved', 'Onboarding approved',
      'HR approved your onboarding details.' || coalesce(' Comment: ' || note, ''));
  elsif new.action = 'changes_requested' then
    perform public.notify_employee(new.employee_id, 'onboarding_changes_requested', 'Changes needed to your onboarding',
      'HR sent your onboarding details back for changes.' || coalesce(' Comment: ' || note, '')
      || ' Open Onboarding to update them and submit again.');
  end if;
  return new;
end $$;
drop trigger if exists employee_onboarding_reviews_notify on public.employee_onboarding_reviews;
create trigger employee_onboarding_reviews_notify after insert on public.employee_onboarding_reviews
  for each row execute function public.notify_onboarding_review();

-- the photo removed by HR
create or replace function public.notify_photo_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(old."Profile Image"), '') <> '' and coalesce(btrim(new."Profile Image"), '') = ''
     and public.acting_on_someone_else(new.id) then
    perform public.notify_employee(new.id, 'photo_removed', 'Photo removed',
      'HR removed your profile photo. Please upload a new one in Onboarding.');
  end if;
  return new;
end $$;
drop trigger if exists employees_notify_photo_removed on public.employees;
create trigger employees_notify_photo_removed after update of "Profile Image" on public.employees
  for each row execute function public.notify_photo_removed();

-- another document asked for
create or replace function public.notify_document_requested() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  what text;
begin
  if not public.acting_on_someone_else(new.employee_id) then
    return new;
  end if;
  select t.label into what from public.document_types t where t.code = new.code;
  perform public.notify_employee(new.employee_id, 'document_requested', 'Document requested',
    'HR asked you for your ' || coalesce(what, 'document') || '. Upload it in Onboarding.');
  return new;
end $$;
drop trigger if exists employee_document_requirements_notify on public.employee_document_requirements;
create trigger employee_document_requirements_notify after insert on public.employee_document_requirements
  for each row execute function public.notify_document_requested();

notify pgrst, 'reload schema';
