import { supabase } from './supabase';
import { kpiError } from './kpiApi';
import { WEIGHTS_TOTAL, checkWeights, formatNumber, round1 } from './kpis';

// KPI templates (migration 20261019300000): a set of KPIs with targets and weights for a department (and its
// sub-departments), a job title, a job group or everyone. The database applies the active ones when a review period
// opens and when someone joins or moves during an open period. The same KPI from several places is given once, from
// the highest priority source: a person (assigned by hand) > job title > job group > department (the nearest first)
// > everyone.

export type TemplateScope = 'department' | 'job_title' | 'job_group' | 'everyone';

export interface KpiTemplateItem {
  kpi_id: string;
  /** null: the KPI's default target */
  target: number | null;
  weight: number;
}

export interface KpiTemplateRecord {
  id: string;
  name: string;
  description: string | null;
  applies_to: TemplateScope;
  department_id: string | null;
  job_title_id: string | null;
  job_group_id: string | null;
  active: boolean;
  created_at: string;
  items: KpiTemplateItem[];
}

export interface TemplateMember {
  template_id: string;
  employee_number: string;
  /** 2 job title, 3 job group, 4 department, 5 everyone */
  priority: number;
  /** for a department template: 0 the employee's own department, 1 the one above it ... */
  depth: number;
}

export interface KpiTemplateInput {
  name: string;
  description: string | null;
  applies_to: TemplateScope;
  /** the department, job title or job group id (null for everyone) */
  target: string | null;
  active: boolean;
  items: KpiTemplateItem[];
}

export const SCOPE_LABEL: Record<TemplateScope, string> = {
  department: 'A department',
  job_title: 'A job title',
  job_group: 'A job group',
  everyone: 'Everyone',
};

/** Highest first, as the database decides which template a KPI comes from. */
export const PRIORITY_ORDER = ['Assigned by hand (one person)', 'Job title', 'Job group', 'Department (nearest first)', 'Everyone'] as const;

export const targetOf = (t: Pick<KpiTemplateRecord, 'applies_to' | 'department_id' | 'job_title_id' | 'job_group_id'>): string | null =>
  t.applies_to === 'department' ? t.department_id : t.applies_to === 'job_title' ? t.job_title_id : t.applies_to === 'job_group' ? t.job_group_id : null;

export interface TemplateWeights {
  total: number;
  ok: boolean;
  /** why it can't be active yet, or null */
  problem: string | null;
}

/** Whether a template may be active: it has KPIs and their weights total 100. */
export function templateWeights(items: readonly { weight: number | null | undefined }[]): TemplateWeights {
  const check = checkWeights(items.map((i) => i.weight));
  if (items.length === 0) return { total: 0, ok: false, problem: 'Add KPIs to the template' };
  if (!check.ok) {
    return {
      total: check.total,
      ok: false,
      problem: `Weights total ${formatNumber(check.total)}%; they must total ${WEIGHTS_TOTAL}% before the template can be active.`,
    };
  }
  return { total: check.total, ok: true, problem: null };
}

/** What is wrong with a template form, or null. */
export function templateProblem(input: KpiTemplateInput): string | null {
  if (!input.name.trim()) return 'Give the template a name';
  if (input.applies_to !== 'everyone' && !input.target) return 'Choose who the template is for';
  const kpis = input.items.map((i) => i.kpi_id);
  if (kpis.some((k) => !k)) return 'Choose a KPI on every line';
  if (new Set(kpis).size !== kpis.length) return 'Each KPI can only be in the template once';
  if (input.items.some((i) => !Number.isFinite(i.weight) || i.weight < 0 || i.weight > 100)) return 'Weights are from 0 to 100';
  if (input.active) return templateWeights(input.items).problem;
  return null;
}

export interface EmployeePreview {
  employeeNumber: string;
  /** the KPIs the active templates give them, with the template each comes from */
  kpis: { kpi_id: string; template_id: string; weight: number }[];
  weightTotal: number;
  templates: string[];
}

/**
 * What the active templates give each employee (manual assignments aside), using the database's priority: per KPI,
 * the template with the lowest priority number, then the nearest department, then the oldest.
 */
export function previewEmployees(members: readonly TemplateMember[], templates: readonly KpiTemplateRecord[]): EmployeePreview[] {
  const byId = new Map(templates.filter((t) => t.active).map((t) => [t.id, t]));
  const perEmployee = new Map<string, Map<string, { m: TemplateMember; t: KpiTemplateRecord; weight: number }>>();
  const rank = (m: TemplateMember, t: KpiTemplateRecord) => [m.priority, m.depth, t.created_at, t.id] as const;
  const better = (a: ReturnType<typeof rank>, b: ReturnType<typeof rank>) => {
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };
  for (const m of members) {
    const t = byId.get(m.template_id);
    if (!t) continue;
    const kpis = perEmployee.get(m.employee_number) ?? new Map();
    for (const item of t.items) {
      const cur = kpis.get(item.kpi_id);
      if (!cur || better(rank(m, t), rank(cur.m, cur.t))) kpis.set(item.kpi_id, { m, t, weight: item.weight });
    }
    perEmployee.set(m.employee_number, kpis);
  }
  return [...perEmployee.entries()].map(([employeeNumber, kpis]) => {
    const list = [...kpis.entries()].map(([kpi_id, v]) => ({ kpi_id, template_id: v.t.id, weight: v.weight }));
    return {
      employeeNumber,
      kpis: list,
      weightTotal: round1(list.reduce((s, k) => s + k.weight, 0)),
      templates: [...new Set(list.map((k) => k.template_id))],
    };
  });
}

const fail = (error: unknown): never => {
  throw new Error(kpiError(error));
};
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

export async function loadKpiTemplates(): Promise<KpiTemplateRecord[]> {
  const { data, error } = await supabase
    .from('kpi_templates')
    .select('id, name, description, applies_to, department_id, job_title_id, job_group_id, active, created_at, kpi_template_items (kpi_id, target, weight)')
    .order('name');
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as KpiTemplateRecord),
    items: ((r.kpi_template_items ?? []) as Record<string, unknown>[]).map((i) => ({
      kpi_id: String(i.kpi_id),
      target: num(i.target),
      weight: Number(i.weight ?? 0),
    })),
  }));
}

/** Template names by id (for "from template" labels; anyone in the company may read them). */
export async function loadKpiTemplateNames(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('kpi_templates').select('id, name');
  if (error) return new Map();
  return new Map(((data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
}

export async function loadTemplateMembers(): Promise<TemplateMember[]> {
  const { data, error } = await supabase.rpc('kpi_template_members');
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    template_id: String(r.template_id),
    employee_number: String(r.employee_number),
    priority: Number(r.priority),
    depth: Number(r.depth ?? 0),
  }));
}

/** Adds a template (id null) or changes one with its KPIs, in one go; returns its id. */
export async function saveKpiTemplate(id: string | null, input: KpiTemplateInput): Promise<string> {
  const { data, error } = await supabase.rpc('save_kpi_template', {
    p_id: id,
    p_name: input.name.trim(),
    p_applies_to: input.applies_to,
    p_target: input.applies_to === 'everyone' ? null : input.target,
    p_active: input.active,
    p_items: input.items.map((i) => ({ kpi_id: i.kpi_id, target: i.target, weight: i.weight })),
    p_description: input.description?.trim() || null,
  });
  if (error) fail(error);
  return String(data);
}

export async function setKpiTemplateActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('kpi_templates').update({ active }).eq('id', id);
  if (error) fail(error);
}

export async function deleteKpiTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('kpi_templates').delete().eq('id', id);
  if (error) fail(error);
}

/** Applies the active templates in every open review period now; returns how many KPIs were added. */
export async function applyKpiTemplates(periodId: string | null = null): Promise<number> {
  const { data, error } = await supabase.rpc('apply_kpi_templates', { p_period: periodId });
  if (error) fail(error);
  return Number(data ?? 0);
}
