import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({ session: null as unknown, loading: true }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));

import { ProtectedRoute } from './ProtectedRoute';

afterEach(() => cleanup());

describe('ProtectedRoute', () => {
  it('shows the Figbloom logo loader while the session is checked', () => {
    render(
      <MemoryRouter>
        <ProtectedRoute><div>the page</div></ProtectedRoute>
      </MemoryRouter>
    );
    expect(screen.queryByText('the page')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading' }).querySelector('.fb-arc')).toBeTruthy();
  });

  it('shows the page once someone is signed in', () => {
    auth.loading = false;
    auth.session = { user: { id: 'u1' } };
    render(
      <MemoryRouter>
        <ProtectedRoute><div>the page</div></ProtectedRoute>
      </MemoryRouter>
    );
    expect(screen.getByText('the page')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
