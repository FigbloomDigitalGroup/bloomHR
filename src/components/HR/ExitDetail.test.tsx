import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ClearanceItem, ExitRecord } from '../../lib/exits';

const mocks = vi.hoisted(() => ({
  exit: null as unknown as ExitRecord,
  items: [] as ClearanceItem[],
  decide: vi.fn(),
  complete: vi.fn(),
  saveItem: vi.fn(),
  workOut: vi.fn(),
  saveDues: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/privateFiles', () => ({ openPrivateFile: vi.fn() }));
vi.mock('./ExitLetters', () => ({ default: () => <div data-testid="exit-letters" /> }));
vi.mock('../../lib/exits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/exits')>();
  return {
    ...actual,
    loadExit: () => Promise.resolve(mocks.exit),
    loadClearance: () => Promise.resolve(mocks.items),
    loadInterview: () => Promise.resolve(null),
    loadFinalDues: () => Promise.resolve(null),
    decideExit: (...a: unknown[]) => mocks.decide(...a),
    completeExit: (...a: unknown[]) => mocks.complete(...a),
    saveClearanceItem: (...a: unknown[]) => mocks.saveItem(...a),
    workOutFinalDues: (...a: unknown[]) => mocks.workOut(...a),
    saveFinalDues: (...a: unknown[]) => mocks.saveDues(...a),
  };
});

import ExitDetail from './ExitDetail';

const exit = (over: Partial<ExitRecord> = {}): ExitRecord => ({
  id: 'x1',
  employee_number: 'E2',
  employee_name: 'Eric Two',
  kind: 'termination',
  reason_category: 'redundancy',
  reason: 'Role closed',
  notice_given_on: '2026-10-01',
  notice_days: 28,
  last_working_day: '2026-10-15',
  notice_pay: true,
  letter_path: null,
  status: 'requested',
  decision_note: null,
  requested_by: 'hr1',
  decided_by: null,
  decided_at: null,
  access_ended_at: null,
  completed_at: null,
  created_at: '2026-10-01T08:00:00Z',
  ...over,
});
const item = (id: string, done: boolean): ClearanceItem => ({
  id,
  exit_id: 'x1',
  category: 'it',
  title: `Item ${id}`,
  owner: 'IT',
  asset_id: null,
  done,
  done_at: null,
  notes: null,
  sort_order: Number(id),
});

beforeEach(() => {
  mocks.exit = exit();
  mocks.items = [];
  for (const fn of [mocks.decide, mocks.complete, mocks.saveItem, mocks.saveDues]) fn.mockReset().mockResolvedValue(undefined);
  mocks.workOut.mockReset().mockResolvedValue({
    lines: [
      { code: 'basic', label: 'Basic pay for the last month', detail: '15 of 31 days', kind: 'earning', amount: 30000 },
      { code: 'advance', label: 'Salary advances owed', kind: 'deduction', amount: 5000 },
    ],
    notes: ['No 2026 annual leave balance on record: leave days count as 0.'],
  });
});
afterEach(() => cleanup());

describe('ExitDetail', () => {
  it('a request awaits approval: approve, or decline with a note', async () => {
    render(<ExitDetail exitId="x1" onBack={() => {}} />);
    await screen.findByText('Eric Two');
    expect(screen.getByText('Redundancy')).toBeTruthy();
    expect(screen.queryByText('Clearance', { selector: 'div' })).toBeNull();
    const decline = screen.getByRole('button', { name: 'Decline' }) as HTMLButtonElement;
    expect(decline.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Note (needed to decline)'), { target: { value: 'Keep the role' } });
    expect(decline.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith('x1', 'approved', 'Keep the role'));
  });

  it('shows clearance progress, and completes only once everything is cleared', async () => {
    mocks.exit = exit({ status: 'clearance' });
    mocks.items = [item('1', true), item('2', false)];
    render(<ExitDetail exitId="x1" onBack={() => {}} />);
    await screen.findByText('1 of 2 done');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    expect((screen.getByRole('button', { name: 'Complete exit' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Item 2/ }));
    await waitFor(() => expect(mocks.saveItem).toHaveBeenCalledWith('2', { done: true }));
    cleanup();

    mocks.items = [item('1', true), item('2', true)];
    render(<ExitDetail exitId="x1" onBack={() => {}} />);
    await screen.findByText('2 of 2 done');
    fireEvent.click(screen.getByRole('button', { name: 'Complete exit' }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith('x1'));
  });

  it('works out the final dues as a statement HR can adjust and save', async () => {
    mocks.exit = exit({ status: 'approved' });
    render(<ExitDetail exitId="x1" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Work out final dues' }));
    await screen.findByText('Basic pay for the last month');
    expect(screen.getByTestId('dues-net').textContent).toBe('25,000.00');
    expect(screen.getByText(/No 2026 annual leave balance/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Salary advances owed amount'), { target: { value: '2000' } });
    expect(screen.getByTestId('dues-net').textContent).toBe('28,000.00');
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    await waitFor(() =>
      expect(mocks.saveDues).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'x1' }),
        expect.objectContaining({ status: 'reviewed', lines: expect.arrayContaining([expect.objectContaining({ code: 'advance', amount: 2000 })]) })
      )
    );
  });

  it('the exit interview starts from the standard questions', async () => {
    mocks.exit = exit({ status: 'approved' });
    render(<ExitDetail exitId="x1" onBack={() => {}} />);
    await screen.findByText('Exit interview');
    expect(screen.getByLabelText('What is your main reason for leaving?')).toBeTruthy();
    expect(screen.getByText(/Confidential to HR/)).toBeTruthy();
  });
});
