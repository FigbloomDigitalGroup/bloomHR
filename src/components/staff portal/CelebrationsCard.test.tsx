import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  people: [] as Record<string, string | null>[],
  tables: {} as Record<string, unknown[]>,
  myEmail: 'me@farm.co.ke',
  startDirectMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const data = table === 'employee_directory' ? state.people : state.tables[table] || [];
        // awaited as is, or read a page at a time
        return Object.assign(Promise.resolve({ data }), {
          order: () => ({ range: (from: number, to: number) => Promise.resolve({ data: data.slice(from, to + 1), error: null }) }),
        });
      },
    }),
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u-me', email: state.myEmail } } } }) },
  },
}));
vi.mock('../chat/services/chatServices', () => ({
  chatService: {
    startDirectMessage: (...a: unknown[]) => state.startDirectMessage(...a),
    sendMessage: (...a: unknown[]) => state.sendMessage(...a),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import CelebrationsCard from './CelebrationsCard';

const todayDob = () => {
  const t = new Date();
  return `1990-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

afterEach(cleanup);

describe('CelebrationsCard', () => {
  it("prompts a wish for a colleague's birthday today and sends it as a direct message", async () => {
    state.people = [{ 'First Name': 'Amina', 'Last Name': 'Hassan', 'Date of Birth': todayDob(), 'Work Email': 'amina@farm.co.ke' }];
    state.startDirectMessage.mockResolvedValue('dm-1');
    state.sendMessage.mockResolvedValue({ id: 'm1' });
    render(<CelebrationsCard />);

    expect(await screen.findByText(/birthday today/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send wishes' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Happy birthday, Amina!');
    fireEvent.click(screen.getByRole('button', { name: /Send$/ }));

    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledWith('dm-1', 'u-me', expect.stringContaining('Happy birthday, Amina!')));
    expect(state.startDirectMessage).toHaveBeenCalledWith('amina@farm.co.ke');
    expect(await screen.findByText(/Wish sent/)).toBeTruthy();
  });

  it('wishes you a happy birthday on your own birthday, with no prompt to message yourself', async () => {
    state.people = [{ 'First Name': 'Me', 'Last Name': 'Myself', 'Date of Birth': todayDob(), 'Work Email': 'ME@farm.co.ke' }];
    render(<CelebrationsCard />);
    expect(await screen.findByText(/Happy birthday, Me!/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send wishes' })).toBeNull();
  });

  it('looks 60 days ahead and links to the calendar', async () => {
    const inDays = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    state.people = [];
    state.tables = {
      company_events: [
        { title: 'Year-end party', date: inDays(45), description: 'At the farm' },
        { title: 'Too far', date: inDays(75), description: null },
      ],
    };
    const onViewCalendar = vi.fn();
    render(<CelebrationsCard onViewCalendar={onViewCalendar} />);
    expect(await screen.findByText('Year-end party')).toBeTruthy();
    expect(screen.queryByText('Too far')).toBeNull();
    expect(screen.getByText('The next 60 days at your company')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View calendar →' }));
    expect(onViewCalendar).toHaveBeenCalled();
    state.tables = {};
  });
});
