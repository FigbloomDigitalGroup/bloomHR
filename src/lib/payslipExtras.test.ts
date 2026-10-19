import { beforeEach, describe, expect, it, vi } from 'vitest';

// FIG-814: loading a payslip's year to date and run: from the database functions, or (before the migration is applied)
// from the payslips the person can read, approved months only.

const h = vi.hoisted(() => ({
  rpc: {} as Record<string, { data: unknown; error: unknown }>,
  tables: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock('./supabase', () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'lt', 'order', 'limit']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve(h.tables[table] ?? { data: null, error: null });
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(h.tables[table] ?? { data: [], error: null }).then(ok, bad);
    return q;
  };
  return { supabase: { from: chain, rpc: (name: string) => Promise.resolve(h.rpc[name] ?? { data: null, error: { message: 'missing' } }) } };
});

import { employeeDetailsOf, loadPayslipRun, loadPayslipYtd, runRef } from './payslipExtras';

const current = { employee_id: 'E1', pay_period: '2026-04', country: 'Kenya', currency: 'KES', gross_pay: 8000, taxable_pay: 7200, paye_tax: 800, nssf_deduction: 100, net_pay: 6400 };

beforeEach(() => {
  h.rpc = {};
  h.tables = {};
});

describe('the year to date', () => {
  it("adds this payslip to the database's totals of earlier approved months", async () => {
    h.rpc.payslip_ytd = {
      data: [{ currency: 'KES', months: 2, gross_pay: '3000', taxable_pay: '2700.00', taxable_months: 2, paye_tax: '300', nssf_deduction: '200', net_pay: '2400', country: 'Kenya', tax_year_start: '2026-01' }],
      error: null,
    };
    expect(await loadPayslipYtd(current)).toMatchObject({ months: 3, gross_pay: 11000, taxable_pay: 9900, net_pay: 8800, currency: 'KES' });
  });

  it('without the function: from the readable payslips, approved months only', async () => {
    h.tables.salary_history = {
      data: [
        { employee_id: 'E1', pay_period: '2026-01', country: 'Kenya', currency: 'KES', gross_pay: 1000, net_pay: 800, run_id: 'r1' },
        { employee_id: 'E1', pay_period: '2026-02', country: 'Kenya', currency: 'KES', gross_pay: 2000, net_pay: 1600, run_id: 'r2' },
      ],
      error: null,
    };
    h.tables.payroll_run_countries = { data: [{ run_id: 'r1', country: 'Kenya', status: 'paid' }, { run_id: 'r2', country: 'Kenya', status: 'draft' }], error: null };
    expect(await loadPayslipYtd(current)).toMatchObject({ months: 2, gross_pay: 9000 });
    // staff can't read run statuses: what they can read is published (approved) already
    h.tables.payroll_run_countries = { data: null, error: { message: 'denied' } };
    expect(await loadPayslipYtd(current)).toMatchObject({ months: 3, gross_pay: 11000 });
  });
});

describe('the run and the employee', () => {
  it("gives the run's reference and dates", async () => {
    h.rpc.payslip_run_details = { data: [{ run_id: 'abcd1234-5678-0000-0000-000000000000', status: 'paid', approved_at: '2026-10-28', paid_at: '2026-10-30' }], error: null };
    expect(await loadPayslipRun(current)).toEqual({ runId: 'abcd1234-5678-0000-0000-000000000000', ref: '2026-04 · ABCD1234', status: 'paid', approvedAt: '2026-10-28', paidAt: '2026-10-30' });
    h.rpc.payslip_run_details = { data: [], error: null };
    expect(await loadPayslipRun(current)).toBeNull();
    expect(runRef('11112222-3333', '2026-10')).toBe('2026-10 · 11112222');
  });

  it("the employee's numbers from their record, the SHA number from the old NHIF column when that is all there is", () => {
    expect(employeeDetailsOf({ position: 'Clerk' }, { 'Tax PIN': 'A1', 'NSSF Number': 'N1', 'NHIF Number': 'H1', 'ID Number': '9', 'Job Title': 'Old title' }, 'Kampala')).toEqual({
      taxNumber: 'A1', nssfNumber: 'N1', shaNumber: 'H1', idNumber: '9', branch: 'Kampala', department: null, position: 'Clerk', jobGroup: null,
    });
  });
});
