import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CasualDay, CasualPayLine, CasualPayRun, CasualWorker, LimitAlert } from '../../lib/casualPay';
import { today, weekStart } from '../../lib/casualPay';

const api = vi.hoisted(() => ({
  casuals: [] as CasualWorker[],
  alerts: [] as LimitAlert[],
  days: [] as CasualDay[],
  runs: [] as CasualPayRun[],
  lines: [] as CasualPayLine[],
  setDay: vi.fn(),
  approveDays: vi.fn(),
  finishCasual: vi.fn(),
  saveCasual: vi.fn(),
  approveRun: vi.fn(),
  markRunPaid: vi.fn(),
}));
const perms = vi.hoisted(() => ({ modules: ['payroll'] as string[] }));
const confirmDialog = vi.hoisted(() => vi.fn());
const saveAs = vi.hoisted(() => vi.fn());

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('file-saver', () => ({ saveAs }));
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (m: string) => perms.modules.includes(m),
    hasAnyPermission: (ms: string[]) => ms.some((m) => perms.modules.includes(m)),
  }),
}));
vi.mock('../UI/DepartmentPicker', () => ({ default: () => <div /> }));
vi.mock('../UI/EmployeePicker', () => ({ default: () => <div /> }));
vi.mock('../../lib/casualApi', () => ({
  loadCasuals: () => Promise.resolve(api.casuals),
  loadLimitAlerts: () => Promise.resolve(api.alerts),
  loadDayLimit: () => Promise.resolve(30),
  saveDayLimit: vi.fn(),
  loadDays: () => Promise.resolve(api.days),
  setDay: api.setDay,
  approveDays: api.approveDays,
  uploadDays: vi.fn(),
  registerCasuals: vi.fn(),
  finishCasual: api.finishCasual,
  rejoinCasual: vi.fn(),
  saveCasual: api.saveCasual,
  loadRuns: () => Promise.resolve(api.runs),
  loadRunLines: () => Promise.resolve(api.lines),
  createRun: vi.fn(),
  refreshRun: vi.fn(),
  saveAdjustment: vi.fn(),
  approveRun: api.approveRun,
  reopenRun: vi.fn(),
  markRunPaid: api.markRunPaid,
  deleteRun: vi.fn(),
}));

import CasualWorkers from './CasualWorkers';

const monday = weekStart(today());
const casual = (n: string, first: string, patch: Partial<CasualWorker> = {}): CasualWorker => ({
  id: n, employee_number: n, first_name: first, last_name: 'Mwangi', id_number: '23456789', phone: '0712345678', daily_rate: 800,
  start_date: '2026-01-01', finished_on: null, department_id: null, department: 'Tea field', supervisor_email: 'sup@a.co',
  payment_method: 'M-Pesa', bank: null, bank_branch: null, bank_code: null, branch_code: null, account_name: null, account_number: null,
  ...patch,
});

beforeEach(() => {
  perms.modules = ['payroll'];
  api.casuals = [casual('C1', 'Wanjiku'), casual('C2', 'Kamau', { finished_on: '2026-02-01' }), casual('C3', 'Otieno')];
  api.alerts = [{ employee_number: 'C1', worker_name: 'Wanjiku Mwangi', days_in_a_row: 34, since: '2026-09-01', last_worked: today(), day_limit: 30, level: 'over' }];
  api.days = [
    { id: 'd1', employee_number: 'C1', work_date: monday, portion: 'full', daily_rate: 800, amount: 800, status: 'approved', pay_run_id: null, paid_at: null },
    { id: 'd2', employee_number: 'C3', work_date: monday, portion: 'half', daily_rate: 800, amount: 400, status: 'submitted', pay_run_id: null, paid_at: null },
  ];
  api.runs = [{ id: 'r1', period_start: '2026-10-05', period_end: '2026-10-11', status: 'approved', notes: null, total: 2400, created_at: '', approved_at: '', paid_on: null }];
  api.lines = [{
    id: 'l1', run_id: 'r1', employee_number: 'C1', worker_name: 'Wanjiku Mwangi', full_days: 3, half_days: 0, daily_rate: 800, days_amount: 2400,
    additions: 0, deductions: 0, adjustment_note: null, net_pay: 2400, payment_method: 'M-Pesa', phone: '0712345678', bank: null, bank_branch: null,
    bank_code: null, branch_code: null, account_name: null, account_number: null, payroll_number: 'PR-1',
  }];
  for (const fn of [api.setDay, api.approveDays, api.finishCasual, api.saveCasual, api.approveRun, api.markRunPaid, confirmDialog, saveAs]) fn.mockReset();
  api.setDay.mockResolvedValue(undefined);
  api.approveDays.mockResolvedValue(undefined);
  api.markRunPaid.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('CasualWorkers', () => {
  it('lists current casuals with the day-limit warning; people who finished are hidden until asked', async () => {
    render(<CasualWorkers />);
    expect(await screen.findByText('Wanjiku Mwangi', { selector: 'span.font-semibold.text-ink' })).toBeTruthy();
    expect(screen.getByText('1 over the day limit')).toBeTruthy();
    expect(screen.getByText('34 days in a row')).toBeTruthy();
    expect(screen.queryByText('Kamau Mwangi')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show people who finished'));
    expect(screen.getByText('Kamau Mwangi')).toBeTruthy();
    expect(screen.getByText(/Finished 1 Feb 2026/)).toBeTruthy();
  });

  it('registering checks the daily rate before saving', async () => {
    render(<CasualWorkers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Register a casual' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: 'Achieng' } });
    fireEvent.change(within(dialog).getByLabelText('Last name'), { target: { value: 'Otieno' } });
    fireEvent.change(within(dialog).getByLabelText('Phone (M-Pesa)'), { target: { value: '0722000111' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/daily rate of more than 0/);
    expect(api.saveCasual).not.toHaveBeenCalled();
    api.saveCasual.mockResolvedValue('MCL-000003');
    fireEvent.change(within(dialog).getByLabelText('Daily rate (KSh)'), { target: { value: '700' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(api.saveCasual).toHaveBeenCalledWith(expect.objectContaining({ first_name: 'Achieng', daily_rate: '700', payment_method: 'M-Pesa' })));
  });

  it('marks a casual finished after asking', async () => {
    confirmDialog.mockResolvedValue(true);
    api.finishCasual.mockResolvedValue(undefined);
    render(<CasualWorkers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Wanjiku Mwangi finished' }));
    await waitFor(() => expect(api.finishCasual).toHaveBeenCalledWith('C1', today()));
  });

  it('the week grid records a day and approves the waiting ones', async () => {
    render(<CasualWorkers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Days worked' }));
    const cells = await screen.findAllByRole('combobox');
    expect((cells[0] as HTMLSelectElement).value).toBe('full');
    fireEvent.change(cells[0], { target: { value: 'half' } });
    await waitFor(() => expect(api.setDay).toHaveBeenCalledWith('C1', monday, 'half', expect.objectContaining({ id: 'd1' })));
    fireEvent.click(screen.getByRole('button', { name: /Approve 1 waiting day/ }));
    await waitFor(() => expect(api.approveDays).toHaveBeenCalledWith(['d2']));
  });

  it('a supervisor (no payroll module) sees no pay runs and cannot register', async () => {
    perms.modules = [];
    render(<CasualWorkers />);
    await screen.findByText('Wanjiku Mwangi', { selector: 'span.font-semibold.text-ink' });
    expect(screen.queryByRole('button', { name: 'Pay runs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Register a casual' })).toBeNull();
  });

  it('an approved pay run downloads the M-Pesa file and is marked paid', async () => {
    render(<CasualWorkers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pay runs' }));
    fireEvent.click(await screen.findByText('5 Oct 2026 to 11 Oct 2026'));
    expect(await screen.findByText('1 person')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'M-Pesa bulk pay CSV' }));
    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'casual-pay-2026-10-05-to-2026-10-11-mpesa.csv');
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(api.markRunPaid).toHaveBeenCalledWith('r1', today()));
  });
});
