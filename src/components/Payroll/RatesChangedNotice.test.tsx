import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const db = vi.hoisted(() => ({ calls: [] as [string, unknown][], result: { data: null as unknown, error: null as unknown } }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      db.calls.push([fn, args]);
      return Promise.resolve(db.result);
    },
  },
}));

import { RatesChangedNotice } from './RatesChangedNotice';
import { getStaleCountries, recordRunRates } from '../../lib/payrollRuns';

afterEach(() => {
  cleanup();
  db.calls = [];
  db.result = { data: null, error: null };
});

describe('the rates-changed notice', () => {
  it('says which draft countries need recalculating, and recalculates in one click', () => {
    const onRecalculate = vi.fn();
    render(<RatesChangedNotice countries={['Kenya', 'Uganda']} periodLabel="July 2026" busy={false} onRecalculate={onRecalculate} />);
    expect(screen.getByText('Rates changed since this was calculated')).toBeTruthy();
    expect(screen.getByText(/after Kenya, Uganda were worked out/)).toBeTruthy();
    fireEvent.click(screen.getByText('Recalculate'));
    expect(onRecalculate).toHaveBeenCalledOnce();
  });

  it('shows nothing when no draft is stale', () => {
    const { container } = render(<RatesChangedNotice countries={[]} periodLabel="July 2026" busy={false} onRecalculate={() => undefined} />);
    expect(container.textContent).toBe('');
  });
});

describe('the rates a run was worked out with', () => {
  it('are recorded per country, and stale countries read back', async () => {
    db.result = { data: ['Kenya'], error: null };
    expect(await recordRunRates('run-1', { Kenya: { shif_rate: 0.0275 } })).toEqual(['Kenya']);
    expect(db.calls[0]).toEqual(['record_payroll_rates', { p_run: 'run-1', p_rates: { Kenya: { shif_rate: 0.0275 } } }]);
    db.result = { data: ['Uganda'], error: null };
    expect(await getStaleCountries('run-1')).toEqual(['Uganda']);
    expect(db.calls[1]).toEqual(['payroll_stale_countries', { p_run: 'run-1' }]);
  });

  it('a database without the migration yet skips the check rather than failing', async () => {
    db.result = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    expect(await getStaleCountries('run-1')).toEqual([]);
    expect(await recordRunRates('run-1', {})).toEqual([]);
    db.result = { data: null, error: { code: '42501', message: 'Only payroll can do this' } };
    await expect(recordRunRates('run-1', {})).rejects.toMatchObject({ message: 'Only payroll can do this' });
  });
});
