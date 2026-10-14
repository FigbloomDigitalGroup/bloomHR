import { supabase } from './supabase';

// After hiring (FIG-831, migration 20261016300000): a new employee's orientation checklist, the training required of
// them and their tests. HR sets up the checklists, required training and tests once; each new employee gets theirs
// when they are added. after_hiring() returns one employee's progress for the onboarding page and the staff portal.

export type OwnerRole = 'hr' | 'manager' | 'employee';

export const OWNER_LABELS: Record<OwnerRole, string> = { hr: 'HR', manager: 'Manager', employee: 'Employee' };

export interface ChecklistItem {
  id: string;
  title: string;
  description: string | null;
  owner_role: OwnerRole;
  due_date: string | null;
  done_at: string | null;
}

export interface RequiredTrainingItem {
  kind: 'video' | 'document';
  item_id: string;
  title: string;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
}

export interface AssignedTest {
  id: string;
  quiz_id: string;
  title: string;
  pass_mark: number;
  due_date: string | null;
  submitted_at: string | null;
  score: number | null;
  passed: boolean | null;
  attempts: number;
  correct_count: number | null;
  question_count: number;
}

export interface AfterHiring {
  employee: { id: string; employee_number: string; name: string; job_title: string | null; start_date: string | null };
  /** HR only: the offer the employee was added from */
  offer: { id: string; status: string; job_title: string; sent_at: string | null; responded_at: string | null; start_date: string | null } | null;
  orientation: ChecklistItem[];
  training: RequiredTrainingItem[];
  tests: AssignedTest[];
}

export interface TemplateItem {
  id?: string;
  title: string;
  description: string | null;
  owner_role: OwnerRole;
  due_offset_days: number;
}

export interface OrientationTemplate {
  id: string;
  name: string;
  job_title: string | null;
  is_default: boolean;
  active: boolean;
  items: TemplateItem[];
}

export interface RequiredTrainingRule {
  id: string;
  item_kind: 'video' | 'document';
  item_id: string;
  job_title: string | null;
  due_days: number;
}

export interface TrainingOption {
  kind: 'video' | 'document';
  id: string;
  title: string;
}

export interface QuizQuestion {
  id?: string;
  question: string;
  options: string[];
  correct_index: number;
}

export interface Quiz {
  id: string;
  title: string;
  description: string | null;
  pass_mark: number;
  auto_assign: boolean;
  job_title: string | null;
  due_days: number;
  active: boolean;
  questions: QuizQuestion[];
}

export interface QuizToTake {
  title: string;
  description: string | null;
  pass_mark: number;
  questions: { id: string; question: string; options: string[] }[];
}

export interface QuizResult {
  score: number;
  passed: boolean;
  correct: number;
  total: number;
  pass_mark: number;
}

export interface ProgressSummary {
  employee_id: string;
  orientation_done: number;
  orientation_total: number;
  tests_passed: number;
  tests_total: number;
}

/** Common first-week items, to start a checklist from. */
export const SUGGESTED_ITEMS: TemplateItem[] = [
  { title: 'Prepare desk, laptop and work email', description: null, owner_role: 'hr', due_offset_days: -2 },
  { title: 'Welcome and office tour', description: null, owner_role: 'manager', due_offset_days: 0 },
  { title: 'Sign the contract and policies', description: null, owner_role: 'employee', due_offset_days: 0 },
  { title: 'Complete onboarding details and documents', description: null, owner_role: 'employee', due_offset_days: 3 },
  { title: 'Meet the team and key contacts', description: null, owner_role: 'manager', due_offset_days: 2 },
  { title: 'Agree goals for the probation period', description: null, owner_role: 'manager', due_offset_days: 14 },
  { title: 'First-month check-in', description: null, owner_role: 'hr', due_offset_days: 30 },
];

const fail = (error: { message?: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

export const today = () => new Date().toISOString().slice(0, 10);

/** Done (or completed) out of the total. */
export const progressOf = <T>(items: T[], done: (item: T) => boolean) => ({ done: items.filter(done).length, total: items.length });

/** Past its due date and not done. */
export const isOverdue = (due: string | null, done: boolean, now = today()) => Boolean(due && !done && due < now);

/** 14 Oct 2026 */
export const shortDate = (value: string | null | undefined) => {
  if (!value) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** One employee's checklist, training and tests; without an id, the signed-in employee's own. */
export async function loadAfterHiring(employeeId?: string): Promise<AfterHiring> {
  const { data, error } = await supabase.rpc('after_hiring', employeeId ? { p_employee: employeeId } : {});
  if (error) fail(error, 'Could not load the first weeks.');
  const d = data as AfterHiring;
  return { ...d, orientation: d.orientation ?? [], training: d.training ?? [], tests: d.tests ?? [] };
}

export async function loadAfterHiringSummary(): Promise<Map<string, ProgressSummary>> {
  const { data, error } = await supabase.rpc('after_hiring_summary');
  if (error) return new Map();
  return new Map(((data ?? []) as ProgressSummary[]).map((r) => [r.employee_id, r]));
}

export async function setChecklistItemDone(itemId: string, done: boolean) {
  const { error } = await supabase.rpc('set_orientation_item_done', { p_item: itemId, p_done: done });
  if (error) fail(error, 'The item was not saved.');
}

export async function assignChecklist(employeeId: string, templateId: string): Promise<number> {
  const { data, error } = await supabase.rpc('assign_orientation', { p_employee: employeeId, p_template: templateId });
  if (error) fail(error, 'The checklist was not assigned.');
  return Number(data ?? 0);
}

// --- orientation templates ---------------------------------------------------------------

export async function loadOrientationTemplates(): Promise<OrientationTemplate[]> {
  const { data, error } = await supabase
    .from('orientation_templates')
    .select('id, name, job_title, is_default, active, items:orientation_template_items(id, title, description, owner_role, due_offset_days, position)')
    .order('created_at');
  if (error) fail(error, 'Could not load the checklists.');
  return ((data ?? []) as (OrientationTemplate & { items: (TemplateItem & { position: number })[] })[]).map((t) => ({
    ...t,
    items: [...(t.items ?? [])].sort((a, b) => a.position - b.position).map(({ position: _p, ...i }) => i),
  }));
}

/** What is wrong with a checklist template, or null. */
export function templateError(t: Pick<OrientationTemplate, 'name' | 'items'>): string | null {
  if (!t.name.trim()) return 'Give the checklist a name';
  if (t.items.length === 0) return 'Add at least one item';
  if (t.items.some((i) => !i.title.trim())) return 'Every item needs a title';
  if (t.items.some((i) => !Number.isInteger(i.due_offset_days) || i.due_offset_days < -90 || i.due_offset_days > 365))
    return 'Due days must be between -90 and 365';
  return null;
}

/** Saves a template and its items (id null: a new one); one default per company. Returns its id. */
export async function saveOrientationTemplate(id: string | null, t: Omit<OrientationTemplate, 'id'>): Promise<string> {
  if (t.is_default) {
    const others = supabase.from('orientation_templates').update({ is_default: false }).eq('is_default', true);
    const { error } = id ? await others.neq('id', id) : await others;
    if (error) fail(error, 'The checklist was not saved.');
  }
  const row = { name: t.name.trim(), job_title: t.job_title?.trim() || null, is_default: t.is_default, active: t.active };
  const { data, error } = id
    ? await supabase.from('orientation_templates').update(row).eq('id', id).select('id').single()
    : await supabase.from('orientation_templates').insert(row).select('id').single();
  if (error) fail(error, 'The checklist was not saved.');
  const templateId = (data as { id: string }).id;
  const del = await supabase.from('orientation_template_items').delete().eq('template_id', templateId);
  if (del.error) fail(del.error, 'The checklist items were not saved.');
  const ins = await supabase.from('orientation_template_items').insert(
    t.items.map((i, position) => ({
      template_id: templateId, position, title: i.title.trim(), description: i.description?.trim() || null,
      owner_role: i.owner_role, due_offset_days: i.due_offset_days,
    }))
  );
  if (ins.error) fail(ins.error, 'The checklist items were not saved.');
  return templateId;
}

export async function deleteOrientationTemplate(id: string) {
  const { error } = await supabase.from('orientation_templates').delete().eq('id', id);
  if (error) fail(error, 'The checklist was not deleted.');
}

// --- required training -------------------------------------------------------------------

export async function loadRequiredTraining(): Promise<RequiredTrainingRule[]> {
  const { data, error } = await supabase.from('required_training').select('id, item_kind, item_id, job_title, due_days').order('created_at');
  if (error) fail(error, 'Could not load the required training.');
  return (data ?? []) as RequiredTrainingRule[];
}

/** The company's training videos and documents to choose from. */
export async function loadTrainingOptions(): Promise<TrainingOption[]> {
  const [videos, documents] = await Promise.all([
    supabase.from('training_videos').select('id, title').order('title'),
    supabase.from('training_documents').select('id, title').order('title'),
  ]);
  if (videos.error) fail(videos.error, 'Could not load the training.');
  if (documents.error) fail(documents.error, 'Could not load the training.');
  return [
    ...((videos.data ?? []) as { id: string; title: string | null }[]).map((v) => ({ kind: 'video' as const, id: v.id, title: v.title || 'Untitled video' })),
    ...((documents.data ?? []) as { id: string; title: string | null }[]).map((d) => ({ kind: 'document' as const, id: d.id, title: d.title || 'Untitled document' })),
  ];
}

export async function addRequiredTraining(rule: Omit<RequiredTrainingRule, 'id'>) {
  const { error } = await supabase.from('required_training').insert({ ...rule, job_title: rule.job_title?.trim() || null });
  if (error) {
    if (error.code === '23505') throw new Error('That training is already required for them');
    fail(error, 'The training was not added.');
  }
}

export async function removeRequiredTraining(id: string) {
  const { error } = await supabase.from('required_training').delete().eq('id', id);
  if (error) fail(error, 'The training was not removed.');
}

// --- tests -------------------------------------------------------------------------------

export async function loadQuizzes(): Promise<Quiz[]> {
  const { data, error } = await supabase
    .from('quizzes')
    .select('id, title, description, pass_mark, auto_assign, job_title, due_days, active, questions:quiz_questions(id, question, options, correct_index, position)')
    .order('created_at');
  if (error) fail(error, 'Could not load the tests.');
  return ((data ?? []) as (Quiz & { questions: (QuizQuestion & { position: number })[] })[]).map((q) => ({
    ...q,
    questions: [...(q.questions ?? [])].sort((a, b) => a.position - b.position).map(({ position: _p, ...x }) => x),
  }));
}

/** What is wrong with a test, or null. */
export function quizError(q: Pick<Quiz, 'title' | 'pass_mark' | 'due_days' | 'questions'>): string | null {
  if (!q.title.trim()) return 'Give the test a title';
  if (!Number.isInteger(q.pass_mark) || q.pass_mark < 0 || q.pass_mark > 100) return 'The pass mark is a percentage from 0 to 100';
  if (!Number.isInteger(q.due_days) || q.due_days < 0 || q.due_days > 365) return 'Days to complete must be between 0 and 365';
  if (q.questions.length === 0) return 'Add at least one question';
  for (const [i, x] of q.questions.entries()) {
    if (!x.question.trim()) return `Question ${i + 1} needs its text`;
    const options = x.options.map((o) => o.trim());
    if (options.length < 2 || options.some((o) => !o)) return `Question ${i + 1} needs at least two filled-in choices`;
    if (options.length > 8) return `Question ${i + 1} can have at most 8 choices`;
    if (x.correct_index < 0 || x.correct_index >= options.length) return `Pick the right answer for question ${i + 1}`;
  }
  return null;
}

/** Saves a test and its questions (id null: a new one). Returns its id. */
export async function saveQuiz(id: string | null, q: Omit<Quiz, 'id'>): Promise<string> {
  const row = {
    title: q.title.trim(), description: q.description?.trim() || null, pass_mark: q.pass_mark, auto_assign: q.auto_assign,
    job_title: q.job_title?.trim() || null, due_days: q.due_days, active: q.active,
  };
  const { data, error } = id
    ? await supabase.from('quizzes').update(row).eq('id', id).select('id').single()
    : await supabase.from('quizzes').insert(row).select('id').single();
  if (error) fail(error, 'The test was not saved.');
  const quizId = (data as { id: string }).id;
  const del = await supabase.from('quiz_questions').delete().eq('quiz_id', quizId);
  if (del.error) fail(del.error, 'The questions were not saved.');
  const ins = await supabase.from('quiz_questions').insert(
    q.questions.map((x, position) => ({
      quiz_id: quizId, position, question: x.question.trim(), options: x.options.map((o) => o.trim()), correct_index: x.correct_index,
    }))
  );
  if (ins.error) fail(ins.error, 'The questions were not saved.');
  return quizId;
}

export async function deleteQuiz(id: string) {
  const { error } = await supabase.from('quizzes').delete().eq('id', id);
  if (error) fail(error, 'The test was not deleted.');
}

export async function assignQuiz(quizId: string, employeeId: string) {
  const { error } = await supabase.rpc('assign_quiz', { p_quiz: quizId, p_employee: employeeId });
  if (error) fail(error, 'The test was not assigned.');
}

export async function allowAnotherAttempt(assignmentId: string) {
  const { error } = await supabase.rpc('reset_quiz_assignment', { p_assignment: assignmentId });
  if (error) fail(error, 'That did not work.');
}

export async function loadQuizToTake(assignmentId: string): Promise<QuizToTake> {
  const { data, error } = await supabase.rpc('quiz_to_take', { p_assignment: assignmentId });
  if (error) fail(error, 'Could not open the test.');
  return data as QuizToTake;
}

/** Sends the answers (the chosen choice's index per question, in order); the database marks them. */
export async function submitQuiz(assignmentId: string, answers: number[]): Promise<QuizResult> {
  const { data, error } = await supabase.rpc('submit_quiz', { p_assignment: assignmentId, p_answers: answers });
  if (error) fail(error, 'Your answers were not sent.');
  return data as QuizResult;
}
