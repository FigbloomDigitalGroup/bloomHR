import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { Kpi, KpiAssignment, KpiPeriod, KpiPerson } from './kpiApi';
import {
  ASSIGNMENT_SHEET_COLUMNS,
  KPI_SHEET_COLUMNS,
  RESULT_SHEET_COLUMNS,
  applyKpiUpload,
  kpiTemplateWorkbook,
  parseDirection,
  parseFrequency,
  parseMeasure,
  parseSheetNumber,
  parseUnit,
  parseYesNo,
  planKpiUpload,
  readKpiSheets,
  rowsToSave,
  type KpiSheets,
  type KpiUploadApi,
  type KpiUploadContext,
  type SheetRow,
} from './kpiSheet';

const SALES: Kpi = {
  id: 'k1', name: 'Sales revenue', description: 'Revenue closed', unit: 'currency_ksh', direction: 'higher_is_better',
  default_target: 1000000, default_weight: 60, frequency: 'quarterly', category: 'Financial', measure: 'manual', archived: false,
};
const CSAT: Kpi = {
  id: 'k2', name: 'Customer satisfaction', description: null, unit: 'rating_1_5', direction: 'higher_is_better',
  default_target: 5, default_weight: 20, frequency: 'quarterly', category: null, measure: 'manual', archived: false,
};
const AUDIT: Kpi = {
  id: 'k3', name: 'Audit passed', description: null, unit: 'yes_no', direction: 'higher_is_better',
  default_target: 1, default_weight: 20, frequency: 'annual', category: null, measure: 'manual', archived: false,
};
const OLD: Kpi = { ...SALES, id: 'k4', name: 'Old measure', archived: true };
const OPEN: KpiPeriod = { id: 'p1', name: 'Q4 2026', starts_on: '2026-10-01', ends_on: '2026-12-31', status: 'open' };

const person = (n: string, first: string, dept: string | null, title: string, group = 'JG5', status = 'Active'): KpiPerson => ({
  employeeNumber: n, firstName: first, middleName: '', lastName: 'Test', fullName: `${first} Test`, jobTitle: title, branch: '',
  town: '', email: '', id: n, departmentId: dept, department: '', reportsToId: null, photo: '', status, jobGroup: group,
});
const PEOPLE = [
  person('E1', 'Amina', 'd1', 'Sales Rep'),
  person('E2', 'Brian', 'd2', 'Clerk', 'JG3'),
  person('E3', 'Chao', 'd1', 'Sales Rep'),
  person('E9', 'Gone', 'd3', 'Driver', 'JG1', 'Terminated'),
];
const DEPTS = [
  { id: 'd1', name: 'Sales', parent_id: null, head_employee_id: null, active: true },
  { id: 'd2', name: 'Ops', parent_id: null, head_employee_id: null, active: true },
  { id: 'd3', name: 'Transport', parent_id: null, head_employee_id: null, active: true },
];
const assignment = (over: Partial<KpiAssignment>): KpiAssignment => ({
  id: 'a1', period_id: 'p1', kpi_id: 'k1', employee_number: 'E1', target: 1000000, weight: 60, assigned_via: 'person',
  self_value: null, self_comment: null, self_at: null, actual_value: null, manager_comment: null, scored_at: null, ...over,
});

const ctx = (over: Partial<KpiUploadContext> = {}): KpiUploadContext => ({
  kpis: [SALES, CSAT, AUDIT, OLD], people: PEOPLE, departments: DEPTS, period: OPEN,
  assignments: [assignment({}), assignment({ id: 'a2', kpi_id: 'k2' }), assignment({ id: 'a3', kpi_id: 'k3', employee_number: 'E2' })],
  ...over,
});
let n = 1;
const rows = (sheet: string, cells: Record<string, string | number>[]): SheetRow[] => cells.map((c) => ({ sheet, row: ++n, cells: c }));
const sheets = (over: Partial<KpiSheets>): KpiSheets => ({ kpis: [], assignments: [], results: [], problems: [], ...over });
const plan = (over: Partial<KpiSheets>, c?: Partial<KpiUploadContext>) => planKpiUpload(sheets(over), ctx(c));
const reasons = (p: ReturnType<typeof plan>) => p.refused.map((r) => r.reason);

const xlsx = (wb: XLSX.WorkBook) => new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
const csv = (s: string) => new TextEncoder().encode(s);

describe('KPI upload template', () => {
  it('has the three sheets, each with help above its headings and no rows to upload by mistake', () => {
    const wb = kpiTemplateWorkbook();
    expect(wb.SheetNames).toEqual(['KPIs', 'Assignments', 'Results']);
    const last = (name: string) => XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1 }).at(-1);
    expect(last('KPIs')).toEqual([...KPI_SHEET_COLUMNS]);
    expect(last('Assignments')).toEqual([...ASSIGNMENT_SHEET_COLUMNS]);
    expect(last('Results')).toEqual([...RESULT_SHEET_COLUMNS]);
    const help = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.KPIs, { header: 1 }).map((r) => r.join(' ')).join('\n');
    expect(help).toMatch(/Percent \(%\)/);
    expect(help).toMatch(/Tasks done on time \(%\)/);
    expect(readKpiSheets(xlsx(wb))).toEqual({ kpis: [], assignments: [], results: [], problems: [] });
  });

  it('a filled-in template reads back by field, with the row numbers people see', () => {
    const wb = kpiTemplateWorkbook();
    const start = (name: string) => XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, blankrows: true }).length;
    const kpiRow = start('KPIs') + 1;
    XLSX.utils.sheet_add_aoa(wb.Sheets.KPIs, [['Calls made', 'Outbound calls', 'Entered by hand', 'Number', 'Higher is better', 200, 10, 'Monthly', 'Customer']], { origin: `A${kpiRow}` });
    XLSX.utils.sheet_add_aoa(wb.Sheets.Assignments, [['E1', '', '', '', 'Calls made', 250, 20]], { origin: `A${start('Assignments') + 1}` });
    XLSX.utils.sheet_add_aoa(wb.Sheets.Results, [['E1', 'Calls made', 240, 'Good month']], { origin: `A${start('Results') + 1}` });
    const read = readKpiSheets(xlsx(wb));
    expect(read.kpis).toEqual([{
      sheet: 'KPIs', row: kpiRow,
      cells: { name: 'Calls made', description: 'Outbound calls', measure: 'Entered by hand', unit: 'Number', direction: 'Higher is better', target: 200, weight: 10, frequency: 'Monthly', category: 'Customer' },
    }]);
    expect(read.assignments[0].cells).toEqual({ employee: 'E1', kpi: 'Calls made', target: 250, weight: 20 });
    expect(read.results[0].cells).toEqual({ employee: 'E1', kpi: 'Calls made', actual: 240, comment: 'Good month' });
  });
});

describe('readKpiSheets', () => {
  it('knows a .csv by its headings, keeps the row numbers and skips blank rows', () => {
    const read = readKpiSheets(csv('Employee number,KPI name,Actual,Comment\nE1,Sales revenue,"1,200,000",\n,,,\nE2,Audit passed,Yes,ok'));
    expect(read.results.every((r) => r.sheet === 'Results')).toBe(true);
    expect(read.results.map((r) => [r.row, r.cells])).toEqual([
      [2, { employee: 'E1', kpi: 'Sales revenue', actual: '1,200,000' }],
      [4, { employee: 'E2', kpi: 'Audit passed', actual: 'Yes', comment: 'ok' }],
    ]);
  });

  it('reads an assignments .csv and a KPI list .csv', () => {
    expect(readKpiSheets(csv('Department,KPI name,Weight (%)\nSales,Sales revenue,40')).assignments[0].cells).toEqual({ department: 'Sales', kpi: 'Sales revenue', weight: '40' });
    expect(readKpiSheets(csv('KPI name,Unit\nCalls,Number')).kpis[0].cells).toEqual({ name: 'Calls', unit: 'Number' });
  });

  it('reads a cell formatted as a percentage as the number shown', () => {
    const ws = XLSX.utils.aoa_to_sheet([['Employee number', 'KPI name', 'Actual'], ['E1', 'On time', 0.85]]);
    ws.C2.z = '0%';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    expect(readKpiSheets(xlsx(wb)).results[0].cells.actual).toBe(85);
  });

  it('says so when a named sheet has rows but no heading row, and ignores other sheets', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['E1', 'Sales revenue', 5]]), 'Results');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Notes'], ['anything']]), 'Notes');
    const read = readKpiSheets(xlsx(wb));
    expect(read.results).toEqual([]);
    expect(read.problems).toEqual(['The Results sheet has no heading row (Employee number, KPI name, Actual, Comment). Start from the template.']);
  });
});

describe('reading values', () => {
  it('reads units, directions, frequencies and measures as labels, codes or common words', () => {
    expect(parseUnit('Percent (%)')).toBe('percent');
    expect(parseUnit('percent')).toBe('percent');
    expect(parseUnit('%')).toBe('percent');
    expect(parseUnit('Amount (KSh)')).toBe('currency_ksh');
    expect(parseUnit('currency_ksh')).toBe('currency_ksh');
    expect(parseUnit('yes / no')).toBe('yes_no');
    expect(parseUnit('Rating (1-5)')).toBe('rating_1_5');
    expect(parseUnit('kg')).toBeNull();
    expect(parseDirection('Lower is better')).toBe('lower_is_better');
    expect(parseDirection('higher_is_better')).toBe('higher_is_better');
    expect(parseFrequency('yearly')).toBe('annual');
    expect(parseFrequency('Quarterly')).toBe('quarterly');
    expect(parseMeasure('Late tasks')).toBe('tasks_late');
    expect(parseMeasure('tasks_on_time')).toBe('tasks_on_time');
    expect(parseMeasure('Entered by hand')).toBe('manual');
  });

  it('reads numbers with commas, KSh or % and refuses words', () => {
    expect(parseSheetNumber('1,200,000')).toBe(1200000);
    expect(parseSheetNumber('KSh 85,000.50')).toBe(85000.5);
    expect(parseSheetNumber('85%')).toBe(85);
    expect(parseSheetNumber('-3')).toBe(-3);
    expect(parseSheetNumber(42)).toBe(42);
    expect(parseSheetNumber('about 5')).toBeNull();
    expect(parseSheetNumber('')).toBeNull();
  });

  it('reads yes / no as Yes, No, 1 or 0', () => {
    expect(['Yes', 'y', 'TRUE', '1', 1].map(parseYesNo)).toEqual([1, 1, 1, 1, 1]);
    expect(['No', 'n', 'false', '0', 0].map(parseYesNo)).toEqual([0, 0, 0, 0, 0]);
    expect(parseYesNo('maybe')).toBeNull();
  });
});

describe('planKpiUpload: KPIs', () => {
  it('adds a new name with defaults for blank cells, and updates one already there ignoring case and spaces', () => {
    const p = plan({
      kpis: rows('KPIs', [
        { name: 'Calls  made', unit: 'Number', target: '200', weight: 10, frequency: 'Monthly' },
        { name: '  sales   REVENUE ', target: '1,500,000' },
      ]),
    });
    expect(p.refused).toEqual([]);
    expect(p.kpis[0]).toMatchObject({
      action: 'add', id: null, name: 'Calls made',
      input: { name: 'Calls made', unit: 'number', direction: 'higher_is_better', default_target: 200, default_weight: 10, frequency: 'monthly', measure: 'manual', category: null, description: null },
    });
    // the name stays as the library has it; blank cells keep what the KPI has
    expect(p.kpis[1]).toMatchObject({
      action: 'update', id: 'k1', name: 'Sales revenue', changes: ['default target'],
      input: { name: 'Sales revenue', unit: 'currency_ksh', default_target: 1500000, default_weight: 60, category: 'Financial', description: 'Revenue closed' },
    });
  });

  it('marks a row that changes nothing, and leaves it out of what is saved', () => {
    const p = plan({ kpis: rows('KPIs', [{ name: 'Sales revenue', unit: 'Amount (KSh)', weight: 60 }]) });
    expect(p.kpis[0].action).toBe('unchanged');
    expect(rowsToSave(p)).toBe(0);
  });

  it('takes the unit and direction from a task measure, and refuses ones that contradict it', () => {
    const p = plan({
      kpis: rows('KPIs', [
        { name: 'Late work', measure: 'Late tasks' },
        { name: 'On time', measure: 'Tasks done on time (%)', unit: 'Percent (%)', direction: 'Higher is better', target: 90 },
        { name: 'Bad', measure: 'tasks_late', unit: 'Percent (%)', direction: 'Higher is better' },
      ]),
    });
    expect(p.kpis.map((k) => [k.name, k.input.measure, k.input.unit, k.input.direction])).toEqual([
      ['Late work', 'tasks_late', 'number', 'lower_is_better'],
      ['On time', 'tasks_on_time', 'percent', 'higher_is_better'],
    ]);
    expect(reasons(p)).toEqual(['Late tasks is always measured as Number. Late tasks is always Lower is better']);
  });

  it('refuses unknown choices, bad numbers, empty and repeated names, with the row number', () => {
    const p = plan({
      kpis: rows('KPIs', [
        { description: 'no name' },
        { name: 'A', unit: 'kg' },
        { name: 'B', direction: 'sideways', frequency: 'weekly' },
        { name: 'C', weight: 120 },
        { name: 'D', target: 'lots' },
        { name: 'E' },
        { name: 'e' },
        { name: 'x'.repeat(121) },
      ]),
    });
    expect(p.kpis.map((k) => k.name)).toEqual(['E']);
    expect(reasons(p)).toEqual([
      'The KPI name is empty',
      '"kg" isn\'t a unit; use one of: Number, Percent (%), Amount (KSh), Yes / No, Rating (1-5)',
      '"sideways" isn\'t a direction; use one of: Higher is better, Lower is better. "weekly" isn\'t a frequency; use one of: Monthly, Quarterly, Annual',
      'The default weight is from 0 to 100',
      'The default target "lots" isn\'t a number',
      `e is already on row ${p.kpis[0].row}`,
      'The KPI name is longer than 120 characters',
    ]);
    expect(p.refused.every((r) => r.sheet === 'KPIs' && r.row > 0)).toBe(true);
  });

  it('uses 5 as the target of a rating, and reads a yes / no target', () => {
    const p = plan({ kpis: rows('KPIs', [{ name: 'Rated', unit: 'rating', target: 3 }, { name: 'Done', unit: 'Yes / No', target: 'Yes' }]) });
    expect(p.kpis.map((k) => k.input.default_target)).toEqual([5, 1]);
  });
});

describe('planKpiUpload: assignments', () => {
  it('resolves a person, a department, a job title and a job group to the people they reach', () => {
    const p = plan({
      assignments: rows('Assignments', [
        { employee: 'e2', kpi: 'sales revenue', target: '900,000', weight: 30 },
        { department: 'sales', kpi: 'Sales revenue' },
        { jobTitle: 'SALES REP', kpi: 'Customer satisfaction', target: 4 },
        { jobGroup: 'jg3', kpi: 'Audit passed', target: 'No' },
      ]),
    });
    expect(p.refused).toEqual([]);
    expect(p.assignments.map((a) => [a.scope, a.value, a.who, a.people, a.target, a.weight])).toEqual([
      ['person', 'E2', 'Brian Test (E2)', ['E2'], 900000, 30],
      ['department', 'd1', 'Department: Sales', ['E1', 'E3'], null, null],
      // a rating's target is not used
      ['job_title', 'Sales Rep', 'Job title: Sales Rep', ['E1', 'E3'], null, null],
      ['job_group', 'JG3', 'Job group: JG3', ['E2'], 0, null],
    ]);
    expect(p.assignments[1]).toMatchObject({ targetText: 'default', weightText: 'default' });
  });

  it('can assign a KPI the same upload adds', () => {
    const p = plan({ kpis: rows('KPIs', [{ name: 'Calls made' }]), assignments: rows('Assignments', [{ employee: 'E1', kpi: 'calls made', weight: 10 }]) });
    expect(p.assignments[0]).toMatchObject({ kpiName: 'Calls made', kpiKey: 'calls made' });
  });

  it('refuses rows it cannot place, saying why', () => {
    const p = plan({
      assignments: rows('Assignments', [
        { kpi: 'Sales revenue' },
        { employee: 'E1', department: 'Sales', kpi: 'Sales revenue' },
        { employee: 'E1' },
        { employee: 'E1', kpi: 'Unknown' },
        { employee: 'E1', kpi: 'Old measure' },
        { employee: 'E404', kpi: 'Sales revenue' },
        { employee: 'E9', kpi: 'Sales revenue' },
        { department: 'Finance', kpi: 'Sales revenue' },
        { department: 'Transport', kpi: 'Sales revenue' },
        { jobTitle: 'Pilot', kpi: 'Sales revenue' },
        { jobGroup: 'JG9', kpi: 'Sales revenue' },
        { employee: 'E1', kpi: 'Sales revenue', weight: 101 },
        { employee: 'E1', kpi: 'Sales revenue', target: 'a lot' },
        { employee: 'E1', kpi: 'Sales revenue' },
        { employee: 'e1', kpi: 'SALES REVENUE' },
      ]),
    });
    expect(reasons(p)).toEqual([
      'Fill in an employee number, a department, a job title or a job group',
      'Fill in only one of employee number, department, job title or job group',
      'The KPI name is empty',
      'There is no KPI called "Unknown"; add it on the KPIs sheet or in the KPI library',
      'Old measure is archived; restore it in the KPI library first',
      'No employee has the number E404',
      'Gone Test (E9) has left the company',
      'There is no department called "Finance"',
      'Nobody currently works in Transport',
      'Nobody has the job title "Pilot"',
      'Nobody has the job group "JG9"',
      'The weight is from 0 to 100',
      'The target "a lot" isn\'t a number',
      `Row ${p.assignments[0].row} already assigns Sales revenue to the same people`,
    ]);
    expect(p.assignments).toHaveLength(1);
  });

  it('refuses every row for a closed period', () => {
    const p = plan({ assignments: rows('Assignments', [{ employee: 'E1', kpi: 'Sales revenue' }]) }, { period: { ...OPEN, status: 'closed' } });
    expect(reasons(p)).toEqual(['Q4 2026 is closed; reopen it to change its KPIs']);
  });
});

describe('planKpiUpload: results', () => {
  it('reads each actual for its KPI’s unit and matches it to the KPI the person has', () => {
    const p = plan({
      results: rows('Results', [
        { employee: 'e1', kpi: 'Sales revenue', actual: 'KSh 1,250,000', comment: 'Strong quarter' },
        { employee: 'E1', kpi: 'customer satisfaction', actual: 4 },
        { employee: 'E2', kpi: 'Audit passed', actual: 'No' },
      ]),
    });
    expect(p.refused).toEqual([]);
    expect(p.results.map((r) => [r.employeeNumber, r.kpiName, r.value, r.valueText, r.comment, r.viaUpload])).toEqual([
      ['E1', 'Sales revenue', 1250000, 'KSh 1,250,000', 'Strong quarter', false],
      ['E1', 'Customer satisfaction', 4, '4 / 5', '', false],
      ['E2', 'Audit passed', 0, 'No', '', false],
    ]);
  });

  it('refuses a result for someone who does not have the KPI, instead of assigning it', () => {
    const p = plan({ results: rows('Results', [{ employee: 'E3', kpi: 'Sales revenue', actual: 5 }]) });
    expect(reasons(p)).toEqual(["Chao Test (E3) doesn't have Sales revenue in Q4 2026; assign it first"]);
  });

  it('accepts a result for a KPI the same upload assigns', () => {
    const p = plan({
      kpis: rows('KPIs', [{ name: 'Calls made' }]),
      assignments: rows('Assignments', [{ department: 'Sales', kpi: 'Calls made' }]),
      results: rows('Results', [{ employee: 'E3', kpi: 'Calls made', actual: 30 }, { employee: 'E2', kpi: 'Calls made', actual: 30 }]),
    });
    expect(p.results.map((r) => [r.employeeNumber, r.viaUpload])).toEqual([['E3', true]]);
    expect(reasons(p)).toEqual(["Brian Test (E2) doesn't have Calls made in Q4 2026; assign it first"]);
  });

  it('refuses bad values, missing cells and repeats', () => {
    const p = plan({
      results: rows('Results', [
        { kpi: 'Sales revenue', actual: 5 },
        { employee: 'E404', kpi: 'Sales revenue', actual: 5 },
        { employee: 'E1', actual: 5 },
        { employee: 'E1', kpi: 'Nope', actual: 5 },
        { employee: 'E1', kpi: 'Sales revenue' },
        { employee: 'E1', kpi: 'Sales revenue', actual: 'lots' },
        { employee: 'E1', kpi: 'Customer satisfaction', actual: 6 },
        { employee: 'E2', kpi: 'Audit passed', actual: 'maybe' },
        { employee: 'E1', kpi: 'Sales revenue', actual: 10 },
        { employee: 'E1', kpi: 'Sales revenue', actual: 11 },
      ]),
    });
    expect(reasons(p)).toEqual([
      'The employee number is empty',
      'No employee has the number E404',
      'The KPI name is empty',
      'There is no KPI called "Nope"; add it on the KPIs sheet or in the KPI library',
      'The actual is empty',
      'The actual "lots" isn\'t a number',
      'A rating is from 1 to 5, not 6',
      'The actual "maybe" isn\'t Yes or No',
      `Row ${p.results[0].row} already gives Amina Test (E1) a result for Sales revenue`,
    ]);
  });

  it('refuses a negative percentage', () => {
    const pct: Kpi = { ...SALES, id: 'k5', name: 'Attendance', unit: 'percent' };
    const p = plan(
      { results: rows('Results', [{ employee: 'E1', kpi: 'Attendance', actual: '-5%' }]) },
      { kpis: [pct], assignments: [assignment({ kpi_id: 'k5' })] }
    );
    expect(reasons(p)).toEqual(["A percentage can't be negative"]);
  });

  it('refuses results unless the period is open', () => {
    const p = plan({ results: rows('Results', [{ employee: 'E1', kpi: 'Sales revenue', actual: 5 }]) }, { period: { ...OPEN, status: 'draft' } });
    expect(reasons(p)).toEqual(['Results can only be entered while the review period is open; Q4 2026 is draft']);
  });
});

describe('applyKpiUpload', () => {
  const fakeApi = (over: Partial<KpiUploadApi> = {}) => {
    const saved: Kpi[] = [SALES, CSAT, AUDIT];
    const calls: string[] = [];
    const api: KpiUploadApi = {
      saveKpi: vi.fn(async (id, fields) => {
        calls.push(`kpi ${fields.name}`);
        if (!id) saved.push({ ...fields, id: `new-${fields.name}`, archived: false });
      }),
      loadKpis: vi.fn(async () => saved),
      assignKpi: vi.fn(async (a) => {
        calls.push(`assign ${a.kpiId} ${a.scope} ${a.value}`);
        return a.scope === 'department' ? 2 : 1;
      }),
      loadAssignments: vi.fn(async () => [
        assignment({}), assignment({ id: 'a9', kpi_id: 'new-Calls made', employee_number: 'E3' }),
      ]),
      addCheckin: vi.fn(async (id, kind, value) => {
        calls.push(`checkin ${id} ${kind} ${value}`);
      }),
      ...over,
    };
    return { api, calls };
  };

  it('saves KPIs, then assignments, then results as final check-ins, and counts them', async () => {
    const p = plan({
      kpis: rows('KPIs', [{ name: 'Calls made', weight: 10 }, { name: 'Sales revenue', weight: 50 }, { name: 'Audit passed' }]),
      assignments: rows('Assignments', [{ department: 'Sales', kpi: 'Calls made' }]),
      results: rows('Results', [{ employee: 'E3', kpi: 'Calls made', actual: 30, comment: 'ok' }, { employee: 'E1', kpi: 'Sales revenue', actual: 900000 }]),
    });
    const { api, calls } = fakeApi();
    const r = await applyKpiUpload(p, 'p1', api);
    expect(calls).toEqual([
      'kpi Calls made', 'kpi Sales revenue',
      'assign new-Calls made department d1',
      'checkin a9 final 30', 'checkin a1 final 900000',
    ]);
    expect(api.addCheckin).toHaveBeenCalledWith('a9', 'final', 30, 'ok');
    expect(api.saveKpi).toHaveBeenCalledWith('k1', expect.objectContaining({ default_weight: 50 }));
    expect(r).toEqual({ kpisAdded: 1, kpisUpdated: 1, assigned: 1, peopleAssigned: 2, resultsSaved: 2, failed: [] });
  });

  it('keeps going when a row fails, and says which rows failed and why', async () => {
    const p = plan({
      kpis: rows('KPIs', [{ name: 'Calls made' }]),
      assignments: rows('Assignments', [{ employee: 'E1', kpi: 'Calls made' }, { employee: 'E2', kpi: 'Sales revenue' }, { employee: 'E3', kpi: 'Sales revenue' }]),
      results: rows('Results', [{ employee: 'E1', kpi: 'Sales revenue', actual: 5 }, { employee: 'E1', kpi: 'Calls made', actual: 5 }]),
    });
    const { api } = fakeApi({
      saveKpi: vi.fn(async () => { throw new Error('That name is already used'); }),
      assignKpi: vi.fn(async (a) => {
        if (a.value === 'E2') throw new Error('Only HR or a manager can assign KPIs');
        return a.value === 'E3' ? 0 : 1;
      }),
      addCheckin: vi.fn(async () => { throw new Error("You can't enter your own final score"); }),
    });
    const r = await applyKpiUpload(p, 'p1', api);
    expect(r.failed.map((f) => [f.sheet, f.reason])).toEqual([
      ['KPIs', 'That name is already used'],
      ['Assignments', "Calls made wasn't saved, so this row couldn't be"],
      ['Assignments', 'Only HR or a manager can assign KPIs'],
      ['Assignments', 'Nobody matched: no current employees there'],
      ['Results', "You can't enter your own final score"],
      ['Results', "Calls made wasn't saved, so this row couldn't be"],
    ]);
    expect(r).toMatchObject({ kpisAdded: 0, assigned: 0, resultsSaved: 0 });
    expect(r.failed.every((f) => f.row > 0)).toBe(true);
  });

  it('reports a result whose KPI did not end up assigned', async () => {
    const p = plan({
      assignments: rows('Assignments', [{ employee: 'E3', kpi: 'Sales revenue' }]),
      results: rows('Results', [{ employee: 'E3', kpi: 'Sales revenue', actual: 5 }]),
    });
    const { api } = fakeApi();
    const r = await applyKpiUpload(p, 'p1', api);
    expect(r.failed.map((f) => f.reason)).toEqual(["Chao Test (E3) doesn't have Sales revenue in this period"]);
  });

  it('saves only KPIs when there is nothing else, without reloading', async () => {
    const { api } = fakeApi();
    const r = await applyKpiUpload(plan({ kpis: rows('KPIs', [{ name: 'Calls made' }]) }), 'p1', api);
    expect(r.kpisAdded).toBe(1);
    expect(api.loadKpis).not.toHaveBeenCalled();
    expect(api.loadAssignments).not.toHaveBeenCalled();
  });
});
