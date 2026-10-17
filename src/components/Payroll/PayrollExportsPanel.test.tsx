import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as XLSX from 'xlsx';

const data = vi.hoisted(() => ({
  payslips: [] as Record<string, unknown>[],
  employees: [] as Record<string, unknown>[],
  rateDays: [] as unknown[],
  debit: '' as string,
}));
vi.mock('../../lib/payrollRuns', () => ({ getRunPayslips: () => Promise.resolve(data.payslips) }));
vi.mock('../../lib/fetchAll', () => ({ fetchAll: () => Promise.resolve(data.employees) }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => ({ range: () => undefined }), maybeSingle: () => Promise.resolve({ data: { equity_debit_account: data.debit }, error: null }) }),
      upsert: (row: { equity_debit_account: string }) => {
        data.debit = row.equity_debit_account;
        return Promise.resolve({ error: null });
      },
    }),
    rpc: (_fn: string, args: { p_day: string }) => {
      data.rateDays.push(args.p_day);
      return Promise.resolve({ data: { insurance_relief_rate: 0.15 }, error: null });
    },
  },
}));
const saved = vi.hoisted(() => ({ files: [] as { name: string; blob: Blob }[] }));
vi.mock('file-saver', () => ({ saveAs: (blob: Blob, name: string) => saved.files.push({ blob, name }) }));

import PayrollExportsPanel, { downloadP10 } from './PayrollExportsPanel';

// jsdom's Blob has no text(); read it the way a browser without it would
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

const readBytes = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });

const run = { id: 'r1', pay_period: '2026-10', status: 'approved' } as never;

beforeEach(() => {
  data.payslips = [
    { employee_id: 'E1', gross_pay: 50000, net_pay: 40000, nhif_deduction: 1375, nssf_deduction: 3000, housing_levy: 750, paye_tax: 6000, tax_relief: 2400, nita_levy: 50 },
    { employee_id: 'E2', gross_pay: 30000, net_pay: 25000, nhif_deduction: 825, nssf_deduction: 1800, housing_levy: 450, paye_tax: 2000, tax_relief: 2400 },
  ];
  data.employees = [
    { 'Employee Number': 'E1', 'Payroll Number': 'PR-00001', 'First Name': 'Amina', 'Last Name': 'Wanjiru', 'Tax PIN': 'A012345678Z',
      kra_residency: 'Resident', kra_employee_type: 'Primary Employee', payment_method: 'M-Pesa', 'Mobile Number': '0712345678' },
    { 'Employee Number': 'E2', 'Payroll Number': 'PR-00002', 'First Name': 'Juma', 'Last Name': 'Otieno', payment_method: 'Bank Transfer',
      Bank: 'KCB', account_number_name: 'Juma Otieno', 'Account Number': '1100' },
  ];
  data.rateDays = [];
  data.debit = '';
  data.debit = '';
  saved.files = [];
});
afterEach(() => cleanup());

describe('PayrollExportsPanel', () => {
  it('offers each file with its row count, using the rates of the month’s last day', async () => {
    render(<PayrollExportsPanel run={run} />);
    expect(await screen.findByText('KRA PAYE (P10)')).toBeTruthy();
    expect(screen.getAllByText(/2 rows/)).toHaveLength(4); // P10, SHA, NSSF, Equity (M-Pesa and bank together)
    expect(screen.getAllByText(/1 row,/)).toHaveLength(3); // M-Pesa, bank, NITA levy (only E1 has a levy)
    expect(data.rateDays).toEqual(['2026-10-31']);
  });

  it('shows the month’s amounts to pay, the employer’s NITA levy among them, and a NITA file (FIG-898)', async () => {
    render(<PayrollExportsPanel run={run} />);
    await screen.findByText('NITA training levy');
    const totals = screen.getByLabelText('Amounts to pay');
    expect(totals.textContent).toContain('NITA levy');
    expect(totals.textContent).toContain('KSh 50.00');
    expect(totals.textContent).toContain('Employer only, 1 employee');
    fireEvent.click(screen.getAllByRole('button', { name: /Download CSV/ })[6]);
    expect(saved.files.map((f) => f.name)).toEqual(['nita-levy-2026-10.csv']);
    expect(await readBlob(saved.files[0].blob)).toBe(['PAYROLL NUMBER,EMPLOYEE NAME,ID NO,KRA PIN,NITA NO,LEVY', 'PR-00001,Amina Wanjiru,,A012345678Z,,50.00', ''].join(String.fromCharCode(13, 10)));
  });

  it('downloads a CSV named after the file and month', async () => {
    render(<PayrollExportsPanel run={run} />);
    await screen.findByText('KRA PAYE (P10)');
    fireEvent.click(screen.getAllByRole('button', { name: /Download CSV/ })[3]); // M-Pesa
    expect(saved.files.map((f) => f.name)).toEqual(['bulk-pay-mpesa-2026-10.csv']);
    expect(await readBlob(saved.files[0].blob)).toBe('Phone Number,Name,Amount,Reference,Payroll Number\r\n254712345678,Amina Wanjiru,40000.00,Salary 2026-10,PR-00001\r\n');
  });

  it('offers each file as Excel too, with the same rows and every cell as text', async () => {
    render(<PayrollExportsPanel run={run} />);
    await screen.findByText('KRA PAYE (P10)');
    expect(screen.getAllByRole('button', { name: /Download Excel/ })).toHaveLength(7);
    fireEvent.click(screen.getAllByRole('button', { name: /Download Excel/ })[3]); // M-Pesa
    expect(saved.files.map((f) => f.name)).toEqual(['bulk-pay-mpesa-2026-10.xlsx']);
    const book = XLSX.read(await readBytes(saved.files[0].blob), { type: 'array' });
    expect(book.SheetNames).toEqual(['M-Pesa bulk pay']);
    const sheet = book.Sheets[book.SheetNames[0]];
    expect(XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })).toEqual([
      ['Phone Number', 'Name', 'Amount', 'Reference', 'Payroll Number'],
      ['254712345678', 'Amina Wanjiru', '40000.00', 'Salary 2026-10', 'PR-00001'],
    ]);
    expect(sheet.A2.t).toBe('s');
  });

  it('shows who is missing what before the download', async () => {
    render(<PayrollExportsPanel run={run} />);
    await screen.findByText('KRA PAYE (P10)');
    fireEvent.click(screen.getAllByRole('button', { name: /missing details/ })[0]);
    await waitFor(() => expect(screen.getByText('Juma Otieno')).toBeTruthy());
    expect(screen.getByText(/KRA PIN, Residency, Type of employee/)).toBeTruthy();
  });

  it('the P10 button saves the month’s P10 as CSV with each employee’s own KRA PIN', async () => {
    const problems = await downloadP10(run);
    expect(saved.files.map((f) => f.name)).toEqual(['kra-p10-2026-10.csv']);
    const [header, first] = (await readBlob(saved.files[0].blob)).split('\r\n');
    expect(header.startsWith('Employee pin,Employee name,')).toBe(true);
    expect(first.startsWith('A012345678Z,Amina Wanjiru,')).toBe(true);
    expect(problems.map((p) => p.employeeNumber)).toEqual(['E2']); // Juma has no KRA PIN yet
  });

  it('asks for the company’s Equity account before the Eazzy Biz file can be downloaded', async () => {
    render(<PayrollExportsPanel run={run} />);
    await screen.findByText('Equity Bank (Eazzy Biz)');
    const download = screen.getAllByRole('button', { name: /Download CSV/ })[5] as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Equity account salaries are paid from/), { target: { value: '0123 456 789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Paid from Equity account 0123456789')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Download CSV/ })[5]);
    expect(saved.files.map((f) => f.name)).toEqual(['equity-eazzy-biz-2026-10.csv']);
  });
});
