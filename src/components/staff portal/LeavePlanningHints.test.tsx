import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, eqCalls: [] as [string, string, unknown][] }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const result = Promise.resolve({ data: state.tables[table] || [], error: null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = Object.assign(result, {
        select: () => b,
        order: () => b,
        eq: (col: string, val: unknown) => {
          state.eqCalls.push([table, col, val]);
          return b;
        },
      });
      return b;
    },
  },
}));

import LeavePlanningHints from './LeavePlanningHints';

const today = new Date(2026, 9, 17); // Sat 17 Oct 2026

beforeEach(() => {
  state.eqCalls = [];
  state.tables = {
    holidays: [
      { name: 'Mashujaa Day', date: '2019-10-20', recurring: true },
      { name: 'Jamhuri Day', date: '2019-12-12', recurring: true },
      { name: 'Christmas Day', date: '2019-12-25', recurring: true },
      { name: 'Boxing Day', date: '2019-12-26', recurring: true },
    ],
    company_events: [
      { id: 'e1', title: 'Town hall', date: '2026-10-22', description: null },
      { id: 'e2', title: 'Far away', date: '2026-11-20', description: null },
    ],
    tasks: [
      { id: 't1', key: 'OPS-1', title: 'Stock count', status: 'todo', due_date: '2026-10-21', assignee_number: 'E1', is_group: false },
      { id: 't2', key: 'OPS-2', title: 'Payroll inputs', status: 'in_review', due_date: '2026-10-23', assignee_number: 'E1', is_group: false },
      { id: 't3', key: 'OPS-3', title: 'Already done', status: 'done', due_date: '2026-10-22', assignee_number: 'E1', is_group: false },
    ],
  };
});
afterEach(cleanup);

describe('LeavePlanningHints', () => {
  it('shows the next public holidays before any dates are picked, with a link to the calendar', async () => {
    const onSeeCalendar = vi.fn();
    render(<LeavePlanningHints employeeNumber="E1" startDate="" endDate="" today={today} onSeeCalendar={onSeeCalendar} />);
    const next = await screen.findByTestId('next-holidays');
    expect(next.textContent).toContain('Mashujaa Day (Tue 20 Oct, in 3 days)');
    expect(next.textContent).toContain('Jamhuri Day');
    expect(next.textContent).toContain('Christmas Day');
    expect(next.textContent).not.toContain('Boxing Day');
    expect(screen.queryByTestId('leave-hints')).toBeNull();
    fireEvent.click(within(next).getByRole('button', { name: 'See calendar' }));
    expect(onSeeCalendar).toHaveBeenCalled();
  });

  it('names the holidays, events and my tasks in the chosen dates, without blocking anything', async () => {
    render(<LeavePlanningHints employeeNumber="E1" startDate="2026-10-20" endDate="2026-10-23" today={today} onSeeCalendar={vi.fn()} />);
    const hints = await screen.findByTestId('leave-hints');
    expect(await within(hints).findByText('2 of your tasks are due during this leave:')).toBeTruthy();
    expect(hints.textContent).toContain('Mashujaa Day (Tue 20 Oct) is a public holiday, not counted');
    expect(hints.textContent).toContain('Town hall on Thu 22 Oct during your leave');
    expect(hints.textContent).toContain('OPS-1 Stock count (due Wed 21 Oct)');
    expect(hints.textContent).toContain('OPS-2 Payroll inputs (due Fri 23 Oct)');
    expect(hints.textContent).not.toContain('Already done');
    expect(hints.textContent).not.toContain('Far away');
    expect(within(hints).getByRole('button', { name: 'See calendar' })).toBeTruthy();
    expect(state.eqCalls).toContainEqual(['tasks', 'assignee_number', 'E1']);
  });

  it('mentions a holiday the day after the leave ends', async () => {
    render(<LeavePlanningHints employeeNumber="E1" startDate="2026-10-19" endDate="2026-10-19" today={today} />);
    const hints = await screen.findByTestId('leave-hints');
    expect(hints.textContent).toContain('Mashujaa Day (Tue 20 Oct) is a public holiday the day after your leave ends');
  });

  it('says nothing about the dates when nothing falls near them', async () => {
    render(<LeavePlanningHints employeeNumber="E1" startDate="2026-11-02" endDate="2026-11-03" today={today} />);
    await screen.findByTestId('next-holidays');
    expect(screen.queryByTestId('leave-hints')).toBeNull();
  });
});
