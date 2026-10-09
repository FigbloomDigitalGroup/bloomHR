import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake salary_history table behind a query builder like supabase-js: ranges are capped at 1000 rows, as the API does.
const db = vi.hoisted(() => ({
  rows: [] as { id: string; employee_id: string | null; pay_period: string; run_id?: string }[],
  upserts: [] as number[],
  deletes: [] as string[][],
}));

vi.mock('./supabase', () => {
  const query = () => {
    const filters: [string, unknown][] = [];
    let range: [number, number] = [0, Infinity];
    const matching = () => db.rows.filter((r) => filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v));
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      },
      order: () => b,
      range: (from: number, to: number) => {
        range = [from, Math.min(to, from + 999)];
        return b;
      },
      then: (resolve: (r: unknown) => void) => resolve({ data: matching().slice(range[0], range[1] + 1), error: null }),
      upsert: (rows: unknown[]) => {
        db.upserts.push(rows.length);
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        in: (_col: string, ids: string[]) => {
          db.deletes.push(ids);
          db.rows = db.rows.filter((r) => !ids.includes(r.id));
          return Promise.resolve({ error: null });
        },
      }),
    };
    return b;
  };
  return { supabase: { from: () => query() } };
});

import { getRunPayslips, saveDraftRun } from './payrollRuns';
import type { SalaryHistoryRecord } from './salaryHistory';

const record = (n: number) => ({ employee_id: `E${n}` }) as SalaryHistoryRecord;

beforeEach(() => {
  db.rows = [];
  db.upserts = [];
  db.deletes = [];
});

describe('saveDraftRun with thousands of employees', () => {
  it('saves every payslip in batches and removes only the payslips of people no longer paid', async () => {
    // 2600 saved last time; 2500 still employed; one old payslip has no employee number
    db.rows = [
      ...Array.from({ length: 2600 }, (_, i) => ({ id: `p${i}`, employee_id: `E${i}`, pay_period: '2026-10' })),
      { id: 'legacy', employee_id: null, pay_period: '2026-10' },
      { id: 'other-month', employee_id: 'E2550', pay_period: '2026-09' },
    ];
    await saveDraftRun('2026-10', Array.from({ length: 2500 }, (_, i) => record(i)));

    expect(db.upserts).toEqual([500, 500, 500, 500, 500]);
    expect(db.deletes.flat().sort()).toEqual(Array.from({ length: 100 }, (_, i) => `p${2500 + i}`).sort());
    expect(Math.max(...db.deletes.map((ids) => ids.length))).toBeLessThanOrEqual(200);
    expect(db.rows.some((r) => r.id === 'legacy')).toBe(true);
    expect(db.rows.some((r) => r.id === 'other-month')).toBe(true);
  });

  it('refuses an empty payroll', async () => {
    await expect(saveDraftRun('2026-10', [])).rejects.toThrow('There are no employees to pay for this month.');
  });
});

describe('getRunPayslips', () => {
  it('returns every payslip of a run, past the 1000-row limit', async () => {
    db.rows = Array.from({ length: 2345 }, (_, i) => ({ id: `p${i}`, employee_id: `E${i}`, pay_period: '2026-10', run_id: 'r1' }));
    expect(await getRunPayslips('r1')).toHaveLength(2345);
  });
});
