-- HR and admins see every task in their company, read-only, for oversight (follow-up to 20261019500000_task_visibility).
--
-- 20261019500000 made a task visible only to the people concerned (assignee, creator, project people, @mentioned,
-- the assignee's supervisor): no role saw everything. The refinement: "the admin should see all tasks, for visibility,
-- it can't be just the creator and assignee; HR should see too in case of incident or dispute".
--
-- Who gets oversight: a signed-in user whose role (user_profiles.role, through current_user_role()) is ADMIN or HR.
-- Custom roles (company_role_id, built separately) keep a base role in user_profiles.role, so a custom role based on
-- ADMIN or HR gets oversight too, and one based on any other role does not.
--
-- What they read: every task of their own company, with its comments, activity, attachments (the rows and the files in
-- the task-attachments bucket), label links, and every project and its members.
-- What does not change:
--   - oversight is read-only. Changing or deleting a task, its labels or its files (task_update / task_delete,
--     can_edit_task()), commenting and attaching (my_task_ids()) stay with the people concerned. my_task_ids(),
--     my_group_task_ids() and can_edit_task() are left exactly as 20261019500000 wrote them; oversight is a separate
--     OR branch on the SELECT policies only.
--   - what ADMIN and HR have as people who run tasks (manages_tasks(): projects, labels, templates, adding tasks) and
--     anything they have because they are concerned with a task.
--   - MANAGER, OPERATIONS, REGIONAL, CHECKER and STAFF: only what concerns them.
--   - company isolation: the restrictive tenant_isolation policy on every task table still applies; the files check
--     their company folder.
--   - notifications: other people's task_assigned rows stay hidden from HR's notifications list.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. who oversees tasks
-- ---------------------------------------------------------------------------------------------
create or replace function public.oversees_tasks() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and coalesce(public.current_user_role(), '') in ('ADMIN', 'HR')
$$;
revoke all on function public.oversees_tasks() from public, anon;
grant execute on function public.oversees_tasks() to authenticated, service_role;

-- whether the signed-in user is concerned with a task (may comment and attach), as opposed to only overseeing it
create or replace function public.task_concerns_me(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.my_task_ids() x where x = p_task)
$$;
revoke all on function public.task_concerns_me(uuid) from public, anon;
grant execute on function public.task_concerns_me(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. tasks: the 20261019500000 select policy, plus oversight
-- ---------------------------------------------------------------------------------------------
drop policy if exists task_select on public.tasks;
create policy task_select on public.tasks for select to authenticated using (
  (select public.oversees_tasks())
  or created_by = (select auth.uid())
  or assignee_number = (select public.current_employee_number())
  or creator_number = (select public.current_employee_number())
  or project_id in (select public.my_task_project_ids())
  or id in (select public.my_mentioned_task_ids())
  or assignee_number in (select public.supervised_employee_numbers())
  or id in (select public.my_group_task_ids())
);
-- task_insert, task_update and task_delete are unchanged

-- ---------------------------------------------------------------------------------------------
-- 3. what hangs off a task: read with oversight; writing stays with the people concerned
-- ---------------------------------------------------------------------------------------------
drop policy if exists task_select on public.task_label_links;
create policy task_select on public.task_label_links for select to authenticated using (
  (select public.oversees_tasks()) or task_id in (select public.my_task_ids())
);

drop policy if exists task_select on public.task_comments;
create policy task_select on public.task_comments for select to authenticated using (
  (select public.oversees_tasks()) or task_id in (select public.my_task_ids())
);

drop policy if exists task_select on public.task_activity;
create policy task_select on public.task_activity for select to authenticated using (
  (select public.oversees_tasks()) or task_id in (select public.my_task_ids())
);

drop policy if exists task_select on public.task_attachments;
create policy task_select on public.task_attachments for select to authenticated using (
  (select public.oversees_tasks()) or task_id in (select public.my_task_ids())
);

-- ---------------------------------------------------------------------------------------------
-- 4. projects and their members
-- ---------------------------------------------------------------------------------------------
drop policy if exists task_select on public.task_projects;
create policy task_select on public.task_projects for select to authenticated using (
  (select public.oversees_tasks())
  or (select public.manages_tasks())
  or id in (select public.my_task_project_ids())
  or exists (select 1 from public.tasks t where t.project_id = task_projects.id)
);

drop policy if exists task_select on public.task_project_members;
create policy task_select on public.task_project_members for select to authenticated using (
  (select public.oversees_tasks())
  or (select public.manages_tasks())
  or project_id in (select public.my_task_project_ids())
);

-- ---------------------------------------------------------------------------------------------
-- 5. stored files: read with oversight, in the company's own folder; uploading is unchanged
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  drop policy if exists task_attachments_select on storage.objects;
  create policy task_attachments_select on storage.objects for select to authenticated
    using (
      bucket_id = 'task-attachments'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((select public.oversees_tasks())
           or (storage.foldername(name))[2] in (select x::text from public.my_task_ids() x))
    );
end $$;

notify pgrst, 'reload schema';
