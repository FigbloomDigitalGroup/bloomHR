-- Only the people concerned see a task (follow-up to 20261019200000_tasks.sql, FIG-886).
--
-- Before: the people who run tasks (manages_tasks(): the Task Manager module on any role but STAFF, so MANAGER,
-- OPERATIONS, REGIONAL, CHECKER, HR and ADMIN) saw, changed and deleted every task in the company. The decision:
-- "those concerned, not admins and HR only". Nobody sees a task because of their role or module, ADMIN and HR included.
--
-- Who sees a task (and with it its comments, activity, attachments, label links and stored files):
--   its assignee; its creator (the login that made it, or the employee recorded as its creator); the project's people
--   (lead, the project's creator, listed members, people in the project's department); anyone @mentioned in its
--   comments; the assignee's supervisor (supervised_employee_numbers(), the set form of supervises()).
--   A group task is also seen by everyone with a sub-task in it, and its sub-tasks by whoever sees the group task.
-- Who changes a task: its assignee, its creator, the project lead. Deleting: its creator, the project lead.
-- Anyone who sees a task may comment on it; you edit and delete your own comments, the project lead may remove any.
--
-- What the people who run tasks keep (management, not visibility): creating projects (the creator counts as one of the
-- project's people, so they see its tasks), editing and archiving any project and its members (so they can add
-- themselves or others), labels, recurring templates (a template's tasks are created by the template's creator, who
-- therefore sees them), "Run now", adding a task or a task for a department (create_group_task) to any project (they are
-- then its creator, so see it), and deleting a project. They see every project's name, but a
-- project they are not in shows them only the tasks they are concerned with.
--
-- Notifications: each task notification goes to the assignee, the creator (creator_number) or someone @mentioned, all of
-- whom see the task. creator_number can no longer be set by hand to someone else, and task notifications are no longer
-- readable by HR through the HR notifications list (only by the person they are for).
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the tasks the signed-in user is concerned with, worked out once per query
-- ---------------------------------------------------------------------------------------------
-- group tasks: the ones the user sees directly (created, in the project, @mentioned) or has a sub-task in, and every
-- sub-task of those
create or replace function public.my_group_task_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid, public.current_employee_number() as num, public.current_tenant_id() as tenant
  ),
  grp as (
    select g.id from public.tasks g, me
    where me.uid is not null and g.tenant_id = me.tenant and g.is_group
      and (g.created_by = me.uid
           or (me.num is not null and g.creator_number = me.num)
           or g.project_id in (select public.my_task_project_ids())
           or g.id in (select public.my_mentioned_task_ids()))
    union
    select g.id from public.tasks c join public.tasks g on g.id = c.parent_id and g.is_group, me
    where me.num is not null and c.tenant_id = me.tenant and c.assignee_number = me.num
  )
  select id from grp
  union
  select c.id from public.tasks c where c.parent_id in (select id from grp)
$$;
revoke all on function public.my_group_task_ids() from public, anon;
grant execute on function public.my_group_task_ids() to authenticated, service_role;

-- every task the signed-in user is concerned with (the tasks select policy, as a set, for what hangs off a task)
create or replace function public.my_task_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid, public.current_employee_number() as num, public.current_tenant_id() as tenant
  )
  select t.id from public.tasks t, me
  where me.uid is not null and t.tenant_id = me.tenant
    and (t.created_by = me.uid
         or (me.num is not null and t.assignee_number = me.num)
         or (me.num is not null and t.creator_number = me.num)
         or t.project_id in (select public.my_task_project_ids())
         or t.id in (select public.my_mentioned_task_ids())
         or t.assignee_number in (select public.supervised_employee_numbers()))
  union
  select public.my_group_task_ids()
$$;
revoke all on function public.my_task_ids() from public, anon;
grant execute on function public.my_task_ids() to authenticated, service_role;

-- whether the signed-in user may change a task: assignee, creator, project lead (no role-wide power)
create or replace function public.can_edit_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task and t.tenant_id = public.current_tenant_id() and auth.uid() is not null
      and (t.created_by = auth.uid()
           or (t.assignee_number is not null and t.assignee_number = public.current_employee_number())
           or t.project_id in (select public.led_task_project_ids()))
  )
$$;
revoke all on function public.can_edit_task(uuid) from public, anon;
grant execute on function public.can_edit_task(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. tasks
-- ---------------------------------------------------------------------------------------------
drop policy if exists task_select on public.tasks;
drop policy if exists task_insert on public.tasks;
drop policy if exists task_update on public.tasks;
drop policy if exists task_delete on public.tasks;

-- written out on the row (not as a set of ids) so a task being inserted or changed is checked as it will be
create policy task_select on public.tasks for select to authenticated using (
  created_by = (select auth.uid())
  or assignee_number = (select public.current_employee_number())
  or creator_number = (select public.current_employee_number())
  or project_id in (select public.my_task_project_ids())
  or id in (select public.my_mentioned_task_ids())
  or assignee_number in (select public.supervised_employee_numbers())
  or id in (select public.my_group_task_ids())
);
-- creating: in a project you are in; the people who run tasks in any project (they are then its creator, so see it)
create policy task_insert on public.tasks for insert to authenticated with check (
  created_by = (select auth.uid())
  and ((select public.manages_tasks()) or project_id in (select public.my_task_project_ids()))
);
create policy task_update on public.tasks for update to authenticated
  using (
    created_by = (select auth.uid())
    or assignee_number = (select public.current_employee_number())
    or project_id in (select public.led_task_project_ids())
  )
  with check (
    created_by = (select auth.uid())
    or assignee_number = (select public.current_employee_number())
    or project_id in (select public.my_task_project_ids())
  );
create policy task_delete on public.tasks for delete to authenticated using (
  created_by = (select auth.uid())
  or project_id in (select public.led_task_project_ids())
);

-- the creator's employee number is the signed-in person's own when they insert a task themselves (it decides who sees
-- the task and who is told when it is done); the database's own jobs (recurring tasks) still set the template's creator
create or replace function public.tasks_creator_number() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and new.created_by is not distinct from auth.uid() then
    new.creator_number := public.current_employee_number();
  end if;
  return new;
end $$;
revoke all on function public.tasks_creator_number() from public, anon, authenticated;
drop trigger if exists tasks_creator_number on public.tasks;
-- named to run before tasks_rules (triggers fire in name order)
create trigger tasks_creator_number before insert on public.tasks
  for each row execute function public.tasks_creator_number();

-- ---------------------------------------------------------------------------------------------
-- 3. what hangs off a task follows the task
-- ---------------------------------------------------------------------------------------------
drop policy if exists task_select on public.task_label_links;
create policy task_select on public.task_label_links for select to authenticated using (
  task_id in (select public.my_task_ids())
);

drop policy if exists task_select on public.task_comments;
drop policy if exists task_insert on public.task_comments;
drop policy if exists task_delete on public.task_comments;
create policy task_select on public.task_comments for select to authenticated using (
  task_id in (select public.my_task_ids())
);
create policy task_insert on public.task_comments for insert to authenticated with check (
  author_id = (select auth.uid()) and task_id in (select public.my_task_ids())
);
create policy task_delete on public.task_comments for delete to authenticated using (
  author_id = (select auth.uid())
  or exists (select 1 from public.tasks t
             where t.id = task_comments.task_id and t.project_id in (select public.led_task_project_ids()))
);

drop policy if exists task_select on public.task_activity;
create policy task_select on public.task_activity for select to authenticated using (
  task_id in (select public.my_task_ids())
);

drop policy if exists task_select on public.task_attachments;
drop policy if exists task_insert on public.task_attachments;
create policy task_select on public.task_attachments for select to authenticated using (
  task_id in (select public.my_task_ids())
);
create policy task_insert on public.task_attachments for insert to authenticated with check (
  uploaded_by = (select auth.uid()) and task_id in (select public.my_task_ids())
);
-- task_delete (the uploader or whoever can edit the task) is unchanged: can_edit_task() above no longer has a role path

-- ---------------------------------------------------------------------------------------------
-- 4. projects: their people and the people who run tasks see them (seeing a project is not seeing its tasks)
-- ---------------------------------------------------------------------------------------------
drop policy if exists task_select on public.task_projects;
create policy task_select on public.task_projects for select to authenticated using (
  (select public.manages_tasks())
  or id in (select public.my_task_project_ids())
  -- the project of a task you see (its key and name)
  or exists (select 1 from public.tasks t where t.project_id = task_projects.id)
);
-- insert / update / delete on projects and their members stay with the people who run tasks (and a lead for their
-- own project), as in 20261019200000

-- ---------------------------------------------------------------------------------------------
-- 5. stored files in task-attachments follow the task
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  drop policy if exists task_attachments_select on storage.objects;
  drop policy if exists task_attachments_insert on storage.objects;

  create policy task_attachments_select on storage.objects for select to authenticated
    using (
      bucket_id = 'task-attachments'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] in (select x::text from public.my_task_ids() x)
    );
  create policy task_attachments_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'task-attachments'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] in (select x::text from public.my_task_ids() x)
    );
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. task notifications are read only by the person they are for (not through HR's notifications list)
-- ---------------------------------------------------------------------------------------------
drop policy if exists module_access on public.hr_notifications;
create policy module_access on public.hr_notifications for all to authenticated
  using ((select public.has_any_module('leaves', 'hr-lifecycle', 'employees')) and notification_type is distinct from 'task_assigned')
  with check ((select public.has_any_module('leaves', 'hr-lifecycle', 'employees')) and notification_type is distinct from 'task_assigned');

-- ---------------------------------------------------------------------------------------------
-- 7. the old todos table (unused by the app): its creator and its assignee only
-- ---------------------------------------------------------------------------------------------
drop policy if exists read_tasks on public.todos;
create policy read_tasks on public.todos for select to authenticated
  using (
    user_id = (select auth.uid())
    or assigne = (select auth.uid())
    or assigned_to = ((select auth.uid()))::text
    or assigned_to = (select public.current_employee_number())
  );

notify pgrst, 'reload schema';
