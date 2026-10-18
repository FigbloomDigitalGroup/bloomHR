import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const perms = vi.hoisted(() => ({ role: 'MANAGER', granted: [] as string[], loading: false }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (m: string) => perms.role === 'ADMIN' || perms.granted.includes(m),
    hasAnyPermission: (ms: string[]) => perms.role === 'ADMIN' || ms.some((m) => perms.granted.includes(m)),
    hasAllPermissions: (ms: string[]) => perms.role === 'ADMIN' || ms.every((m) => perms.granted.includes(m)),
    loading: perms.loading,
  }),
}));
vi.mock('../UI/FigbloomLoader', () => ({ default: () => <div>Loading</div> }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { ScreenGate } from './AuthRoute';
import ModuleGate from './ModuleGate';

afterEach(() => {
  cleanup();
  perms.role = 'MANAGER';
  perms.granted = [];
  perms.loading = false;
});

const gate = (path: string) =>
  render(
    <MemoryRouter>
      <ScreenGate screen={path}>
        <p>the page</p>
      </ScreenGate>
    </MemoryRouter>
  );

describe('a screen opens by the modules of the role, not its name', () => {
  it('opens for a role holding one of its modules', () => {
    perms.granted = ['payroll'];
    gate('/payroll');
    expect(screen.getByText('the page')).toBeTruthy();
  });

  it('says so, instead of sending them elsewhere, when the role lacks it', () => {
    perms.granted = ['employees'];
    gate('/payroll');
    expect(screen.queryByText('the page')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('have access to this page');
  });

  it('administrators open everything', () => {
    perms.role = 'ADMIN';
    gate('/role-permissions');
    expect(screen.getByText('the page')).toBeTruthy();
  });

  it('waits for the permissions before deciding', () => {
    perms.loading = true;
    gate('/payroll');
    expect(screen.getByText('Loading')).toBeTruthy();
  });

  it('screens open to everyone in the admin app open without a module', () => {
    gate('/settings/company');
    expect(screen.getByText('the page')).toBeTruthy();
  });
});

describe('ModuleGate', () => {
  it('shows with any of anyOf and all of allOf', () => {
    perms.granted = ['hr-admin'];
    render(
      <>
        <ModuleGate anyOf={['hr-admin', 'payroll']}>any</ModuleGate>
        <ModuleGate allOf={['hr-admin', 'payroll']}>both</ModuleGate>
      </>
    );
    expect(screen.queryByText('any')).toBeTruthy();
    expect(screen.queryByText('both')).toBeNull();
  });

  it('shows nothing while loading', () => {
    perms.loading = true;
    perms.role = 'ADMIN';
    render(<ModuleGate anyOf={['payroll']}>x</ModuleGate>);
    expect(screen.queryByText('x')).toBeNull();
  });
});
