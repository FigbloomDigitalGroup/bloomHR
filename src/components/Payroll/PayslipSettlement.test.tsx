import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

// html2pdf needs a real canvas; the payslip itself is what is tested here
vi.mock('html2pdf.js', () => ({ default: () => ({ from: () => ({ set: () => ({ save: vi.fn() }) }) }) }));
const saved = vi.hoisted(() => ({ files: [] as { name: string; blob: Blob }[] }));
vi.mock('file-saver', () => ({ saveAs: (blob: Blob, name: string) => saved.files.push({ blob, name }) }));

import { PayslipDocument } from './PayrollPayslipModal';
import WorkSettlementCard from './WorkSettlementCard';

// The piece rate parts of a payslip (FIG-812 stage 5): the work earnings, a contractor's WHT and the month-end
// settlement lines, on the payslip payroll sees, emails and staff download; and the WHT report download on the Run tab.

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

// the worked example: no salary, 30,000 of work, 20,000 of it paid out (300 AHL and 2,000 reserve held back)
const worker = {
  employee_id: 'W1', employee_name: 'Wanjiru One', pay_period: '2026-10', basic_salary: 0, gross_pay: 30000, work_pay: 30000, jobs_pay: 0,
  work_items: [{ name: 'Tea picked', unit: 'kg', quantity: 1500, amount: 30000 }], paye_tax: 731.25, nhif_deduction: 825, nssf_deduction: 1800,
  housing_levy: 450, total_deductions: 3806.25, paid_out: 17700, ahl_withheld: 300, reserve_released: 2000, wht_withheld: 0,
  arrears_brought_forward: 0, arrears_carried_forward: 0, net_pay: 8493.75, work_settlement: true, worker_kind: 'employee',
};
const contractor = {
  employee_id: 'C1', employee_name: 'Chege Contract', pay_period: '2026-10', basic_salary: 0, gross_pay: 10000, work_pay: 10000, jobs_pay: 0,
  paye_tax: 0, nhif_deduction: 0, nssf_deduction: 0, housing_levy: 0, wht_rate: 0.03, wht_tax: 300, wht_withheld: 150, total_deductions: 300,
  paid_out: 4850, net_pay: 4850, work_settlement: true, worker_kind: 'contractor',
};
const salaried = {
  employee_id: 'S1', employee_name: 'Sara Salary', pay_period: '2026-10', basic_salary: 60000, gross_pay: 70000, total_deductions: 13045.2,
  net_pay: 56954.8, paye_tax: 5899.7,
};

afterEach(() => {
  cleanup();
  saved.files = [];
});

describe('the payslip', () => {
  it('shows the work as earnings and the month-end settlement lines', () => {
    render(<PayslipDocument record={worker} companyInfo={{ company_name: 'Acme Farms' }} />);
    expect(screen.getByTestId('work-earning')?.textContent).toMatch(/Piece rate work.*Tea picked: 1,500 kg/);
    const s = within(screen.getByTestId('payslip-settlement'));
    expect(s.getByText('Month-end settlement')).toBeTruthy();
    expect(s.getByText('Net pay for the month').parentElement?.textContent).toContain('KSh 26,193.75');
    expect(s.getByText('Already paid during the month').parentElement?.textContent).toContain('−KSh 17,700');
    expect(s.getByText('Held back (reserve) released').parentElement?.textContent).toContain('(KSh 2,000)');
    expect(s.getByText('AHL already withheld').parentElement?.textContent).toContain('(KSh 300)');
    expect(s.getByText('Net to pay at month end', { selector: 'span' }).parentElement?.textContent).toContain('KSh 8,493.75');
    expect(s.queryByText('Arrears brought forward')).toBeNull();
    // the payslip's last line says what it is
    expect(screen.getAllByText('Net to pay at month end')).toHaveLength(2);
  });

  it('shows arrears brought and carried forward', () => {
    render(<PayslipDocument record={{ ...worker, arrears_brought_forward: 500, arrears_carried_forward: 1200, arrears_note: 'KSh 1,200 more than was left to pay', net_pay: 0 }} companyInfo={{}} />);
    const s = within(screen.getByTestId('payslip-settlement'));
    expect(s.getByText('Arrears brought forward').parentElement?.textContent).toContain('−KSh 500');
    expect(s.getByText('Carried forward').parentElement?.textContent).toContain('+KSh 1,200');
    expect(s.getByText('KSh 1,200 more than was left to pay')).toBeTruthy();
  });

  it("a contractor's payslip shows withholding tax and the WHT already withheld", () => {
    render(<PayslipDocument record={contractor} companyInfo={{}} />);
    expect(screen.getByTestId('wht-line')?.textContent).toContain('Withholding tax (3%)KSh 300');
    expect(within(screen.getByTestId('payslip-settlement')).getByText('WHT already withheld').parentElement?.textContent).toContain('(KSh 150)');
  });

  it('a salaried payslip has none of it', () => {
    render(<PayslipDocument record={salaried} companyInfo={{}} />);
    expect(screen.queryByTestId('payslip-settlement')).toBeNull();
    expect(screen.queryByTestId('work-earning')).toBeNull();
    expect(screen.queryByTestId('wht-line')).toBeNull();
    expect(screen.getByText('Net pay')).toBeTruthy();
  });
});

describe('the WHT report on the Run tab', () => {
  const employees = [
    { 'Employee Number': 'C1', 'First Name': 'Chege', 'Last Name': 'Contract', 'Tax PIN': 'A012345678Z', 'Payroll Number': 'PR-7', wht_category: 'contractual' },
    { 'Employee Number': 'W1', 'First Name': 'Wanjiru', 'Last Name': 'One' },
  ];

  it('sums up the settlement and downloads the WHT report as CSV', async () => {
    render(<WorkSettlementCard payslips={[worker, contractor, salaried]} employees={employees} payPeriod="2026-10" periodLabel="October 2026" />);
    expect(screen.getByTestId('work-settlement-summary')?.textContent).toMatch(/2 people are settled for October 2026/);
    expect(screen.getByTestId('work-settlement-summary')?.textContent).toMatch(/Withholding tax on 1 contractor: KSh 300/);
    fireEvent.click(screen.getByRole('button', { name: 'Download WHT report CSV' }));
    expect(saved.files.map((f) => f.name)).toEqual(['kra-wht-2026-10.csv']);
    const csv = await readBlob(saved.files[0].blob);
    expect(csv.split('\r\n')[0]).toBe('PIN of withholdee,Name of withholdee,Payroll number,Pay period,Nature of transaction,Gross amount,WHT rate (%),WHT amount,Withheld at payouts,Withheld at month end');
    expect(csv.split('\r\n')[1]).toBe('A012345678Z,Chege Contract,PR-7,2026-10,Contractual fees,10000.00,3.00,300.00,150.00,150.00');
  });

  it('downloads it as Excel too', () => {
    render(<WorkSettlementCard payslips={[contractor]} employees={employees} payPeriod="2026-10" periodLabel="October 2026" />);
    fireEvent.click(screen.getByRole('button', { name: 'Download WHT report Excel' }));
    expect(saved.files.map((f) => f.name)).toEqual(['kra-wht-2026-10.xlsx']);
  });

  it('shows nothing for a payroll with no one paid for work', () => {
    const { container } = render(<WorkSettlementCard payslips={[salaried]} employees={employees} payPeriod="2026-10" periodLabel="October 2026" />);
    expect(container.innerHTML).toBe('');
  });
});
