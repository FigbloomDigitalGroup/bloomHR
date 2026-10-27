import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import UserProfileDropdown from './UserProfile';

afterEach(() => cleanup());

describe('UserProfileDropdown', () => {
  it('the desktop header menu floats below the button instead of pushing the header taller', () => {
    render(<MemoryRouter><UserProfileDropdown onPasswordReset={vi.fn()} userName="Michael Mwaura" setActiveTab={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Michael Mwaura/ }));
    const menu = screen.getByText('Sign out').closest('div') as HTMLElement;
    expect(menu.className).toContain('absolute');
    expect(menu.className).toContain('top-full');
    expect(screen.getByText('My Profile')).toBeTruthy();
  });
});
