import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  avatar: null as string | null,
  upload: vi.fn(),
  save: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1', email: 'admin@acme.co' } } }) },
    storage: { from: () => ({ remove: () => Promise.resolve({ error: null }) }) },
  },
}));
vi.mock('../../lib/avatarStorage', () => ({ uploadUserAvatar: mocks.upload }));
vi.mock('../../lib/preferences', () => ({
  fetchMyPreferences: () => Promise.resolve({ theme: null, avatarUrl: mocks.avatar }),
  saveMyAvatar: mocks.save,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ProfilePicture from './ProfilePicture';
import toast from 'react-hot-toast';

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProfilePicture />
    </QueryClientProvider>
  );

beforeEach(() => {
  mocks.avatar = null;
  mocks.upload.mockReset().mockResolvedValue('https://files/u1.png?v=1');
  mocks.save.mockReset().mockResolvedValue(true);
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

describe('ProfilePicture', () => {
  it('shows the initial until a picture is set, then uploads and saves it on the account', async () => {
    renderIt();
    await screen.findByText('A');
    const input = screen.getByLabelText('Choose a profile picture');
    fireEvent.change(input, { target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] } });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('https://files/u1.png?v=1'));
  });

  it('refuses files that are not images', async () => {
    renderIt();
    await screen.findByText('A');
    fireEvent.change(screen.getByLabelText('Choose a profile picture'), { target: { files: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })] } });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('shows the current picture and can remove it', async () => {
    mocks.avatar = 'https://files/employeeavatar/t1/user_avatars/u1.png?v=1';
    renderIt();
    await screen.findByAltText('Your profile');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(null));
  });
});
