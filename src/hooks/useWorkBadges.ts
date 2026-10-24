import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// The counts on the HR items of the sidebar that wait on someone's decision, for those who may make it.
//
//   * Attendance: missed-scan requests the person may decide now (attendance_missed_scans' can_decide: the manager
//     the request went to, or HR).
//   * HR Lifecycle: exits asked for and not yet decided, for the 'approve-exits' module.
//   * Onboarding: new hires' records sent for HR's review, for the 'employees' module.
//   * Overtime: entries waiting for approval that the person can see (payroll everyone's, a supervisor their team's).
//   * Email Admin: staff sign-up requests waiting to be confirmed, for the 'adminconfirm' module.
//
// Refreshed when a request, exit, overtime entry or sign-up changes (realtime, where the person may see the rows), when
// the tab comes back, and every 2 minutes while it is visible.

export const WORK_BADGE_POLL_MS = 2 * 60 * 1000;

export type WorkBadges = Partial<Record<'attendance' | 'hr-lifecycle' | 'onboarding' | 'overtime' | 'email admin', number>>;

export interface WorkBadgeAccess {
  attendance: boolean;
  exits: boolean;
  onboarding: boolean;
  overtime: boolean;
  /** staff sign-ups to confirm; absent: not asked */
  signups?: boolean;
}

async function count(query: PromiseLike<{ count: number | null; error: unknown }>) {
  const { count: n, error } = await query;
  return error ? 0 : n || 0;
}

async function missedScansToDecide() {
  const { data, error } = await supabase.rpc('attendance_missed_scans', { p_status: 'pending', p_employee: null, p_from: null, p_to: null });
  if (error) return 0;
  return ((data ?? []) as { can_decide?: boolean }[]).filter((r) => r.can_decide === true).length;
}

/** What waits on the person, for the items they may act on (the rest are not asked). */
export async function loadWorkBadges(access: WorkBadgeAccess): Promise<WorkBadges> {
  const head = { count: 'exact' as const, head: true };
  const [attendance, exits, onboarding, overtime, signups] = await Promise.all([
    access.attendance ? missedScansToDecide() : 0,
    access.exits ? count(supabase.from('employee_exits').select('id', head).eq('status', 'requested')) : 0,
    access.onboarding ? count(supabase.from('employees').select('"Employee Number"', head).eq('onboarding_status', 'submitted')) : 0,
    access.overtime ? count(supabase.from('overtime_entries').select('id', head).eq('status', 'submitted')) : 0,
    access.signups ? count(supabase.from('staff_signup_requests').select('id', head).eq('status', 'pending')) : 0,
  ]);
  return { attendance, 'hr-lifecycle': exits, onboarding, overtime, 'email admin': signups };
}

export function useWorkBadges(who: string | undefined, access: WorkBadgeAccess): WorkBadges {
  const [badges, setBadges] = useState<WorkBadges>({});
  const { attendance, exits, onboarding, overtime, signups = false } = access;

  useEffect(() => {
    if (!who || !(attendance || exits || onboarding || overtime || signups)) {
      setBadges({});
      return;
    }
    let live = true;
    const refresh = async () => {
      try {
        const next = await loadWorkBadges({ attendance, exits, onboarding, overtime, signups });
        if (live) setBadges(next);
      } catch (err) {
        console.error('Error counting work waiting on me:', err);
      }
    };
    refresh();

    const channel = supabase.channel('sidebar_work_badges');
    // (not employees: every edit to anyone would recount; onboarding is caught by the 2-minute refresh)
    for (const table of ['attendance_missed_scan_requests', 'employee_exits', 'overtime_entries', 'staff_signup_requests']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => void refresh());
    }
    channel.subscribe();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, WORK_BADGE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [who, attendance, exits, onboarding, overtime, signups]);

  return badges;
}
