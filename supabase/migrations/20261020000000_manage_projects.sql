-- "Manage projects" is a permission any role can hold, staff-based custom roles included (FIG-901).
--
-- Before: creating and running projects (manages_tasks(), 20261019200000_tasks.sql) meant "the Task Manager module on a
-- role other than STAFF". So assigning projects needed an admin-side role (Manager, HR, ...), and every one of them could
-- do it. The ask: "do i have to be hr to assign projects, thats not the hr's job though, this is why i needed the
-- custom roles so some staff can assign projects and not be admins."
--
-- Now: a module of its own, task-projects ("Manage projects"), ticked per role on the Roles & Permissions screen. Whoever
-- holds it (any role, including a custom role based on Staff; administrators always) does what "the people who run
-- tasks" did: create projects, edit and archive any project and its members, labels, recurring tasks and "Run now",
-- add a task (or a task for a department / job title / several people) to any project, delete a project.
--
-- What does not change:
--   - manages_tasks() keeps its name, so every policy and function that uses it (projects, members, labels, templates,
--     run_task_templates(), create_group_task(), adding tasks to any project) follows without being rewritten.
--   - a project's lead (or its creator) still edits their own project and its members without the module.
--   - visibility: holding the module does not show anyone else's tasks. A project manager sees a project's tasks once
--     they are its creator, lead or a member, as before; ADMIN and HR keep read-only oversight (oversees_tasks()).
--   - company isolation (the restrictive tenant_isolation policies) and the custom-role escalation rules: task-projects
--     is not admin-only nor staff-restricted, so a STAFF-based role may hold it (module_allowed_for_base()).
--
-- Existing companies keep what they had: the first time this runs, every role that could manage projects gets the
-- module (ADMIN, and every other non-STAFF role, system or custom, that has Task Manager). STAFF and STAFF-based roles
-- do not. Running this again grants nothing, so a company that unticks it for a role keeps it unticked. New companies
-- copy the default company's roles (create_company), which are seeded the same way.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the module, granted once to the roles that could manage projects
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.permissions where module_id = 'task-projects') then
    insert into public.permissions (module_id, module_name, description, category)
    values ('task-projects', 'Manage projects',
            'Create projects, add members, assign tasks to a department or team, set up recurring tasks and labels.',
            'workspace')
    on conflict (module_id) do nothing;

    update public.role_permissions rp
      set permissions = array_append(coalesce(rp.permissions, '{}'), 'task-projects'), updated_at = now()
      where not ('task-projects' = any (coalesce(rp.permissions, '{}')))
        and (
          rp.role_name = 'ADMIN'
          -- the other system roles that ran tasks: not STAFF, with Task Manager
          or (rp.role_name = any (public.system_role_names()) and rp.role_name <> 'STAFF'
              and 'task-manager' = any (coalesce(rp.permissions, '{}')))
          -- a company's own roles that ran tasks: based on anything but STAFF, with Task Manager
          or exists (select 1 from public.company_roles c
                     where c.tenant_id = rp.tenant_id and c.role_key = rp.role_name and not c.is_system
                       and c.base_role <> 'STAFF' and 'task-manager' = any (coalesce(rp.permissions, '{}')))
        );
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. who manages projects: the module, whatever the role
-- ---------------------------------------------------------------------------------------------
create or replace function public.manages_tasks() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.has_module('task-projects')
$$;
revoke all on function public.manages_tasks() from public, anon;
grant execute on function public.manages_tasks() to authenticated, service_role;

notify pgrst, 'reload schema';
