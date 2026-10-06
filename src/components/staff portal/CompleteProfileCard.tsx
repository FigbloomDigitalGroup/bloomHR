import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { profileItems, profileScore, ProfileScore } from '../../lib/profileCompleteness';

interface CompleteProfileCardProps {
  /** Opens the Bio Data tab, where the person fills these in. */
  onOpen: () => void;
}

/**
 * "Complete your profile": HR only enters the company basics, so each person adds their own picture, mobile number,
 * ID, tax PIN, payment details and emergency contact. Shows what is still missing and goes away at 100%.
 */
export default function CompleteProfileCard({ onOpen }: CompleteProfileCardProps) {
  const [score, setScore] = useState<ProfileScore | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user?.email) return;

        const { data: employee } = await supabase.from('employees').select('*').eq('Work Email', user.email).maybeSingle();
        if (!employee || cancelled) return; // not linked to an employee record yet: the portal already says so

        let hasEmergency: boolean | null = null;
        const { count, error } = await supabase
          .from('emergency_contact')
          .select('Employee Number', { count: 'exact', head: true })
          .eq('Employee Number', employee['Employee Number']);
        if (!error) hasEmergency = (count ?? 0) > 0;

        if (!cancelled) setScore(profileScore(profileItems(employee, hasEmergency)));
      } catch {
        /* a card that cannot load is simply not shown */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!score || score.complete) return null;

  return (
    <section aria-label="Complete your profile" className="rounded-2xl border border-gray-200 bg-white p-4 md:p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-gray-900">Complete your profile</h3>
          <p className="text-xs text-gray-500">
            HR has set up the basics. Add the rest yourself so payroll, SMS and your records are right ({score.done} of {score.total} done).
          </p>
        </div>
        <button type="button" onClick={onOpen} className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800">
          Open Bio Data
        </button>
      </div>

      <div className="mt-3 h-1.5 rounded-full bg-gray-100 overflow-hidden" role="progressbar" aria-valuenow={score.percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${score.percent}%` }} />
      </div>

      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {score.missing.map((item) => (
          <li key={item.key} className="flex items-baseline gap-2 text-xs">
            <span className="text-amber-500" aria-hidden>
              ○
            </span>
            <span className="font-semibold text-gray-800">{item.label}</span>
            <span className="text-gray-400 truncate">{item.hint}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
