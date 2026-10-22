import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Kpi, KpiAccess, KpiAssignment, KpiPeriod, KpiPerson } from '../../../lib/kpiApi';

const api = vi.hoisted(() => ({
  saveKpi: vi.fn(),
  setKpiArchived: vi.fn(),
  assignKpi: vi.fn(),
  loadAssignments: vi.fn(),
  removeAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  addCheckin: vi.fn(),
  downloadCsv: vi.fn(),
  loadKpiAccess: vi.fn(),
  loadKpis: vi.fn(),
  loadPeriods: vi.fn(),
  refreshMeasures: vi.fn(),
}));
const confirm = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/confirmDialog', () => ({ confirmDialog: confirm }));
vi.mock('../../../lib/kpiTemplates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/kpiTemplates')>()),
  loadKpiTemplateNames: () => Promise.resolve(new Map([['t1', 'Sales team']])),
}));
vi.mock('../../../lib/kpiApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/kpiApi')>()),
  ...api,
}));

import KpiLibrary from './KpiLibrary';
import AssignKpis from './AssignKpis';
import Scorecards from './Scorecards';
import MyKpis from './MyKpis';

const SALES: Kpi = {
  id: 'k1', name: 'Sales revenue', description: 'Revenue closed', unit: 'currency_ksh', direction: 'higher_is_better',
  default_target: 1000000, default_weight: 60, frequency: 'quarterly', category: 'Financial', measure: 'manual', archived: false,
};
const ERRORS: Kpi = {
  id: 'k2', name: 'Error rate', description: null, unit: 'percent', direction: 'lower_is_better',
  default_target: 2, default_weight: 40, frequency: 'monthly', category: null, measure: 'manual', archived: false,
};
const Q4: KpiPeriod = { id: 'p1', name: 'Q4 2026', starts_on: '2026-10-01', ends_on: '2026-12-31', status: 'open' };
const person = (n: string, first: string, dept: string | null, title: string): KpiPerson => ({
  employeeNumber: n, firstName: first, middleName: '', lastName: 'Test', fullName: `${first} Test`, jobTitle: title, branch: '',
  town: '', email: '', id: n, departmentId: dept, department: dept === 'd1' ? 'Sales' : 'Ops', reportsToId: null, photo: '',
  status: 'Active', jobGroup: 'JG5',
});
const PEOPLE = [person('E1', 'Amina', 'd1', 'Sales Rep'), person('E2', 'Brian', 'd2', 'Clerk'), person('E3', 'Chao', 'd1', 'Sales Rep')];
const DEPTS = [
  { id: 'd1', name: 'Sales', parent_id: null, head_employee_id: null, active: true },
  { id: 'd2', name: 'Ops', parent_id: null, head_employee_id: null, active: true },
];
const HR: KpiAccess = { manages: true, employeeNumber: 'HR1', team: [] };
const row = (over: Partial<KpiAssignment>): KpiAssignment => ({
  id: 'a1', period_id: 'p1', kpi_id: 'k1', employee_number: 'E1', target: 1000000, weight: 60, assigned_via: 'person',
  self_value: null, self_comment: null, self_at: null, actual_value: null, manager_comment: null, scored_at: null, ...over,
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.saveKpi.mockResolvedValue(undefined);
  api.setKpiArchived.mockResolvedValue(undefined);
  api.assignKpi.mockResolvedValue(2);
  api.loadAssignments.mockResolvedValue([]);
  api.addCheckin.mockResolvedValue(undefined);
  api.removeAssignment.mockResolvedValue(undefined);
  confirm.mockReset().mockResolvedValue(true);
});
afterEach(() => cleanup());

describe('KPI library', () => {
  it('lists KPIs with their unit, target and weight', () => {
    render(<KpiLibrary kpis={[SALES, ERRORS]} canManage onChanged={vi.fn()} />);
    const r = screen.getByText('Sales revenue').closest('tr')!;
    expect(within(r).getByText('KSh 1,000,000')).toBeTruthy();
    expect(within(r).getByText('60%')).toBeTruthy();
    expect(within(screen.getByText('Error rate').closest('tr')!).getByText('Lower is better')).toBeTruthy();
  });

  it('adds a KPI from the form', async () => {
    const onChanged = vi.fn();
    render(<KpiLibrary kpis={[]} canManage onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add KPI' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Calls made' } });
    fireEvent.change(within(dialog).getByLabelText('Default target'), { target: { value: '1,200' } });
    fireEvent.change(within(dialog).getByLabelText('Default weight (%)'), { target: { value: '25' } });
    fireEvent.change(within(dialog).getByLabelText('Frequency'), { target: { value: 'monthly' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.saveKpi).toHaveBeenCalledWith(null, expect.objectContaining({
      name: 'Calls made', unit: 'number', direction: 'higher_is_better', default_target: 1200, default_weight: 25, frequency: 'monthly',
    }));
  });

  it('a KPI calculated from tasks takes its unit and direction from the measure', async () => {
    render(<KpiLibrary kpis={[]} canManage onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add KPI' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Late tasks' } });
    fireEvent.change(within(dialog).getByLabelText("How it's measured"), { target: { value: 'tasks_late' } });
    expect((within(dialog).getByLabelText('Measured as') as HTMLSelectElement).disabled).toBe(true);
    expect((within(dialog).getByLabelText('Direction') as HTMLSelectElement).value).toBe('lower_is_better');
    fireEvent.change(within(dialog).getByLabelText('Default target'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveKpi).toHaveBeenCalledWith(null, expect.objectContaining({
      name: 'Late tasks', measure: 'tasks_late', unit: 'number', direction: 'lower_is_better', default_target: 2,
    })));
  });

  it('offers attendance measures, worked out from clock-ins', () => {
    render(<KpiLibrary kpis={[]} canManage onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add KPI' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText("How it's measured"), { target: { value: 'punctuality' } });
    expect((within(dialog).getByLabelText('Measured as') as HTMLSelectElement).value).toBe('percent');
    expect(within(dialog).getByText(/share they were on time.*from clock-ins/)).toBeTruthy();
  });

  it('refuses a weight over 100', () => {
    render(<KpiLibrary kpis={[]} canManage onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add KPI' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'X' } });
    fireEvent.change(within(dialog).getByLabelText('Default weight (%)'), { target: { value: '120' } });
    expect(within(dialog).getByText('The weight is from 0 to 100')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers starter templates not yet in the library', async () => {
    render(<KpiLibrary kpis={[SALES]} canManage onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Add template Sales revenue' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add template Attendance rate' }));
    await waitFor(() => expect(api.saveKpi).toHaveBeenCalledWith(null, expect.objectContaining({ name: 'Attendance rate', unit: 'percent', measure: 'attendance_rate' })));
    fireEvent.click(screen.getByRole('button', { name: 'Add template Tasks completed on time' }));
    await waitFor(() => expect(api.saveKpi).toHaveBeenCalledWith(null, expect.objectContaining({ measure: 'tasks_on_time' })));
  });

  it('archives after asking', async () => {
    render(<KpiLibrary kpis={[SALES]} canManage onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive Sales revenue' }));
    await waitFor(() => expect(api.setKpiArchived).toHaveBeenCalledWith('k1', true));
    expect(confirm).toHaveBeenCalled();
  });

  it('is read-only for people who do not manage KPIs', () => {
    render(<KpiLibrary kpis={[SALES]} canManage={false} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Add KPI' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Sales revenue' })).toBeNull();
  });
});

describe('Assign', () => {
  const page = (access: KpiAccess = HR) =>
    render(<AssignKpis kpis={[SALES, ERRORS]} periods={[Q4]} people={PEOPLE} departments={DEPTS} access={access} />);

  it('assigns a KPI to a department with target and weight overrides', async () => {
    page();
    fireEvent.change(screen.getByLabelText('KPI'), { target: { value: 'k1' } });
    fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: 'department' } });
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd1' } });
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText('Weight (%)'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(api.assignKpi).toHaveBeenCalledWith({ periodId: 'p1', kpiId: 'k1', scope: 'department', value: 'd1', target: 500000, weight: 50 }));
  });

  it('by job title: the titles in the company', () => {
    page();
    fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: 'job_title' } });
    const opts = within(screen.getByLabelText('Job title')).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['Choose…', 'Clerk', 'Sales Rep']);
  });

  it('a manager can pick only their reports', () => {
    page({ manages: false, employeeNumber: 'M1', team: ['E2'] });
    const opts = within(screen.getByLabelText('Person')).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['Choose…', 'Brian Test (E2)']);
  });

  it('warns when someone’s weights do not total 100', async () => {
    api.loadAssignments.mockResolvedValue([row({}), row({ id: 'a2', kpi_id: 'k2', weight: 20, target: 2 })]);
    page();
    expect(await screen.findByText('Weights: 80%')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/80%, not 100%/);
  });

  it('shows which KPIs came from a template, and which were adjusted or no longer match', async () => {
    api.loadAssignments.mockResolvedValue([
      row({ assigned_via: 'template', template_id: 't1', overridden: true }),
      row({ id: 'a2', kpi_id: 'k2', weight: 40, assigned_via: 'template', template_id: 't1', no_longer_matches: true }),
    ]);
    page();
    const revenue = (await screen.findByText('Sales revenue', { selector: 'td' })).closest('tr')!;
    expect(await within(revenue).findByText(/From template: Sales team/)).toBeTruthy();
    expect(within(revenue).getByText(/adjusted/)).toBeTruthy();
    expect(within(screen.getByText('Error rate', { selector: 'td' }).closest('tr')!).getByText(/no longer matches/)).toBeTruthy();
    fireEvent.click(within(revenue).getByRole('button', { name: /Edit Sales revenue/ }));
    expect(screen.getByText(/comes from a template/)).toBeTruthy();
  });

  it('removes an assignment after asking', async () => {
    api.loadAssignments.mockResolvedValue([row({})]);
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Sales revenue from Amina Test' }));
    await waitFor(() => expect(api.removeAssignment).toHaveBeenCalledWith('a1'));
  });
});

describe('Scorecards', () => {
  const page = (access: KpiAccess = HR) =>
    render(<Scorecards kpis={[SALES, ERRORS]} periods={[Q4]} people={PEOPLE} departments={DEPTS} access={access} />);

  beforeEach(() => {
    api.loadAssignments.mockResolvedValue([
      row({ actual_value: 1200000 }),                                      // 120% x 60
      row({ id: 'a2', kpi_id: 'k2', weight: 40, target: 2, actual_value: 4 }), // 50% x 40
      row({ id: 'a3', employee_number: 'E2', weight: 100 }),               // not scored
    ]);
  });

  it('the team overview: weighted overall score and band per person', async () => {
    page();
    const amina = (await screen.findByText('Amina Test')).closest('tr')!;
    expect(within(amina).getByText('92%')).toBeTruthy(); // (120*60 + 50*40) / 100
    expect(within(amina).getByText('Meets')).toBeTruthy();
    expect(within(amina).getByText('2 / 2')).toBeTruthy();
    const brian = screen.getByText('Brian Test').closest('tr')!;
    expect(within(brian).getByText('Not scored')).toBeTruthy();
  });

  it('warns above the list about anyone whose weights don’t total 100', async () => {
    api.loadAssignments.mockResolvedValue([row({}), row({ id: 'a3', employee_number: 'E2', weight: 100 })]);
    page();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Amina Test's KPI weights don't total 100%/);
  });

  it('filters by department', async () => {
    page();
    await screen.findByText('Amina Test');
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd2' } });
    expect(screen.queryByText('Amina Test')).toBeNull();
    expect(screen.getByText('Brian Test')).toBeTruthy();
  });

  it('a manager enters the final score on a scorecard', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Open scorecard for Brian Test' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enter score for Sales revenue' }));
    fireEvent.change(within(dialog).getByLabelText('Actual'), { target: { value: '900000' } });
    fireEvent.change(within(dialog).getByLabelText('Comment'), { target: { value: 'Close' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.addCheckin).toHaveBeenCalledWith('a3', 'final', 900000, 'Close'));
  });

  it('nobody scores themselves', async () => {
    page({ manages: true, employeeNumber: 'E1', team: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Open scorecard for Amina Test' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /Enter score|Update/ })).toBeNull();
  });

  it('scores a KPI calculated from tasks on its calculated value until a final score replaces it', async () => {
    const onTime: Kpi = { ...ERRORS, id: 'k3', name: 'Tasks on time', unit: 'percent', direction: 'higher_is_better', measure: 'tasks_on_time' };
    api.loadAssignments.mockResolvedValue([
      row({ kpi_id: 'k3', weight: 100, target: 80, auto_value: 60, auto_detail: { on_time: 3, due: 5 } }),
      row({ id: 'a2', employee_number: 'E2', kpi_id: 'k3', weight: 100, target: 80, auto_value: 60, actual_value: 80 }),
    ]);
    render(<Scorecards kpis={[onTime]} periods={[Q4]} people={PEOPLE} departments={DEPTS} access={HR} />);
    const amina = (await screen.findByText('Amina Test')).closest('tr')!;
    expect(within(amina).getByText('75%')).toBeTruthy(); // 60 / 80
    // the final score (80 of 80), not the calculated 60: weights 100% and score 100%
    expect(within(screen.getByText('Brian Test').closest('tr')!).getAllByText('100%')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Open scorecard for Amina Test' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Calculated from tasks')).toBeTruthy();
    expect(within(dialog).getByText('3 of 5 due tasks done on time')).toBeTruthy();
  });

  it('recalculates the period’s calculated KPIs on request', async () => {
    const onTime: Kpi = { ...ERRORS, id: 'k3', measure: 'tasks_on_time' };
    api.loadAssignments.mockResolvedValue([row({ kpi_id: 'k3' })]);
    api.refreshMeasures.mockResolvedValue(1);
    render(<Scorecards kpis={[onTime]} periods={[Q4]} people={PEOPLE} departments={DEPTS} access={HR} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recalculate' }));
    await waitFor(() => expect(api.refreshMeasures).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(api.loadAssignments).toHaveBeenCalledTimes(2));
  });

  it('no Recalculate without calculated KPIs', async () => {
    page();
    await screen.findByText('Amina Test');
    expect(screen.queryByRole('button', { name: 'Recalculate' })).toBeNull();
  });

  it('exports the shown scorecards as CSV', async () => {
    page();
    await screen.findByText('Amina Test');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(api.downloadCsv).toHaveBeenCalledWith('KPI-scorecards-Q4-2026.csv', expect.stringContaining('Amina Test'));
    const csv = api.downloadCsv.mock.calls[0][1] as string;
    expect(csv.split('\r\n')[0]).toMatch(/^Employee number,Employee,Department,KPI/);
    expect(csv).toMatch(/Sales revenue.*120%.*92%,Meets/);
  });
});

describe('My KPIs (staff)', () => {
  beforeEach(() => {
    api.loadKpiAccess.mockResolvedValue({ manages: false, employeeNumber: 'E1', team: [] });
    api.loadKpis.mockResolvedValue([SALES, ERRORS]);
    api.loadPeriods.mockResolvedValue([Q4, { ...Q4, id: 'p0', name: 'Q1 2027', status: 'draft' }]);
    api.loadAssignments.mockResolvedValue([row({ self_value: 800000 }), row({ id: 'x', employee_number: 'E2' })]);
  });

  it('shows only their own KPIs in the open period, not draft periods', async () => {
    render(<MyKpis />);
    expect(await screen.findByText('Sales revenue')).toBeTruthy();
    expect(screen.getByText('KSh 800,000')).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Q1 2027/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Self-assess/ })).toHaveLength(1);
  });

  it('adds a self-assessment', async () => {
    render(<MyKpis />);
    fireEvent.click(await screen.findByRole('button', { name: 'Self-assess Sales revenue' }));
    fireEvent.change(screen.getByLabelText('Your value'), { target: { value: '950000' } });
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Two big deals' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.addCheckin).toHaveBeenCalledWith('a1', 'self', 950000, 'Two big deals'));
  });

  it('warns the employee when their weights don’t total 100', async () => {
    render(<MyKpis />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/add up to 60%, not 100%/);
  });

  it('no self-assessment once the period is closed', async () => {
    api.loadPeriods.mockResolvedValue([{ ...Q4, status: 'closed' }]);
    render(<MyKpis />);
    await screen.findByText('Sales revenue');
    expect(screen.queryByRole('button', { name: /Self-assess/ })).toBeNull();
  });
});
