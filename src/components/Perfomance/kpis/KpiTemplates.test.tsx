import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Kpi, KpiPeriod, KpiPerson } from '../../../lib/kpiApi';
import type { KpiTemplateRecord, TemplateMember } from '../../../lib/kpiTemplates';

const state = vi.hoisted(() => ({ templates: [] as KpiTemplateRecord[], members: [] as TemplateMember[] }));
const api = vi.hoisted(() => ({
  saveKpiTemplate: vi.fn(),
  setKpiTemplateActive: vi.fn(),
  deleteKpiTemplate: vi.fn(),
  applyKpiTemplates: vi.fn(),
}));
const confirm = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/confirmDialog', () => ({ confirmDialog: confirm }));
vi.mock('../../../lib/kpiTemplates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/kpiTemplates')>()),
  loadKpiTemplates: () => Promise.resolve(state.templates),
  loadTemplateMembers: () => Promise.resolve(state.members),
  ...api,
}));
vi.mock('../../../lib/jobTitles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/jobTitles')>()),
  loadJobTitles: () => Promise.resolve([{ id: 'jt1', name: 'Sales Rep', department_id: null, job_group_id: null, active: true }]),
  loadJobGroupChoices: () => Promise.resolve([{ id: 'g1', code: 'JG5', name: 'JG5', active: true }]),
}));

import KpiTemplates from './KpiTemplates';

const kpi = (id: string, name: string, weight: number): Kpi => ({
  id, name, description: null, unit: 'number', direction: 'higher_is_better', default_target: 10, default_weight: weight,
  frequency: 'quarterly', category: null, archived: false,
});
const KPIS = [kpi('k1', 'Revenue', 60), kpi('k2', 'Calls', 40), kpi('k3', 'Attendance', 100)];
const OPEN: KpiPeriod = { id: 'p1', name: 'Q4 2026', starts_on: '2026-10-01', ends_on: '2026-12-31', status: 'open' };
const person = (n: string, first: string): KpiPerson => ({
  employeeNumber: n, firstName: first, middleName: '', lastName: 'Test', fullName: `${first} Test`, jobTitle: '', branch: '', town: '',
  email: '', id: n, departmentId: 'd1', department: 'Sales', reportsToId: null, photo: '', status: 'Active', jobGroup: '',
});
const PEOPLE = [person('E1', 'Amina'), person('E2', 'Brian')];
const DEPTS = [
  { id: 'd1', name: 'Sales', parent_id: null, head_employee_id: null, active: true },
  { id: 'd2', name: 'North', parent_id: 'd1', head_employee_id: null, active: true },
];
const tpl = (over: Partial<KpiTemplateRecord>): KpiTemplateRecord => ({
  id: 't1', name: 'Sales team', description: null, applies_to: 'department', department_id: 'd1', job_title_id: null, job_group_id: null,
  active: true, created_at: '2026-10-01T00:00:00Z', items: [{ kpi_id: 'k1', target: 500, weight: 60 }, { kpi_id: 'k2', target: null, weight: 40 }], ...over,
});

const page = (periods: KpiPeriod[] = [OPEN]) => render(<KpiTemplates kpis={KPIS} periods={periods} people={PEOPLE} departments={DEPTS} />);

beforeEach(() => {
  state.templates = [tpl({}), tpl({ id: 't2', name: 'Everyone', applies_to: 'everyone', department_id: null, active: false, items: [{ kpi_id: 'k3', target: null, weight: 80 }] })];
  state.members = [
    { template_id: 't1', employee_number: 'E1', priority: 4, depth: 0 },
    { template_id: 't2', employee_number: 'E1', priority: 5, depth: 0 },
    { template_id: 't2', employee_number: 'E2', priority: 5, depth: 0 },
  ];
  for (const f of Object.values(api)) f.mockReset();
  api.saveKpiTemplate.mockResolvedValue('new');
  api.setKpiTemplateActive.mockResolvedValue(undefined);
  api.deleteKpiTemplate.mockResolvedValue(undefined);
  api.applyKpiTemplates.mockResolvedValue(3);
  confirm.mockReset().mockResolvedValue(true);
});
afterEach(() => cleanup());

describe('KPI templates', () => {
  it('shows each template: who it is for, its KPIs and the weights total', async () => {
    page();
    const card = (await screen.findByText('Sales team')).closest('div.bg-white') as HTMLElement;
    expect(within(card).getByText('Department: Sales (and the departments under it)')).toBeTruthy();
    expect(within(card).getByText('Revenue')).toBeTruthy();
    expect(within(card).getByText('500')).toBeTruthy();
    expect(within(card).getByText('100%')).toBeTruthy();
    expect(within(card).getByText('Active')).toBeTruthy();
  });

  it('warns when a template’s weights don’t total 100 and won’t activate it', async () => {
    page();
    const card = (await screen.findByText('Everyone', { selector: 'div.font-bold' })).closest('div.bg-white') as HTMLElement;
    expect(within(card).getByRole('alert').textContent).toMatch(/total 80%; they must total 100%/);
    expect((within(card).getByRole('button', { name: 'Activate Everyone' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists who a template matches', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'People matching Sales team' }));
    const list = screen.getByRole('list', { name: 'Matching Sales team' });
    expect(within(list).getByText(/Amina Test/)).toBeTruthy();
    expect(within(list).queryByText(/Brian Test/)).toBeNull();
    expect(screen.getByRole('button', { name: 'People matching Sales team' }).textContent).toMatch(/Matches 1 person/);
  });

  it('creates a template; the total must reach 100 before it can be saved active', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'New template' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Reps' } });
    fireEvent.change(within(dialog).getByLabelText('For'), { target: { value: 'job_title' } });
    fireEvent.change(within(dialog).getByLabelText('Job title'), { target: { value: 'jt1' } });
    fireEvent.change(within(dialog).getByLabelText('KPI 1'), { target: { value: 'k1' } });
    expect((within(dialog).getByLabelText('Weight 1') as HTMLInputElement).value).toBe('60'); // the KPI's default weight
    expect(within(dialog).getByTestId('template-total').textContent).toBe('Total 60%');
    expect(within(dialog).getByRole('alert').textContent).toMatch(/must total 100%/);
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add KPI' }));
    fireEvent.change(within(dialog).getByLabelText('KPI 2'), { target: { value: 'k2' } });
    fireEvent.change(within(dialog).getByLabelText('Target 2'), { target: { value: '25' } });
    expect(within(dialog).getByTestId('template-total').textContent).toBe('Total 100%');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.saveKpiTemplate).toHaveBeenCalledWith(null, {
        name: 'Reps', description: null, applies_to: 'job_title', target: 'jt1', active: true,
        items: [{ kpi_id: 'k1', target: null, weight: 60 }, { kpi_id: 'k2', target: 25, weight: 40 }],
      })
    );
  });

  it('an unfinished template can be saved turned off', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Everyone' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText(/Active/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveKpiTemplate).toHaveBeenCalledWith('t2', expect.objectContaining({ active: false, applies_to: 'everyone', target: null })));
  });

  it('warns about people whose combined template weights aren’t 100', async () => {
    state.templates = [tpl({}), tpl({ id: 't2', name: 'Everyone', applies_to: 'everyone', department_id: null, items: [{ kpi_id: 'k3', target: null, weight: 100 }] })];
    page();
    const alert = await screen.findByText(/templates whose weights together don’t total 100%/);
    expect(alert.textContent).toMatch(/Amina Test \(200%\)/);
    expect(alert.textContent).not.toMatch(/Brian/);
  });

  it('applies templates to open periods now', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to open periods' }));
    await waitFor(() => expect(api.applyKpiTemplates).toHaveBeenCalled());
  });

  it('can’t apply when no period is open', async () => {
    page([{ ...OPEN, status: 'draft' }]);
    expect((await screen.findByRole('button', { name: 'Apply to open periods' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('turns a template off, and deletes one after asking', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off Sales team' }));
    await waitFor(() => expect(api.setKpiTemplateActive).toHaveBeenCalledWith('t1', false));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sales team' }));
    await waitFor(() => expect(api.deleteKpiTemplate).toHaveBeenCalledWith('t1'));
    expect(confirm).toHaveBeenCalled();
  });
});
