// Where a notification takes you when you open it. hr_notifications has no link column, so it goes by the type, and
// for the types several features share (employment_update, approval_needed, approval_progress) by the title the
// database gives it. The staff portal opens one of its sections (/staff?tab=...); HR and admins open the screen the
// matter is handled on. The notification emails use the same (supabase/functions/send-notification-emails/email.ts
// keeps a copy; notificationLinks.test.ts checks the two agree).

import { canOpenScreen } from './routeModules';

export interface NotificationLike {
  notification_type: string;
  title?: string | null;
  message?: string | null;
}

/** A staff portal section, with any extra address parameters (e.g. My team's view). */
export interface StaffLink {
  tab: string;
  params?: Record<string, string>;
}

const STAFF_BY_TYPE: Record<string, StaffLink> = {
  leave_approved: { tab: 'leave-history' },
  leave_rejected: { tab: 'leave-history' },
  leave_reopened: { tab: 'leave-history' },
  leave_scheduled: { tab: 'leave-history' },
  leave_year_end_reminder: { tab: 'leave' },
  document_accepted: { tab: 'onboarding' },
  document_rejected: { tab: 'onboarding' },
  document_requested: { tab: 'onboarding' },
  onboarding_approved: { tab: 'onboarding' },
  onboarding_changes_requested: { tab: 'onboarding' },
  photo_removed: { tab: 'onboarding' },
  policy_to_accept: { tab: 'onboarding', params: { section: 'policies' } },
  salary_advance_approved: { tab: 'salary-advance' },
  salary_advance_rejected: { tab: 'salary-advance' },
  salary_advance_paid: { tab: 'salary-advance' },
  loan_approved: { tab: 'loan' },
  loan_rejected: { tab: 'loan' },
  loan_disbursed: { tab: 'loan' },
  loan_repaid: { tab: 'loan' },
  payslip_ready: { tab: 'payslips' },
  salary_paid: { tab: 'payslips' },
  phone_change_approved: { tab: 'details' },
  phone_change_rejected: { tab: 'details' },
  incident_update: { tab: 'incident-report' },
  suspended: { tab: 'details' },
  reactivated: { tab: 'details' },
  task_assigned: { tab: 'tasks' },
  exit_approved: { tab: 'resignation' },
  exit_declined: { tab: 'resignation' },
  contract_sent: { tab: 'contract' },
  contract_sent_back: { tab: 'contract' },
  contract_accepted: { tab: 'contract' },
  contract_cancelled: { tab: 'contract' },
  missed_scan_request: { tab: 'my-team', params: { view: 'missed' } },
  missed_scan_approved: { tab: 'home' },
  missed_scan_declined: { tab: 'home' },
};

const has = (text: string | null | undefined, pattern: RegExp) => pattern.test(text ?? '');

/** The staff portal section a notification opens, or null when there is none for it (it is only marked read). */
export function staffNotificationLink(n: NotificationLike): StaffLink | null {
  const { notification_type: type, title, message } = n;
  switch (type) {
    case 'employment_update':
      if (has(title, /KPI/)) return { tab: 'my-kpis' };
      if (has(title, /(recorded|excused)$/)) return { tab: 'leave-history' }; // an absence
      if (has(title, /contract job|payout/i)) return { tab: 'my-work' };
      if (has(title, /^Contribution/)) return { tab: 'payslips' };
      return { tab: 'details' };
    case 'approval_needed':
      if (has(title, /leave/i)) return { tab: 'leave-approvals' };
      if (has(title, /work|contract job/i)) return { tab: 'my-team', params: { view: 'work' } };
      return null; // a payout is approved by payroll, not in the staff portal
    case 'approval_progress':
      if (has(title, /overtime/i)) return { tab: 'overtime' };
      if (has(title, /contract job/i)) return { tab: 'my-work' };
      // someone's own work, or the work they entered for their team
      if (has(title, /^Work /)) return has(message, /^Your work/) ? { tab: 'my-work' } : { tab: 'my-team', params: { view: 'work' } };
      return { tab: 'leave-history' };
    default:
      return STAFF_BY_TYPE[type] ?? null;
  }
}

const ADMIN_BY_TYPE: Record<string, string> = {
  contract_expiring: '/hr-lifecycle?tab=status',
  probation_expiring: '/hr-lifecycle?tab=status',
  contract_signed: '/hr-lifecycle?tab=contracts',
  exit_requested: '/hr-lifecycle?tab=exits',
  exit_approved: '/hr-lifecycle?tab=exits',
  exit_declined: '/hr-lifecycle?tab=exits',
  suspended: '/hr-lifecycle?tab=suspension',
  reactivated: '/hr-lifecycle?tab=suspension',
  employment_update: '/hr-lifecycle?tab=history',
  contract_sent: '/hr-lifecycle?tab=contracts',
  contract_sent_back: '/hr-lifecycle?tab=contracts',
  contract_accepted: '/hr-lifecycle?tab=contracts',
  contract_cancelled: '/hr-lifecycle?tab=contracts',
  leave_recommended: '/leaves',
  leave_approved: '/leaves',
  leave_rejected: '/leaves',
  leave_reopened: '/leaves',
  leave_scheduled: '/leaves',
  leave_exhausted: '/leaves',
  leave_document_overdue: '/leave-discipline',
  document_accepted: '/onboarding',
  document_rejected: '/onboarding',
  document_requested: '/onboarding',
  onboarding_approved: '/onboarding',
  onboarding_changes_requested: '/onboarding',
  onboarding_followups_overdue: '/onboarding',
  photo_removed: '/onboarding',
  policy_to_accept: '/onboarding',
  salary_advance_approved: '/salaryadmin',
  salary_advance_rejected: '/salaryadmin',
  salary_advance_paid: '/salaryadmin',
  loan_requested: '/loans',
  loan_approved: '/loans',
  loan_rejected: '/loans',
  loan_disbursed: '/loans',
  loan_repaid: '/loans',
  payslip_ready: '/payroll?tab=history',
  salary_paid: '/payroll?tab=history',
  contribution_requested: '/payroll?tab=deductions',
  expense_approved: '/expenses',
  expense_rejected: '/expenses',
  incident_update: '/incident-reports',
  warning_issued: '/staffcheck',
  task_assigned: '/tasks',
  asset_assigned: '/asset',
  application_received: '/recruitment',
  casual_limit: '/casual-workers',
  attendance_odd_hours: '/attendance',
  missed_scan_requested: '/attendance?tab=missed',
  missed_scan_request: '/attendance?tab=missed',
};

/** The screen HR or an admin handles a notification on, or null when there is none (it is only marked read). */
export function adminNotificationPath(n: NotificationLike): string | null {
  const { notification_type: type, title } = n;
  switch (type) {
    case 'employment_update':
      if (has(title, /KPI/)) return '/performance';
      if (has(title, /(recorded|excused)$/)) return '/leave-discipline';
      if (has(title, /contract job|payout/i)) return '/piece-rate';
      if (has(title, /^Contribution/)) return '/payroll?tab=deductions';
      return ADMIN_BY_TYPE[type];
    case 'approval_needed':
      return has(title, /leave/i) ? '/leaves' : '/piece-rate';
    case 'approval_progress':
      if (has(title, /overtime/i)) return '/overtime';
      if (has(title, /contract job|^Work /i)) return '/piece-rate';
      return '/leaves';
    default:
      return ADMIN_BY_TYPE[type] ?? null;
  }
}

/** The address part of a staff link: ?tab=onboarding&section=policies */
export function staffLinkSearch(link: StaffLink): string {
  const params = new URLSearchParams({ tab: link.tab, ...(link.params ?? {}) });
  return `?${params.toString()}`;
}

/**
 * Where the admin app's bell takes someone: the HR screen when they may open it; else, for a notification of their
 * own (a leave approver without Time Off, their payslip...), that section of their staff portal; else nowhere.
 */
export function adminNotificationTarget(n: NotificationLike, has: (module: string) => boolean): string | null {
  const path = adminNotificationPath(n);
  if (path && canOpenScreen(path.split('?')[0], has)) return path;
  const staff = staffNotificationLink(n);
  return staff ? `/staff${staffLinkSearch(staff)}` : null;
}
