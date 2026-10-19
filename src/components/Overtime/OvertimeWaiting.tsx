import { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCheck } from 'lucide-react';
import { Button, Card, EmptyState, Modal, TableScroll } from '../UI';
import { approveOvertime, rejectOvertime, type OvertimeEntry, type OvertimePerson } from '../../lib/overtimeApi';
import { longDate } from '../../lib/casualPay';
import { DAY_TYPE_LABEL } from '../../lib/overtimePay';
import { LoaderBlock } from '../UI/FigbloomLoader';

// Overtime employees asked for, waiting for the supervisor's or payroll's decision. Approved overtime is paid with
// that month's salary; a rejection needs a reason, which the employee sees.

interface Props {
  entries: OvertimeEntry[];
  people: OvertimePerson[];
  loading: boolean;
  onChanged: () => void;
}

export default function OvertimeWaiting({ entries, people, loading, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<OvertimeEntry | null>(null);
  const [reason, setReason] = useState('');
  const names = new Map(people.map((p) => [p.employee_number, p.name || p.employee_number]));

  const approve = async (ids: string[]) => {
    setBusy(true);
    try {
      await approveOvertime(ids);
      toast.success(`${ids.length} ${ids.length === 1 ? 'request' : 'requests'} approved`);
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejecting || !reason.trim()) return;
    setBusy(true);
    try {
      await rejectOvertime(rejecting.id, reason);
      toast.success('Request not approved; the employee has been told why');
      setRejecting(null);
      setReason('');
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="none">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
        <span className="text-[13px] font-semibold text-ink">
          {entries.length} {entries.length === 1 ? 'request' : 'requests'} waiting
        </span>
        {entries.length > 1 && (
          <div className="ml-auto">
            <Button icon={<CheckCheck className="w-3.5 h-3.5" />} disabled={busy} onClick={() => void approve(entries.map((e) => e.id))}>
              Approve all {entries.length}
            </Button>
          </div>
        )}
      </div>
      {entries.length === 0 ? (
        loading ? <LoaderBlock label="Loading" compact /> : <EmptyState icon={<CheckCheck className="w-5 h-5" />} title="Nothing waiting"
          description="Overtime your team asks for in the staff portal shows here for you to approve." />
      ) : (
        <TableScroll>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-semibold">Employee</th>
                <th className="px-3 py-2 font-semibold">Day</th>
                <th className="px-3 py-2 font-semibold">Kind of day</th>
                <th className="px-3 py-2 font-semibold text-right">Hours</th>
                <th className="px-3 py-2 font-semibold">Note</th>
                <th className="px-3 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink">{names.get(e.employee_number) ?? e.employee_number}</div>
                    <div className="text-[10.5px] text-subtle">{e.employee_number}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{longDate(e.work_date)}</td>
                  <td className="px-3 py-2">{DAY_TYPE_LABEL[e.day_type]}</td>
                  <td className="px-3 py-2 text-right">{Number(e.hours)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{e.note}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button type="button" className="text-brand font-semibold mr-3" disabled={busy}
                      aria-label={`Approve ${names.get(e.employee_number) ?? e.employee_number}, ${e.work_date}`} onClick={() => void approve([e.id])}>
                      Approve
                    </button>
                    <button type="button" className="text-status-danger font-semibold" disabled={busy}
                      aria-label={`Reject ${names.get(e.employee_number) ?? e.employee_number}, ${e.work_date}`} onClick={() => setRejecting(e)}>
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {rejecting && (
        <Modal open onClose={() => setRejecting(null)} title="Not approve this overtime" size="md" closeOnBackdrop={!busy}>
          <div className="space-y-3 text-xs text-ink">
            <p>
              {names.get(rejecting.employee_number) ?? rejecting.employee_number}: {Number(rejecting.hours)} h on {longDate(rejecting.work_date)}.
              Say why (the employee sees this and can correct the request).
            </p>
            <textarea aria-label="Reason" className="w-full rounded-lg border border-border p-2" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRejecting(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void reject()} disabled={busy || !reason.trim()}>Not approved</Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
