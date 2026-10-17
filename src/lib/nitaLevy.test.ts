import { describe, expect, it } from 'vitest';
import { nitaLevyFor, nitaTotal, payslipNitaLevy } from './nitaLevy';

describe('NITA training levy (FIG-898)', () => {
  const rates = { nita_levy: 50 };

  it('is the month\'s rate for each employee; none for casual workers or contractors', () => {
    expect(nitaLevyFor({ worker_kind: 'employee' }, rates)).toBe(50);
    expect(nitaLevyFor({}, rates)).toBe(50);
    expect(nitaLevyFor({ worker_kind: 'casual' }, rates)).toBe(0);
    expect(nitaLevyFor({ worker_kind: 'contractor' }, rates)).toBe(0);
    // a month with no rate: nothing
    expect(nitaLevyFor({}, {})).toBe(0);
    expect(nitaLevyFor({}, null)).toBe(0);
  });

  it('totals the month for NITA', () => {
    expect(payslipNitaLevy({ nita_levy: '50.00' })).toBe(50);
    expect(payslipNitaLevy({})).toBe(0);
    expect(nitaTotal([{ nita_levy: 50 }, { nita_levy: '50' }, { nita_levy: 0 }, {}])).toEqual({ total: 100, employees: 2 });
  });
});
