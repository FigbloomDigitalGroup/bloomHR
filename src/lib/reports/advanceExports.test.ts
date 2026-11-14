import { describe, expect, it } from 'vitest';
import { advanceReportHtml, advanceRows, advancesCsv, csvCell, totalAdvanced, type AdvanceRecord } from './advanceExports';

const records: AdvanceRecord[] = [
  { id: 2, employee_number: 'E-002', first_name: 'Rose', last_name: 'Achieng', application_date: '2026-11-03T08:00:00Z', amount_requested: 5000, status: 'pending' },
  { id: 1, employee_number: 'E-001', first_name: 'Moses', last_name: 'Kibet', application_date: '2026-10-06T11:00:00Z', amount_requested: '5000', status: 'paid', mpesa_code: 'QK12AB' },
  { id: 3, employee_number: 'E-001', first_name: 'Moses', last_name: 'Kibet', application_date: '2026-09-01', amount_requested: null, status: 'rejected' },
];

describe('salary advance exports', () => {
  it('one row per advance, by employee then date, with the amount as a number', () => {
    expect(advanceRows(records)).toEqual([
      ['E-001', 'Moses Kibet', '2026-09-01', '0.00', 'rejected', ''],
      ['E-001', 'Moses Kibet', '2026-10-06', '5000.00', 'paid', 'QK12AB'],
      ['E-002', 'Rose Achieng', '2026-11-03', '5000.00', 'pending', ''],
    ]);
  });

  it('CSV: a header and quoted cells where needed', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    const csv = advancesCsv(records).split('\n');
    expect(csv[0]).toBe('Employee number,Name,Date,Amount (KES),Status,M-Pesa reference');
    expect(csv).toHaveLength(4);
  });

  it('adds up the amounts, counting a missing one as 0', () => {
    expect(totalAdvanced(records)).toBe(10000);
  });

  it('the printed page names the employee, lists the advances and the total, and escapes text', () => {
    const html = advanceReportHtml({ name: 'Moses <Kibet>', number: 'E-001' }, records.slice(1));
    expect(html).toContain('Salary advances: Moses &lt;Kibet&gt;');
    expect(html).toContain('QK12AB');
    expect(html).toContain('5,000.00');
    expect(html).not.toContain('<Kibet>');
  });
});
