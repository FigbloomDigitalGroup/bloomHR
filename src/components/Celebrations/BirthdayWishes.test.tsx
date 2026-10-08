import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  people: [] as Record<string, string | null>[],
  startDirectMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => Promise.resolve({ data: state.people }) }),
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u-admin', email: 'admin@farm.co.ke' } } } }) },
  },
}));
vi.mock('../chat/services/chatServices', () => ({
  chatService: {
    startDirectMessage: (...a: unknown[]) => state.startDirectMessage(...a),
    sendMessage: (...a: unknown[]) => state.sendMessage(...a),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { TodaysBirthdayWishes } from './BirthdayWishes';

const dob = (offsetDays: number) => {
  const t = new Date();
  t.setDate(t.getDate() + offsetDays);
  return `1990-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

afterEach(cleanup);

describe('TodaysBirthdayWishes (admin dashboard)', () => {
  it("lets an admin send a wish for today's birthday", async () => {
    state.people = [
      { 'First Name': 'Amina', 'Last Name': 'Hassan', 'Date of Birth': dob(0), 'Work Email': 'amina@farm.co.ke' },
      { 'First Name': 'Brian', 'Last Name': 'Rotich', 'Date of Birth': dob(3), 'Work Email': 'brian@farm.co.ke' },
    ];
    state.startDirectMessage.mockResolvedValue('dm-9');
    state.sendMessage.mockResolvedValue({ id: 'm' });
    render(<TodaysBirthdayWishes />);

    expect(await screen.findByText(/birthday today/)).toBeTruthy();
    expect(screen.queryByText(/Brian/)).toBeNull(); // only today's
    fireEvent.click(screen.getByRole('button', { name: 'Send wishes' }));
    fireEvent.click(screen.getByRole('button', { name: /Send$/ }));
    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledWith('dm-9', 'u-admin', expect.stringContaining('Amina')));
  });

  it('shows nothing when nobody has a birthday today', async () => {
    state.people = [{ 'First Name': 'Brian', 'Last Name': 'Rotich', 'Date of Birth': dob(3), 'Work Email': 'brian@farm.co.ke' }];
    const { container } = render(<TodaysBirthdayWishes />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
});
