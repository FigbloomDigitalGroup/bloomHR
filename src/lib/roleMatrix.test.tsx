// What each role sees, before and after the screens moved from role names to modules (FIG-827).
//
// __fixtures__/roleMatrix.before.json was captured from the code BEFORE the change: the real Sidebar rendered for each
// of the seven system roles with their default modules (including its `orRoles` exceptions), and the routes each role
// could open by App.tsx's `allowedRoles` (a route without `allowedRoles` opened for every role of the admin app).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import before from './__fixtures__/roleMatrix.before.json';
import { DEFAULT_ROLE_MODULES, DEFAULT_ROLE_MODULES_AFTER } from './__fixtures__/defaultRoleModules';
import { SCREENS, canOpenScreen, inMenu, screenFor, usesStaffPortal } from './routeModules';
import { MODULE_IDS } from './modules';

const perms = vi.hoisted(() => ({ role: 'ADMIN', granted: [] as string[] }));
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (p: string) => perms.role === 'ADMIN' || perms.granted.includes(p),
    hasAnyPermission: (ps: string[]) => perms.role === 'ADMIN' || ps.some((p) => perms.granted.includes(p)),
    loading: false,
    userRole: perms.role,
    roleName: null,
  }),
}));
vi.mock('../hooks/useMyPreferences', () => ({ useMyPreferences: () => ({ data: null }) }));
vi.mock('./supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'ilike', 'is', 'in', 'order', 'range']) chain[m] = () => chain;
  chain.single = () => Promise.resolve({ data: null, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], count: 0, error: null });
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: () => chain, channel: () => channel, removeChannel: () => {} } };
});

import Sidebar from '../components/Layout/Sidebar';

afterEach(cleanup);

type Before = {
  routes: { path: string; allowed: string[] | null }[];
  roles: Record<string, { sidebar: string[]; routes: string[]; portal: string }>;
};
const B = before as Before;
const ROLES = Object.keys(B.roles);
const norm = (p: string) => (p.startsWith('/') ? p : `/${p}`);
const hasFor = (role: string, modules: string[]) => (m: string) => role === 'ADMIN' || modules.includes(m);

/** The sidebar entries the real Sidebar shows for a role holding these modules. */
function sidebarFor(role: string, modules: string[]) {
  perms.role = role;
  perms.granted = modules;
  const { container } = render(
    <MemoryRouter initialEntries={['/x']}>
      <Sidebar user={{ email: 'a@b.co', role }} isCollapsed={false} onToggle={() => {}} />
    </MemoryRouter>
  );
  const labels = [...container.querySelectorAll('#app-sidebar button')]
    .map((b) => b.textContent?.trim() ?? '')
    .filter((t) => t && !['Settings', 'Log out'].includes(t));
  cleanup();
  return labels;
}

const routesFor = (role: string, modules: string[]) =>
  usesStaffPortal(role)
    ? []
    : B.routes.map((r) => norm(r.path)).filter((p) => p !== '/*' && p !== '/expenses' && canOpenScreen(p, hasFor(role, modules)));

// Routes that had `allowedRoles` and whose module never matched it: the menu already followed the module, the route
// let more (or fewer) roles in by typing the address. Now both follow the module.
const GUARDED_CHANGES: Record<string, { gained: string[]; lost: string[] }> = {
  // "/" redirected Regional managers and Operations to a page that did not exist; now it is their dashboard
  '/': { gained: ['REGIONAL', 'OPERATIONS'], lost: [] },
  // Operations do not have Email Admin (their menu never showed it); the address no longer opens it either
  '/adminconfirm': { gained: [], lost: ['OPERATIONS'] },
  // HR keeps it (Approve exits: they approve exits there); Checker and Manager never had it in the menu
  '/hr-lifecycle': { gained: [], lost: ['CHECKER', 'MANAGER'] },
};

describe('the seven system roles see the same screens as before', () => {
  it.each(ROLES)('%s: the same sidebar entries, in the same order', (role) => {
    const after = usesStaffPortal(role) ? [] : sidebarFor(role, DEFAULT_ROLE_MODULES_AFTER[role]);
    expect(after).toEqual(B.roles[role].sidebar);
  });

  it.each(ROLES)('%s: the guarded routes open for the same roles (except the listed fixes)', (role) => {
    if (usesStaffPortal(role)) return expect(B.roles[role].portal).toBe('staff');
    const after = new Set(routesFor(role, DEFAULT_ROLE_MODULES_AFTER[role]));
    const beforeSet = new Set(B.roles[role].routes.map(norm));
    for (const r of B.routes.filter((x) => x.allowed)) {
      const p = norm(r.path);
      const change = GUARDED_CHANGES[p];
      const expected = change?.gained.includes(role) ? true : change?.lost.includes(role) ? false : beforeSet.has(p);
      expect([p, after.has(p)]).toEqual([p, expected]);
    }
  });

  it.each(ROLES)('%s: a route that had no guard still opens wherever its menu entry was shown, and nothing new opens', (role) => {
    if (usesStaffPortal(role)) return;
    const after = new Set(routesFor(role, DEFAULT_ROLE_MODULES_AFTER[role]));
    const beforeSet = new Set(B.roles[role].routes.map(norm));
    const beforeMenu = new Set(B.roles[role].sidebar);
    for (const r of B.routes.filter((x) => !x.allowed && x.path !== '*' && x.path !== '/expenses')) {
      const p = norm(r.path);
      expect([p, beforeSet.has(p)]).toEqual([p, true]);
      const screen = screenFor(p)!;
      if (beforeMenu.has(screen.label)) expect([p, after.has(p)]).toEqual([p, true]);
    }
    for (const p of after) if (!GUARDED_CHANGES[p]) expect([p, beforeSet.has(p)]).toEqual([p, true]);
  });

  it('the unguarded routes now closed are exactly those the role had no menu entry or module for', () => {
    const closed = Object.fromEntries(
      ROLES.filter((r) => !usesStaffPortal(r)).map((role) => {
        const after = new Set(routesFor(role, DEFAULT_ROLE_MODULES_AFTER[role]));
        return [role, B.routes.filter((x) => !x.allowed && x.path !== '*' && x.path !== '/expenses').map((x) => norm(x.path)).filter((p) => !after.has(p))];
      })
    );
    // typing the address of a screen that was never in your menu (and that your role has no module for) no longer opens it
    expect(closed).toEqual({
      ADMIN: [],
      HR: ['/asset', '/asset/scan', '/settings/audit-trail', '/piece-rate', '/setup-assistant', '/mpesa-zap', '/role-permissions'],
      CHECKER: ['/assign-managers', '/asset', '/asset/scan', '/sms', '/performance', '/leaves', '/role-permissions'],
      MANAGER: ['/assign-managers', '/loanadmin', '/asset', '/asset/scan', '/staffcheck', '/settings/audit-trail', '/loans', '/training', '/setup-assistant', '/mpesa-zap', '/role-permissions'],
      REGIONAL: ['/assign-managers', '/loanadmin', '/asset', '/asset/scan', '/sms', '/staffcheck', '/settings/audit-trail', '/piece-rate', '/overtime', '/loans', '/training', '/setup-assistant', '/mpesa-zap', '/role-permissions'],
      OPERATIONS: ['/assign-managers', '/loanadmin', '/asset', '/asset/scan', '/settings/audit-trail', '/piece-rate', '/overtime', '/loans', '/performance', '/setup-assistant', '/mpesa-zap', '/role-permissions'],
    });
  });

  it('every screen in the menu is in the route list, and every module a screen names exists', () => {
    for (const s of SCREENS) for (const m of s.modules) expect([s.path, MODULE_IDS.includes(m)]).toEqual([s.path, true]);
  });

  it('the default modules before are those of the reference data', () => {
    expect(Object.keys(DEFAULT_ROLE_MODULES)).toEqual(ROLES);
  });
});

describe('custom roles follow their ticks', () => {
  it('a Manager-based "Payroll clerk" with only Payroll sees the payroll screens and nothing else it is not ticked for', () => {
    const modules = ['payroll'];
    const menu = sidebarFor('MANAGER', modules);
    // payroll, and the pay screens that open with it; Organogram and Appearance open for everyone in the admin app
    expect(menu).toEqual(['Organogram', 'Payroll', 'Casual workers', 'Piece rate & jobs', 'Overtime', 'Job groups', 'Loans', 'Appearance']);
    const has = hasFor('MANAGER', modules);
    expect(canOpenScreen('/payroll', has)).toBe(true);
    for (const p of ['/dashboard', '/employees', '/leaves', '/settings', '/salaryadmin', '/recruitment', '/role-permissions', '/invite-people']) {
      expect([p, canOpenScreen(p, has)]).toEqual([p, false]);
    }
    // every screen it opens names payroll, or is open to everyone
    for (const s of SCREENS) if (canOpenScreen(s.path, has)) expect(s.modules.length === 0 || s.modules.includes('payroll')).toBe(true);
  });

  it('a Staff-based "Team lead" with Manage projects stays in the staff portal (no admin app)', () => {
    expect(usesStaffPortal('STAFF')).toBe(true);
    expect(routesFor('STAFF', ['dashboard', 'task-manager', 'teams', 'task-projects'])).toEqual([]);
    // (inside the portal, TaskWorkspace gives "Manage projects" holders the project controls: TaskWorkspace.test.tsx)
  });

  it('an Operations-based "Operations lead" given Payroll and Settings opens them; untick and they close', () => {
    const has = hasFor('OPERATIONS', [...DEFAULT_ROLE_MODULES_AFTER.OPERATIONS, 'payroll', 'settings']);
    expect(canOpenScreen('/payroll', has)).toBe(true);
    expect(canOpenScreen('/settings', has)).toBe(true);
    expect(inMenu('/settings/audit-trail', has)).toBe(true);
    const without = hasFor('OPERATIONS', DEFAULT_ROLE_MODULES_AFTER.OPERATIONS);
    expect(canOpenScreen('/payroll', without)).toBe(false);
  });

  it('HR Lifecycle opens for Approve exits holders but only shows in the menu with HR Lifecycle', () => {
    const has = hasFor('MANAGER', ['approve-exits']);
    expect(canOpenScreen('/hr-lifecycle', has)).toBe(true);
    expect(inMenu('/hr-lifecycle', has)).toBe(false);
    expect(inMenu('/hr-lifecycle', hasFor('MANAGER', ['hr-lifecycle']))).toBe(true);
  });

  it('a screen of a module switched off for every company is offered to nobody, administrators included', () => {
    expect(canOpenScreen('/expenses', () => true)).toBe(false);
    expect(inMenu('/expenses', () => true)).toBe(false);
  });
});
