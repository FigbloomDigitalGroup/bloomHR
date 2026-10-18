import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

// The staff portal's My work > Earnings once the month's payroll is approved (FIG-812 stage 5): "Settled on your
// October payslip", with what was paid at month end.

const api = vi.hoisted(() => ({ settlement: null as unknown }));
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/myWorkApi', () => ({
  loadMyEarnings: () => Promise.resolve({
    from: '2026-10-01', to: '2026-10-31', approved_work: 30000, waiting_work: 0, approved_jobs: 0, waiting_jobs: 0,
    approved_entries: 3, waiting_entries: 0, approved_job_count: 0, waiting_job_count: 0, by_type: [], by_week: [],
  }),
  loadMyPayouts: () => Promise.resolve({ pay_period: '2026-10', gross: 20000, paid: 17700, ahl: 300, reserve: 2000, wht: 0, held: 2300, payouts: [] }),
}));
vi.mock('../../../lib/workSettlementApi', () => ({ loadMyWorkSettlement: () => Promise.resolve(api.settlement) }));

import MyEarnings from './MyEarnings';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());

describe('settled work', () => {
  it('says the month was settled on the payslip, with the month-end pay and anything carried forward', async () => {
    api.settlement = { pay_period: '2026-10', settled: true, net_pay: 8493.75, paid_out: 17700, arrears_brought_forward: 0, arrears_carried_forward: 250 };
    render(<MyEarnings today="2026-10-18" />);
    await settle();
    const note = screen.getByTestId('work-settled').textContent ?? '';
    expect(note).toMatch(/Settled on your October payslip\./);
    expect(note).toMatch(/paid at month end, after .*17,700.* paid out during the month/);
    expect(note).toMatch(/250.* is carried forward/);
  });

  it('says nothing while the month is open', async () => {
    api.settlement = { pay_period: '2026-10', settled: false, net_pay: 0, paid_out: 0, arrears_brought_forward: 0, arrears_carried_forward: 0 };
    render(<MyEarnings today="2026-10-18" />);
    await settle();
    expect(screen.queryByTestId('work-settled')).toBeNull();
  });
});
