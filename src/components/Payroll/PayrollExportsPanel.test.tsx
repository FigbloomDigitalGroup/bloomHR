import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const data = vi.hoisted(() => ({
  payslips: [] as Record<string, unknown>[],
  employees: [] as Record<string, unknown>[],
  rateDays: [] as unknown[],
}));
vi.mock('../../lib/payrollRuns', () => ({ getRunPayslips: () => Promise.resolve(data.payslips) }));
vi.mock('../../lib/fetchAll', () => ({ fetchAll: () => Promise.resolve(data.employees) }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => ({ range: () => undefined }) }) }),
    rpc: (_fn: string, args: { p_day: string }) => {
      data.rateDays.push(args.p_day);
      return Promise.resolve({ data: { insurance_relief_rate: 0.15 }, error: null });
    },
  },
}));
const saved = vi.hoisted(() => ({ files: [] as { name: string; blob: Blob }[] }));
vi.mock('file-saver', () => ({ saveAs: (blob: Blob, name: string) => saved.files.push({ blob, name }) }));

import PayrollExportsPanel from './PayrollExportsPanel';

// jsdom's Blob has no text(); read it the way a browser without it would
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

const run = { id: 'r1', pay_period: '2026-10', status: 'approved' } as never;

beforeEach(() => {
  data.payslips = [
    { employee_id: 'E1', gross_pay: 50000, net_pay: 40000, nhif_deduction: 1375, nssf_deduction: 3000, housing_levy: 750, paye_tax: 6000, tax_relief: 2400 },
    { employee_id: 'E2', gross_pay: 30000, net_pay: 25000, nhif_deduction: 825, nssf_deduction: 1800, housing_levy: 450, paye_tax: 2000, tax_relief: 2400 },
  ];
  data.employees = [
    { 'Employee Number': 'E1', 'Payroll Number': 'PR-00001', 'First Name': 'Amina', 'Last Name': 'Wanjiru', 'Tax PIN': 'A012345678Z',
      kra_residency: 'Resident', kra_employee_type: 'Primary Employee', payment_method: 'M-Pesa', 'Mobile Number': '0712345678' },
    { 'Employee Number': 'E2', 'Payroll Number': 'PR-00002', 'First Name': 'Juma', 'Last Name': 'Otieno', payment_method: 'Bank Transfer',
      Bank: 'KCB', account_number_name: 'Juma Otieno', 'Account Number': '1100' },
  ];
  data.rateDays = [];
  saved.files = [];
});
afterEach(() => cleanup());

describe('PayrollExportsPanel', () => {
  it('offers each file with its row count, using the rates of the month’s last day', async () => {
    render(<PayrollExportsPanel run={run} />);
    expect(await screen.findByText('KRA PAYE (P10)')).toBeTruthy();
    expect(screen.getAllByText(/2 rows/)).toHaveLength(3); // P10, SHA, NSSF
    expect(screen.getAllByText(/1 row,/)).toHaveLength(2); // M-Pesa, bank
    expect(data.rateDays).toEqual(['2026-10-31']);
  });

  it('downloads a CSV named after the file and month', async () => {
    render(<PayrollExportsPanel run={run} />);
    await screen.findByText('KRA PAYE (P10)');
    fireEvent.click(screen.getAllByRole('button', { name: /Download CSV/ })[3]); // M-Pesa
    expect(saved.files.map((f) => f.name)).toEqual(['bulk-pay-mpesa-2026-10.csv']);
    expect(await readBlob(saved.files[0].blob)).toBe('Phone Number,Name,Amount,Reference,Payroll Number\r\n254712345678,Amina Wanjiru,40000.00,Salary 2026-10,PR-00001\r\n');
  });

  it('shows who is missing what before the download', async () => {
    render(<PayrollExportsPanel run={run} />);
    await screen.findByText('KRA PAYE (P10)');
    fireEvent.click(screen.getAllByRole('button', { name: /missing details/ })[0]);
    await waitFor(() => expect(screen.getByText('Juma Otieno')).toBeTruthy());
    expect(screen.getByText(/KRA PIN, Residency, Type of employee/)).toBeTruthy();
  });
});
