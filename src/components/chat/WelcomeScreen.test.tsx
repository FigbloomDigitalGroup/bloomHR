import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../lib/supabase', () => ({ supabase: { auth: { onAuthStateChange: vi.fn() } } }));
vi.mock('./services/chatServices', () => ({ chatService: {} }));

import { SidebarProvider } from './ui/sidebar';
import { WelcomeScreen } from './ChatLayout';
import type { User } from './types/types';

// jsdom has no matchMedia; the sidebar asks it whether this is a phone
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe('chat WelcomeScreen', () => {
  it('has a button to open the channel list, which is a slide-in sheet on phones', () => {
    const user = { id: 'u1', name: 'Amina Wanjiru', initials: 'AW' } as unknown as User;
    render(
      <SidebarProvider>
        <WelcomeScreen currentUser={user} onCreateChannel={vi.fn()} />
      </SidebarProvider>
    );
    expect(screen.getByRole('button', { name: 'Toggle Sidebar' })).toBeTruthy();
    expect(screen.getByText('Welcome to Figbloom Teams')).toBeTruthy();
  });
});
