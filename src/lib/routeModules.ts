import { isHiddenModule } from './hiddenModules';

// Who may open each screen of the admin app, and who sees it in the menu and the header search: by the modules of
// their role (FIG-827), never by the role's name. One list, used by the routes (App.tsx), the sidebar and the header
// search, so they cannot drift apart. Administrators hold every module, so they open everything.
//
// Staff (base role STAFF, and the company roles based on it) never get the admin app: they use the staff portal, where
// the extra modules a STAFF-based role holds show up (Manage projects, My team). That rule is on the base role, in
// App.tsx.
//
// The data behind each screen is still guarded by the database (row-level security on the same modules); this decides
// what is offered.

export interface ScreenAccess {
  /** as in App.tsx (":id" parts included) */
  path: string;
  /** what the screen is called in the menu and the search */
  label: string;
  /** any one of these opens it; empty: everyone in the admin app (see `open`) */
  modules: string[];
  /** why a screen is open to everyone in the admin app */
  open?: string;
  /**
   * who sees it in the menu, when narrower than who may open it (only where the menu always was narrower and the
   * screen is reached from elsewhere: a notification, a link)
   */
  menuModules?: string[];
  /** shown in the header search (screens reached only from another screen are not) */
  searchable?: boolean;
}

const S = (path: string, label: string, modules: string[], extra: Partial<ScreenAccess> = {}): ScreenAccess => ({
  path,
  label,
  modules,
  searchable: true,
  ...extra,
});
const sub = (path: string, label: string, modules: string[], extra: Partial<ScreenAccess> = {}) =>
  S(path, label, modules, { searchable: false, ...extra });

export const SCREENS: ScreenAccess[] = [
  // overview
  sub('/', 'Dashboard', ['dashboard']),
  S('/dashboard', 'Dashboard', ['dashboard']),
  S('/calendar', 'Calendar', ['dashboard']),
  S('/reports', 'Reports', ['reports']),
  // people numbers for reports or employees, the money tabs for payroll (FIG-905)
  S('/reports/group', 'Group report', ['reports', 'employees', 'payroll']),
  sub('/reports/base', 'Base report', ['reports']),
  sub('/reports/staffloan', 'Staff loan report', ['reports']),
  sub('/reports/statutory', 'Statutory deductions report', ['reports']),
  sub('/ai-assistant', 'AI assistant', ['ai-assistant']),

  // tasks and communication
  S('/tasks', 'Task Manager', ['task-manager']),
  S('/teams', 'Teams', ['teams']),
  S('/sms', 'SMS Center', ['sms']),
  S('/email-portal', 'Email Portal', ['email-portal']),

  // people
  S('/employees', 'Employees', ['employees']),
  sub('/add-employee', 'Add employee', ['employees']),
  sub('/employee-added', 'Employee added', ['employees']),
  sub('/view-employee/:id', 'Employee', ['employees']),
  sub('/view-employee/:employeeId', 'Employee', ['employees']),
  sub('/edit-employee/:id', 'Edit employee', ['employees']),
  sub('/fogs', 'Bulk upload', ['employees']),
  S('/organogram', 'Organogram', [], { open: 'the company chart: everyone in the admin app' }),
  S('/onboarding', 'Onboarding', ['employees']),
  S('/departments', 'Departments', ['employees']),
  S('/invite-people', 'Invite people', ['invite-people']),
  S('/recruitment', 'Recruitment', ['recruitment']),
  S('/offers', 'Offers', ['employees', 'recruitment']),
  S('/assign-managers', 'Assign Managers', ['assign-managers']),
  S('/training', 'Training', ['training']),
  // HR approves exits there (and its notifications lead there); the menu entry stays with the HR Lifecycle module
  S('/hr-lifecycle', 'HR Lifecycle', ['hr-lifecycle', 'approve-exits'], { menuModules: ['hr-lifecycle'] }),
  S('/adminconfirm', 'Email Admin', ['adminconfirm']),

  // time off and discipline
  S('/leaves', 'Time Off', ['leaves']),
  S('/leave-discipline', 'Leave discipline', ['leaves', 'employees', 'team-work']),
  S('/staffcheck', 'Disciplinary', ['staffcheck']),
  S('/incident-reports', 'Incidents', ['incident-reports']),

  // performance
  S('/performance', 'Performance', ['performance']),

  // pay and money
  S('/payroll', 'Payroll', ['payroll']),
  // how payslips look (FIG-814): letterhead, contacts, footer, sections
  S('/settings/payslip-design', 'Payslip design', ['payslip-design']),
  // new statutory rates for every company (FIG-813): reached from the Rates tab by Figbloom platform admins only
  sub('/platform/rates', 'Platform rates', [], { open: 'Figbloom platform admins: the page checks is_platform_admin and the database refuses anyone else' }),
  S('/casual-workers', 'Casual workers', ['work-records', 'payroll', 'employees', 'casual-overtime', 'team-work']),
  S('/piece-rate', 'Piece rate & jobs', ['work-records', 'payroll', 'team-work']),
  S('/overtime', 'Overtime', ['payroll', 'work-records', 'casual-overtime', 'team-work']),
  S('/settings/job-groups', 'Job groups', ['payroll', 'employees']),
  S('/expenses', 'Expenses', ['expenses']),
  S('/salaryadmin', 'Salary Advance', ['salaryadmin']),
  S('/loans', 'Loans', ['payroll', 'loans']),
  sub('/loanadmin', 'Loan requests', ['payroll', 'loans']),
  S('/asset', 'Assets', ['asset']),
  sub('/asset/scan', 'Scan an asset', ['asset']),
  S('/mpesa-zap', 'Mpesa Zap', ['mpesa-zap']),

  // company set-up and security
  S('/settings', 'Settings', ['settings']),
  S('/setup-assistant', 'Set up with AI', ['settings']),
  S('/settings/company', 'Company profile', [], { open: 'everyone in the company reads it; Settings changes it' }),
  S('/settings/branches', 'Branches', ['employees', 'settings']),
  S('/settings/job-titles', 'Job titles', ['employees', 'kpi-admin']),
  S('/settings/audit-trail', 'Audit Trail', ['settings']),
  S('/role-permissions', 'Role Permissions', ['role-permissions']),
  S('/appearance', 'Appearance', [], { open: 'their own colours and theme' }),
];

const byPath = new Map(SCREENS.map((s) => [s.path, s]));

/** The screen a route path is, or undefined (a path not in the list is not offered to anyone). */
export const screenFor = (path: string): ScreenAccess | undefined => byPath.get(path.startsWith('/') ? path : `/${path}`);

type Has = (module: string) => boolean;

/** Switched off for every company (hiddenModules.ts): its screens are not offered at all. */
export const isHiddenScreen = (screen: ScreenAccess) => screen.modules.length > 0 && screen.modules.every((m) => isHiddenModule(m));

/** May someone holding these modules open the screen? `has` is usePermissions().hasPermission (true for ADMIN). */
export function canOpenScreen(path: string, has: Has): boolean {
  const screen = screenFor(path);
  if (!screen || isHiddenScreen(screen)) return false;
  return screen.modules.length === 0 || screen.modules.some(has);
}

/** Does the screen appear in their menu? */
export function inMenu(path: string, has: Has): boolean {
  const screen = screenFor(path);
  if (!screen || isHiddenScreen(screen)) return false;
  const modules = screen.menuModules ?? screen.modules;
  return modules.length === 0 || modules.some(has);
}

/** The screens offered in the header search, matching the text. */
export function searchScreens(query: string, has: Has): ScreenAccess[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SCREENS.filter((s) => s.searchable && inMenu(s.path, has) && s.label.toLowerCase().includes(q));
}

/** The screens a role with these modules can open, by label (for the Roles screen's "what can this role do"). */
export function screensFor(has: Has): ScreenAccess[] {
  const seen = new Set<string>();
  return SCREENS.filter((s) => {
    if (!s.searchable || !canOpenScreen(s.path, has) || seen.has(s.label)) return false;
    seen.add(s.label);
    return true;
  });
}

/**
 * Staff (base role STAFF, and every company role based on it) use the staff portal, never the admin app, whatever
 * else their role holds: the extra modules show up inside the portal (Manage projects, My team). One of the few checks
 * on the base role, on purpose.
 */
export const usesStaffPortal = (baseRole: string | null | undefined) => baseRole === 'STAFF';
