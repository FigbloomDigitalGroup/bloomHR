import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EmployeeMinimum } from '../../lib/minimumWage';

const api = vi.hoisted(() => ({
  settings: { enabled: true, daysPerMonth: 26 },
  minimums: new Map<string, unknown>(),
  workDays: new Map<string, number>(),
  calls: [] as [string, string][],
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/minimumWageApi', () => ({
  loadMinimumWageCheck: (period: string, day: string) => {
    api.calls.push([period, day]);
    return Promise.resolve({ settings: api.settings, minimums: api.minimums, workDays: api.workDays });
  },
}));

import MinimumWageWarning from './MinimumWageWarning';

const KENYA: EmployeeMinimum = { country: 'Kenya', monthly: 15600, currency: 'KES' };
const employees = [
  { 'Employee Number': 'E1', pay_basis: 'salary', worker_kind: 'employee' },
  { 'Employee Number': 'E2', pay_basis: 'salary', worker_kind: 'employee' },
  { 'Employee Number': 'W1', pay_basis: 'work', worker_kind: 'employee' },
  { 'Employee Number': 'C1', pay_basis: 'salary', worker_kind: 'contractor' },
];
const payslips = [
  { employee_id: 'E1', employee_name: 'Amina Wanjiru', basic_salary: 12000 },
  { employee_id: 'E2', employee_name: 'Brian Otieno', basic_salary: 50000 },
  { employee_id: 'W1', employee_name: 'Wanjiru Work', basic_salary: 0, work_pay: 5000 },
  { employee_id: 'C1', employee_name: 'Chege Contract', basic_salary: 1000 },
];

const show = () =>
  render(
    <MemoryRouter>
      <MinimumWageWarning payslips={payslips} employees={employees} payPeriod="2026-10" periodLabel="October 2026" />
    </MemoryRouter>,
  );

beforeEach(() => {
  api.settings = { enabled: true, daysPerMonth: 26 };
  api.minimums = new Map([['E1', KENYA], ['E2', KENYA], ['W1', KENYA], ['C1', KENYA]]);
  api.workDays = new Map([['W1', 10]]);
  api.calls = [];
});
afterEach(cleanup);

describe('MinimumWageWarning', () => {
  it('lists who is paid below the minimum, with country, pay, minimum and shortfall, and links to the employee', async () => {
    show();
    expect(await screen.findByText('2 people are paid below the minimum wage for October 2026')).toBeTruthy();
    expect(api.calls).toEqual([['2026-10', '2026-10-31']]);
    const amina = screen.getByRole('link', { name: 'Amina Wanjiru' });
    expect(amina.getAttribute('href')).toBe('/view-employee/E1');
    const row = amina.closest('tr')!;
    expect(row.textContent).toContain('Kenya');
    expect(row.textContent).toContain('KES 12,000');
    expect(row.textContent).toContain('KES 15,600');
    expect(row.textContent).toContain('KES 3,600');
    // paid by work: 600 a day x 10 days
    const wanjiru = screen.getByRole('link', { name: 'Wanjiru Work' }).closest('tr')!;
    expect(wanjiru.textContent).toContain('KES 6,000');
    expect(wanjiru.textContent).toContain('10 days of work');
    expect(screen.queryByText('Brian Otieno')).toBeNull();
    expect(screen.queryByText('Chege Contract')).toBeNull();
    expect(screen.getByText(/A warning only: you can still approve/)).toBeTruthy();
  });

  it('shows nothing when no amount is set', async () => {
    api.minimums = new Map([['E1', { country: 'Kenya', monthly: null, currency: 'KES' }]]);
    show();
    await waitFor(() => expect(api.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('minimum-wage-warning')).toBeNull();
  });

  it('shows nothing with the check off', async () => {
    api.settings = { enabled: false, daysPerMonth: 26 };
    show();
    await waitFor(() => expect(api.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('minimum-wage-warning')).toBeNull();
  });
});
