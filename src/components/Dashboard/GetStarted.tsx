import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { companyApi } from '../../lib/companyApi';
import { useMyCompanies } from '../../hooks/useMyCompanies';
import { loadStoredTheme } from '../../theme/applyTheme';
import { usePermissions } from '../../hooks/usePermissions';
import { Card } from '../UI';

export const OPEN_COMPANY_PROFILE = 'open-company-profile';
/** Fired after the company profile is saved, so the checklist can tick it off straight away. */
export const COMPANY_PROFILE_SAVED = 'company-profile-saved';

interface Step {
  id: string;
  title: string;
  hint: string;
  done: boolean;
  to?: string;
  onClick?: () => void;
  action: string;
}

const dismissKey = (tenantId: string) => `getstarted_dismissed_${tenantId}`;

/** A short checklist for a new company's administrator: profile, team, employees, look. Dismissible. */
export default function GetStarted() {
  const { userRole } = usePermissions();
  const { data: companies } = useMyCompanies();
  const current = companies?.find((c) => c.is_current);
  const [dismissed, setDismissed] = useState(true); // hidden until we know
  const [done, setDone] = useState({ profile: false, invited: false, employees: false });
  const [loaded, setLoaded] = useState(false);
  const [checkCount, setCheckCount] = useState(0); // bumped to look at the data again

  useEffect(() => {
    if (!current) return;
    try {
      setDismissed(localStorage.getItem(dismissKey(current.tenant_id)) === '1');
    } catch {
      setDismissed(false);
    }
  }, [current?.tenant_id]);

  useEffect(() => {
    if (!current || dismissed || userRole !== 'ADMIN') return;
    let cancelled = false;
    (async () => {
      const [profile, invitations, employees] = await Promise.allSettled([
        supabase.from('company_logo').select('id', { head: true, count: 'exact' }),
        companyApi.listInvitations(),
        supabase.from('employees').select('"Employee Number"', { head: true, count: 'exact' }),
      ]);
      if (cancelled) return;
      setDone({
        profile: profile.status === 'fulfilled' && (profile.value.count ?? 0) > 0,
        invited: invitations.status === 'fulfilled' && invitations.value.length > 0,
        employees: employees.status === 'fulfilled' && (employees.value.count ?? 0) > 0,
      });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [current?.tenant_id, dismissed, userRole, checkCount]);

  // look again after the profile is saved, and when the person comes back to this tab (e.g. after inviting someone)
  useEffect(() => {
    const again = () => setCheckCount((n) => n + 1);
    const onVisible = () => {
      if (document.visibilityState === 'visible') again();
    };
    window.addEventListener(COMPANY_PROFILE_SAVED, again);
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(COMPANY_PROFILE_SAVED, again);
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!current || dismissed || !loaded || userRole !== 'ADMIN') return null;

  const steps: Step[] = [
    {
      id: 'profile',
      title: 'Set up your company profile',
      hint: 'Add your logo and a tagline. Your team sees them in the top bar.',
      done: done.profile,
      action: 'Open profile',
      onClick: () => window.dispatchEvent(new Event(OPEN_COMPANY_PROFILE)),
    },
    {
      id: 'invite',
      title: 'Invite your team',
      hint: 'Send each person a link to create their account (company or personal email).',
      done: done.invited,
      action: 'Invite people',
      to: '/invite-people',
    },
    {
      id: 'employees',
      title: 'Add your employees',
      hint: 'Enter their records so payroll, leave and the staff portal work.',
      done: done.employees,
      action: 'Add employee',
      to: '/add-employee',
    },
    {
      id: 'look',
      title: 'Choose your look',
      hint: 'Pick a theme and colours for your own view.',
      done: loadStoredTheme() !== null,
      action: 'Appearance',
      to: '/appearance',
    },
  ];
  const completed = steps.filter((s) => s.done).length;

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(current.tenant_id), '1');
    } catch {
      /* hidden for this visit only */
    }
    setDismissed(true);
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[14px] font-bold text-ink">Get {current.name} set up</h2>
          <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">
            {completed} of {steps.length} done
          </p>
        </div>
        <button type="button" onClick={dismiss} className="text-[12px] font-semibold text-muted-foreground hover:text-ink">
          Hide
        </button>
      </div>
      <div className="mt-2 h-1.5 rounded-pill bg-secondary overflow-hidden" aria-hidden>
        <div className="h-full bg-brand transition-all" style={{ width: `${(completed / steps.length) * 100}%` }} />
      </div>
      <ul className="mt-3 divide-y divide-border">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2.5">
            <span
              aria-label={s.done ? 'Done' : 'To do'}
              className={`w-5 h-5 rounded-full border flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                s.done ? 'bg-brand border-brand text-white' : 'border-border text-transparent'
              }`}
            >
              ✓
            </span>
            <span className="flex-1 min-w-0">
              <span className={`block text-[13px] font-semibold ${s.done ? 'text-muted-foreground line-through' : 'text-ink'}`}>{s.title}</span>
              <span className="block text-[11.5px] text-muted-foreground">{s.hint}</span>
            </span>
            {s.to ? (
              <Link to={s.to} className="text-[12px] font-semibold text-brand whitespace-nowrap">
                {s.action}
              </Link>
            ) : (
              <button type="button" onClick={s.onClick} className="text-[12px] font-semibold text-brand whitespace-nowrap">
                {s.action}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
