import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { workDaysMismatches } from '../../lib/attendance';
import { DEFAULT_SCHEDULE, loadSchedules } from '../../lib/attendanceApi';
import { loadBranches, type Branch } from '../../lib/branches';
import { loadDepartments, type Department } from '../../lib/orgStructure';
import { loadCompanyWorkWeek } from '../../lib/workWeek';

/**
 * A heads-up when attendance's working days (work schedules) and the work week leave and payroll count (Settings) don't
 * match. Shown on both screens; reloads when refreshKey changes (after a save). Nothing shows when it can't load.
 */
export default function WorkDaysMismatch({ refreshKey, fixHint }: { refreshKey?: unknown; fixHint: string }) {
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [schedules, branches, companyWeek, departments] = await Promise.all([
          loadSchedules(),
          loadBranches().catch(() => [] as Branch[]),
          loadCompanyWorkWeek(),
          loadDepartments().catch(() => [] as Department[]),
        ]);
        const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? 'A branch';
        const found = workDaysMismatches({
          companyDays: schedules.find((s) => s.branch_id === null)?.work_days ?? DEFAULT_SCHEDULE.work_days,
          branches: schedules.filter((s) => s.branch_id !== null).map((s) => ({ name: branchName(s.branch_id), workDays: s.work_days })),
          companyWeek,
          departments: departments.filter((d) => d.active !== false).map((d) => ({ name: d.name, workWeek: d.work_week })),
        });
        if (live) setMessages(found);
      } catch {
        // only a heads-up: say nothing rather than an error
      }
    })();
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (messages.length === 0) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-tile px-3 py-2 text-[12px] text-orange-text-alt bg-orange-tint-alt">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <div className="min-w-0 space-y-1">
        <div className="font-semibold">Working days don't match</div>
        <ul className="list-disc pl-4 space-y-0.5">
          {messages.map((m) => <li key={m}>{m}</li>)}
        </ul>
        <div>
          Staff could be marked absent on a day leave and payroll treat as a day off, or the other way round. {fixHint}
        </div>
      </div>
    </div>
  );
}
