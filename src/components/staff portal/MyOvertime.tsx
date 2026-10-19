import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Clock } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, StatusPill, TableScroll, type StatusTone } from '../UI';
import { loadMyOvertime, myEmployeeNumber, requestOvertime, withdrawOvertime, type OvertimeEntry, type OvertimeStatus } from '../../lib/overtimeApi';
import { longDate, today } from '../../lib/casualPay';
import { DAY_TYPE_LABEL, round2 } from '../../lib/overtimePay';
import { LoaderBlock } from '../UI/FigbloomLoader';

// The staff portal's Overtime page (FIG-889): the employee's own overtime, as their supervisor or payroll recorded it,
// and a form to ask for overtime they worked. A request waits for the supervisor's or payroll's approval; approved
// overtime is paid with that month's salary.

const STATUS: Record<OvertimeStatus, { label: string; tone: StatusTone }> = {
  submitted: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
};

const input = 'w-full border border-border rounded-xl px-3 py-2.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/40';

export default function MyOvertime() {
  const [number, setNumber] = useState<string | null | undefined>(undefined);
  const [entries, setEntries] = useState<OvertimeEntry[]>([]);
  const [day, setDay] = useState(today());
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const n = await myEmployeeNumber();
      setNumber(n);
      setEntries(n ? await loadMyOvertime(n) : []);
    } catch (err) {
      setNumber(null);
      toast.error((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async () => {
    const h = Number(hours);
    if (!(h > 0 && h <= 24)) {
      toast.error('Hours should be more than 0 and at most 24');
      return;
    }
    setBusy(true);
    try {
      await requestOvertime(day, round2(h), note);
      toast.success('Overtime requested; your supervisor will approve it');
      setHours('');
      setNote('');
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (e: OvertimeEntry) => {
    try {
      await withdrawOvertime(e.id);
      toast.success('Request withdrawn');
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const approvedThisMonth = round2(entries
    .filter((e) => e.status === 'approved' && e.work_date.slice(0, 7) === today().slice(0, 7))
    .reduce((s, e) => s + Number(e.hours), 0));

  return (
    <div>
      <PageHeader title="Overtime" subtitle="Your overtime hours. Approved overtime is paid with that month's salary." />

      {number === null ? (
        <Card><p className="text-[13px] text-muted-foreground m-0">Your login isn&apos;t linked to an employee record, so there is no overtime to show.</p></Card>
      ) : (
        <>
          <Card className="mb-4">
            <h2 className="m-0 text-[14px] font-bold text-ink">Ask for overtime</h2>
            <p className="mt-0.5 mb-3 text-[12px] text-muted-foreground">
              For overtime you have worked. Your supervisor or payroll approves it; working days, rest days and public holidays
              are paid at different rates.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_2fr_auto] gap-3 items-end">
              <label className="text-[12px] font-semibold text-ink">
                Day
                <input type="date" className={input} max={today()} value={day} onChange={(e) => setDay(e.target.value)} />
              </label>
              <label className="text-[12px] font-semibold text-ink">
                Hours
                <input inputMode="decimal" className={input} value={hours} placeholder="e.g. 2.5" onChange={(e) => setHours(e.target.value)} />
              </label>
              <label className="text-[12px] font-semibold text-ink">
                What for (optional)
                <input className={input} value={note} placeholder="e.g. harvest, stock take" onChange={(e) => setNote(e.target.value)} />
              </label>
              <Button onClick={() => void submit()} disabled={busy || !day || !hours.trim()}>Ask for approval</Button>
            </div>
          </Card>

          <Card padding="none">
            <div className="p-3 border-b border-border text-[13px] font-semibold text-ink">
              Approved this month: {approvedThisMonth} {approvedThisMonth === 1 ? 'hour' : 'hours'}
            </div>
            {entries.length === 0 ? (
              number === undefined ? <LoaderBlock label="Loading" compact /> : <EmptyState icon={<Clock className="w-5 h-5" />} title="No overtime yet" />
            ) : (
              <TableScroll>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                      <th className="px-3 py-2 font-semibold">Day</th>
                      <th className="px-3 py-2 font-semibold">Kind of day</th>
                      <th className="px-3 py-2 font-semibold text-right">Hours</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Note</th>
                      <th className="px-3 py-2 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap">{longDate(e.work_date)}</td>
                        <td className="px-3 py-2">{DAY_TYPE_LABEL[e.day_type]}</td>
                        <td className="px-3 py-2 text-right">{Number(e.hours)}</td>
                        <td className="px-3 py-2"><StatusPill label={STATUS[e.status].label} tone={STATUS[e.status].tone} /></td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {e.note}
                          {e.rejection_reason && <span className="block text-status-danger">Why: {e.rejection_reason}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {e.status !== 'approved' && e.source === 'self' && (
                            <button type="button" className="text-muted-foreground font-semibold" onClick={() => void withdraw(e)}>Withdraw</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
