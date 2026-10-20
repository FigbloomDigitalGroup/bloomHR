import { describe, expect, it } from 'vitest';
import { holdsModule, previewRole, whatWouldShow } from './rolePreview';
import { inMenu } from './routeModules';
import { SIDEBAR_MENU } from './sidebarMenu';

const shownLabels = (base: string, modules: string[]) => previewRole(base, modules).areas.flatMap((a) => a.shown.map((e) => e.label));
const hiddenLabels = (base: string, modules: string[]) => previewRole(base, modules).areas.flatMap((a) => a.hidden.map((e) => e.label));

describe('previewRole', () => {
  it('an administrator sees every menu entry, whatever is ticked', () => {
    const p = previewRole('ADMIN', []);
    expect(p.workspace).toBe('admin');
    expect(hiddenLabels('ADMIN', [])).toEqual([]);
    expect(shownLabels('ADMIN', [])).toContain('Payroll');
    expect(shownLabels('ADMIN', [])).toContain('Role Permissions');
    // Expenses is switched off for every company, so it is not listed at all
    expect(shownLabels('ADMIN', [])).not.toContain('Expenses');
  });

  it('matches the sidebar rule (inMenu) entry by entry', () => {
    const modules = ['dashboard', 'employees', 'leaves', 'payroll'];
    const has = holdsModule('HR', modules);
    const p = previewRole('HR', modules);
    for (const group of SIDEBAR_MENU) {
      const area = p.areas.find((a) => a.title === group.title);
      for (const item of group.items) {
        if (item.path === '/expenses') continue;
        const shown = !!area?.shown.some((e) => e.path === item.path);
        expect(shown, item.path).toBe(inMenu(item.path, has));
      }
    }
  });

  it('groups by the sidebar areas and says what would show a hidden screen', () => {
    const p = previewRole('MANAGER', ['dashboard']);
    expect(p.areas.map((a) => a.title)).toEqual(['Overview', 'Workspace', 'Team', 'Finance', 'System']);
    const finance = p.areas.find((a) => a.title === 'Finance')!;
    expect(finance.hidden.find((e) => e.label === 'Payroll')?.needs).toBe('Tick Payroll');
    const system = p.areas.find((a) => a.title === 'System')!;
    expect(system.hidden.find((e) => e.label === 'Settings')?.needs).toBe('Only for roles based on Administrator');
    // the company chart is open to everyone in the admin app
    expect(p.areas.find((a) => a.title === 'Team')!.shown.map((e) => e.label)).toContain('Organogram');
  });

  it('follows the ticks: ticking a module shows its screens', () => {
    expect(shownLabels('HR', [])).not.toContain('Payroll');
    expect(shownLabels('HR', ['payroll'])).toContain('Payroll');
    expect(shownLabels('HR', ['payroll'])).toContain('Job groups');
  });

  it('never shows what the base role may not hold, even when ticked', () => {
    expect(shownLabels('HR', ['settings', 'role-permissions'])).not.toContain('Settings');
    expect(shownLabels('HR', ['settings', 'role-permissions'])).not.toContain('Role Permissions');
  });

  it('lists screens they may open that are not in their menu', () => {
    // approving exits opens HR Lifecycle, whose menu entry stays with the HR Lifecycle module
    const p = previewRole('HR', ['approve-exits']);
    expect(hiddenLabels('HR', ['approve-exits'])).toContain('HR Lifecycle');
    expect(p.alsoOpens.map((e) => e.label)).toContain('HR Lifecycle');
    expect(p.alsoOpens.map((e) => e.label)).toContain('Company profile');
  });

  it('a role based on Staff gets the staff portal, with the task extras its modules add', () => {
    const p = previewRole('STAFF', ['task-projects', 'payroll']);
    expect(p.workspace).toBe('portal');
    expect(p.alsoOpens).toEqual([]);
    const labels = p.areas.flatMap((a) => a.shown.map((e) => e.label));
    expect(labels).toContain('Payslips');
    expect(labels).toContain('Leave: Apply for Leave');
    expect(labels).toContain('Tasks: Manage projects (create projects, assign tasks to teams)');
    expect(labels).not.toContain('Payroll');
    const work = p.areas.find((a) => a.title === 'Work & Development')!;
    expect(work.hidden.map((e) => e.label)).toEqual(['Tasks: See every task, read-only']);
    expect(p.areas.find((a) => a.title === 'My team')!.shown[0].when).toMatch(/supervises/);
  });

  it('says why a screen is out of reach for a Staff-based role', () => {
    expect(whatWouldShow('STAFF', ['payroll'])).toBe('Not for roles based on Staff');
    expect(whatWouldShow('STAFF', ['payroll', 'work-records'])).toBe('Tick Work & Piece Rate');
    expect(whatWouldShow('HR', ['payroll', 'loans'])).toBe('Tick Payroll or Staff loans');
  });
});
