import { describe, expect, it, vi } from 'vitest';

// FIG-814: the emailed PDF is drawn from the same PayslipDocument as the screen, with the same employer block, employee
// numbers, year to date and design (loaded for the payslip when not given).

const h = vi.hoisted(() => ({ html: '' as string, loads: 0 }));
vi.mock('html2pdf.js', () => ({
  default: () => {
    const chain = {
      set: () => chain,
      from: (el: HTMLElement) => {
        h.html = el.outerHTML;
        return chain;
      },
      outputPdf: () => Promise.resolve(new Blob(['%PDF'])),
    };
    return chain;
  },
}));
vi.mock('../../lib/payslipExtras', async (orig) => ({
  ...(await orig<typeof import('../../lib/payslipExtras')>()),
  loadPayslipExtras: () => {
    h.loads += 1;
    return Promise.resolve({
      employer: { name: 'Acme Ltd', logoUrl: null, letterheadUrl: null, address: 'Plot 7, Nairobi', phone: null, email: null, website: null, taxLabel: 'KRA PIN', taxNumber: 'P051234567X' },
      employee: { taxNumber: 'A012345678Z', nssfNumber: '123', shaNumber: 'CR1', idNumber: '1', branch: 'HQ', department: null, position: null, jobGroup: null },
      run: { runId: 'r', ref: '2026-10 · ABCD1234', status: 'approved', approvedAt: '2026-10-28T09:00:00Z', paidAt: null },
    });
  },
}));

import { renderPayslipPdf } from './payslipPdf';

describe('the emailed payslip PDF', () => {
  const record = { employee_id: 'E1', employee_name: 'Amina', pay_period: '2026-10', gross_pay: 50000, net_pay: 40000, tax_relief: 2400 };

  it('is the shared payslip with its details', async () => {
    const blob = await renderPayslipPdf(record, { company_name: 'Acme Ltd' });
    expect(blob).toBeInstanceOf(Blob);
    expect(h.loads).toBe(1);
    expect(h.html).toContain('data-testid="payslip-document"');
    expect(h.html).toContain('KRA PIN: P051234567X');
    expect(h.html).toContain('A012345678Z');
    expect(h.html).toContain('Payroll run 2026-10 · ABCD1234');
    expect(h.html).toContain('This payslip is computer generated');
  });

  it('uses the details it is given without loading them again', async () => {
    h.loads = 0;
    await renderPayslipPdf(record, {}, null, null);
    expect(h.loads).toBe(0);
    expect(h.html).toContain('data-testid="payslip-document"');
  });
});
