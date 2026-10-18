// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';

// the off-screen rendering is browser-only; these tests are about the options handed to jsPDF
vi.mock('html2pdf.js', () => ({ default: () => ({}) }));
vi.mock('./PayrollPayslipModal', () => ({ PayslipDocument: () => null }));

import { payslipPdfOptions } from './payslipPdf';

describe('payslip PDF options', () => {
  it('match the "Download PDF" button, with no password by default', () => {
    const o = payslipPdfOptions({ employee_id: 'E1', pay_period: '2026-10' });
    expect(o).toMatchObject({ margin: 0.5, filename: 'payslip_E1_2026-10.pdf', jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' } });
    expect(o.jsPDF).not.toHaveProperty('encryption');
  });

  it('with a password: opening needs it, printing is allowed, and the owner password is random', () => {
    const a = payslipPdfOptions({ employee_id: 'E1' }, '12345678');
    const b = payslipPdfOptions({ employee_id: 'E1' }, '12345678');
    expect(a.jsPDF.encryption).toMatchObject({ userPassword: '12345678', userPermissions: ['print'] });
    expect(a.jsPDF.encryption?.ownerPassword).toMatch(/^[0-9a-f]{36}$/);
    expect(a.jsPDF.encryption?.ownerPassword).not.toBe(b.jsPDF.encryption?.ownerPassword);
    expect(a.jsPDF.encryption?.ownerPassword).not.toBe('12345678');
  });

  it('jsPDF encrypts a document made with these options', () => {
    const doc = new jsPDF(payslipPdfOptions({ employee_id: 'E1' }, '12345678').jsPDF);
    doc.text('Payslip', 1, 1);
    const pdf = doc.output();
    expect(pdf).toContain('/Encrypt');
    expect(pdf).not.toContain('(Payslip)'); // the text is not readable without the password
    const plain = new jsPDF(payslipPdfOptions({ employee_id: 'E1' }).jsPDF);
    plain.text('Payslip', 1, 1);
    expect(plain.output()).not.toContain('/Encrypt');
  });
});
