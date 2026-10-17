-- Tasks like Linear, on the company's real departments (FIG-886).
--
-- The old task manager kept everything in one table (todos): one assignee as free text (an employee number or a login
-- id), department / category / branch as free text from a hard-coded microfinance list, and every task that was not
-- marked private readable by the whole company. This replaces it with:
--
--   task_projects            a project: key (2-6 capitals, e.g. "OPS"), name, description, an optional department (its
--                            people count as members), a lead (employee), archived. Keys number its tasks: OPS-1, OPS-2
--   task_project_members     who else is in a project (employee numbers)
--   tasks                    title, description, status (backlog, todo, in_progress, in_review, done, cancelled),
--                            priority (urgent, high, medium, low, none), assignee (employee number, like the rest of
--                            the app), creator (login + their employee number when they have one), due date, parent
--                            (sub-tasks), sort order within a status (the board's drag and drop), completed_at, and the
--                            key (project key + the project's next number, given by the database)
--   task_labels / task_label_links   the company's own labels
--   task_comments            comments, with the employee numbers they @mention
--   task_activity            every change: who, when, which field, before -> after (written by the database)
--   task_attachments         files in the private task-attachments bucket, <company>/<task id>/<file>
--   task_templates           recurring role tasks: daily / weekly / monthly, for a department, a job title or named
--                            people; run_task_templates() makes each person's task once per period (pg_cron every
--                            morning, best effort; idempotent: one task per template, period and person)
--
--   create_group_task(...)   "assign to a department / job title / people": one parent task (is_group) and a sub-task
--                            for each person; the parent shows n/m done and closes itself when everyone has finished
--
-- Who sees a task: its assignee, its creator, the project's members (lead, members, the project department's people),
-- anyone @mentioned on it, the assignee's supervisor (supervised_employee_numbers()), and the people who run tasks
-- (manages_tasks(): the Task Manager module on a role other than STAFF; every default role has the module, STAFF
-- included, so the module alone cannot mean "sees every task"). Nobody else: no more "everyone sees everything".
-- Who changes a task: its assignee, its creator, the project lead and the people who run tasks. Deleting: the creator,
-- the lead and the people who run tasks. Projects, labels and templates: the people who run tasks (a lead edits their
-- own project and its members).
--
-- Notifications (employee-facing, emailed by the existing pipeline, type task_assigned for all of them so no
-- notification type list changes): a task given to you; you were @mentioned; a comment on a task you are assigned or
-- created; a task you created marked done. One notification per person per event; never for what you did yourself.
--
-- The old tasks: every todos row is copied once into a "General" project (key GEN) of its company, keeping title,
-- description, status, priority, due date, dates and who created it. The free-text assignee is matched to an employee
-- (by employee number, or by the login's email); what cannot be matched, and the old department / category / branch
-- text, is kept in the description. The todos table stays (nothing in the app uses it now) but is no longer readable
-- by the whole company: only by its creator, its assignee and the people who run tasks.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. who runs tasks
-- ---------------------------------------------------------------------------------------------
create or replace function public.manages_tasks() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and public.has_module('task-manager')
    and coalesce(public.current_user_role(), 'STAFF') <> 'STAFF'
$$;
revoke all on function public.manages_tasks() from public, anon;
grant execute on function public.manages_tasks() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.task_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[A-Z][A-Z0-9]{1,5}$'),
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  description text check (description is null or char_length(description) <= 5000),
  department_id uuid references public.departments(id) on delete set null,
  lead_number text,
  archived boolean not null default false,
  -- the last task number given in this project
  next_number integer not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key),
  foreign key (tenant_id, lead_number) references public.employees(tenant_id, "Employee Number")
    on update cascade on delete set null (lead_number)
);
create index if not exists task_projects_tenant on public.task_projects (tenant_id);

create table if not exists public.task_project_members (
  project_id uuid not null references public.task_projects(id) on delete cascade,
  employee_number text not null,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, employee_number),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number")
    on update cascade on delete cascade
);
create index if not exists task_project_members_employee on public.task_project_members (tenant_id, employee_number);

create table if not exists public.task_labels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> '' and char_length(name) <= 40),
  color text not null default 'slate' check (color ~ '^[a-z]{3,12}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists task_labels_tenant_name on public.task_labels (tenant_id, lower(btrim(name)));

create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  project_id uuid not null references public.task_projects(id) on delete cascade,
  title text not null check (btrim(title) <> '' and char_length(title) <= 300),
  description text check (description is null or char_length(description) <= 20000),
  priority text not null default 'none' check (priority in ('urgent', 'high', 'medium', 'low', 'none')),
  schedule text not null check (schedule in ('daily', 'weekly', 'monthly')),
  -- weekly: the ISO weekday it is made on or after (1 = Monday); monthly: the day of the month (the last day if shorter)
  weekday integer not null default 1 check (weekday between 1 and 7),
  month_day integer not null default 1 check (month_day between 1 and 31),
  -- days after it is made that it is due (0 = the same day)
  due_in_days integer not null default 0 check (due_in_days between 0 and 365),
  target_kind text not null check (target_kind in ('department', 'job_title', 'people')),
  department_id uuid references public.departments(id) on delete set null,
  job_title text check (job_title is null or char_length(job_title) <= 200),
  people text[] not null default '{}',
  active boolean not null default true,
  -- the last period it made tasks for
  last_period text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_templates_tenant on public.task_templates (tenant_id) where active;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  project_id uuid not null references public.task_projects(id) on delete cascade,
  number integer not null default 0,
  key text not null default '',
  title text not null check (btrim(title) <> '' and char_length(title) <= 500),
  description text check (description is null or char_length(description) <= 50000),
  status text not null default 'todo' check (status in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  priority text not null default 'none' check (priority in ('urgent', 'high', 'medium', 'low', 'none')),
  assignee_number text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  creator_number text,
  due_date date,
  parent_id uuid references public.tasks(id) on delete cascade,
  -- one task given to a department / job title / people: its sub-tasks are each person's
  is_group boolean not null default false,
  sort_order double precision not null default extract(epoch from clock_timestamp()),
  completed_at timestamptz,
  template_id uuid references public.task_templates(id) on delete set null,
  template_period text,
  legacy_todo_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id),
  foreign key (tenant_id, assignee_number) references public.employees(tenant_id, "Employee Number")
    on update cascade on delete set null (assignee_number)
);
create index if not exists tasks_tenant_project on public.tasks (tenant_id, project_id, status, sort_order);
create index if not exists tasks_tenant_assignee on public.tasks (tenant_id, assignee_number);
create index if not exists tasks_created_by on public.tasks (created_by);
create index if not exists tasks_parent on public.tasks (parent_id) where parent_id is not null;
create unique index if not exists tasks_project_number on public.tasks (project_id, number);
create unique index if not exists tasks_template_period on public.tasks (template_id, template_period, assignee_number)
  where template_id is not null;

create table if not exists public.task_label_links (
  task_id uuid not null references public.tasks(id) on delete cascade,
  label_id uuid not null references public.task_labels(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  primary key (task_id, label_id)
);
create index if not exists task_label_links_label on public.task_label_links (label_id);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  body text not null check (btrim(body) <> '' and char_length(body) <= 10000),
  mentions text[] not null default '{}',
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  author_number text,
  author_name text,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists task_comments_task on public.task_comments (task_id, created_at);
create index if not exists task_comments_mentions on public.task_comments using gin (mentions);

create table if not exists public.task_activity (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  field text not null,
  before_value text,
  after_value text,
  created_at timestamptz not null default now()
);
create index if not exists task_activity_task on public.task_activity (task_id, created_at);

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  path text not null check (char_length(path) <= 500),
  file_name text not null check (char_length(file_name) <= 300),
  size_bytes bigint,
  content_type text,
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists task_attachments_task on public.task_attachments (task_id);

-- ---------------------------------------------------------------------------------------------
-- 3. the signed-in user's projects and mentions, worked out once per query
-- ---------------------------------------------------------------------------------------------
-- projects the signed-in user is in: lead, creator, member, or in the project's department
create or replace function public.my_task_project_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  with me as (
    select public.current_employee_number() as num,
           (select e.department_id from public.employees e where e.id = public.current_employee_id()) as dept
  )
  select p.id from public.task_projects p, me
  where p.tenant_id = public.current_tenant_id()
    and (p.created_by = auth.uid()
         or (me.num is not null and p.lead_number = me.num)
         or (me.num is not null and exists (select 1 from public.task_project_members m
                                             where m.project_id = p.id and m.employee_number = me.num))
         or (me.dept is not null and p.department_id = me.dept))
$$;

-- projects the signed-in user leads (or created)
create or replace function public.led_task_project_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.task_projects p
  where p.tenant_id = public.current_tenant_id()
    and (p.created_by = auth.uid() or (p.lead_number is not null and p.lead_number = public.current_employee_number()))
$$;

-- tasks the signed-in user was @mentioned on
create or replace function public.my_mentioned_task_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct c.task_id from public.task_comments c
  where c.tenant_id = public.current_tenant_id() and c.mentions @> array[public.current_employee_number()]
$$;

revoke all on function public.my_task_project_ids() from public, anon;
revoke all on function public.led_task_project_ids() from public, anon;
revoke all on function public.my_mentioned_task_ids() from public, anon;
grant execute on function public.my_task_project_ids() to authenticated, service_role;
grant execute on function public.led_task_project_ids() to authenticated, service_role;
grant execute on function public.my_mentioned_task_ids() to authenticated, service_role;

-- whether the signed-in user may change a task (the tasks update policy, for label links and attachments)
create or replace function public.can_edit_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task and t.tenant_id = public.current_tenant_id()
      and (public.manages_tasks()
           or t.created_by = auth.uid()
           or (t.assignee_number is not null and t.assignee_number = public.current_employee_number())
           or t.project_id in (select public.led_task_project_ids()))
  )
$$;
revoke all on function public.can_edit_task(uuid) from public, anon;
grant execute on function public.can_edit_task(uuid) to authenticated, service_role;

-- the signed-in person's name for comments and activity: their employee name, else their login's
create or replace function public.task_actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), '') from public.employees e
      where e.id = public.current_employee_id()),
    (select coalesce(nullif(btrim(p.full_name), ''), p.email) from public.user_profiles p where p.user_id = auth.uid()),
    'System')
$$;
revoke all on function public.task_actor_name() from public, anon;
grant execute on function public.task_actor_name() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. access
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['task_projects', 'task_project_members', 'task_labels', 'task_templates', 'tasks',
                           'task_label_links', 'task_comments', 'task_activity', 'task_attachments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all
         using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists task_select on public.%I', t);
    execute format('drop policy if exists task_insert on public.%I', t);
    execute format('drop policy if exists task_update on public.%I', t);
    execute format('drop policy if exists task_delete on public.%I', t);
  end loop;
end $$;

-- tasks
create policy task_select on public.tasks for select to authenticated using (
  (select public.manages_tasks())
  or created_by = (select auth.uid())
  or assignee_number = (select public.current_employee_number())
  or project_id in (select public.my_task_project_ids())
  or id in (select public.my_mentioned_task_ids())
  or assignee_number in (select public.supervised_employee_numbers())
);
create policy task_insert on public.tasks for insert to authenticated with check (
  created_by = (select auth.uid())
  and ((select public.manages_tasks()) or project_id in (select public.my_task_project_ids()))
);
create policy task_update on public.tasks for update to authenticated
  using (
    (select public.manages_tasks())
    or created_by = (select auth.uid())
    or assignee_number = (select public.current_employee_number())
    or project_id in (select public.led_task_project_ids())
  )
  with check (
    (select public.manages_tasks())
    or created_by = (select auth.uid())
    or assignee_number = (select public.current_employee_number())
    or project_id in (select public.my_task_project_ids())
  );
create policy task_delete on public.tasks for delete to authenticated using (
  (select public.manages_tasks())
  or created_by = (select auth.uid())
  or project_id in (select public.led_task_project_ids())
);

-- projects: the people who run tasks; members see theirs, and anyone sees a project they can see a task in
create policy task_select on public.task_projects for select to authenticated using (
  (select public.manages_tasks())
  or id in (select public.my_task_project_ids())
  or exists (select 1 from public.tasks t where t.project_id = task_projects.id)
);
create policy task_insert on public.task_projects for insert to authenticated with check ((select public.manages_tasks()));
create policy task_update on public.task_projects for update to authenticated
  using ((select public.manages_tasks()) or id in (select public.led_task_project_ids()))
  with check ((select public.manages_tasks()) or id in (select public.led_task_project_ids()));
create policy task_delete on public.task_projects for delete to authenticated using ((select public.manages_tasks()));

create policy task_select on public.task_project_members for select to authenticated using (
  (select public.manages_tasks()) or project_id in (select public.my_task_project_ids())
);
create policy task_insert on public.task_project_members for insert to authenticated with check (
  (select public.manages_tasks()) or project_id in (select public.led_task_project_ids())
);
create policy task_delete on public.task_project_members for delete to authenticated using (
  (select public.manages_tasks()) or project_id in (select public.led_task_project_ids())
);

-- labels: the whole company reads them; the people who run tasks set them
create policy task_select on public.task_labels for select to authenticated using (true);
create policy task_insert on public.task_labels for insert to authenticated with check ((select public.manages_tasks()));
create policy task_update on public.task_labels for update to authenticated
  using ((select public.manages_tasks())) with check ((select public.manages_tasks()));
create policy task_delete on public.task_labels for delete to authenticated using ((select public.manages_tasks()));

create policy task_select on public.task_label_links for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id)
);
create policy task_insert on public.task_label_links for insert to authenticated with check (public.can_edit_task(task_id));
create policy task_delete on public.task_label_links for delete to authenticated using (public.can_edit_task(task_id));

-- templates: the people who run tasks
create policy task_select on public.task_templates for select to authenticated using ((select public.manages_tasks()));
create policy task_insert on public.task_templates for insert to authenticated with check ((select public.manages_tasks()));
create policy task_update on public.task_templates for update to authenticated
  using ((select public.manages_tasks())) with check ((select public.manages_tasks()));
create policy task_delete on public.task_templates for delete to authenticated using ((select public.manages_tasks()));

-- comments: anyone who can see the task reads and comments; you edit and delete your own
create policy task_select on public.task_comments for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id)
);
create policy task_insert on public.task_comments for insert to authenticated with check (
  author_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id)
);
create policy task_update on public.task_comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy task_delete on public.task_comments for delete to authenticated using (
  author_id = (select auth.uid()) or (select public.manages_tasks())
);

-- activity: read with the task; only the database writes it
create policy task_select on public.task_activity for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id)
);
revoke insert, update, delete, truncate on public.task_activity from authenticated;

-- attachments: anyone who can see the task reads and adds; the uploader or whoever can edit the task removes
create policy task_select on public.task_attachments for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id)
);
create policy task_insert on public.task_attachments for insert to authenticated with check (
  uploaded_by = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id)
);
create policy task_delete on public.task_attachments for delete to authenticated using (
  uploaded_by = (select auth.uid()) or public.can_edit_task(task_id)
);
revoke update on public.task_attachments from authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. rules on rows
-- ---------------------------------------------------------------------------------------------
create or replace function public.task_projects_rules() returns trigger
language plpgsql set search_path = public as $$
begin
  new.key := upper(btrim(new.key));
  new.name := btrim(new.name);
  if new.department_id is not null and not exists (
    select 1 from public.departments d where d.id = new.department_id and d.tenant_id = new.tenant_id) then
    raise exception 'That department is not in this company' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' then
    new.next_number := greatest(new.next_number, old.next_number);
    new.created_by := old.created_by;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists task_projects_rules on public.task_projects;
create trigger task_projects_rules before insert or update on public.task_projects
  for each row execute function public.task_projects_rules();

-- a project's key changed: its tasks' keys follow
create or replace function public.task_projects_rekey() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.tasks set key = new.key || '-' || number where project_id = new.id;
  return new;
end $$;
drop trigger if exists task_projects_rekey on public.task_projects;
create trigger task_projects_rekey after update of key on public.task_projects
  for each row when (old.key is distinct from new.key) execute function public.task_projects_rekey();

create or replace function public.tasks_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  par public.tasks;
  cur uuid;
  hops integer := 0;
  v_key text;
begin
  new.title := btrim(new.title);
  if tg_op = 'INSERT' then
    new.creator_number := coalesce(new.creator_number, public.current_employee_number());
  else
    new.created_by := old.created_by;
    new.creator_number := old.creator_number;
    new.legacy_todo_id := old.legacy_todo_id;
    new.updated_at := now();
  end if;

  -- a sub-task lives in its parent's project, in the same company, and never under itself
  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    select * into par from public.tasks where id = new.parent_id;
    if par.id is null or par.tenant_id <> new.tenant_id then
      raise exception 'The parent task was not found' using errcode = '23503';
    end if;
    new.project_id := par.project_id;
    cur := par.parent_id;
    while cur is not null and hops < 1000 loop
      if cur = new.id then
        raise exception 'A task cannot be under its own sub-task' using errcode = '23514';
      end if;
      select parent_id into cur from public.tasks where id = cur;
      hops := hops + 1;
    end loop;
  end if;

  -- the key: the project's key and its next number (again when the task moves to another project)
  if tg_op = 'INSERT' or new.project_id is distinct from old.project_id then
    update public.task_projects set next_number = next_number + 1
    where id = new.project_id and tenant_id = new.tenant_id
    returning next_number, key into new.number, v_key;
    if v_key is null then
      raise exception 'The project was not found' using errcode = '23503';
    end if;
    new.key := v_key || '-' || new.number;
  end if;

  if new.status = 'done' then
    new.completed_at := case when tg_op = 'UPDATE' and old.status = 'done' then coalesce(old.completed_at, now())
                             else coalesce(case when tg_op = 'INSERT' then new.completed_at end, now()) end;
  else
    new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists tasks_rules on public.tasks;
create trigger tasks_rules before insert or update on public.tasks
  for each row execute function public.tasks_rules();

-- the activity log
create or replace function public.task_log(p_task public.tasks, p_field text, p_before text, p_after text)
returns void language sql security definer set search_path = public as $$
  insert into public.task_activity (tenant_id, task_id, actor_id, actor_name, field, before_value, after_value)
  values (p_task.tenant_id, p_task.id, auth.uid(), public.task_actor_name(), p_field, left(p_before, 500), left(p_after, 500))
$$;
revoke all on function public.task_log(public.tasks, text, text, text) from public, anon, authenticated;

create or replace function public.tasks_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.legacy_todo_id is null then
      perform public.task_log(new, 'created', null, new.key);
    end if;
    return new;
  end if;
  if new.title is distinct from old.title then perform public.task_log(new, 'title', old.title, new.title); end if;
  if new.description is distinct from old.description then perform public.task_log(new, 'description', null, null); end if;
  if new.status is distinct from old.status then perform public.task_log(new, 'status', old.status, new.status); end if;
  if new.priority is distinct from old.priority then perform public.task_log(new, 'priority', old.priority, new.priority); end if;
  if new.assignee_number is distinct from old.assignee_number then
    perform public.task_log(new, 'assignee', old.assignee_number, new.assignee_number);
  end if;
  if new.due_date is distinct from old.due_date then
    perform public.task_log(new, 'due_date', old.due_date::text, new.due_date::text);
  end if;
  if new.project_id is distinct from old.project_id then perform public.task_log(new, 'project', old.key, new.key); end if;
  if new.parent_id is distinct from old.parent_id then
    perform public.task_log(new, 'parent',
      (select t.key from public.tasks t where t.id = old.parent_id), (select t.key from public.tasks t where t.id = new.parent_id));
  end if;
  return new;
end $$;
drop trigger if exists tasks_activity on public.tasks;
create trigger tasks_activity after insert or update on public.tasks
  for each row execute function public.tasks_activity();

create or replace function public.task_label_links_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
  v_name text;
begin
  select * into t from public.tasks where id = coalesce(new.task_id, old.task_id);
  if t.id is null then
    return null;
  end if;
  select name into v_name from public.task_labels where id = coalesce(new.label_id, old.label_id);
  if tg_op = 'INSERT' then
    perform public.task_log(t, 'labels', null, v_name);
  else
    perform public.task_log(t, 'labels', v_name, null);
  end if;
  return null;
end $$;
drop trigger if exists task_label_links_activity on public.task_label_links;
create trigger task_label_links_activity after insert or delete on public.task_label_links
  for each row execute function public.task_label_links_activity();

create or replace function public.task_label_links_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.task_labels l where l.id = new.label_id and l.tenant_id = new.tenant_id)
     or not exists (select 1 from public.tasks t where t.id = new.task_id and t.tenant_id = new.tenant_id) then
    raise exception 'That label or task is not in this company' using errcode = '23503';
  end if;
  return new;
end $$;
drop trigger if exists task_label_links_rules on public.task_label_links;
create trigger task_label_links_rules before insert on public.task_label_links
  for each row execute function public.task_label_links_rules();

create or replace function public.task_attachments_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = coalesce(new.task_id, old.task_id);
  if t.id is not null then
    if tg_op = 'INSERT' then
      perform public.task_log(t, 'attachment', null, new.file_name);
    else
      perform public.task_log(t, 'attachment', old.file_name, null);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists task_attachments_activity on public.task_attachments;
create trigger task_attachments_activity after insert or delete on public.task_attachments
  for each row execute function public.task_attachments_activity();

-- ---------------------------------------------------------------------------------------------
-- 6. notifications (and a group task follows its sub-tasks)
-- ---------------------------------------------------------------------------------------------
create or replace function public.task_label(t public.tasks) returns text language sql immutable as $$
  select t.key || ' ' || t.title
$$;

create or replace function public.tasks_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  par public.tasks;
  v_open integer;
  v_done integer;
  v_started integer;
  v_want text;
begin
  if new.legacy_todo_id is not null and tg_op = 'INSERT' then
    return new;
  end if;

  -- given to someone (not the group task itself: each person gets their own sub-task)
  if not new.is_group and new.assignee_number is not null
     and (tg_op = 'INSERT' or new.assignee_number is distinct from old.assignee_number) then
    perform public.notify_employee_number(new.tenant_id, new.assignee_number, 'task_assigned', 'New task',
      'You have been given a task: ' || public.task_label(new)
      || coalesce(', due ' || to_char(new.due_date, 'DD Mon YYYY'), '') || '.');
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    -- done: the person who created it is told
    if new.status = 'done' and new.creator_number is not null then
      perform public.notify_employee_number(new.tenant_id, new.creator_number, 'task_assigned', 'Task done',
        public.task_actor_name() || ' marked ' || public.task_label(new) || ' as done.');
    end if;
    -- a sub-task of a group task: the group task follows (done when everyone has finished)
    if new.parent_id is not null then
      select * into par from public.tasks where id = new.parent_id;
      if par.id is not null and par.is_group then
        select count(*) filter (where status not in ('done', 'cancelled')),
               count(*) filter (where status = 'done'),
               count(*) filter (where status not in ('backlog', 'todo'))
          into v_open, v_done, v_started
        from public.tasks where parent_id = par.id;
        v_want := case when v_open = 0 and v_done > 0 then 'done'
                       when v_open = 0 then 'cancelled'
                       when v_started > 0 then 'in_progress'
                       else 'todo' end;
        -- a group task someone cancelled by hand stays cancelled
        if par.status <> 'cancelled' and v_want is distinct from par.status then
          update public.tasks set status = v_want where id = par.id;
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tasks_notify on public.tasks;
create trigger tasks_notify after insert or update of assignee_number, status on public.tasks
  for each row execute function public.tasks_notify();

create or replace function public.task_comments_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.body := btrim(new.body);
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    new.author_number := public.current_employee_number();
    new.author_name := public.task_actor_name();
    new.created_at := now();
  else
    new.author_id := old.author_id;
    new.author_number := old.author_number;
    new.author_name := old.author_name;
    new.task_id := old.task_id;
    new.created_at := old.created_at;
    new.edited_at := now();
  end if;
  -- only real people in this company, once each
  new.mentions := coalesce((
    select array_agg(distinct e."Employee Number" order by e."Employee Number") from public.employees e
    where e.tenant_id = new.tenant_id and e."Employee Number" = any (coalesce(new.mentions, '{}'))), '{}');
  return new;
end $$;
drop trigger if exists task_comments_rules on public.task_comments;
create trigger task_comments_rules before insert or update on public.task_comments
  for each row execute function public.task_comments_rules();

-- one notification per person: @mentioned ones are told they were mentioned; the assignee and creator otherwise
create or replace function public.task_comments_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
  who text;
  told text[] := '{}';
  v_name text := coalesce(new.author_name, 'Someone');
begin
  select * into t from public.tasks where id = new.task_id;
  if t.id is null then
    return null;
  end if;
  foreach who in array new.mentions loop
    if who is distinct from new.author_number then
      perform public.notify_employee_number(t.tenant_id, who, 'task_assigned', 'You were mentioned',
        v_name || ' mentioned you on ' || public.task_label(t) || '.');
      told := told || who;
    end if;
  end loop;
  foreach who in array array_remove(array[t.assignee_number, t.creator_number], null) loop
    if who is distinct from new.author_number and not (who = any (told)) then
      perform public.notify_employee_number(t.tenant_id, who, 'task_assigned', 'New comment on your task',
        v_name || ' commented on ' || public.task_label(t) || '.');
      told := told || who;
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists task_comments_notify on public.task_comments;
create trigger task_comments_notify after insert on public.task_comments
  for each row execute function public.task_comments_notify();

-- ---------------------------------------------------------------------------------------------
-- 7. who a department / job title / list of people means (current employees of the company)
-- ---------------------------------------------------------------------------------------------
create or replace function public.task_target_people(p_tenant uuid, p_kind text, p_department uuid, p_job_title text, p_people text[])
returns setof text
language sql stable security definer set search_path = public as $$
  with recursive dept(id) as (
    select d.id from public.departments d where p_kind = 'department' and d.id = p_department and d.tenant_id = p_tenant
    union
    select d.id from public.departments d join dept on d.parent_id = dept.id where d.tenant_id = p_tenant
  )
  select e."Employee Number" from public.employees e
  where e.tenant_id = p_tenant
    and coalesce(btrim(e."Employee Number"), '') <> ''
    and e."Termination Date" is null
    and lower(coalesce(btrim(e."Status"), '')) not in ('terminated', 'inactive', 'exited', 'resigned', 'dismissed')
    and case p_kind
          when 'department' then e.department_id in (select id from dept)
          when 'job_title' then lower(btrim(e."Job Title")) = lower(btrim(coalesce(p_job_title, '')))
                                and btrim(coalesce(p_job_title, '')) <> ''
          when 'people' then e."Employee Number" = any (coalesce(p_people, '{}'))
          else false
        end
  order by e."First Name", e."Last Name", e."Employee Number"
$$;
revoke all on function public.task_target_people(uuid, text, uuid, text, text[]) from public, anon, authenticated;

/**
 * One task for a department, a job title or several people: a group task (no assignee) and a sub-task for each
 * person. Allowed for the people who run tasks, the project's lead, a department's head (for their department), and a
 * project member giving it to people they all supervise. Returns the group task's id.
 */
create or replace function public.create_group_task(
  p_project uuid, p_title text, p_description text, p_priority text, p_due date,
  p_kind text, p_department uuid default null, p_job_title text default null, p_people text[] default null,
  p_labels uuid[] default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_people text[];
  v_parent uuid;
  v_child uuid;
  who text;
  v_ok boolean;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.task_projects p where p.id = p_project and p.tenant_id = v_tenant and not p.archived) then
    raise exception 'The project was not found' using errcode = '23503';
  end if;
  if p_kind not in ('department', 'job_title', 'people') then
    raise exception 'Choose a department, a job title or people' using errcode = '22023';
  end if;
  select array_agg(x) into v_people from public.task_target_people(v_tenant, p_kind, p_department, p_job_title, p_people) x;
  if coalesce(cardinality(v_people), 0) = 0 then
    raise exception 'Nobody matches: no current employees there' using errcode = '22023';
  end if;

  v_ok := public.manages_tasks()
    or p_project in (select public.led_task_project_ids())
    or (p_kind = 'department' and exists (
          select 1 from public.departments d where d.id = p_department and d.tenant_id = v_tenant
            and d.head_employee_id is not null and d.head_employee_id = public.current_employee_id()))
    or (p_project in (select public.my_task_project_ids())
        and not exists (select 1 from unnest(v_people) n where n not in (select public.supervised_employee_numbers())));
  if not v_ok then
    raise exception 'You cannot give tasks to these people in this project' using errcode = '42501';
  end if;

  insert into public.tasks (tenant_id, project_id, title, description, priority, due_date, is_group, created_by)
  values (v_tenant, p_project, p_title, nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_priority, 'none'), p_due, true, auth.uid())
  returning id into v_parent;
  insert into public.task_label_links (task_id, label_id, tenant_id)
    select v_parent, l.id, v_tenant from public.task_labels l where l.tenant_id = v_tenant and l.id = any (coalesce(p_labels, '{}'));

  foreach who in array v_people loop
    insert into public.tasks (tenant_id, project_id, parent_id, title, description, priority, due_date, assignee_number, created_by)
    values (v_tenant, p_project, v_parent, p_title, nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_priority, 'none'), p_due, who, auth.uid())
    returning id into v_child;
    insert into public.task_label_links (task_id, label_id, tenant_id)
      select v_child, l.id, v_tenant from public.task_labels l where l.tenant_id = v_tenant and l.id = any (coalesce(p_labels, '{}'));
  end loop;
  return v_parent;
end $$;
revoke all on function public.create_group_task(uuid, text, text, text, date, text, uuid, text, text[], uuid[]) from public, anon;
grant execute on function public.create_group_task(uuid, text, text, text, date, text, uuid, text, text[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. recurring role tasks
-- ---------------------------------------------------------------------------------------------
-- the period a template makes tasks for on a day, or null when it is not due yet that period
create or replace function public.task_template_period(p_schedule text, p_weekday integer, p_month_day integer, p_on date)
returns text language sql immutable as $$
  select case p_schedule
    when 'daily' then to_char(p_on, 'YYYY-MM-DD')
    when 'weekly' then case when extract(isodow from p_on) >= coalesce(p_weekday, 1) then to_char(p_on, 'IYYY-"W"IW') end
    when 'monthly' then case when extract(day from p_on) >= least(coalesce(p_month_day, 1),
                                    extract(day from (date_trunc('month', p_on) + interval '1 month - 1 day'))::integer)
                             then to_char(p_on, 'YYYY-MM') end
  end
$$;

/**
 * Makes the tasks every active template owes for the day: one per person per period (a second run the same period
 * makes nothing). A signed-in user (the people who run tasks) runs their own company's; the morning job runs every
 * company's. How many tasks were made.
 */
create or replace function public.run_task_templates(p_on date default current_date) returns integer
language plpgsql security definer set search_path = public as $$
declare
  tpl public.task_templates;
  v_period text;
  v_tenant uuid := null;
  v_creator text;
  who text;
  n integer := 0;
  k integer;
begin
  if auth.uid() is not null then
    if not public.manages_tasks() then
      raise exception 'Only people who run tasks can do this' using errcode = '42501';
    end if;
    v_tenant := public.current_tenant_id();
  end if;
  for tpl in
    select t.* from public.task_templates t
    join public.task_projects p on p.id = t.project_id and not p.archived
    where t.active and (v_tenant is null or t.tenant_id = v_tenant)
    order by t.created_at
  loop
    v_period := public.task_template_period(tpl.schedule, tpl.weekday, tpl.month_day, p_on);
    continue when v_period is null;
    select e."Employee Number" into v_creator from public.employees e join auth.users u on lower(u.email) = lower(e."Work Email")
      where u.id = tpl.created_by and e.tenant_id = tpl.tenant_id limit 1;
    for who in select x from public.task_target_people(tpl.tenant_id, tpl.target_kind, tpl.department_id, tpl.job_title, tpl.people) x loop
      -- already made this period (checked first so a second run does not use up task numbers)
      continue when exists (select 1 from public.tasks d
                            where d.template_id = tpl.id and d.template_period = v_period and d.assignee_number = who);
      insert into public.tasks (tenant_id, project_id, title, description, priority, due_date, assignee_number,
                                created_by, creator_number, template_id, template_period)
      values (tpl.tenant_id, tpl.project_id, tpl.title, tpl.description, tpl.priority, p_on + tpl.due_in_days, who,
              tpl.created_by, v_creator, tpl.id, v_period)
      on conflict do nothing;
      get diagnostics k = row_count;
      n := n + k;
    end loop;
    update public.task_templates set last_period = v_period where id = tpl.id;
  end loop;
  return n;
end $$;
revoke all on function public.run_task_templates(date) from public, anon;
grant execute on function public.run_task_templates(date) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- 03:10 UTC = 06:10 Nairobi
    perform cron.schedule('task-templates-daily', '10 3 * * *', $c$select public.run_task_templates(current_date);$c$);
  else
    raise notice 'pg_cron is not available: recurring tasks are made when someone who runs tasks presses "Run now".';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 9. attachments bucket (private): <company>/<task id>/<file>
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('task-attachments', 'task-attachments', false)
  on conflict (id) do update set public = false;

  drop policy if exists task_attachments_select on storage.objects;
  drop policy if exists task_attachments_insert on storage.objects;
  drop policy if exists task_attachments_delete on storage.objects;

  -- anyone who can see the task (the tasks policies decide)
  create policy task_attachments_select on storage.objects for select to authenticated
    using (
      bucket_id = 'task-attachments'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and exists (select 1 from public.tasks t where t.id::text = (storage.foldername(name))[2])
    );
  create policy task_attachments_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'task-attachments'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and exists (select 1 from public.tasks t where t.id::text = (storage.foldername(name))[2])
    );
  create policy task_attachments_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'task-attachments'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (owner = (select auth.uid())
           or exists (select 1 from public.tasks t where t.id::text = (storage.foldername(name))[2] and public.can_edit_task(t.id)))
    );
end $$;

-- ---------------------------------------------------------------------------------------------
-- 10. the old tasks (todos): copied once into each company's "General" project
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_tenant uuid;
  v_project uuid;
begin
  for v_tenant in select distinct t.tenant_id from public.todos t
                  where t.tenant_id is not null and exists (select 1 from public.tenants x where x.id = t.tenant_id) loop
    select id into v_project from public.task_projects where tenant_id = v_tenant and key = 'GEN';
    if v_project is null then
      insert into public.task_projects (tenant_id, key, name, description, created_by)
      values (v_tenant, 'GEN', 'General', 'Tasks from the old task manager, and anything that does not belong to another project.', null)
      returning id into v_project;
    end if;

    insert into public.tasks (tenant_id, project_id, title, description, status, priority, assignee_number, created_by,
                              creator_number, due_date, completed_at, created_at, updated_at, legacy_todo_id, sort_order)
    select v_tenant, v_project,
      left(coalesce(nullif(btrim(o.title), ''), 'Untitled task'), 500),
      nullif(left(concat_ws(E'\n',
        nullif(btrim(o.description), ''),
        case when coalesce(btrim(o.department), '') <> '' or coalesce(btrim(o.category), '') <> '' or coalesce(btrim(o.branch), '') <> ''
                  or coalesce(btrim(o.progress), '') <> '' or (who.num is null and coalesce(btrim(o.assigned_to), '') <> '')
                  or coalesce(btrim(o.completed_comment), '') <> '' then E'\n---\nFrom the old task manager:' end,
        'Department: ' || nullif(btrim(o.department), ''),
        'Category: ' || nullif(btrim(o.category), ''),
        'Branch: ' || nullif(btrim(o.branch), ''),
        'Progress: ' || nullif(btrim(o.progress), ''),
        'Completion note: ' || nullif(btrim(o.completed_comment), ''),
        case when who.num is null then 'Assigned to: ' || nullif(btrim(o.assigned_to), '') end
      ), 50000), ''),
      case when coalesce(o.completed, false) then 'done'
           else case lower(btrim(coalesce(o.status, '')))
                  when 'not-started' then 'todo' when 'in-progress' then 'in_progress'
                  when 'pending-review' then 'in_review' when 'pending-approval' then 'in_review'
                  when 'on-hold' then 'backlog' when 'completed' then 'done' when 'cancelled' then 'cancelled'
                  else 'todo' end end,
      case lower(btrim(coalesce(o.priority, '')))
        when 'critical' then 'urgent' when 'urgent' then 'urgent' when 'high' then 'high'
        when 'medium' then 'medium' when 'low' then 'low' else 'none' end,
      who.num,
      (select u.id from auth.users u where u.id = o.user_id),
      (select e."Employee Number" from public.employees e join auth.users u on lower(u.email) = lower(e."Work Email")
        where u.id = o.user_id and e.tenant_id = v_tenant limit 1),
      o.due_date::date, o.completed_at, coalesce(o.created_at, now()), coalesce(o.updated_at, o.created_at, now()), o.id,
      extract(epoch from coalesce(o.created_at, now()))
    from public.todos o
    left join lateral (
      select coalesce(
        (select e."Employee Number" from public.employees e
          where e.tenant_id = v_tenant and e."Employee Number" = btrim(o.assigned_to) limit 1),
        (select e."Employee Number" from public.employees e join auth.users u on lower(u.email) = lower(e."Work Email")
          where e.tenant_id = v_tenant
            and u.id = case when btrim(coalesce(o.assigned_to, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            then btrim(o.assigned_to)::uuid end limit 1),
        (select e."Employee Number" from public.employees e join auth.users u on lower(u.email) = lower(e."Work Email")
          where e.tenant_id = v_tenant and u.id = o.assigne limit 1)
      ) as num
    ) who on true
    where o.tenant_id = v_tenant
      and not exists (select 1 from public.tasks x where x.legacy_todo_id = o.id)
    order by o.created_at nulls first, o.id;
  end loop;
end $$;

-- the old table is no longer read by the whole company: its creator, its assignee and the people who run tasks
drop policy if exists read_tasks on public.todos;
create policy read_tasks on public.todos for select to authenticated
  using (
    user_id = (select auth.uid())
    or assigne = (select auth.uid())
    or assigned_to = ((select auth.uid()))::text
    or assigned_to = (select public.current_employee_number())
    or (select public.manages_tasks())
  );

notify pgrst, 'reload schema';
