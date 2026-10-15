// @vitest-environment node
//
// Builds real PDFs (no mocked jsPDF): the table plugin must actually draw, which is what broke when
// jspdf-autotable 5 stopped adding doc.autoTable on import.
import { describe, expect, it } from 'vitest';
import { payrollRegisterPdf, registerFigures } from './payrollPdf';

const rows = [
  { employee_id: 'MCL-000001', employee_name: 'Amina Wanjiru', department: 'Finance', basic_salary: 80000, gross_pay: 95000,
    paye_tax: 17000, nhif_deduction: 2612.5, nssf_deduction: 5700, housing_levy: 1425, total_deductions: 29737.5, net_pay: 65262.5 },
  { employee_id: 'MCL-000002', employee_name: 'Juma Otieno', department: 'Branch Staff', branch: 'Nakuru', basic_salary: 30000, gross_pay: 30000,
    paye_tax: 2000, nhif_deduction: 825, nssf_deduction: 1800, housing_levy: 450, total_deductions: 6075, net_pay: 23925 },
];

describe('payroll register PDF', () => {
  it('works out allowances, other deductions and totals', () => {
    const { lines, totals } = registerFigures(rows);
    expect(lines[0].amounts).toEqual([80000, 15000, 95000, 17000, 2612.5, 5700, 1425, 3000, 65262.5]);
    expect(lines[1].department).toBe('Nakuru');
    expect(lines[1].amounts[7]).toBe(1000);
    expect(totals[2]).toBe(125000);
    expect(totals[8]).toBe(89187.5);
  });

  it('draws a real PDF with the table, its totals and the period', () => {
    const doc = payrollRegisterPdf(rows, { periodLabel: 'October 2026', companyName: 'Acme Tech' });
    const pdf = doc.output();
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain('Payroll register: October 2026');
    expect(pdf).toContain('Amina Wanjiru');
    expect(pdf).toContain('125,000');
  });
});
