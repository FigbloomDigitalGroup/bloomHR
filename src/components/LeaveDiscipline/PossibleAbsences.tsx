import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarX } from 'lucide-react';
import { Button, Card, EmptyState, StatusPill, TableScroll } from '../UI';
import {
  formatDateRange, noticeText, possibleAbsenceSettingsProblem, possibleAbsenceText,
  type AbsenceKind, type PossibleAbsence, type PossibleAbsenceSettings,
} from '../../lib/leaveDiscipline';
import { savePossibleAbsenceSettings } from '../../lib/leaveDisciplineApi';

// The "Possible absences" tab of Leave discipline (migration 20261106100000): the days attendance counts as absent
// that nobody has recorded or dismissed yet. Each is recorded with the usual recording (so pay and warnings work as
// for one recorded by hand) or dismissed with a reason. Nothing is recorded by itself.

const th = 'text-left text-[10.5px] font-bold uppercase text-subtle px-3 py-2 whitespace-nowrap';
const td = 'px-3 py-2.5 text-xs text-ink align-top';
const input = 'px-2 py-1.5 text-xs border border-border rounded-tile bg-white text-ink outline-none focus:border-brand';

const nairobiToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function PossibleAbsencesTable({
  list, onRecord, onDismiss,
}: {
  list: PossibleAbsence[];
  onRecord: (p: PossibleAbsence, kind: AbsenceKind) => void;
  onDismiss: (p: PossibleAbsence) => void;
}) {
  const today = nairobiToday();
  return (
    <Card padding="none" className="overflow-hidden">
      {list.length === 0 ? (
        <EmptyState className="py-10" icon={<CalendarX size={20} />} title="No possible absences to review" />
      ) : (
        <TableScroll>
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className={th}>Employee</th>
                <th className={th}>Days with no clock-in</th>
                <th className={th}>Follow-up</th>
                <th className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const notice = noticeText(p, today);
                const label = `${p.employee_name}, ${formatDateRange(p.start_date, p.end_date)}`;
                return (
                  <tr key={`${p.employee_number}-${p.start_date}`} className="border-b border-[#F1F5F2] last:border-b-0">
                    <td className={td}>
                      <div className="font-semibold">{p.employee_name}</div>
                      <div className="text-[11px] text-muted-foreground">{p.employee_number}</div>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{possibleAbsenceText(p)}</td>
                    <td className={td}>
                      {p.pending_leave && <StatusPill tone="info" label="Leave applied for, not decided" />}
                      {notice && (
                        <div className={`text-[11px] ${notice.overdue ? 'text-status-danger' : 'text-muted-foreground'} ${p.pending_leave ? 'mt-1' : ''}`}>
                          {notice.text}{notice.overdue ? ' (no reply yet)' : ''}
                        </div>
                      )}
                      {!p.pending_leave && !notice && <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className={`${td} text-right`}>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button variant="secondary" aria-label={`Record as unexcused absence: ${label}`} onClick={() => onRecord(p, 'unexcused_absence')}>
                          Record as unexcused absence
                        </Button>
                        <Button variant="secondary" aria-label={`Record as failure to notify: ${label}`} onClick={() => onRecord(p, 'failed_to_notify')}>
                          Record as failure to notify
                        </Button>
                        <Button variant="ghost" aria-label={`Dismiss: ${label}`} onClick={() => onDismiss(p)}>
                          Dismiss
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}

/** HR's settings: how far back the list looks, and the notice to employees (off until switched on). */
export function PossibleAbsenceSettingsCard({
  settings, onSaved,
}: {
  settings: PossibleAbsenceSettings;
  onSaved: (s: PossibleAbsenceSettings) => void;
}) {
  const [lookback, setLookback] = useState(String(settings.lookback_days));
  const [notify, setNotify] = useState(settings.notify_employees);
  const [reply, setReply] = useState(String(settings.reply_working_days));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLookback(String(settings.lookback_days));
    setNotify(settings.notify_employees);
    setReply(String(settings.reply_working_days));
  }, [settings]);

  const draft = { lookback_days: Number(lookback), notify_employees: notify, reply_working_days: Number(reply) };
  const problem = possibleAbsenceSettingsProblem(draft);
  const dirty = draft.lookback_days !== settings.lookback_days || notify !== settings.notify_employees
    || draft.reply_working_days !== settings.reply_working_days;

  const save = async () => {
    setBusy(true);
    try {
      const saved = await savePossibleAbsenceSettings(draft);
      toast.success('Settings saved.');
      onSaved(saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-3">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block text-xs text-ink">
          <span className="block text-[11px] font-semibold mb-1">Look back (days)</span>
          <input type="number" min={7} max={180} className={`${input} w-20`} value={lookback} onChange={(e) => setLookback(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink cursor-pointer pb-1.5">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Tell employees about their possible absences
        </label>
        <label className="block text-xs text-ink">
          <span className="block text-[11px] font-semibold mb-1">Reply within (working days)</span>
          <input type="number" min={1} max={10} className={`${input} w-20`} value={reply} disabled={!notify} onChange={(e) => setReply(e.target.value)} />
        </label>
        <Button onClick={() => void save()} disabled={busy || !dirty || !!problem}>{busy ? 'Saving...' : 'Save'}</Button>
      </div>
      {problem && <p className="m-0 mt-2 text-[11px] text-status-danger">{problem}</p>}
      <p className="m-0 mt-2 text-[11px] text-muted-foreground">
        {settings.notify_employees && settings.notify_from
          ? `Employees are told the morning after a working day with no clock-in (in the app and by email), for absences from ${formatDateRange(settings.notify_from)} on. It is a notice, not a warning: nothing is recorded.`
          : 'When switched on, each employee is told the morning after a working day with no clock-in, and asked to send a missed-scan request or a leave application. Only absences from the day it is switched on are noticed, never older ones.'}
      </p>
    </Card>
  );
}
