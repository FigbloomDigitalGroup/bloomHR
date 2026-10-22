import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import { toDirectoryEmployee, type DirectoryEmployee } from './employeeDirectory';
import { loadDepartments, type Department } from './orgStructure';
import { toCsv } from './payrollExports';
import {
  achievement,
  formatPercent,
  formatValue,
  overallScore,
  ratingBand,
  type KpiDirection,
  type KpiFrequency,
  type KpiMeasure,
  type KpiUnit,
  type PeriodStatus,
} from './kpis';

// Reading and saving custom KPIs (migrations 20261016900000, 20261019300000 for templates, 20261023200000 for KPIs
// calculated from tasks, 20261023500000 from attendance). The database decides who may do what; these return its
// refusals as plain sentences.

export interface Kpi {
  id: string;
  name: string;
  description: string | null;
  unit: KpiUnit;
  direction: KpiDirection;
  default_target: number | null;
  default_weight: number;
  frequency: KpiFrequency;
  category: string | null;
  /** typed in, or calculated from tasks or attendance */
  measure: KpiMeasure;
  archived: boolean;
}
export type KpiInput = Omit<Kpi, 'id' | 'archived'>;

export interface KpiPeriod {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: PeriodStatus;
}
export type KpiPeriodInput = Omit<KpiPeriod, 'id'>;

export type AssignScope = 'person' | 'department' | 'job_title' | 'job_group';

export interface KpiAssignment {
  id: string;
  period_id: string;
  kpi_id: string;
  employee_number: string;
  target: number | null;
  weight: number;
  /** how it was given: by hand to one person or a group (assign_kpi), or by a KPI template */
  assigned_via: AssignScope | 'template';
  /** the template it came from (assigned_via 'template') */
  template_id?: string | null;
  /** a manager or HR changed its target or weight: templates no longer change it */
  overridden?: boolean;
  /** from a template that no longer fits the employee, kept because it has check-ins */
  no_longer_matches?: boolean;
  self_value: number | null;
  self_comment: string | null;
  self_at: string | null;
  actual_value: number | null;
  manager_comment: string | null;
  scored_at: string | null;
  /** the calculated value (KPIs with a calculated measure), what it came from and when it last changed */
  auto_value?: number | null;
  auto_detail?: Record<string, number> | null;
  auto_at?: string | null;
}

/** The actual a KPI is scored on: the manager's (or HR's) final score, else the calculated value. */
export const actualOf = (a: KpiAssignment): number | null => a.actual_value ?? a.auto_value ?? null;

export interface KpiAccess {
  manages: boolean;
  employeeNumber: string | null;
  /** the employee numbers of the signed-in person's reports */
  team: string[];
}

export interface KpiPerson extends DirectoryEmployee {
  jobGroup: string;
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** A database refusal as something a person can act on. */
export function kpiError(err: unknown): string {
  const e = (err ?? {}) as { message?: string; code?: string };
  if (e.code === '23505') return 'That name is already used';
  if (e.code === '23503' && /kpi_assignments/.test(e.message ?? '')) return 'This KPI is in use; archive it instead';
  if (e.code === '42501' && /row-level security/.test(e.message ?? '')) return 'You are not allowed to do that';
  return e.message || 'Something went wrong';
}
const fail = (error: unknown): never => {
  throw new Error(kpiError(error));
};

export async function loadKpiAccess(): Promise<KpiAccess> {
  const { data, error } = await supabase.rpc('kpi_my_access');
  if (error) return { manages: false, employeeNumber: null, team: [] };
  const d = (data ?? {}) as { manages?: boolean; employee_number?: string | null; team?: string[] | null };
  return { manages: !!d.manages, employeeNumber: d.employee_number ?? null, team: d.team ?? [] };
}

const toKpi = (r: Record<string, unknown>): Kpi => ({
  ...(r as unknown as Kpi),
  default_target: num(r.default_target),
  default_weight: Number(r.default_weight ?? 0),
  measure: (r.measure as KpiMeasure) ?? 'manual',
});

export async function loadKpis(): Promise<Kpi[]> {
  const { data, error } = await supabase
    .from('kpis')
    .select('id, name, description, unit, direction, default_target, default_weight, frequency, category, measure, archived')
    .order('name');
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map(toKpi);
}

/** Adds a KPI (id null) or changes one. */
export async function saveKpi(id: string | null, fields: KpiInput): Promise<void> {
  const row = { ...fields, name: fields.name.trim(), description: fields.description?.trim() || null, category: fields.category?.trim() || null };
  const { error } = id ? await supabase.from('kpis').update(row).eq('id', id) : await supabase.from('kpis').insert(row);
  if (error) fail(error);
}

export async function setKpiArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase.from('kpis').update({ archived }).eq('id', id);
  if (error) fail(error);
}

export async function loadPeriods(): Promise<KpiPeriod[]> {
  const { data, error } = await supabase.from('kpi_periods').select('id, name, starts_on, ends_on, status').order('starts_on', { ascending: false });
  if (error) fail(error);
  return (data ?? []) as KpiPeriod[];
}

export async function savePeriod(id: string | null, fields: KpiPeriodInput): Promise<void> {
  const row = { ...fields, name: fields.name.trim() };
  const { error } = id ? await supabase.from('kpi_periods').update(row).eq('id', id) : await supabase.from('kpi_periods').insert(row);
  if (error) fail(error);
}

const ASSIGNMENT_COLUMNS =
  'id, period_id, kpi_id, employee_number, target, weight, assigned_via, template_id, overridden, no_longer_matches, self_value, self_comment, self_at, actual_value, manager_comment, scored_at, auto_value, auto_detail, auto_at';

const toAssignment = (r: Record<string, unknown>): KpiAssignment => ({
  ...(r as unknown as KpiAssignment),
  target: num(r.target),
  weight: Number(r.weight ?? 0),
  self_value: num(r.self_value),
  actual_value: num(r.actual_value),
  auto_value: num(r.auto_value),
});

/** The period's assignments the signed-in person may see (HR all, a manager their team's, staff their own). */
export async function loadAssignments(periodId: string): Promise<KpiAssignment[]> {
  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    supabase.from('kpi_assignments').select(ASSIGNMENT_COLUMNS).eq('period_id', periodId).order('id').range(from, to)
  ).catch(fail);
  return rows.map(toAssignment);
}

/** Works out the period's calculated KPIs again now (they also update every hour); returns how many changed. */
export async function refreshMeasures(periodId: string): Promise<number> {
  const { data, error } = await supabase.rpc('kpi_refresh_measures', { p_period: periodId });
  if (error) fail(error);
  return Number(data ?? 0);
}

/** Assigns the KPI to everyone in scope; returns how many people it was set for. */
export async function assignKpi(args: {
  periodId: string;
  kpiId: string;
  scope: AssignScope;
  value: string;
  target: number | null;
  weight: number | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc('assign_kpi', {
    p_period: args.periodId,
    p_kpi: args.kpiId,
    p_scope: args.scope,
    p_value: args.value,
    p_target: args.target,
    p_weight: args.weight,
  });
  if (error) fail(error);
  return Number(data ?? 0);
}

export async function updateAssignment(id: string, fields: { target: number | null; weight: number }): Promise<void> {
  const { error } = await supabase.from('kpi_assignments').update(fields).eq('id', id);
  if (error) fail(error);
}

export async function removeAssignment(id: string): Promise<void> {
  const { error } = await supabase.from('kpi_assignments').delete().eq('id', id);
  if (error) fail(error);
}

/** A self-assessment (the employee) or a final score (their manager or HR). */
export async function addCheckin(assignmentId: string, kind: 'self' | 'final', value: number | null, comment: string): Promise<void> {
  const { error } = await supabase
    .from('kpi_checkins')
    .insert({ assignment_id: assignmentId, kind, value, comment: comment.trim() || null });
  if (error) fail(error);
}

/** Everyone in the company (the directory every role reads), with their job group. */
export async function loadKpiPeople(): Promise<KpiPerson[]> {
  const rows = await fetchAll<Record<string, string | null>>((from, to) =>
    supabase
      .from('employee_directory')
      .select('"Employee Number", "First Name", "Middle Name", "Last Name", "Job Title", "Job Group", "Branch", "Town", "Work Email", id, department_id, reports_to_id, "Job Level", "Profile Image", "Status"')
      .order('Employee Number')
      .range(from, to) as unknown as PromiseLike<{ data: Record<string, string | null>[] | null; error: unknown }>
  ).catch(fail);
  return rows
    .map((r) => ({ ...toDirectoryEmployee(r), jobGroup: (r['Job Group'] || '').trim() }))
    .filter((p) => p.employeeNumber);
}

export const loadKpiDepartments = (): Promise<Department[]> => loadDepartments().catch(fail);

// ---------------------------------------------------------------------------------------------
// scorecards
// ---------------------------------------------------------------------------------------------
export interface ScoredLine {
  assignment: KpiAssignment;
  kpi: Kpi | undefined;
  achievement: number | null;
}

export interface Scorecard {
  employeeNumber: string;
  name: string;
  department: string;
  lines: ScoredLine[];
  score: number | null;
  scored: number;
  weightTotal: number;
}

/** One scorecard per employee who has KPIs in the period, by name. */
export function buildScorecards(assignments: KpiAssignment[], kpis: Kpi[], people: KpiPerson[]): Scorecard[] {
  const kpiById = new Map(kpis.map((k) => [k.id, k]));
  const personBy = new Map(people.map((p) => [p.employeeNumber, p]));
  const byEmployee = new Map<string, KpiAssignment[]>();
  for (const a of assignments) byEmployee.set(a.employee_number, [...(byEmployee.get(a.employee_number) ?? []), a]);
  const cards: Scorecard[] = [];
  for (const [employeeNumber, list] of byEmployee) {
    const lines = list
      .map((a) => {
        const kpi = kpiById.get(a.kpi_id);
        const ach = kpi ? achievement({ unit: kpi.unit, direction: kpi.direction, target: a.target, actual: actualOf(a) }) : null;
        return { assignment: a, kpi, achievement: ach };
      })
      .sort((x, y) => y.assignment.weight - x.assignment.weight || (x.kpi?.name ?? '').localeCompare(y.kpi?.name ?? ''));
    const overall = overallScore(lines.map((l) => ({ weight: l.assignment.weight, achievement: l.achievement })));
    const person = personBy.get(employeeNumber);
    cards.push({
      employeeNumber,
      name: person?.fullName ?? employeeNumber,
      department: person?.department ?? '',
      lines,
      score: overall.score,
      scored: overall.scored,
      weightTotal: lines.reduce((s, l) => s + l.assignment.weight, 0),
    });
  }
  return cards.sort((a, b) => a.name.localeCompare(b.name));
}

export const SCORECARD_CSV_HEADERS = [
  'Employee number', 'Employee', 'Department', 'KPI', 'Unit', 'Target', 'Weight %', 'Self-assessment', 'Calculated', 'Actual (final)',
  'Achievement %', 'Overall score %', 'Band',
] as const;

export function scorecardsCsv(cards: Scorecard[]): string {
  const rows: string[][] = [];
  for (const c of cards) {
    const band = ratingBand(c.score)?.label ?? '';
    for (const l of c.lines) {
      const unit = l.kpi?.unit ?? 'number';
      rows.push([
        c.employeeNumber, c.name, c.department, l.kpi?.name ?? '', unit, formatValue(unit, l.assignment.target),
        String(l.assignment.weight), formatValue(unit, l.assignment.self_value),
        formatValue(unit, l.assignment.auto_value), formatValue(unit, l.assignment.actual_value),
        formatPercent(l.achievement), formatPercent(c.score), band,
      ]);
    }
  }
  return toCsv(SCORECARD_CSV_HEADERS, rows);
}

export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
