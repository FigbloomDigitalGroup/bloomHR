import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ links: [] as { source: string; linked_at: string }[], unlink: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/platformHandoff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformHandoff')>()),
  loadMyExternalLogins: () => Promise.resolve(api.links),
  handoffApi: { unlink: api.unlink },
}));

import ConnectedAccounts from './ConnectedAccounts';

afterEach(() => cleanup());

describe('ConnectedAccounts: the Schools account connected to this HR login', () => {
  it('shows nothing when none is connected', async () => {
    api.links = [];
    const { container } = render(<ConnectedAccounts />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });

  it('shows the connected Schools account, and removes it', async () => {
    api.links = [{ source: 'schools', linked_at: '2026-11-06T09:00:00Z' }];
    api.unlink.mockResolvedValue({ ok: true, removed: 1 });
    render(<ConnectedAccounts />);
    expect(await screen.findByText('Figbloom Schools')).toBeTruthy();
    expect(screen.getByText(/connected 6 Nov 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.unlink).toHaveBeenCalledWith('schools'));
    await waitFor(() => expect(screen.queryByText('Figbloom Schools')).toBeNull());
  });
});
