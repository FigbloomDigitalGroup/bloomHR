// The admin app's menu, grouped, without its icons (Sidebar.tsx adds those). Kept here so the Roles screen's
// "Preview as this role" reads the very same entries the sidebar shows. Who sees each entry is decided by its path in
// routeModules.ts (the modules of the person's role, FIG-827).

export interface SidebarMenuItem {
  id: string;
  label: string;
  path: string;
}

export interface SidebarMenuGroup {
  title: string;
  items: SidebarMenuItem[];
}

export const SIDEBAR_MENU: SidebarMenuGroup[] = [
  {
    title: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', path: '/dashboard' },
      { id: 'calendar', label: 'Calendar', path: '/calendar' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { id: 'task-manager', label: 'Task Manager', path: '/tasks' },
      { id: 'teams', label: 'Teams', path: '/teams' },
      { id: 'video-calls', label: 'Video calls', path: '/video-calls' },
      { id: 'messages', label: 'SMS Center', path: '/sms' },
      { id: 'email-portal', label: 'Email Portal', path: '/email-portal' },
    ],
  },
  {
    title: 'Team',
    items: [
      { id: 'employees', label: 'Employees', path: '/employees' },
      { id: 'organogram', label: 'Organogram', path: '/organogram' },
      { id: 'onboarding', label: 'Onboarding', path: '/onboarding' },
      { id: 'recruitment', label: 'Recruitment', path: '/recruitment' },
      { id: 'offers', label: 'Offers', path: '/offers' },
      { id: 'leaves', label: 'Time Off', path: '/leaves' },
      // absences, failures to notify, missing leave documents and warnings for them: HR, and supervisors for their team
      { id: 'leave-discipline', label: 'Leave discipline', path: '/leave-discipline' },
      { id: 'performance', label: 'Performance', path: '/performance' },
      { id: 'training', label: 'Training', path: '/training' },
      { id: 'assign-managers', label: 'Assign Managers', path: '/assign-managers' },
      { id: 'staffcheck', label: 'Disciplinary', path: '/staffcheck' },
      { id: 'hr-lifecycle', label: 'HR Lifecycle', path: '/hr-lifecycle' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { id: 'payroll', label: 'Payroll', path: '/payroll' },
      // people paid by the day, outside the monthly payroll: payroll, HR, and managers who supervise casuals
      { id: 'casual-workers', label: 'Casual workers', path: '/casual-workers' },
      // piece rate and contract jobs: payroll, and managers who supervise people paid by work
      { id: 'piece-rate', label: 'Piece rate & jobs', path: '/piece-rate' },
      // overtime hours per day, approved and paid with the month's salary: payroll, and managers for their team
      { id: 'overtime', label: 'Overtime', path: '/overtime' },
      // job groups and their pay: for Payroll and Employees, who can't open Settings
      { id: 'job-groups', label: 'Job groups', path: '/settings/job-groups' },
      { id: 'expense', label: 'Expenses', path: '/expenses' },
      { id: 'advanced', label: 'Salary Advance', path: '/salaryadmin' },
      // HR and payroll (and admins): staff loans with interest
      { id: 'loans', label: 'Loans', path: '/loans' },
      { id: 'asset', label: 'Assets', path: '/asset' },
      { id: 'mpesa-zap', label: 'Mpesa Zap', path: '/mpesa-zap' },
    ],
  },
  {
    title: 'System',
    items: [
      { id: 'reports', label: 'Reports', path: '/reports' },
      { id: 'email admin', label: 'Email Admin', path: '/adminconfirm' },
      { id: 'incident-reports', label: 'Incidents', path: '/incident-reports' },
      { id: 'settings', label: 'Settings', path: '/settings' },
      { id: 'setup-assistant', label: 'Set up with AI', path: '/setup-assistant' },
      { id: 'departments', label: 'Departments', path: '/departments' },
      // offices, each in a country (FIG-905): holidays and the minimum wage follow an employee's branch
      { id: 'branches', label: 'Branches', path: '/settings/branches' },
      // the job titles list (KPI templates can be set per title): HR and the Employees module
      { id: 'job-titles', label: 'Job titles', path: '/settings/job-titles' },
      { id: 'audit-trail', label: 'Audit Trail', path: '/settings/audit-trail' },
      { id: 'role-permissions', label: 'Role Permissions', path: '/role-permissions' },
      { id: 'appearance', label: 'Appearance', path: '/appearance' },
    ],
  },
];

// The staff portal's menu, without its icons (StaffPortal.tsx adds those). Staff (base role STAFF, and the company
// roles based on it) always get these; the portal does not hide entries by module. Inside Tasks, the modules decide
// the extras (Manage projects, See every task).
export interface PortalMenuItem {
  id: string;
  label: string;
  /** other words the menu search finds this item by */
  keywords?: string[];
  submenu?: { id: string; label: string }[];
}

export interface PortalMenuGroup {
  title: string;
  items: PortalMenuItem[];
}

export const STAFF_PORTAL_MENU: PortalMenuGroup[] = [
  {
    title: 'Overview',
    items: [{ id: 'home', label: 'Dashboard' }],
  },
  {
    title: 'Work & Development',
    items: [
      { id: 'tasks', label: 'Tasks' },
      { id: 'my-kpis', label: 'My KPIs' },
      { id: 'training', label: 'Training' },
      { id: 'job-applications', label: 'Job Opportunities' },
      { id: 'incident-report', label: 'Report Incident' },
    ],
  },
  {
    title: 'Finance',
    items: [
      {
        id: 'financial',
        label: 'Financial',
        submenu: [
          { id: 'salary-advance', label: 'Salary Advance' },
          { id: 'loan', label: 'Loans' },
        ],
      },
      { id: 'payslips', label: 'Payslips' },
      { id: 'overtime', label: 'Overtime' },
    ],
  },
  {
    title: 'Communication',
    items: [
      {
        id: 'communication',
        label: 'Communication',
        submenu: [
          { id: 'chat', label: 'Chat' },
          { id: 'VideoConf', label: 'Video Conference' },
        ],
      },
    ],
  },
  {
    title: 'Company',
    items: [
      {
        id: 'company',
        label: 'Company',
        submenu: [
          { id: 'company-calendar', label: 'Calendar' },
          { id: 'company-organogram', label: 'Organogram' },
          { id: 'company-departments', label: 'Departments' },
          { id: 'company-approvers', label: 'Who approves my leave' },
        ],
      },
    ],
  },
  {
    title: 'Personal & HR',
    items: [
      { id: 'onboarding', label: 'Onboarding' },
      { id: 'first-weeks', label: 'My First Weeks' },
      {
        id: 'leave',
        label: 'Leave',
        submenu: [
          { id: 'leave', label: 'Apply for Leave' },
          { id: 'leave-history', label: 'Leave History' },
          // anyone may be a Leave Approver, line manager or department head, whatever their role
          { id: 'leave-approvals', label: 'Approve leave' },
        ],
      },
      { id: 'contract', label: 'Contracts' },
      // resigning starts at the bottom of Profile (behind a confirmation), so searching for it finds Profile
      { id: 'details', label: 'Profile', keywords: ['resign', 'resignation', 'leaving'] },
      { id: 'biodata', label: 'Bio Data' },
      { id: 'documents', label: 'Documents' },
      { id: 'appearance', label: 'Appearance' },
    ],
  },
];

/** Shown only to someone who supervises at least one person (migration 20261018900000) */
export const STAFF_PORTAL_MY_TEAM: PortalMenuGroup = { title: 'My team', items: [{ id: 'my-team', label: 'My team' }] };
/** Shown only to someone paid by work or given contract jobs (FIG-812, migration 20261020100000) */
export const STAFF_PORTAL_MY_WORK: PortalMenuGroup = { title: 'My work', items: [{ id: 'my-work', label: 'My work' }] };
