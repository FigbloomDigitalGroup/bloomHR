// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { adminNotificationPath, adminNotificationTarget, staffLinkSearch, staffNotificationLink } from './notificationLinks';
import { HR_PAGES, STAFF_TABS, staffEmailLink, staffPortalLink } from '../../supabase/functions/send-notification-emails/email';

// every type the database allows: the last hr_notifications_notification_type_check in the migrations
const allTypes = (() => {
  const dir = join(__dirname, '../../supabase/migrations');
  const last = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().reverse()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .find((sql) => sql.includes('add constraint hr_notifications_notification_type_check'))!;
  const list = last.split('add constraint hr_notifications_notification_type_check')[1].split('));')[0];
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
})();
const n = (notification_type: string, title = '', message = '') => ({ notification_type, title, message });
const all = () => true;

describe('where a notification opens', () => {
  it('every type opens somewhere (only the email digest has no page)', () => {
    expect(allTypes.length).toBeGreaterThan(50);
    const nowhere = allTypes.filter((t) => !staffNotificationLink(n(t)) && !adminNotificationPath(n(t)));
    expect(nowhere).toEqual(['company_digest']);
  });

  it('a policy to accept opens the policies in Onboarding', () => {
    expect(staffNotificationLink(n('policy_to_accept'))).toEqual({ tab: 'onboarding', params: { section: 'policies' } });
    expect(staffLinkSearch(staffNotificationLink(n('policy_to_accept'))!)).toBe('?tab=onboarding&section=policies');
  });

  it('the types several features share go by their title', () => {
    expect(staffNotificationLink(n('employment_update', 'New KPIs'))).toEqual({ tab: 'my-kpis' });
    expect(staffNotificationLink(n('employment_update', 'Unexcused absence recorded'))).toEqual({ tab: 'leave-history' });
    expect(staffNotificationLink(n('employment_update', 'Payout on its way'))).toEqual({ tab: 'my-work' });
    expect(staffNotificationLink(n('employment_update', 'Contribution declined'))).toEqual({ tab: 'payslips' });
    expect(staffNotificationLink(n('employment_update', 'Employment update'))).toEqual({ tab: 'details' });
    expect(staffNotificationLink(n('approval_needed', 'Leave awaiting your approval'))).toEqual({ tab: 'leave-approvals' });
    expect(staffNotificationLink(n('approval_needed', 'Work waiting for your approval'))).toEqual({ tab: 'my-team', params: { view: 'work' } });
    expect(staffNotificationLink(n('approval_needed', 'Payout waiting for approval'))).toBeNull();
    expect(staffNotificationLink(n('approval_progress', 'Overtime approved'))).toEqual({ tab: 'overtime' });
    expect(staffNotificationLink(n('approval_progress', 'Work approved', 'Your work for 01 Oct 2026'))).toEqual({ tab: 'my-work' });
    expect(staffNotificationLink(n('approval_progress', 'Work approved', 'Ann X\'s work for 01 Oct 2026'))).toEqual({ tab: 'my-team', params: { view: 'work' } });
    expect(staffNotificationLink(n('approval_progress', 'Leave application moving on'))).toEqual({ tab: 'leave-history' });
    expect(adminNotificationPath(n('approval_needed', 'Payout waiting for approval'))).toBe('/piece-rate');
    expect(adminNotificationPath(n('employment_update', 'KPI targets changed'))).toBe('/performance');
  });

  it('HR opens the screen it is handled on', () => {
    expect(adminNotificationPath(n('leave_recommended'))).toBe('/leaves');
    expect(adminNotificationPath(n('exit_requested'))).toBe('/hr-lifecycle?tab=exits');
    expect(adminNotificationPath(n('loan_requested'))).toBe('/loans');
    expect(adminNotificationPath(n('application_received'))).toBe('/recruitment');
  });

  it('someone who may not open the screen goes to their own staff portal section, or nowhere', () => {
    const onlyStaff = (m: string) => m === 'dashboard';
    expect(adminNotificationTarget(n('approval_needed', 'Leave awaiting your approval'), all)).toBe('/leaves');
    expect(adminNotificationTarget(n('approval_needed', 'Leave awaiting your approval'), onlyStaff)).toBe('/staff?tab=leave-approvals');
    expect(adminNotificationTarget(n('payslip_ready'), onlyStaff)).toBe('/staff?tab=payslips');
    expect(adminNotificationTarget(n('loan_requested'), onlyStaff)).toBeNull();
  });
});

describe('the emails open the same', () => {
  it('the email copy of the staff sections agrees', () => {
    for (const [type, tab] of Object.entries(STAFF_TABS)) {
      expect(staffNotificationLink(n(type))?.tab, type).toBe(tab);
    }
  });

  it('HR alert emails open the screen the bell opens', () => {
    for (const [type, page] of Object.entries(HR_PAGES)) {
      expect(adminNotificationPath(n(type))?.split('?')[0], type).toBe(page.split('?')[0]);
    }
  });

  it('an employee email opens the section its updates share, else home', () => {
    const app = 'https://bloom-hr-phi.vercel.app/staff';
    const it_ = (type: string) => ({ type });
    expect(staffEmailLink(app, [it_('payslip_ready')])).toBe(`${app}?tab=payslips`);
    expect(staffEmailLink(app, [it_('policy_to_accept'), it_('policy_to_accept')])).toBe(`${app}?tab=onboarding&section=policies`);
    expect(staffEmailLink(app, [it_('policy_to_accept'), it_('document_rejected')])).toBe(`${app}?tab=onboarding`);
    expect(staffEmailLink(app, [it_('payslip_ready'), it_('loan_approved')])).toBe(app);
    expect(staffEmailLink(app, [it_('approval_needed')])).toBe(app);
    expect(staffPortalLink('not a url', 'payslips')).toBe('not a url');
  });
});
