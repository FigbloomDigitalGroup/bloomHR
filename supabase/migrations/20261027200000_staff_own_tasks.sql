-- Staff add their own tasks, and sub-tasks under the tasks they work on.
--
-- Before: a task could only be added to a project you were in (its lead, creator, a member or in its department), or
-- to any project by whoever holds "Manage projects". So someone given a task in a project they were not in could not
-- break it into sub-tasks (a sub-task lives in its parent's project), and a member of staff in no project could not
-- note down their own work at all ("You are not in any project yet").
--
-- Now:
--   - sub-tasks: whoever may change a task (its assignee, its creator, the project lead: can_edit_task()) may add a
--     sub-task under it, in any project.
--   - own tasks: every company has one "Personal" project (task_projects.personal). Anyone may add a task there, for
--     themselves only (the assignee is the creator, or nobody). Nobody is "in" the Personal project, so a task there
--     is seen as any task is: by its creator and assignee, the assignee's supervisor and ADMIN/HR oversight, never by
--     the rest of the company. Everyone sees the project itself (its name and key), so it can be picked.
--   - the Personal project keeps no lead, department or members (those would show everyone's personal tasks to them),
--     holds no recurring tasks (they go to other people), cannot be archived or deleted, and is made by the database:
--     one per company, now and for every new company.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the Personal project
-- ---------------------------------------------------------------------------------------------
alter table public.task_projects add column if not exists personal boolean not null default false;
create unique index if not exists task_projects_one_personal on public.task_projects (tenant_id) where personal;

-- the company's Personal project, made when missing; its key is the first of these not taken
create or replace function public.ensure_personal_task_project(p_tenant uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_key text;
begin
  select id into v_id from public.task_projects where tenant_id = p_tenant and personal;
  if v_id is not null then
    return v_id;
  end if;
  select k into v_key from unnest(array['MY', 'MINE', 'OWN', 'SELF', 'PERS', 'MYTASK']) with ordinality as c(k, n)
  where not exists (select 1 from public.task_projects p where p.tenant_id = p_tenant and p.key = c.k)
  order by n limit 1;
  if v_key is null then
    v_key := 'P' || upper(substr(md5(p_tenant::text || clock_timestamp()::text), 1, 5));
  end if;
  -- the rules trigger lets only this function make a Personal project
  perform set_config('app.making_personal_project', 'on', true);
  insert into public.task_projects (tenant_id, key, name, description, personal, created_by)
  values (p_tenant, v_key, 'Personal',
          'Your own tasks. Only you (and your supervisor and HR) see the ones you add here.', true, null)
  returning id into v_id;
  perform set_config('app.making_personal_project', 'off', true);
  return v_id;
end $$;
revoke all on function public.ensure_personal_task_project(uuid) from public, anon, authenticated;
grant execute on function public.ensure_personal_task_project(uuid) to service_role;

-- the signed-in person's company's Personal project
create or replace function public.personal_task_project_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.task_projects where tenant_id = public.current_tenant_id() and personal
$$;
revoke all on function public.personal_task_project_id() from public, anon;
grant execute on function public.personal_task_project_id() to authenticated, service_role;

-- what the Personal project may not become
create or replace function public.task_projects_personal_rules() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    -- the company itself going takes it along
    if old.personal and exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      raise exception 'The Personal project cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' and new.personal and coalesce(current_setting('app.making_personal_project', true), '') <> 'on' then
    raise exception 'The Personal project is made by the system' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.personal is distinct from old.personal then
    raise exception 'A project cannot be made Personal, or stop being it' using errcode = '42501';
  end if;
  if new.personal and (new.lead_number is not null or new.department_id is not null or new.archived) then
    raise exception 'The Personal project has no lead or department and cannot be archived: its tasks are each person''s own'
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists task_projects_personal_rules on public.task_projects;
create trigger task_projects_personal_rules before insert or update or delete on public.task_projects
  for each row execute function public.task_projects_personal_rules();

-- nobody is a member of it (members see all of a project's tasks)
create or replace function public.task_project_members_personal_rules() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.task_projects p where p.id = new.project_id and p.personal) then
    raise exception 'The Personal project has no members: its tasks are each person''s own' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists task_project_members_personal_rules on public.task_project_members;
create trigger task_project_members_personal_rules before insert or update on public.task_project_members
  for each row execute function public.task_project_members_personal_rules();

-- a Personal task is the creator's own: no one else is given it, and it is not a task for a group. Named to run after
-- tasks_rules (triggers run in name order), which has already put a sub-task in its parent's project.
create or replace function public.tasks_personal_rules() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.task_projects p where p.id = new.project_id and p.personal) then
    if new.is_group then
      raise exception 'Personal tasks are for yourself: give a task to a group in another project' using errcode = '42501';
    end if;
    if new.assignee_number is not null and new.assignee_number is distinct from new.creator_number then
      raise exception 'A Personal task can only be given to the person who added it: move it to another project to give it to someone else'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tasks_rules_personal on public.tasks;
create trigger tasks_rules_personal before insert or update of project_id, assignee_number, is_group, parent_id on public.tasks
  for each row execute function public.tasks_personal_rules();

-- a recurring task goes to other people, so not from the Personal project (the morning run would be refused)
create or replace function public.task_templates_personal_rules() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.task_projects p where p.id = new.project_id and p.personal) then
    raise exception 'A recurring task cannot be in the Personal project: choose another project' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists task_templates_personal_rules on public.task_templates;
create trigger task_templates_personal_rules before insert or update of project_id on public.task_templates
  for each row execute function public.task_templates_personal_rules();

-- one for every company now, and for each new one
do $$
declare
  t uuid;
begin
  for t in select id from public.tenants loop
    perform public.ensure_personal_task_project(t);
  end loop;
end $$;

create or replace function public.tenants_personal_task_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_personal_task_project(new.id);
  return new;
end $$;
revoke all on function public.tenants_personal_task_project() from public, anon, authenticated;
drop trigger if exists tenants_personal_task_project on public.tenants;
create trigger tenants_personal_task_project after insert on public.tenants
  for each row execute function public.tenants_personal_task_project();

-- ---------------------------------------------------------------------------------------------
-- 2. access
-- ---------------------------------------------------------------------------------------------
-- adding a task: as before (a project you are in; any project with "Manage projects"), plus a sub-task under a task you
-- may change, plus your own task in the Personal project
drop policy if exists task_insert on public.tasks;
create policy task_insert on public.tasks for insert to authenticated with check (
  created_by = (select auth.uid())
  and ((select public.manages_tasks())
       or project_id in (select public.my_task_project_ids())
       or (parent_id is not null and public.can_edit_task(parent_id))
       or project_id = (select public.personal_task_project_id()))
);

-- everyone sees the Personal project itself (not its tasks)
drop policy if exists task_select on public.task_projects;
create policy task_select on public.task_projects for select to authenticated using (
  (select public.oversees_tasks())
  or (select public.manages_tasks())
  or personal
  or id in (select public.my_task_project_ids())
  or exists (select 1 from public.tasks t where t.project_id = task_projects.id)
);

notify pgrst, 'reload schema';
