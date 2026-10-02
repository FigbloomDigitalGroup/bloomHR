-- FIG-657, tier 4: chat, notifications, tasks, logs, MFA, sign-up requests and profiles.
--
-- These are mostly per-user tables, so the rules follow ownership rather than modules:
--   channels            readable if public, created by you, or restricted to your job title (how the chat
--                       screens already decide); you create channels as yourself; the creator or an ADMIN changes them
--   messages            readable and writable in channels you can see, as yourself; edit/delete your own (ADMIN moderates)
--   channel_members, message_reactions, user_channel_states   your own rows (reactions: in channels you can see)
--   notifications       you read your own; anyone signed in can notify someone; you update/delete your own
--   todos               public tasks are visible to the company, private ones to creator and assignee
--   meeting_transcripts the `teams` module
--   email_logs / sms_logs / staff_signup_requests   the modules that send or review them
--   mfa_numbers / mfa_codes   your own email only (a stop-gap: the codes are still created and checked in the
--                       browser, see the "move MFA to the server" issue)
--   profiles            your own, plus employees/settings modules
-- The restrictive tenant_isolation policy still confines everything to the caller's company.

-- Who am I, as far as these tables care? (security definer: they read auth.users / employees)
create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email from auth.users u where u.id = auth.uid()
$$;

create or replace function public.current_job_title()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select e."Job Title"
  from public.employees e
  join auth.users u on u.id = auth.uid()
  where e.tenant_id = (select public.current_tenant_id()) and e."Work Email" = u.email
  limit 1
$$;

revoke all on function public.current_user_email() from public, anon;
revoke all on function public.current_job_title() from public, anon;
grant execute on function public.current_user_email() to authenticated, service_role;
grant execute on function public.current_job_title() to authenticated, service_role;

-- Start from a clean slate: drop every policy except the tenant rule.
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array[
    'channels', 'channel_members', 'messages', 'message_reactions', 'user_channel_states', 'notifications',
    'todos', 'meeting_transcripts', 'email_logs', 'sms_logs', 'mfa_numbers', 'mfa_codes',
    'staff_signup_requests', 'profiles'
  ] loop
    continue when to_regclass(format('public.%I', t)) is null;
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t and policyname <> 'tenant_isolation'
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end $$;

-- Policies, created only on tables that exist in this database.
do $$
declare
  p record;
begin
  for p in
    select * from (values
      -- chat ------------------------------------------------------------------------------------
      ('channels', $q$create policy visible_channels on public.channels for select to authenticated
         using (
           coalesce(is_private, false) = false
           or created_by = auth.uid()
           or job_title = (select public.current_job_title())
           or (select public.current_user_role()) = 'ADMIN'
         )$q$),
      ('channels', $q$create policy create_channels on public.channels for insert to authenticated
         with check (created_by = auth.uid())$q$),
      ('channels', $q$create policy manage_channels on public.channels for update to authenticated
         using (created_by = auth.uid() or (select public.current_user_role()) = 'ADMIN')
         with check (created_by = auth.uid() or (select public.current_user_role()) = 'ADMIN')$q$),
      ('channels', $q$create policy delete_channels on public.channels for delete to authenticated
         using (created_by = auth.uid() or (select public.current_user_role()) = 'ADMIN')$q$),

      ('messages', $q$create policy read_messages on public.messages for select to authenticated
         using (exists (select 1 from public.channels c where c.id = messages.channel_id))$q$),
      ('messages', $q$create policy send_messages on public.messages for insert to authenticated
         with check (author_id = auth.uid() and exists (select 1 from public.channels c where c.id = messages.channel_id))$q$),
      ('messages', $q$create policy edit_messages on public.messages for update to authenticated
         using (author_id = auth.uid() or (select public.current_user_role()) = 'ADMIN')
         with check (author_id = auth.uid() or (select public.current_user_role()) = 'ADMIN')$q$),
      ('messages', $q$create policy delete_messages on public.messages for delete to authenticated
         using (author_id = auth.uid() or (select public.current_user_role()) = 'ADMIN')$q$),

      ('channel_members', $q$create policy own_membership on public.channel_members for all to authenticated
         using (user_id = auth.uid() or (select public.current_user_role()) = 'ADMIN')
         with check (user_id = auth.uid() or (select public.current_user_role()) = 'ADMIN')$q$),

      ('message_reactions', $q$create policy read_reactions on public.message_reactions for select to authenticated
         using (exists (select 1 from public.messages m where m.id = message_reactions.message_id))$q$),
      ('message_reactions', $q$create policy add_reactions on public.message_reactions for insert to authenticated
         with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_reactions.message_id))$q$),
      ('message_reactions', $q$create policy remove_reactions on public.message_reactions for delete to authenticated
         using (user_id = auth.uid())$q$),

      ('user_channel_states', $q$create policy own_state on public.user_channel_states for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())$q$),

      -- notifications ---------------------------------------------------------------------------
      ('notifications', $q$create policy read_notifications on public.notifications for select to authenticated
         using (
           employee_number = (select public.current_employee_number())
           or public.has_any_module('settings', 'employees')
         )$q$),
      ('notifications', $q$create policy send_notifications on public.notifications for insert to authenticated
         with check (true)$q$),
      ('notifications', $q$create policy update_notifications on public.notifications for update to authenticated
         using (employee_number = (select public.current_employee_number()) or public.has_any_module('settings', 'employees'))
         with check (employee_number = (select public.current_employee_number()) or public.has_any_module('settings', 'employees'))$q$),
      ('notifications', $q$create policy delete_notifications on public.notifications for delete to authenticated
         using (employee_number = (select public.current_employee_number()) or public.has_any_module('settings', 'employees'))$q$),

      -- tasks -----------------------------------------------------------------------------------
      ('todos', $q$create policy read_tasks on public.todos for select to authenticated
         using (
           coalesce(is_private, false) = false
           or user_id = auth.uid() or assigne = auth.uid() or assigned_to = auth.uid()::text
         )$q$),
      ('todos', $q$create policy create_tasks on public.todos for insert to authenticated
         with check (user_id = auth.uid())$q$),
      ('todos', $q$create policy update_tasks on public.todos for update to authenticated
         using (user_id = auth.uid() or assigne = auth.uid() or assigned_to = auth.uid()::text)
         with check (user_id = auth.uid() or assigne = auth.uid() or assigned_to = auth.uid()::text)$q$),
      ('todos', $q$create policy delete_tasks on public.todos for delete to authenticated
         using (user_id = auth.uid() or (select public.current_user_role()) = 'ADMIN')$q$),

      -- meetings and logs -----------------------------------------------------------------------
      ('meeting_transcripts', $q$create policy module_access on public.meeting_transcripts for all to authenticated
         using (public.has_any_module('teams')) with check (public.has_any_module('teams'))$q$),
      ('email_logs', $q$create policy module_access on public.email_logs for all to authenticated
         using (public.has_any_module('employees', 'adminconfirm', 'email-portal', 'settings'))
         with check (public.has_any_module('employees', 'adminconfirm', 'email-portal', 'settings'))$q$),
      ('sms_logs', $q$create policy module_access on public.sms_logs for all to authenticated
         using (public.has_any_module('sms', 'salaryadmin', 'employees', 'hr-lifecycle'))
         with check (public.has_any_module('sms', 'salaryadmin', 'employees', 'hr-lifecycle'))$q$),
      ('staff_signup_requests', $q$create policy module_access on public.staff_signup_requests for all to authenticated
         using (public.has_any_module('adminconfirm', 'employees'))
         with check (public.has_any_module('adminconfirm', 'employees'))$q$),

      -- MFA (stop-gap, see header) --------------------------------------------------------------
      ('mfa_numbers', $q$create policy own_number on public.mfa_numbers for select to authenticated
         using (email = (select public.current_user_email()))$q$),
      ('mfa_numbers', $q$create policy module_access on public.mfa_numbers for all to authenticated
         using (public.has_any_module('settings')) with check (public.has_any_module('settings'))$q$),
      ('mfa_codes', $q$create policy own_codes on public.mfa_codes for all to authenticated
         using (email = (select public.current_user_email()))
         with check (email = (select public.current_user_email()))$q$),

      -- profiles --------------------------------------------------------------------------------
      ('profiles', $q$create policy own_profile on public.profiles for all to authenticated
         using (id = auth.uid()) with check (id = auth.uid())$q$),
      ('profiles', $q$create policy module_read on public.profiles for select to authenticated
         using (public.has_any_module('employees', 'settings'))$q$)
    ) as v(tbl, sql)
  loop
    continue when to_regclass(format('public.%I', p.tbl)) is null;
    execute p.sql;
  end loop;
end $$;

notify pgrst, 'reload schema';
