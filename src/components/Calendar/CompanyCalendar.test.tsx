import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { format } from 'date-fns';

// an event on the 15th of the month being viewed
const fx = vi.hoisted(() => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const ymd = (offset: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return {
    day: new Date(now.getFullYear(), now.getMonth(), 15, 12),
    isoDate: `${now.getFullYear()}-${month}-15T12:00:00`,
    ymd,
  };
});
const eventDay = fx.day;

const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, me: null as string | null }));

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/fetchAll', () => ({ fetchAllResult: vi.fn().mockResolvedValue({ data: [], error: null }) }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const result = Promise.resolve({ data: state.tables[table] || [], error: null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = Object.assign(result, { select: () => b, order: () => b, eq: () => b, range: () => result });
      return b;
    },
    rpc: (name: string) => Promise.resolve({ data: name === 'current_employee_number' ? state.me : null, error: null }),
  },
}));

import CompanyCalendar from './CompanyCalendar';
import { fetchAllResult } from '../../lib/fetchAll';

beforeEach(() => {
  state.tables = { company_events: [{ id: 'e1', title: 'Town hall', date: fx.isoDate, description: null }] };
  state.me = null;
});
afterEach(cleanup);

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

const show = () =>
  render(
    <MemoryRouter initialEntries={['/calendar']}>
      <Routes>
        <Route path="/calendar" element={<CompanyCalendar />} />
        <Route path="/tasks" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );

describe('CompanyCalendar on phones', () => {
  it("lists the month's entries under the grid, and just the tapped day's when one is picked", async () => {
    show();
    const list = screen.getByTestId('calendar-phone-list');
    expect(await within(list).findByText('Town hall')).toBeTruthy();
    expect(within(list).getByText('This month')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: format(eventDay, 'd MMMM yyyy') }));
    expect(within(list).getByText(format(eventDay, 'EEEE d MMMM'))).toBeTruthy();
    expect(within(list).getByText('Town hall')).toBeTruthy();

    // a day with nothing on it
    const otherDay = new Date(eventDay.getFullYear(), eventDay.getMonth(), 16);
    fireEvent.click(screen.getByRole('button', { name: format(otherDay, 'd MMMM yyyy') }));
    expect(within(list).getByText('Nothing on this day.')).toBeTruthy();

    fireEvent.click(within(list).getByRole('button', { name: 'Show whole month' }));
    expect(within(list).getByText('Town hall')).toBeTruthy();
  });

  it('opens the new event form in a dialog that closes on Escape', async () => {
    show();
    await within(screen.getByTestId('calendar-phone-list')).findByText('Town hall');
    fireEvent.click(screen.getByRole('button', { name: /New Event/ }));
    expect(screen.getByRole('dialog', { name: 'New Company Event' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Coming up', () => {
  beforeEach(() => {
    state.me = 'E-ADMIN';
    state.tables = {
      company_events: [
        { id: 'e1', title: 'Town hall', date: fx.ymd(5), description: 'Bring questions' },
        { id: 'e2', title: 'Year planning', date: fx.ymd(45), description: null },
        { id: 'e3', title: 'Old party', date: fx.ymd(-5), description: null },
      ],
      holidays: [{ name: 'Founders Day', date: fx.ymd(10), recurring: false }],
      tasks: [
        { id: 't-late', key: 'OPS-1', title: 'Late report', status: 'todo', due_date: fx.ymd(-3), assignee_number: 'E-ADMIN', is_group: false },
        { id: 't-soon', key: 'OPS-2', title: 'Stock count', status: 'in_progress', due_date: fx.ymd(2), assignee_number: 'E-ADMIN', is_group: false },
        { id: 't-done', key: 'OPS-3', title: 'Finished', status: 'done', due_date: fx.ymd(3), assignee_number: 'E-ADMIN', is_group: false },
      ],
    };
  });

  it('lists events, holidays and my open tasks, overdue first, with the day and how far off', async () => {
    show();
    const panel = screen.getByTestId('coming-up');
    await within(panel).findByText('Town hall');
    const rows = within(panel).getAllByTestId('coming-up-row').map((r) => r.textContent || '');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('Late report');
    expect(rows[0]).toContain('Overdue by 3 days');
    expect(rows[1]).toContain('Stock count');
    expect(rows[1]).toContain('Due in 2 days');
    expect(rows[2]).toContain('Town hall');
    expect(rows[2]).toContain('in 5 days');
    expect(rows[2]).toContain('Bring questions');
    expect(rows[3]).toContain('Founders Day');
    expect(rows[3]).toContain('office closed, not counted as leave');
    expect(rows[4]).toContain('Year planning');
    expect(within(panel).queryByText('Finished')).toBeNull();
    expect(within(panel).queryByText('Old party')).toBeNull();
    expect(within(panel).getByText('1 of your tasks is overdue')).toBeTruthy();

    // a shorter range leaves out what is further off
    fireEvent.click(within(panel).getByRole('button', { name: '30 days' }));
    expect(within(panel).queryByText('Year planning')).toBeNull();
  });

  it('moves the calendar to the month of a row and marks the day', async () => {
    show();
    const panel = screen.getByTestId('coming-up');
    fireEvent.click(await within(panel).findByText('Year planning'));
    const day = new Date();
    day.setDate(day.getDate() + 45);
    expect(screen.getByText(format(day, 'MMMM yyyy'))).toBeTruthy();
    const cell = document.querySelector(`[data-day="${format(day, 'yyyy-MM-dd')}"]`);
    expect(cell?.getAttribute('data-selected')).toBe('true');
  });

  it('shows or hides each kind with the filter', async () => {
    show();
    const panel = screen.getByTestId('coming-up');
    await within(panel).findByText('Stock count');
    const filters = screen.getByTestId('calendar-filters');
    // no leave chip on the admin calendar (no employee given)
    expect(within(filters).queryByRole('button', { name: 'My leave' })).toBeNull();

    fireEvent.click(within(filters).getByRole('button', { name: 'My tasks' }));
    expect(within(filters).getByRole('button', { name: 'My tasks' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(panel).queryByText('Stock count')).toBeNull();
    expect(within(panel).queryByText('Late report')).toBeNull();
    expect(within(panel).getByText('Town hall')).toBeTruthy();

    fireEvent.click(within(filters).getByRole('button', { name: 'Holidays' }));
    expect(within(panel).queryByText('Founders Day')).toBeNull();
    fireEvent.click(within(filters).getByRole('button', { name: 'My tasks' }));
    expect(within(panel).getByText('Stock count')).toBeTruthy();
  });

  it('opens one of my tasks on the admin Tasks page', async () => {
    show();
    const panel = screen.getByTestId('coming-up');
    fireEvent.click(await within(panel).findByRole('button', { name: 'Open task Stock count' }));
    expect(screen.getByTestId('where').textContent).toBe('/tasks?task=t-soon');
  });
});

describe('birthdays on the calendar', () => {
  it("shows a colleague's birthday from its day and month alone (the directory never gives the year)", async () => {
    const mm = String(eventDay.getMonth() + 1).padStart(2, '0');
    vi.mocked(fetchAllResult).mockResolvedValueOnce({
      data: [
        { 'First Name': 'Amina', 'Last Name': 'Hassan', birthday: `${mm}-15`, Town: null },
        // the old full date is no longer read from the directory
        { 'First Name': 'Old', 'Last Name': 'Column', 'Date of Birth': `1990-${mm}-15`, birthday: null, Town: null },
      ],
      error: null,
    } as never);
    show();
    const list = screen.getByTestId('calendar-phone-list');
    await within(list).findByText('Town hall');
    fireEvent.click(screen.getByRole('button', { name: format(eventDay, 'd MMMM yyyy') }));
    expect(await within(list).findByText('Amina Hassan')).toBeTruthy();
    expect(within(list).queryByText('Old Column')).toBeNull();
  });
});
