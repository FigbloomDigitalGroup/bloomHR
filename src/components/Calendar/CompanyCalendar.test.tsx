import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { format } from 'date-fns';

// an event on the 15th of the month being viewed
const fx = vi.hoisted(() => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return {
    day: new Date(now.getFullYear(), now.getMonth(), 15, 12),
    isoDate: `${now.getFullYear()}-${month}-15T12:00:00`,
  };
});
const eventDay = fx.day;

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/fetchAll', () => ({ fetchAllResult: vi.fn().mockResolvedValue({ data: [], error: null }) }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const data =
          table === 'company_events'
            ? [{ id: 'e1', title: 'Town hall', date: fx.isoDate, description: null }]
            : [];
        const result = Promise.resolve({ data, error: null });
        return Object.assign(result, { order: () => result });
      },
    }),
  },
}));

import CompanyCalendar from './CompanyCalendar';

afterEach(cleanup);

const show = () => render(<MemoryRouter><CompanyCalendar /></MemoryRouter>);

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
