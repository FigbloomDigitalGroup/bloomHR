// The modules a role can be given (FIG-827): what the Roles screen lists, grouped by area, with a one-line
// explanation each. The database's `permissions` table is the catalogue the roles are saved against; this adds the
// area and the plain-English line the screen shows (a module the database has but this list does not is shown under
// "Other" with the database's description).
//
// Modules added by migration 20261021200000_roles_everywhere.sql replace checks that used to be on a role's name.
// Each was given, once, to the roles that had the access by name, so nothing changed for existing companies:
//   task-oversight   ADMIN, HR             see every task, read-only (was: role is ADMIN or HR)
//   kpi-admin        HR, and roles that managed KPIs through Performance (not Manager / Regional Manager)
//   loans            HR                    staff loans (was: role is HR, or the Payroll module)
//   team-work        MANAGER               casual workers, overtime, piece rate and leave discipline for their team
//   casual-overtime  HR                    the Casual workers and Overtime screens
//   approve-exits    HR                    approve or decline exits (was: role is ADMIN or HR)
//   chat-channels    HR, MANAGER           create chat channels (was: role is ADMIN, HR or MANAGER)
//   chat-admin       (administrators)      moderate chat (was: role is ADMIN)
//   sign-in-security (administrators)      the company's two-step sign-in rules (was: role is ADMIN)
//   employee-edit    HR, MANAGER, REGIONAL the Add employee and Edit buttons (were: ADMIN, HR, MANAGER, REGIONAL by name)
//   hr-admin         HR                    HR's extra powers on employee and leave screens (were: ADMIN or HR by name)
//   hr-lifecycle     (administrators)      was already checked by the database but missing from the catalogue
// payslip-design (20261021600000_payslip_details.sql) was given once to administrators and every role holding payroll.
// reopen-leave (20261023000000_leave_reopen.sql) was given once to Operations: send approved leave back to pending.
// mailbox (20261025200000_user_mailboxes.sql) was given to no role: a company ticks it for the roles that should read
// their own mailbox in the app.
// payments (20261025400000_payments_to_make.sql) was given once to administrators and every role holding payroll, the
// people who paid until then; requisitions to HR.
// staff-id-cards (20261027400000_staff_id_cards.sql) was given once to ADMIN and HR: view, print and reissue anyone's
// staff ID card (everyone sees their own without it).
// (custom roles based on those roles got them too). Administrators always have every module.

export type ModuleArea = 'overview' | 'workspace' | 'people' | 'time' | 'performance' | 'pay' | 'system';

export interface ModuleInfo {
  id: string;
  name: string;
  area: ModuleArea;
  /** one line: what ticking it lets someone do */
  explain: string;
}

export const MODULE_AREAS: { id: ModuleArea; name: string; explain: string }[] = [
  { id: 'overview', name: 'Overview', explain: 'The dashboard, reports and the AI assistant' },
  { id: 'workspace', name: 'Tasks and communication', explain: 'Tasks, projects, chat, SMS and email' },
  { id: 'people', name: 'People', explain: 'Employee records, hiring, onboarding, invitations and exits' },
  { id: 'time', name: 'Time off and discipline', explain: 'Leave, disciplinary cases, incidents and team records' },
  { id: 'performance', name: 'Performance', explain: 'KPIs and reviews' },
  { id: 'pay', name: 'Pay and money', explain: 'Payroll, pay records, advances, loans, expenses and assets' },
  { id: 'system', name: 'Company set-up and security', explain: 'Settings, roles and sign-in security' },
];

export const MODULES: ModuleInfo[] = [
  // overview
  { id: 'dashboard', name: 'Dashboard', area: 'overview', explain: 'The dashboard and the company calendar' },
  { id: 'reports', name: 'Reports', area: 'overview', explain: 'Run and download reports' },
  { id: 'ai-assistant', name: 'AI Assistant', area: 'overview', explain: 'Ask the AI assistant about the company’s data they can see' },
  // tasks and communication
  { id: 'task-manager', name: 'Task Manager', area: 'workspace', explain: 'Use the task board for their own and shared tasks' },
  { id: 'task-projects', name: 'Manage projects', area: 'workspace', explain: 'Create projects, add members, assign tasks to teams, recurring tasks and labels' },
  { id: 'task-oversight', name: 'See every task', area: 'workspace', explain: 'See every task in the company, read-only, with its comments and files' },
  { id: 'teams', name: 'Teams', area: 'workspace', explain: 'Chat with colleagues in channels and direct messages, and video calls' },
  { id: 'chat-channels', name: 'Create chat channels', area: 'workspace', explain: 'Start new chat channels' },
  { id: 'chat-admin', name: 'Moderate chat', area: 'workspace', explain: 'See private channels, manage any channel and its members, edit or remove anyone’s messages (never direct messages)' },
  { id: 'sms', name: 'SMS Center', area: 'workspace', explain: 'Send SMS messages to staff' },
  { id: 'email-portal', name: 'Email Portal', area: 'workspace', explain: 'Send emails to staff from the app' },
  { id: 'mailbox', name: 'My mailbox', area: 'workspace', explain: 'Connect their own email account and read and send it in the app (Email Portal, or Mail in the staff portal)' },
  // people
  { id: 'employees', name: 'Employees', area: 'people', explain: 'See and edit employee records, departments, onboarding and bulk uploads' },
  { id: 'employee-edit', name: 'Add and edit employees', area: 'people', explain: 'Show Add employee and Edit on employee records (what can be saved still follows Employees)' },
  { id: 'hr-admin', name: 'HR administration', area: 'people', explain: 'Delete and bulk-add employees, relocate and merge duplicates, leave types, salary details on employee forms, every pending leave request' },
  { id: 'invite-people', name: 'Invite people', area: 'people', explain: 'Invite people and create their logins, giving only roles whose access they hold themselves' },
  { id: 'assign-managers', name: 'Assign Managers', area: 'people', explain: 'Choose who manages whom' },
  { id: 'recruitment', name: 'Recruitment', area: 'people', explain: 'Job openings, candidates and offers' },
  { id: 'training', name: 'Training', area: 'people', explain: 'Upload and assign training videos' },
  { id: 'hr-lifecycle', name: 'HR Lifecycle', area: 'people', explain: 'Contracts, probation, employment status, suspensions and the HR Lifecycle screen' },
  { id: 'staff-id-cards', name: 'Staff ID cards', area: 'people', explain: 'View, print and reissue anyone’s staff ID card, and choose what the cards show' },
  { id: 'approve-exits', name: 'Approve exits', area: 'people', explain: 'Approve or decline an employee’s exit, and open HR Lifecycle to do it' },
  { id: 'adminconfirm', name: 'Email Admin', area: 'people', explain: 'Approve staff who sign up for the staff portal' },
  { id: 'phone-approvals', name: 'Approvals', area: 'people', explain: 'Approve phone and device changes' },
  // time off and discipline
  { id: 'leaves', name: 'Time Off', area: 'time', explain: 'See and decide everyone’s leave requests' },
  { id: 'reopen-leave', name: 'Reopen approved leave', area: 'time', explain: 'Send approved leave back to pending, with a reason, before it starts' },
  { id: 'staffcheck', name: 'Disciplinary', area: 'time', explain: 'Warnings and disciplinary cases' },
  { id: 'incident-reports', name: 'Incidents', area: 'time', explain: 'See and handle incident reports' },
  { id: 'team-work', name: 'My team’s work', area: 'time', explain: 'Casual workers, overtime, piece rate and leave discipline for the people who report to them' },
  // performance
  { id: 'performance', name: 'Performance', area: 'performance', explain: 'See performance and KPI scores (managers: for their team)' },
  { id: 'kpi-admin', name: 'Manage KPIs', area: 'performance', explain: 'Set up KPIs, templates, job titles and review periods for everyone' },
  // pay and money
  { id: 'payroll', name: 'Payroll', area: 'pay', explain: 'Run, approve and pay payroll, and see everyone’s pay' },
  { id: 'payslip-design', name: 'Payslip design', area: 'pay', explain: 'Design the payslip: letterhead, contacts, footer, sections' },
  { id: 'work-records', name: 'Work & Piece Rate', area: 'pay', explain: 'Set up kinds of work and rates, record and approve work, casual days and overtime' },
  { id: 'casual-overtime', name: 'Casual workers & overtime', area: 'pay', explain: 'Open the Casual workers and Overtime screens' },
  { id: 'salaryadmin', name: 'Salary Advance', area: 'pay', explain: 'Review and approve salary advance requests' },
  { id: 'loans', name: 'Staff loans', area: 'pay', explain: 'Manage staff loans and get loan requests' },
  { id: 'expenses', name: 'Expenses', area: 'pay', explain: 'Expense claims and approvals' },
  { id: 'requisitions', name: 'Approve requisitions', area: 'pay', explain: 'Raise, approve or turn down requests for money (requisitions)' },
  { id: 'payments', name: 'Payments to make', area: 'pay', explain: 'Get told when money is approved, and record how it was paid' },
  { id: 'asset', name: 'Assets', area: 'pay', explain: 'Track company assets' },
  { id: 'mpesa-zap', name: 'Mpesa Zap', area: 'pay', explain: 'M-Pesa payments' },
  // company set-up and security
  { id: 'settings', name: 'Settings', area: 'system', explain: 'Company settings, the audit trail and the set-up assistant' },
  { id: 'role-permissions', name: 'Role Permissions', area: 'system', explain: 'Create roles and choose what each may do' },
  { id: 'sign-in-security', name: 'Sign-in security', area: 'system', explain: 'Set two-step sign-in for the company and reset someone’s two-step sign-in' },
];

export const MODULE_IDS = MODULES.map((m) => m.id);

const byId = new Map(MODULES.map((m) => [m.id, m]));
export const moduleInfo = (id: string): ModuleInfo | undefined => byId.get(id);

/**
 * Modules that make someone "privileged" for two-step sign-in (the company's "admins, HR and payroll" setting):
 * pay, settings, roles and letting people in. two_step_privileged_modules() in the database.
 */
export const TWO_STEP_PRIVILEGED_MODULES = ['payroll', 'settings', 'role-permissions', 'invite-people'];
