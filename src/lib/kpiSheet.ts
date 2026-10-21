import * as XLSX from 'xlsx';
import {
  DIRECTION_LABEL,
  FREQUENCY_LABEL,
  MEASURE_FIXED,
  MEASURE_LABEL,
  PERIOD_STATUS_LABEL,
  UNIT_LABEL,
  formatValue,
  type KpiDirection,
  type KpiFrequency,
  type KpiMeasure,
  type KpiUnit,
} from './kpis';
import type { AssignScope, Kpi, KpiAssignment, KpiInput, KpiPeriod, KpiPerson } from './kpiApi';
import type { Department } from './orgStructure';

// Uploading KPIs from a spreadsheet (FIG-987). One template workbook, three sheets, each read only when it has rows:
//
//   KPIs          the KPI library: a new name adds a KPI, a name already there (ignoring case and extra spaces) changes it
//   Assignments   who gets which KPI in the review period chosen on screen: one employee, a department, a job title or
//                 a job group (assign_kpi)
//   Results       the actuals for the (open) review period chosen on screen, saved as final check-ins so the history is
//                 kept. A result for someone who doesn't have the KPI in the period is refused, never assigned for them.
//
// Reading and checking are pure: readKpiSheets turns the file into rows, planKpiUpload decides what each row will do
// (or why it is refused) for the preview, and applyKpiUpload saves the plan through the functions it is given:
// KPIs first, then assignments, then results.

export const KPI_SHEET = 'KPIs';
export const ASSIGNMENT_SHEET = 'Assignments';
export const RESULT_SHEET = 'Results';

export const KPI_SHEET_COLUMNS = [
  'KPI name', 'Description', "How it's measured", 'Unit', 'Direction', 'Default target', 'Default weight (%)', 'Frequency', 'Category',
] as const;
export const ASSIGNMENT_SHEET_COLUMNS = ['Employee number', 'Department', 'Job title', 'Job group', 'KPI name', 'Target', 'Weight (%)'] as const;
export const RESULT_SHEET_COLUMNS = ['Employee number', 'KPI name', 'Actual', 'Comment'] as const;

export type SheetKind = 'kpis' | 'assignments' | 'results';

// ---------------------------------------------------------------------------------------------
// the template
// ---------------------------------------------------------------------------------------------
const list = (labels: Record<string, string>) => Object.values(labels).join(', ');

const KPI_HELP = [
  ['KPIs: one row per KPI. A new name adds a KPI; the name of a KPI you already have changes it (blank cells keep what it has now).'],
  [`How it's measured: ${list(MEASURE_LABEL)}. Blank means entered by hand. A measure from tasks fixes the unit and direction.`],
  [`Unit: ${list(UNIT_LABEL)}. Direction: ${list(DIRECTION_LABEL)}. Frequency: ${list(FREQUENCY_LABEL)}.`],
  ['Default weight is from 0 to 100. Fill in your rows under the headings below; delete nothing above them.'],
];
const ASSIGNMENT_HELP = [
  ['Assignments: who gets which KPI in the review period you choose when uploading. One row per KPI.'],
  ['Fill in ONE of: Employee number, Department, Job title or Job group (the KPI goes to everyone currently in it).'],
  ['KPI name: a KPI in your library, or one on the KPIs sheet. Blank Target or Weight uses the KPI’s default. Weight is from 0 to 100.'],
  ['Assigning a KPI someone already has changes its target and weight.'],
];
const RESULT_HELP = [
  ['Results: the actual each person reached, for the open review period you choose when uploading. One row per person per KPI.'],
  ['The person must already have the KPI in that period (or get it on the Assignments sheet); other rows are refused.'],
  ['Actual: a number. Yes / No KPIs take Yes, No, 1 or 0; ratings are from 1 to 5. Percentages may be typed as 85 or 85%.'],
  ['Each row is saved as the final score, with the comment; earlier scores stay in the history.'],
];

function sheetWithHelp(help: string[][], columns: readonly string[]): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet([...help, [], [...columns]]);
  sheet['!cols'] = columns.map((c) => ({ wch: Math.max(16, c.length + 4) }));
  return sheet;
}

/** The template: KPIs, Assignments and Results, each with a few lines of how to fill it above its headings. */
export function kpiTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetWithHelp(KPI_HELP, KPI_SHEET_COLUMNS), KPI_SHEET);
  XLSX.utils.book_append_sheet(wb, sheetWithHelp(ASSIGNMENT_HELP, ASSIGNMENT_SHEET_COLUMNS), ASSIGNMENT_SHEET);
  XLSX.utils.book_append_sheet(wb, sheetWithHelp(RESULT_HELP, RESULT_SHEET_COLUMNS), RESULT_SHEET);
  return wb;
}

// ---------------------------------------------------------------------------------------------
// reading the file
// ---------------------------------------------------------------------------------------------
/** One filled-in row: where it is (the row number people see in their spreadsheet) and its cells by field. */
export interface SheetRow {
  sheet: string;
  row: number;
  cells: Record<string, string | number>;
}

export interface KpiSheets {
  kpis: SheetRow[];
  assignments: SheetRow[];
  results: SheetRow[];
  /** problems with a whole sheet, e.g. no heading row */
  problems: string[];
}

/** A heading as it is compared: lower case, letters and digits only ("Weight (%)" is "weight"). */
const headingKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const FIELDS: Record<SheetKind, Record<string, readonly string[]>> = {
  kpis: {
    name: ['kpiname', 'name', 'kpi'],
    description: ['description'],
    measure: ['howitsmeasured', 'howmeasured', 'measure', 'measuredby'],
    unit: ['unit', 'measuredas'],
    direction: ['direction'],
    target: ['defaulttarget', 'target'],
    weight: ['defaultweight', 'weight'],
    frequency: ['frequency'],
    category: ['category'],
  },
  assignments: {
    employee: ['employeenumber', 'employeeno', 'employee', 'staffnumber'],
    department: ['department'],
    jobTitle: ['jobtitle'],
    jobGroup: ['jobgroup'],
    kpi: ['kpiname', 'kpi'],
    target: ['target'],
    weight: ['weight'],
  },
  results: {
    employee: ['employeenumber', 'employeeno', 'employee', 'staffnumber'],
    kpi: ['kpiname', 'kpi'],
    actual: ['actual', 'actualvalue', 'result', 'value'],
    comment: ['comment', 'comments', 'note', 'notes'],
  },
};

/** The headings that make a row the heading row of each kind of sheet. */
const isHeading: Record<SheetKind, (fields: Set<string>) => boolean> = {
  kpis: (f) => f.has('name'),
  assignments: (f) => f.has('kpi') && ['employee', 'department', 'jobTitle', 'jobGroup'].some((x) => f.has(x)),
  results: (f) => f.has('kpi') && f.has('employee') && f.has('actual'),
};

const SHEET_NAMES: Record<string, SheetKind> = {
  kpis: 'kpis', kpi: 'kpis', kpilist: 'kpis', kpilibrary: 'kpis',
  assignments: 'assignments', assignment: 'assignments', assign: 'assignments',
  results: 'results', result: 'results', actuals: 'results',
};

/** Which column holds which field, for a row read as the headings of a kind of sheet. */
function columnsFor(kind: SheetKind, row: unknown[]): Map<number, string> {
  const byHeading = new Map<string, string>();
  for (const [field, names] of Object.entries(FIELDS[kind])) for (const n of names) byHeading.set(n, field);
  const cols = new Map<number, string>();
  const taken = new Set<string>();
  row.forEach((cell, i) => {
    const field = typeof cell === 'string' ? byHeading.get(headingKey(cell)) : undefined;
    if (field && !taken.has(field)) {
      cols.set(i, field);
      taken.add(field);
    }
  });
  return cols;
}

/** A cell as it was typed: text trimmed, a number formatted as a percentage (0.85 shown as 85%) read as 85. */
function cellValue(cell: XLSX.CellObject | undefined): string | number {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (typeof cell.v === 'number') {
    const percent = (typeof cell.z === 'string' && cell.z.includes('%')) || (typeof cell.w === 'string' && cell.w.trim().endsWith('%'));
    return percent ? Math.round(cell.v * 1e6) / 1e4 : cell.v;
  }
  if (typeof cell.v === 'boolean') return cell.v ? 'Yes' : 'No';
  if (cell.v instanceof Date) return cell.w ?? '';
  return String(cell.v).trim();
}

const HEADING_ROWS_SEARCHED = 30;

/**
 * Reads an .xlsx, .xls or .csv file into the rows of its KPIs, Assignments and Results sheets. A sheet is known by its
 * name, or else by its headings (so a .csv of any one kind works); the headings may sit below a few lines of help.
 */
export function readKpiSheets(data: ArrayBuffer | Uint8Array): KpiSheets {
  const out: KpiSheets = { kpis: [], assignments: [], results: [], problems: [] };
  const wb = XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: 'array', raw: true });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws?.['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const grid: { row: number; cells: (string | number)[] }[] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells: (string | number)[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) cells.push(cellValue(ws[XLSX.utils.encode_cell({ r, c })]));
      grid.push({ row: r + 1, cells });
    }
    if (!grid.some((g) => g.cells.some((c) => c !== ''))) continue;

    const named = SHEET_NAMES[headingKey(name)];
    const kinds: SheetKind[] = named ? [named] : ['results', 'assignments', 'kpis'];
    let found: { kind: SheetKind; at: number; cols: Map<number, string> } | null = null;
    for (let i = 0; i < Math.min(grid.length, HEADING_ROWS_SEARCHED) && !found; i++) {
      for (const kind of kinds) {
        const cols = columnsFor(kind, grid[i].cells);
        if (isHeading[kind](new Set(cols.values()))) {
          found = { kind, at: i, cols };
          break;
        }
      }
    }
    if (!found) {
      if (named) {
        const want = { kpis: KPI_SHEET_COLUMNS, assignments: ASSIGNMENT_SHEET_COLUMNS, results: RESULT_SHEET_COLUMNS }[named];
        out.problems.push(`The ${name} sheet has no heading row (${want.join(', ')}). Start from the template.`);
      }
      continue;
    }
    // a .csv's one sheet is called after the kind of rows it has
    const label = named ? name : { kpis: KPI_SHEET, assignments: ASSIGNMENT_SHEET, results: RESULT_SHEET }[found.kind];
    for (const g of grid.slice(found.at + 1)) {
      const cells: Record<string, string | number> = {};
      for (const [i, field] of found.cols) if (g.cells[i] !== '') cells[field] = g.cells[i];
      if (Object.keys(cells).length) out[found.kind].push({ sheet: label, row: g.row, cells });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// reading values
// ---------------------------------------------------------------------------------------------
/** A KPI, department, job title or job group name as it is compared: lower case, extra spaces ignored. */
export const nameKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const text = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

/** A number as typed: 1000, "1,000", "KSh 1,000.50", "85%", "-3". Blank or unreadable is null. */
export function parseSheetNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = text(v).replace(/ksh|kes|[,\s%]/gi, '');
  return /^-?(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : null;
}

/** Yes / No as typed: Yes, No, Y, N, True, False, 1, 0. Anything else is null. */
export function parseYesNo(v: unknown): 0 | 1 | null {
  const t = text(v).toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(t)) return 1;
  if (['no', 'n', 'false', '0'].includes(t)) return 0;
  return null;
}

/** A choice typed as its code ("higher_is_better") or the label people see ("Higher is better"), or a common alias. */
function choice<T extends string>(labels: Record<T, string>, aliases: Record<string, T>) {
  const byKey = new Map<string, T>();
  for (const [code, label] of Object.entries(labels) as [T, string][]) {
    byKey.set(headingKey(code), code);
    byKey.set(headingKey(label), code);
  }
  for (const [alias, code] of Object.entries(aliases)) byKey.set(headingKey(alias), code);
  return (v: string): T | null => byKey.get(v.trim() === '%' ? 'percent' : headingKey(v)) ?? null;
}

export const parseUnit = choice<KpiUnit>(UNIT_LABEL, {
  count: 'number', percentage: 'percent', amount: 'currency_ksh', ksh: 'currency_ksh', kes: 'currency_ksh', currency: 'currency_ksh',
  money: 'currency_ksh', 'yes/no': 'yes_no', yesno: 'yes_no', 'yes or no': 'yes_no', rating: 'rating_1_5', '1-5': 'rating_1_5',
});
export const parseDirection = choice<KpiDirection>(DIRECTION_LABEL, {
  higher: 'higher_is_better', up: 'higher_is_better', 'higher better': 'higher_is_better',
  lower: 'lower_is_better', down: 'lower_is_better', 'lower better': 'lower_is_better',
});
export const parseFrequency = choice<KpiFrequency>(FREQUENCY_LABEL, {
  month: 'monthly', quarter: 'quarterly', annually: 'annual', year: 'annual', yearly: 'annual',
});
export const parseMeasure = choice<KpiMeasure>(MEASURE_LABEL, {
  'by hand': 'manual', hand: 'manual', typed: 'manual', 'typed in': 'manual',
  'tasks done on time': 'tasks_on_time', 'tasks on time': 'tasks_on_time', 'average days to complete': 'task_days',
});

/** A target or actual for a KPI's unit, or why it can't be read. */
function readValue(unit: KpiUnit, v: unknown, what: string): { value: number } | { problem: string } {
  if (unit === 'yes_no') {
    const yn = parseYesNo(v);
    return yn === null ? { problem: `The ${what} "${text(v)}" isn't Yes or No` } : { value: yn };
  }
  const n = parseSheetNumber(v);
  if (n === null) return { problem: `The ${what} "${text(v)}" isn't a number` };
  if (unit === 'rating_1_5' && (n < 1 || n > 5)) return { problem: `A rating is from 1 to 5, not ${n}` };
  if (unit === 'percent' && n < 0) return { problem: "A percentage can't be negative" };
  return { value: n };
}

// ---------------------------------------------------------------------------------------------
// the plan: what each row will do, or why it is refused
// ---------------------------------------------------------------------------------------------
export interface RowIssue {
  sheet: string;
  row: number;
  reason: string;
}

export interface KpiRowPlan {
  sheet: string;
  row: number;
  action: 'add' | 'update' | 'unchanged';
  /** the KPI changed (update, unchanged), null for a new one */
  id: string | null;
  name: string;
  input: KpiInput;
  /** what changes, by the names people see (update) */
  changes: string[];
  archived: boolean;
}

export interface AssignmentRowPlan {
  sheet: string;
  row: number;
  kpiKey: string;
  kpiName: string;
  scope: AssignScope;
  /** what assign_kpi is given: the employee number, the department's id, the job title or job group */
  value: string;
  /** who, as people read it: "Jane Wanjiru (EMP-1)", "Department: Sales" */
  who: string;
  /** the employee numbers it reaches now */
  people: string[];
  target: number | null;
  weight: number | null;
  /** the target and weight as people read them, "default" when left blank */
  targetText: string;
  weightText: string;
}

export interface ResultRowPlan {
  sheet: string;
  row: number;
  employeeNumber: string;
  employeeName: string;
  kpiKey: string;
  kpiName: string;
  value: number;
  valueText: string;
  comment: string;
  /** the KPI is given to them by this upload's Assignments sheet (not had already) */
  viaUpload: boolean;
}

export interface KpiUploadPlan {
  kpis: KpiRowPlan[];
  assignments: AssignmentRowPlan[];
  results: ResultRowPlan[];
  refused: RowIssue[];
}

export interface KpiUploadContext {
  kpis: Kpi[];
  people: KpiPerson[];
  departments: Department[];
  /** the review period chosen on screen */
  period: KpiPeriod | null;
  /** that period's assignments now */
  assignments: KpiAssignment[];
}

const BLANK_KPI: KpiInput = {
  name: '', description: null, unit: 'number', direction: 'higher_is_better', default_target: null, default_weight: 0,
  frequency: 'quarterly', category: null, measure: 'manual',
};

const LEFT = /^(terminated|inactive|exited|resigned|dismissed)$/i;
const MAX_NAME = 120;
const MAX_CATEGORY = 60;

const FIELD_LABEL: Record<keyof KpiInput, string> = {
  name: 'name', description: 'description', measure: "how it's measured", unit: 'unit', direction: 'direction',
  default_target: 'default target', default_weight: 'default weight', frequency: 'frequency', category: 'category',
};

function planKpis(rows: SheetRow[], kpis: Kpi[], refused: RowIssue[]): KpiRowPlan[] {
  const existing = new Map(kpis.map((k) => [nameKey(k.name), k]));
  const seen = new Map<string, number>();
  const plans: KpiRowPlan[] = [];
  for (const r of rows) {
    const refuse = (reason: string) => refused.push({ sheet: r.sheet, row: r.row, reason });
    const c = r.cells;
    const name = tidy(text(c.name));
    if (!name) { refuse('The KPI name is empty'); continue; }
    if (name.length > MAX_NAME) { refuse(`The KPI name is longer than ${MAX_NAME} characters`); continue; }
    const key = nameKey(name);
    if (seen.has(key)) { refuse(`${name} is already on row ${seen.get(key)}`); continue; }
    seen.set(key, r.row);

    const kpi = existing.get(key);
    const base: KpiInput = kpi ? { ...kpi } : { ...BLANK_KPI, name };
    const problems: string[] = [];
    const pick = <T,>(raw: unknown, parse: (s: string) => T | null, what: string, options: Record<string, string>): T | undefined => {
      const t = text(raw);
      if (!t) return undefined;
      const v = parse(t);
      if (v === null) problems.push(`"${t}" isn't a ${what}; use one of: ${list(options)}`);
      return v ?? undefined;
    };
    const measure = pick(c.measure, parseMeasure, "way of measuring", MEASURE_LABEL) ?? base.measure;
    const unit = pick(c.unit, parseUnit, 'unit', UNIT_LABEL);
    const direction = pick(c.direction, parseDirection, 'direction', DIRECTION_LABEL);
    const frequency = pick(c.frequency, parseFrequency, 'frequency', FREQUENCY_LABEL) ?? base.frequency;
    let finalUnit = unit ?? base.unit;
    let finalDirection = direction ?? base.direction;
    if (measure !== 'manual') {
      const fixed = MEASURE_FIXED[measure];
      if (unit && unit !== fixed.unit) problems.push(`${MEASURE_LABEL[measure]} is always measured as ${UNIT_LABEL[fixed.unit]}`);
      if (direction && direction !== fixed.direction) problems.push(`${MEASURE_LABEL[measure]} is always ${DIRECTION_LABEL[fixed.direction]}`);
      finalUnit = fixed.unit;
      finalDirection = fixed.direction;
    }
    let target = base.default_target;
    if (finalUnit === 'rating_1_5') target = 5;
    else if (text(c.target)) {
      const v = readValue(finalUnit, c.target, 'default target');
      if ('problem' in v) problems.push(v.problem);
      else target = v.value;
    }
    let weight = base.default_weight;
    if (text(c.weight)) {
      const w = parseSheetNumber(c.weight);
      if (w === null || w < 0 || w > 100) problems.push('The default weight is from 0 to 100');
      else weight = w;
    }
    const category = text(c.category) ? tidy(text(c.category)) : base.category;
    if (category && category.length > MAX_CATEGORY) problems.push(`The category is longer than ${MAX_CATEGORY} characters`);
    if (problems.length) { refuse(problems.join('. ')); continue; }

    const input: KpiInput = {
      // a KPI already in the library keeps its name as it is written there
      name: kpi ? kpi.name : name,
      description: text(c.description) || base.description || null,
      measure, unit: finalUnit, direction: finalDirection, default_target: target, default_weight: weight, frequency,
      category: category || null,
    };
    const changes = kpi
      ? (Object.keys(FIELD_LABEL) as (keyof KpiInput)[])
          .filter((f) => (input[f] ?? null) !== ((kpi as KpiInput)[f] ?? null))
          .map((f) => FIELD_LABEL[f])
      : [];
    plans.push({
      sheet: r.sheet, row: r.row, action: !kpi ? 'add' : changes.length ? 'update' : 'unchanged', id: kpi?.id ?? null,
      name: input.name, input, changes, archived: !!kpi?.archived,
    });
  }
  return plans;
}

/** The KPIs a row may name: the library, with this upload's changes and additions. */
type KnownKpi = { name: string; unit: KpiUnit; archived: boolean; id: string | null };

function knownKpis(kpis: Kpi[], planned: KpiRowPlan[]): Map<string, KnownKpi> {
  const m = new Map<string, KnownKpi>(kpis.map((k) => [nameKey(k.name), { name: k.name, unit: k.unit, archived: k.archived, id: k.id }]));
  for (const p of planned) m.set(nameKey(p.name), { name: p.name, unit: p.input.unit, archived: p.archived, id: p.id });
  return m;
}

const unknownKpi = (name: string) => `There is no KPI called "${name}"; add it on the KPIs sheet or in the KPI library`;

function planAssignments(rows: SheetRow[], ctx: KpiUploadContext, kpis: Map<string, KnownKpi>, refused: RowIssue[]): AssignmentRowPlan[] {
  const current = ctx.people.filter((p) => !LEFT.test(p.status));
  const byNumber = new Map(ctx.people.map((p) => [p.employeeNumber.trim().toLowerCase(), p]));
  const seen = new Map<string, number>();
  const plans: AssignmentRowPlan[] = [];
  for (const r of rows) {
    const refuse = (reason: string) => refused.push({ sheet: r.sheet, row: r.row, reason });
    const c = r.cells;
    if (!ctx.period) { refuse('Choose a review period'); continue; }
    if (ctx.period.status === 'closed') { refuse(`${ctx.period.name} is closed; reopen it to change its KPIs`); continue; }
    const kpiName = tidy(text(c.kpi));
    if (!kpiName) { refuse('The KPI name is empty'); continue; }
    const kpi = kpis.get(nameKey(kpiName));
    if (!kpi) { refuse(unknownKpi(kpiName)); continue; }
    if (kpi.archived) { refuse(`${kpi.name} is archived; restore it in the KPI library first`); continue; }

    const given = (['employee', 'department', 'jobTitle', 'jobGroup'] as const).filter((f) => text(c[f]));
    if (given.length === 0) { refuse('Fill in an employee number, a department, a job title or a job group'); continue; }
    if (given.length > 1) { refuse('Fill in only one of employee number, department, job title or job group'); continue; }
    const asked = text(c[given[0]]);
    let scope: AssignScope;
    let value: string;
    let who: string;
    let people: KpiPerson[];
    if (given[0] === 'employee') {
      const p = byNumber.get(asked.toLowerCase());
      if (!p) { refuse(`No employee has the number ${asked}`); continue; }
      if (LEFT.test(p.status)) { refuse(`${p.fullName} (${p.employeeNumber}) has left the company`); continue; }
      [scope, value, who, people] = ['person', p.employeeNumber, `${p.fullName} (${p.employeeNumber})`, [p]];
    } else if (given[0] === 'department') {
      const d = ctx.departments.find((x) => x.active && nameKey(x.name) === nameKey(asked));
      if (!d) { refuse(`There is no department called "${asked}"`); continue; }
      people = current.filter((p) => p.departmentId === d.id);
      if (!people.length) { refuse(`Nobody currently works in ${d.name}`); continue; }
      [scope, value, who] = ['department', d.id, `Department: ${d.name}`];
    } else {
      const field = given[0] === 'jobTitle' ? 'jobTitle' : 'jobGroup';
      const what = given[0] === 'jobTitle' ? 'job title' : 'job group';
      people = current.filter((p) => p[field] && nameKey(p[field]) === nameKey(asked));
      if (!people.length) { refuse(`Nobody has the ${what} "${asked}"`); continue; }
      // the name as the employees have it, so the database matches the same people
      value = people[0][field].trim();
      [scope, who] = [given[0] === 'jobTitle' ? 'job_title' : 'job_group', `${what[0].toUpperCase()}${what.slice(1)}: ${value}`];
    }

    let target: number | null = null;
    if (text(c.target) && kpi.unit !== 'rating_1_5') {
      const v = readValue(kpi.unit, c.target, 'target');
      if ('problem' in v) { refuse(v.problem); continue; }
      target = v.value;
    }
    let weight: number | null = null;
    if (text(c.weight)) {
      weight = parseSheetNumber(c.weight);
      if (weight === null || weight < 0 || weight > 100) { refuse('The weight is from 0 to 100'); continue; }
    }
    const key = `${nameKey(kpi.name)}|${scope}|${nameKey(value)}`;
    if (seen.has(key)) { refuse(`Row ${seen.get(key)} already assigns ${kpi.name} to the same people`); continue; }
    seen.set(key, r.row);
    plans.push({
      sheet: r.sheet, row: r.row, kpiKey: nameKey(kpi.name), kpiName: kpi.name, scope, value, who,
      people: people.map((p) => p.employeeNumber), target, weight,
      targetText: target === null ? 'default' : formatValue(kpi.unit, target),
      weightText: weight === null ? 'default' : `${weight}%`,
    });
  }
  return plans;
}

function planResults(
  rows: SheetRow[], ctx: KpiUploadContext, kpis: Map<string, KnownKpi>, assigned: AssignmentRowPlan[], refused: RowIssue[]
): ResultRowPlan[] {
  const byNumber = new Map(ctx.people.map((p) => [p.employeeNumber.trim().toLowerCase(), p]));
  const has = new Set(ctx.assignments.map((a) => `${a.employee_number}|${a.kpi_id}`));
  const viaUpload = new Set(assigned.flatMap((a) => a.people.map((emp) => `${emp}|${a.kpiKey}`)));
  const seen = new Map<string, number>();
  const plans: ResultRowPlan[] = [];
  for (const r of rows) {
    const refuse = (reason: string) => refused.push({ sheet: r.sheet, row: r.row, reason });
    const c = r.cells;
    const period = ctx.period;
    if (!period) { refuse('Choose a review period'); continue; }
    if (period.status !== 'open') {
      refuse(`Results can only be entered while the review period is open; ${period.name} is ${PERIOD_STATUS_LABEL[period.status].toLowerCase()}`);
      continue;
    }
    const emp = text(c.employee);
    if (!emp) { refuse('The employee number is empty'); continue; }
    const person = byNumber.get(emp.toLowerCase());
    if (!person) { refuse(`No employee has the number ${emp}`); continue; }
    const kpiName = tidy(text(c.kpi));
    if (!kpiName) { refuse('The KPI name is empty'); continue; }
    const kpi = kpis.get(nameKey(kpiName));
    if (!kpi) { refuse(unknownKpi(kpiName)); continue; }
    if (!text(c.actual)) { refuse('The actual is empty'); continue; }
    const v = readValue(kpi.unit, c.actual, 'actual');
    if ('problem' in v) { refuse(v.problem); continue; }

    const who = `${person.fullName} (${person.employeeNumber})`;
    const hadIt = kpi.id !== null && has.has(`${person.employeeNumber}|${kpi.id}`);
    const givenNow = viaUpload.has(`${person.employeeNumber}|${nameKey(kpi.name)}`);
    if (!hadIt && !givenNow) { refuse(`${who} doesn't have ${kpi.name} in ${period.name}; assign it first`); continue; }
    const key = `${person.employeeNumber}|${nameKey(kpi.name)}`;
    if (seen.has(key)) { refuse(`Row ${seen.get(key)} already gives ${who} a result for ${kpi.name}`); continue; }
    seen.set(key, r.row);
    plans.push({
      sheet: r.sheet, row: r.row, employeeNumber: person.employeeNumber, employeeName: person.fullName, kpiKey: nameKey(kpi.name),
      kpiName: kpi.name, value: v.value, valueText: formatValue(kpi.unit, v.value), comment: text(c.comment), viaUpload: !hadIt,
    });
  }
  return plans;
}

/** What uploading the sheets would do, row by row, and the rows refused with why. Saves nothing. */
export function planKpiUpload(sheets: KpiSheets, ctx: KpiUploadContext): KpiUploadPlan {
  const refused: RowIssue[] = [];
  const kpis = planKpis(sheets.kpis, ctx.kpis, refused);
  const known = knownKpis(ctx.kpis, kpis);
  const assignments = planAssignments(sheets.assignments, ctx, known, refused);
  const results = planResults(sheets.results, ctx, known, assignments, refused);
  const order: Record<string, number> = {};
  [...new Set([...sheets.kpis, ...sheets.assignments, ...sheets.results].map((r) => r.sheet))].forEach((s, i) => (order[s] = i));
  refused.sort((a, b) => (order[a.sheet] ?? 0) - (order[b.sheet] ?? 0) || a.row - b.row);
  return { kpis, assignments, results, refused };
}

/** How many rows the plan would save (KPIs that would not change are left out). */
export const rowsToSave = (plan: KpiUploadPlan) =>
  plan.kpis.filter((k) => k.action !== 'unchanged').length + plan.assignments.length + plan.results.length;

// ---------------------------------------------------------------------------------------------
// saving
// ---------------------------------------------------------------------------------------------
export interface KpiUploadApi {
  saveKpi: (id: string | null, fields: KpiInput) => Promise<void>;
  loadKpis: () => Promise<Kpi[]>;
  assignKpi: (args: { periodId: string; kpiId: string; scope: AssignScope; value: string; target: number | null; weight: number | null }) => Promise<number>;
  loadAssignments: (periodId: string) => Promise<KpiAssignment[]>;
  addCheckin: (assignmentId: string, kind: 'self' | 'final', value: number | null, comment: string) => Promise<void>;
}

export interface KpiUploadResult {
  kpisAdded: number;
  kpisUpdated: number;
  /** assignment rows saved, and how many people's KPIs they set */
  assigned: number;
  peopleAssigned: number;
  resultsSaved: number;
  failed: RowIssue[];
}

const message = (e: unknown) => (e instanceof Error && e.message) || 'Something went wrong';

/** Saves the plan: KPIs, then assignments, then results. Each row is saved on its own; the ones that fail say why. */
export async function applyKpiUpload(plan: KpiUploadPlan, periodId: string, api: KpiUploadApi): Promise<KpiUploadResult> {
  const result: KpiUploadResult = { kpisAdded: 0, kpisUpdated: 0, assigned: 0, peopleAssigned: 0, resultsSaved: 0, failed: [] };
  const fail = (r: { sheet: string; row: number }, reason: string) => result.failed.push({ sheet: r.sheet, row: r.row, reason });

  for (const k of plan.kpis) {
    if (k.action === 'unchanged') continue;
    try {
      await api.saveKpi(k.id, k.input);
      if (k.action === 'add') result.kpisAdded += 1;
      else result.kpisUpdated += 1;
    } catch (e) {
      fail(k, message(e));
    }
  }
  if (!plan.assignments.length && !plan.results.length) return result;

  let kpiIds: Map<string, string>;
  try {
    kpiIds = new Map((await api.loadKpis()).map((k) => [nameKey(k.name), k.id]));
  } catch (e) {
    for (const r of [...plan.assignments, ...plan.results]) fail(r, message(e));
    return result;
  }
  const notSaved = (name: string) => `${name} wasn't saved, so this row couldn't be`;

  for (const a of plan.assignments) {
    const kpiId = kpiIds.get(a.kpiKey);
    if (!kpiId) { fail(a, notSaved(a.kpiName)); continue; }
    try {
      const n = await api.assignKpi({ periodId, kpiId, scope: a.scope, value: a.value, target: a.target, weight: a.weight });
      if (n === 0) fail(a, 'Nobody matched: no current employees there');
      else {
        result.assigned += 1;
        result.peopleAssigned += n;
      }
    } catch (e) {
      fail(a, message(e));
    }
  }
  if (!plan.results.length) return result;

  let assignmentIds: Map<string, string>;
  try {
    assignmentIds = new Map((await api.loadAssignments(periodId)).map((a) => [`${a.employee_number}|${a.kpi_id}`, a.id]));
  } catch (e) {
    for (const r of plan.results) fail(r, message(e));
    return result;
  }
  for (const r of plan.results) {
    const kpiId = kpiIds.get(r.kpiKey);
    if (!kpiId) { fail(r, notSaved(r.kpiName)); continue; }
    const id = assignmentIds.get(`${r.employeeNumber}|${kpiId}`);
    if (!id) { fail(r, `${r.employeeName} (${r.employeeNumber}) doesn't have ${r.kpiName} in this period`); continue; }
    try {
      await api.addCheckin(id, 'final', r.value, r.comment);
      result.resultsSaved += 1;
    } catch (e) {
      fail(r, message(e));
    }
  }
  return result;
}
