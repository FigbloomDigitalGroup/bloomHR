import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const db = vi.hoisted(() => ({ toPay: 0, froms: [] as string[] }));
vi.mock('../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve({ count: db.toPay, error: null });
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: (t: string) => {
        db.froms.push(t);
        return chain;
      },
      channel: () => channel,
      removeChannel: () => {},
    },
  };
});
vi.mock('../lib/approvals', () => ({ loadMoneyAwaitingMe: vi.fn() }));

import { loadMoneyAwaitingMe } from '../lib/approvals';
import { moneyBadgeCounts, useMoneyBadges } from './useMoneyBadges';

const waiting = (...kinds: string[]) => kinds.map((kind) => ({ kind })) as never;

beforeEach(() => {
  vi.clearAllMocks();
  db.toPay = 0;
  db.froms = [];
  vi.mocked(loadMoneyAwaitingMe).mockResolvedValue(waiting('salary_advance', 'loan', 'loan', 'requisition'));
});
afterEach(cleanup);

describe('money badges', () => {
  it('counts each kind on its item; requisitions join the payments still to make', () => {
    expect(moneyBadgeCounts(waiting('salary_advance', 'loan', 'loan', 'expense', 'requisition'), 4)).toEqual({
      advanced: 1,
      loans: 2,
      expense: 1,
      payments: 5,
    });
    expect(moneyBadgeCounts([], 0)).toEqual({ advanced: 0, loans: 0, expense: 0, payments: 0 });
  });

  it('finance also gets the payments still to make', async () => {
    db.toPay = 2;
    const { result } = renderHook(() => useMoneyBadges('fin@co.com', true));
    await vi.waitFor(() => expect(result.current).toEqual({ advanced: 1, loans: 2, expense: 0, payments: 3 }));
    expect(db.froms).toContain('payment_requests');
  });

  it('without the payments module, the payments still to make are not asked for', async () => {
    db.toPay = 2;
    const { result } = renderHook(() => useMoneyBadges('hr@co.com', false));
    await vi.waitFor(() => expect(result.current.payments).toBe(1));
    expect(db.froms).not.toContain('payment_requests');
  });

  it('nothing without a signed-in person', () => {
    const { result } = renderHook(() => useMoneyBadges(undefined, true));
    expect(result.current).toEqual({});
    expect(loadMoneyAwaitingMe).not.toHaveBeenCalled();
  });
});
