import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const rates = vi.hoisted(() => ({ rows: [] as unknown[], days: [] as string[] }));
vi.mock('../../lib/statutoryRates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/statutoryRates')>()),
  ratesInForce: (day: string) => {
    rates.days.push(day);
    return Promise.resolve(rates.rows);
  },
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import PayrollRatesTab, { rateSections } from './PayrollRatesTab';

afterEach(cleanup);

const row = (code: string, value: number | null, extra: Record<string, unknown> = {}) => ({
  id: code, tenant_id: null, code, value, bands: null, effective_from: '2025-02-01', effective_to: null, source: 'Finance Act 2023', ...extra,
});

const ROWS = [
  row('paye_bands', null, {
    bands: [{ upto: 24000, rate: 0.1 }, { upto: 32333, rate: 0.25 }, { upto: null, rate: 0.35 }],
    effective_from: '2023-07-01',
  }),
  row('personal_relief', 2400),
  row('insurance_relief_rate', 0.15),
  row('shif_rate', 0.0275, { source: 'SHI Act 2023' }),
  row('shif_minimum', 300),
  row('ahl_rate', 0.015),
  row('nssf_rate', 0.06),
  row('nssf_employer_rate', 0.06),
  row('nssf_lower_limit', 8000),
  row('nssf_upper_limit', 72000, { tenant_id: 't1', source: 'Set by the company', effective_from: '2026-02-01' }),
  row('meals_exempt_limit', 5000),
];

beforeEach(() => {
  rates.rows = ROWS;
  rates.days = [];
});

describe('rateSections', () => {
  it('splits NSSF into tier I (to the lower limit) and tier II (lower to upper) at the stored rate', () => {
    const nssf = rateSections(ROWS as never).find((s) => s.title === 'NSSF');
    const [tier1, tier2] = nssf!.lines;
    expect(tier1.label).toBe('NSSF tier I');
    expect(tier1.value).toBe('6% of pay up to KSh 8,000');
    expect(tier1.note).toContain('KSh 480');
    expect(tier2.label).toBe('NSSF tier II');
    expect(tier2.value).toBe('6% of pay from KSh 8,000 to KSh 72,000');
    // (72,000 - 8,000) x 6%: with tier I that is 6% of 72,000, what statutoryCalc takes
    expect(tier2.note).toContain('KSh 3,840');
  });

  it('puts codes it does not group under other limits', () => {
    const other = rateSections(ROWS as never).find((s) => s.title === 'Other limits and reliefs');
    expect(other!.lines.map((l) => l.label)).toEqual(['Meals exempt up to (monthly)']);
  });
});

describe('PayrollRatesTab', () => {
  it("shows the month's PAYE bands, reliefs, SHA, housing levy and NSSF tiers with dates and sources", async () => {
    render(<PayrollRatesTab payPeriod="2026-10" periodLabel="October 2026" canEdit={false} onEdit={() => {}} version={0} />);
    expect(await screen.findByText('NSSF tier I')).toBeTruthy();
    expect(rates.days).toEqual(['2026-10-31']);
    expect(screen.getByText('PAYE band: First KSh 24,000')).toBeTruthy();
    expect(screen.getByText('PAYE band: KSh 24,001 to KSh 32,333')).toBeTruthy();
    expect(screen.getByText('PAYE band: Above KSh 32,333')).toBeTruthy();
    expect(screen.getByText('35%')).toBeTruthy();
    expect(screen.getByText('Personal relief (monthly)')).toBeTruthy();
    expect(screen.getByText('SHA (SHIF) rate')).toBeTruthy();
    expect(screen.getByText('2.75%')).toBeTruthy();
    expect(screen.getByText('SHI Act 2023')).toBeTruthy();
    expect(screen.getByText('Housing levy rate (employee)')).toBeTruthy();
    expect(screen.getByText('NSSF tier II')).toBeTruthy();
    // tier II uses the company's own upper limit, so it shows its date and the company as the source
    const tier2 = screen.getByText('NSSF tier II').closest('tr')!;
    expect(tier2.textContent).toContain('2026-02-01');
    expect(tier2.textContent).toContain('Your company');
  });

  it('offers "Edit rates" only to those allowed', async () => {
    const onEdit = vi.fn();
    render(<PayrollRatesTab payPeriod="2026-10" periodLabel="October 2026" canEdit onEdit={onEdit} version={0} />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit rates/ }));
    expect(onEdit).toHaveBeenCalled();
    cleanup();
    render(<PayrollRatesTab payPeriod="2026-10" periodLabel="October 2026" canEdit={false} onEdit={onEdit} version={0} />);
    await screen.findByText('NSSF tier I');
    expect(screen.queryByRole('button', { name: /Edit rates/ })).toBeNull();
  });
});
