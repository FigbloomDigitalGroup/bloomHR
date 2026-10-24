import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  scans: [] as { can_decide: boolean }[],
  asked: [] as string[],
  filters: [] as [string, string, unknown][],
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string) => {
      db.asked.push(name);
      return Promise.resolve({ data: db.scans, error: null });
    },
    from: (table: string) => {
      db.asked.push(table);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (col: string, value: unknown) => {
        db.filters.push([table, col, value]);
        return chain;
      };
      chain.then = (resolve: (v: unknown) => void) => resolve({ count: db.counts[table] ?? 0, error: null });
      return chain;
    },
  },
}));

import { loadWorkBadges } from './useWorkBadges';

const all = { attendance: true, exits: true, onboarding: true, overtime: true };

beforeEach(() => {
  db.counts = { employee_exits: 1, employees: 3, overtime_entries: 4 };
  db.scans = [{ can_decide: true }, { can_decide: false }, { can_decide: true }];
  db.asked = [];
  db.filters = [];
});

describe('work badges', () => {
  it('counts what waits on the person', async () => {
    expect(await loadWorkBadges(all)).toEqual({ attendance: 2, 'hr-lifecycle': 1, onboarding: 3, overtime: 4 });
    expect(db.filters).toEqual(
      expect.arrayContaining([
        ['employee_exits', 'status', 'requested'],
        ['employees', 'onboarding_status', 'submitted'],
        ['overtime_entries', 'status', 'submitted'],
      ]),
    );
  });

  it('missed scans count only those the person may decide', async () => {
    db.scans = [{ can_decide: false }];
    expect((await loadWorkBadges({ ...all, exits: false, onboarding: false, overtime: false })).attendance).toBe(0);
  });

  it('does not ask for what the person may not act on', async () => {
    expect(await loadWorkBadges({ attendance: false, exits: false, onboarding: true, overtime: false })).toEqual({
      attendance: 0,
      'hr-lifecycle': 0,
      onboarding: 3,
      overtime: 0,
    });
    expect(db.asked).toEqual(['employees']);
  });
});
