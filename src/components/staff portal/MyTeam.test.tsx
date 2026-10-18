import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Kpi, KpiAssignment, KpiPeriod } from '../../lib/kpiApi';
import type { TeamMember } from '../../lib/myTeamApi';

const kpi = vi.hoisted(() => ({
  loadKpiAccess: vi.fn(),
  loadKpis: vi.fn(),
  loadPeriods: vi.fn(),
  loadAssignments: vi.fn(),
  assignKpi: vi.fn(),
  updateAssignment: vi.fn(),
  removeAssignment: vi.fn(),
  addCheckin: vi.fn(),
  downloadCsv: vi.fn(),
}));
const ot = vi.hoisted(() => ({ loadOvertimePeople: vi.fn(), loadWaitingOvertime: vi.fn(), loadOvertime: vi.fn() }));
const cas = vi.hoisted(() => ({ loadCasuals: vi.fn(), loadDays: vi.fn() }));
const appr = vi.hoisted(() => ({ loadLeaveAwaitingMe: vi.fn(), loadApprovalChains: vi.fn() }));
const work = vi.hoisted(() => ({ loadWorkPeople: vi.fn() }));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/kpiApi', async (orig) => ({ ...(await orig<typeof import('../../lib/kpiApi')>()), ...kpi }));
vi.mock('../../lib/overtimeApi', async (orig) => ({ ...(await orig<typeof import('../../lib/overtimeApi')>()), ...ot }));
vi.mock('../../lib/casualApi', async (orig) => ({ ...(await orig<typeof import('../../lib/casualApi')>()), ...cas }));
vi.mock('../../lib/approvals', async (orig) => ({ ...(await orig<typeof import('../../lib/approvals')>()), ...appr }));
vi.mock('../../lib/pieceRateApi', async (orig) => ({ ...(await orig<typeof import('../../lib/pieceRateApi')>()), ...work }));

import { MemoryRouter, useLocation } from 'react-router-dom';
import MyTeam from './MyTeam';

// the tab is kept in the address (?view=...); the current address is shown so tests can check it
function Address() {
  const { search } = useLocation();
  return <output data-testid="address">{search}</output>;
}
const renderTeam = (entry = '/staff?tab=my-team') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <MyTeam team={TEAM} />
      <Address />
    </MemoryRouter>,
  );

const member = (n: string, first: string, over: Partial<TeamMember> = {}): TeamMember => ({
  employee_number: n, first_name: first, last_name: 'Report', job_title: 'Sales Rep', department_id: 'd1', department: 'Sales',
  photo: null, worker_kind: 'employee', status: 'Active', ...over,
});
const TEAM = [member('E1', 'Amina'), member('E2', 'Brian', { job_title: 'Driver', department: null })];
const CALLS: Kpi = {
  id: 'k1', name: 'Calls made', description: null, unit: 'number', direction: 'higher_is_better', default_target: 100,
  default_weight: 50, frequency: 'quarterly', category: null, archived: false,
};
const Q4: KpiPeriod = { id: 'p1', name: 'Q4 2026', starts_on: '2026-10-01', ends_on: '2026-12-31', status: 'open' };
const row = (over: Partial<KpiAssignment>): KpiAssignment => ({
  id: 'a1', period_id: 'p1', kpi_id: 'k1', employee_number: 'E1', target: 100, weight: 60, assigned_via: 'person',
  self_value: null, self_comment: null, self_at: null, actual_value: null, manager_comment: null, scored_at: null, ...over,
});

beforeEach(() => {
  for (const f of [...Object.values(kpi), ...Object.values(ot), ...Object.values(cas), ...Object.values(appr), ...Object.values(work)]) f.mockReset();
  kpi.loadKpiAccess.mockResolvedValue({ manages: false, employeeNumber: 'LEAD', team: ['E1', 'E2'] });
  kpi.loadKpis.mockResolvedValue([CALLS]);
  kpi.loadPeriods.mockResolvedValue([Q4]);
  kpi.loadAssignments.mockResolvedValue([]);
  kpi.assignKpi.mockResolvedValue(1);
  kpi.addCheckin.mockResolvedValue(undefined);
  ot.loadOvertimePeople.mockResolvedValue([]);
  ot.loadWaitingOvertime.mockResolvedValue([]);
  ot.loadOvertime.mockResolvedValue([]);
  cas.loadCasuals.mockResolvedValue([]);
  cas.loadDays.mockResolvedValue([]);
  appr.loadLeaveAwaitingMe.mockResolvedValue([]);
  appr.loadApprovalChains.mockResolvedValue({});
  work.loadWorkPeople.mockResolvedValue([]);
});
afterEach(() => cleanup());

const openTab = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('My team', () => {
  it('lists the people who report to you, with their job and department', async () => {
    renderTeam();
    expect(screen.getByText('2 people report to you')).toBeTruthy();
    expect(screen.getByText('Amina Report')).toBeTruthy();
    expect(screen.getByText('Sales Rep · Sales')).toBeTruthy();
    expect(screen.getByText('Driver')).toBeTruthy();
    await waitFor(() => expect(cas.loadCasuals).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Casual days' })).toBeNull();
  });

  it('shows Casual days only when they supervise casual workers', async () => {
    cas.loadCasuals.mockResolvedValue([{ id: 'c', employee_number: 'C1', first_name: 'Cy', last_name: 'Cas', id_number: null, phone: null, daily_rate: 800, start_date: '2026-01-01', finished_on: null }]);
    renderTeam();
    fireEvent.click(await screen.findByRole('button', { name: 'Casual days' }));
    expect(await screen.findByText('Cy Cas')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve .* waiting/ })).toBeNull();
  });

  it('KPIs: shows only the team’s scorecards and lets the supervisor score them', async () => {
    kpi.loadAssignments.mockResolvedValue([row({}), row({ id: 'x', employee_number: 'SOMEONE-ELSE' })]);
    renderTeam();
    openTab('KPIs');
    const open = await screen.findByRole('button', { name: 'Open scorecard for Amina Report' });
    expect(screen.queryByText('SOMEONE-ELSE')).toBeNull();
    expect(screen.queryByLabelText('Department')).toBeNull();
    fireEvent.click(open);
    const dialog = await screen.findByRole('dialog');
    // weights 60%, not 100%: the same warning as the admin screen
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Weights add up to 60%/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enter score for Calls made' }));
    fireEvent.change(within(dialog).getByLabelText('Actual'), { target: { value: '90' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(kpi.addCheckin).toHaveBeenCalledWith('a1', 'final', 90, ''));
  });

  it('KPIs: assigns a library KPI to several reports at once', async () => {
    renderTeam();
    openTab('KPIs');
    fireEvent.click(await screen.findByText('Assign and edit'));
    fireEvent.change(await screen.findByLabelText('KPI'), { target: { value: 'k1' } });
    fireEvent.click(screen.getByLabelText('Everyone (2)'));
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Weight (%)'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(kpi.assignKpi).toHaveBeenCalledTimes(2));
    expect(kpi.assignKpi).toHaveBeenCalledWith({ periodId: 'p1', kpiId: 'k1', scope: 'person', value: 'E1', target: 120, weight: 40 });
    expect(kpi.assignKpi).toHaveBeenCalledWith({ periodId: 'p1', kpiId: 'k1', scope: 'person', value: 'E2', target: 120, weight: 40 });
  });

  it('KPIs: says so when HR has not set up a review period', async () => {
    kpi.loadPeriods.mockResolvedValue([]);
    renderTeam();
    openTab('KPIs');
    expect(await screen.findByText('No review periods yet')).toBeTruthy();
  });

  it('Overtime: the team’s requests wait for approval, not the supervisor’s own', async () => {
    ot.loadOvertimePeople.mockResolvedValue([{ employee_number: 'E1', name: 'Amina Report', department: 'Sales', job_group: null, excluded_reason: null }]);
    ot.loadWaitingOvertime.mockResolvedValue([
      { id: 'o1', employee_number: 'E1', work_date: '2026-10-14', hours: 2, day_type: 'normal', note: 'Stock take', status: 'submitted', source: 'self', rejection_reason: null, decided_at: null },
      { id: 'o2', employee_number: 'LEAD', work_date: '2026-10-14', hours: 3, day_type: 'normal', note: null, status: 'submitted', source: 'self', rejection_reason: null, decided_at: null },
    ]);
    renderTeam();
    openTab('Overtime');
    fireEvent.click(await screen.findByText('Waiting for approval (1)'));
    expect(await screen.findByText('Stock take')).toBeTruthy();
    expect(screen.queryByText('LEAD')).toBeNull();
  });

  it('keeps the tab in the address, so Back returns to the previous tab and a link opens one', async () => {
    renderTeam();
    openTab('Leave');
    expect(screen.getByTestId('address').textContent).toBe('?tab=my-team&view=leave');
    cleanup();
    renderTeam('/staff?tab=my-team&view=leave');
    expect(await screen.findByText('No leave is waiting for you to approve.')).toBeTruthy();
  });

  it('Leave: says when nothing is waiting for approval', async () => {
    renderTeam();
    openTab('Leave');
    expect(await screen.findByText('No leave is waiting for you to approve.')).toBeTruthy();
  });
});
