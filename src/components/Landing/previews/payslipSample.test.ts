import { describe, expect, it } from 'vitest';
import { kenyaEngine } from '../../../lib/payroll/countries';
import { KENYA_FIXTURES, KENYA_RATES, baseContext } from '../../../lib/payroll/countries/kenyaFixtures';
import { PAYSLIP_SAMPLE } from './payslipSample';

// The sample payslip on the landing page must be a payslip the product would really produce. Its figures are
// recalculated here by the Kenyan payroll engine, from the same earnings, with the company's per diem share at nothing so
// that PAYE is the plain result of the bands. When a rate or a rule changes, this fails, and the page is updated.

const result = kenyaEngine.calculate({
  employee: KENYA_FIXTURES[0].employee,
  ctx: baseContext({ rates: { ...KENYA_RATES, per_diem_rate: 0 } }),
});
const plain = ({ label, amount }: { label: string; amount: number }) => ({ label, amount });

describe('the sample payslip on the landing page', () => {
  it('is what the Kenyan engine works out for the same earnings', () => {
    expect(PAYSLIP_SAMPLE.earnings).toEqual(result.earnings.map(plain));
    expect(PAYSLIP_SAMPLE.gross).toBe(result.grossPay);
    expect(PAYSLIP_SAMPLE.deductions).toEqual(result.statutoryDeductions.map(plain));
    expect(PAYSLIP_SAMPLE.net).toBe(result.netPay);
  });

  it('adds up', () => {
    const earned = PAYSLIP_SAMPLE.earnings.reduce((sum, line) => sum + line.amount, 0);
    const deducted = PAYSLIP_SAMPLE.deductions.reduce((sum, line) => sum + line.amount, 0);
    expect(earned).toBe(PAYSLIP_SAMPLE.gross);
    expect(PAYSLIP_SAMPLE.totalDeductions).toBeCloseTo(deducted, 2);
    expect(PAYSLIP_SAMPLE.net).toBeCloseTo(PAYSLIP_SAMPLE.gross - deducted, 2);
  });
});
