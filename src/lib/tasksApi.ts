import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import { currentUserAndTenant, randomFileName, signedFileUrl } from './privateFiles';
import type {
  Task, TaskActivity, TaskAttachment, TaskComment, TaskLabel, TaskPriority, TaskProject, TaskStatus, TaskTemplate, TaskViewer,
} from './tasks';

// Reading and saving tasks (migration 20261019200000). The database decides who sees and changes what (row-level
// security); every list below is already only what the signed-in user may see.

export const TASK_ATTACHMENTS_BUCKET = 'task-attachments' as const;

const fail = (error: unknown, fallback: string): never => {
  throw new Error((error as { message?: string })?.message || fallback);
};

/** The signed-in login, their employee number, whether they run tasks and whether they oversee every task (ADMIN/HR). */
export async function loadTaskViewer(): Promise<TaskViewer> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You are not signed in');
  const [num, manages, oversees] = await Promise.all([
    supabase.rpc('current_employee_number'), supabase.rpc('manages_tasks'), supabase.rpc('oversees_tasks'),
  ]);
  return {
    userId: user.id,
    employeeNumber: (num.data as string | null) || null,
    manages: manages.data === true,
    oversees: oversees.data === true,
  };
}

/** Whether the signed-in user is concerned with a task (may comment and attach), not only overseeing it. */
export async function taskConcernsMe(taskId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('task_concerns_me', { p_task: taskId });
  if (error) return true; // let the database decide when they try
  return data === true;
}

const PROJECT_COLUMNS = 'id, key, name, description, department_id, lead_number, archived, created_by';

export async function loadProjects(): Promise<TaskProject[]> {
  const { data, error } = await supabase.from('task_projects').select(PROJECT_COLUMNS).order('name');
  if (error) fail(error, 'Could not load projects');
  return (data ?? []) as TaskProject[];
}

/** project id -> member employee numbers */
export async function loadProjectMembers(): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from('task_project_members').select('project_id, employee_number');
  if (error) fail(error, 'Could not load project members');
  const out: Record<string, string[]> = {};
  for (const r of (data ?? []) as { project_id: string; employee_number: string }[]) (out[r.project_id] ||= []).push(r.employee_number);
  return out;
}

export interface ProjectInput {
  key: string;
  name: string;
  description: string | null;
  department_id: string | null;
  lead_number: string | null;
  archived?: boolean;
}

export async function saveProject(input: ProjectInput, id?: string): Promise<TaskProject> {
  const q = id
    ? supabase.from('task_projects').update(input).eq('id', id)
    : supabase.from('task_projects').insert(input);
  const { data, error } = await q.select(PROJECT_COLUMNS).single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error(`The key ${input.key} is already used by another project`);
    fail(error, 'Could not save the project');
  }
  return data as TaskProject;
}

export async function setProjectMembers(projectId: string, numbers: string[], before: string[]): Promise<void> {
  const add = numbers.filter((n) => !before.includes(n));
  const remove = before.filter((n) => !numbers.includes(n));
  if (add.length) {
    const { error } = await supabase.from('task_project_members').insert(add.map((employee_number) => ({ project_id: projectId, employee_number })));
    if (error) fail(error, 'Could not add the members');
  }
  if (remove.length) {
    const { error } = await supabase.from('task_project_members').delete().eq('project_id', projectId).in('employee_number', remove);
    if (error) fail(error, 'Could not remove the members');
  }
}

const TASK_COLUMNS =
  'id, project_id, number, key, title, description, status, priority, assignee_number, created_by, creator_number, due_date, ' +
  'parent_id, is_group, sort_order, completed_at, template_id, created_at, updated_at, task_label_links(label_id)';

type TaskRow = Omit<Task, 'labels'> & { task_label_links?: { label_id: string }[] };
const toTask = (r: TaskRow): Task => {
  const { task_label_links: links, ...rest } = r;
  return { ...rest, labels: (links ?? []).map((l) => l.label_id) };
};

export async function loadTasks(): Promise<Task[]> {
  const rows = await fetchAll<TaskRow>((from, to) =>
    supabase.from('tasks').select(TASK_COLUMNS).order('created_at').order('id').range(from, to) as unknown as PromiseLike<{ data: TaskRow[] | null; error: unknown }>);
  return rows.map(toTask);
}

export async function loadLabels(): Promise<TaskLabel[]> {
  const { data, error } = await supabase.from('task_labels').select('id, name, color').order('name');
  if (error) fail(error, 'Could not load labels');
  return (data ?? []) as TaskLabel[];
}

export async function saveLabel(label: { name: string; color: string }, id?: string): Promise<void> {
  const { error } = id ? await supabase.from('task_labels').update(label).eq('id', id) : await supabase.from('task_labels').insert(label);
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error(`There is already a label called ${label.name}`);
    fail(error, 'Could not save the label');
  }
}

export async function deleteLabel(id: string): Promise<void> {
  const { error } = await supabase.from('task_labels').delete().eq('id', id);
  if (error) fail(error, 'Could not delete the label');
}

export interface NewTask {
  project_id: string;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_number?: string | null;
  due_date?: string | null;
  parent_id?: string | null;
  labels?: string[];
}

export async function createTask(input: NewTask, viewer: TaskViewer): Promise<Task> {
  const { labels = [], ...fields } = input;
  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...fields, created_by: viewer.userId })
    .select(TASK_COLUMNS)
    .single();
  if (error) fail(error, 'Could not create the task');
  const task = toTask(data as unknown as TaskRow);
  if (labels.length) {
    await setTaskLabels(task.id, labels, []);
    task.labels = labels;
  }
  return task;
}

export type TaskChange = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'assignee_number' | 'due_date' | 'project_id' | 'parent_id' | 'sort_order'>>;

export async function updateTask(id: string, change: TaskChange): Promise<Task> {
  const { data, error } = await supabase.from('tasks').update(change).eq('id', id).select(TASK_COLUMNS).maybeSingle();
  if (error) fail(error, 'Could not save the task');
  if (!data) throw new Error('You cannot change this task');
  return toTask(data as unknown as TaskRow);
}

export async function deleteTask(id: string): Promise<void> {
  const { data, error } = await supabase.from('tasks').delete().eq('id', id).select('id');
  if (error) fail(error, 'Could not delete the task');
  if (!data?.length) throw new Error('You cannot delete this task');
}

export async function setTaskLabels(taskId: string, labels: string[], before: string[]): Promise<void> {
  const add = labels.filter((l) => !before.includes(l));
  const remove = before.filter((l) => !labels.includes(l));
  if (add.length) {
    const { error } = await supabase.from('task_label_links').insert(add.map((label_id) => ({ task_id: taskId, label_id })));
    if (error) fail(error, 'Could not add the label');
  }
  if (remove.length) {
    const { error } = await supabase.from('task_label_links').delete().eq('task_id', taskId).in('label_id', remove);
    if (error) fail(error, 'Could not remove the label');
  }
}

export interface GroupTaskInput {
  project_id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  due_date: string | null;
  kind: 'department' | 'job_title' | 'people';
  department_id?: string | null;
  job_title?: string | null;
  people?: string[];
  labels?: string[];
}

/** One task for a department / job title / people: a group task with one sub-task per person. Returns its id. */
export async function createGroupTask(input: GroupTaskInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_group_task', {
    p_project: input.project_id,
    p_title: input.title,
    p_description: input.description,
    p_priority: input.priority,
    p_due: input.due_date,
    p_kind: input.kind,
    p_department: input.department_id ?? null,
    p_job_title: input.job_title ?? null,
    p_people: input.people ?? null,
    p_labels: input.labels ?? null,
  });
  if (error) fail(error, 'Could not create the tasks');
  return data as string;
}

export async function loadComments(taskId: string): Promise<TaskComment[]> {
  const { data, error } = await supabase
    .from('task_comments')
    .select('id, task_id, body, mentions, author_id, author_number, author_name, created_at, edited_at')
    .eq('task_id', taskId)
    .order('created_at');
  if (error) fail(error, 'Could not load comments');
  return (data ?? []) as TaskComment[];
}

export async function addComment(taskId: string, body: string, mentions: string[], viewer: TaskViewer): Promise<void> {
  const { error } = await supabase.from('task_comments').insert({ task_id: taskId, body, mentions, author_id: viewer.userId });
  if (error) fail(error, 'Could not post the comment');
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from('task_comments').delete().eq('id', id);
  if (error) fail(error, 'Could not delete the comment');
}

export async function loadActivity(taskId: string): Promise<TaskActivity[]> {
  const { data, error } = await supabase
    .from('task_activity')
    .select('id, task_id, actor_id, actor_name, field, before_value, after_value, created_at')
    .eq('task_id', taskId)
    .order('id');
  if (error) fail(error, 'Could not load the activity');
  return (data ?? []) as TaskActivity[];
}

export async function loadAttachments(taskId: string): Promise<TaskAttachment[]> {
  const { data, error } = await supabase
    .from('task_attachments')
    .select('id, task_id, path, file_name, size_bytes, content_type, uploaded_by, created_at')
    .eq('task_id', taskId)
    .order('created_at');
  if (error) fail(error, 'Could not load the attachments');
  return (data ?? []) as TaskAttachment[];
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export async function uploadAttachment(taskId: string, file: File): Promise<void> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('Files can be up to 10 MB');
  const { userId, tenantId } = await currentUserAndTenant();
  const path = `${tenantId}/${taskId}/${randomFileName(file.name)}`;
  const { error: upErr } = await supabase.storage.from(TASK_ATTACHMENTS_BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (upErr) fail(upErr, 'Could not upload the file');
  const { error } = await supabase.from('task_attachments').insert({
    task_id: taskId, path, file_name: file.name.slice(0, 300), size_bytes: file.size, content_type: file.type || null, uploaded_by: userId,
  });
  if (error) {
    await supabase.storage.from(TASK_ATTACHMENTS_BUCKET).remove([path]);
    fail(error, 'Could not save the file');
  }
}

export async function removeAttachment(a: TaskAttachment): Promise<void> {
  const { data, error } = await supabase.from('task_attachments').delete().eq('id', a.id).select('id');
  if (error) fail(error, 'Could not remove the file');
  if (!data?.length) throw new Error('You cannot remove this file');
  await supabase.storage.from(TASK_ATTACHMENTS_BUCKET).remove([a.path]);
}

export const attachmentUrl = (a: TaskAttachment) => signedFileUrl(TASK_ATTACHMENTS_BUCKET, a.path);

const TEMPLATE_COLUMNS =
  'id, project_id, title, description, priority, schedule, weekday, month_day, due_in_days, target_kind, department_id, job_title, people, active, last_period';

export async function loadTemplates(): Promise<TaskTemplate[]> {
  const { data, error } = await supabase.from('task_templates').select(TEMPLATE_COLUMNS).order('title');
  if (error) fail(error, 'Could not load recurring tasks');
  return (data ?? []) as TaskTemplate[];
}

export type TemplateInput = Omit<TaskTemplate, 'id' | 'last_period'>;

export async function saveTemplate(input: TemplateInput, id?: string): Promise<void> {
  const { error } = id ? await supabase.from('task_templates').update(input).eq('id', id) : await supabase.from('task_templates').insert(input);
  if (error) fail(error, 'Could not save the recurring task');
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('task_templates').delete().eq('id', id);
  if (error) fail(error, 'Could not delete the recurring task');
}

/** Makes what the company's recurring tasks owe today (once per period). How many tasks were made. */
export async function runTemplates(): Promise<number> {
  const { data, error } = await supabase.rpc('run_task_templates');
  if (error) fail(error, 'Could not make the recurring tasks');
  return Number(data) || 0;
}
