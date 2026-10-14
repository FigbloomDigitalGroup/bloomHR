import { useEffect, useState } from 'react';
import { History, Upload } from 'lucide-react';
import { Card, EmptyState, StatusPill, TableScroll } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { type PayrollRun, listPayrollRuns, runErrorMessage } from '../../lib/payrollRuns';
import { RUN_STATUS } from './PayrollRunBar';

// The History tab: every month payroll was run for, where each stands (draft, approved, paid), and a way to open one.

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

interface PayrollHistoryTabProps {
  /** opens the month on the Run tab */
  onOpen: (payPeriod: string) => void;
  onUploadHistory: () => void;
  /** bumped when a run changes, so the list reloads */
  version: number;
}

export default function PayrollHistoryTab({ onOpen, onUploadHistory, version }: PayrollHistoryTabProps) {
  const [runs, setRuns] = useState<PayrollRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPayrollRuns().then(
      (found) => {
        if (!cancelled) setRuns(found);
      },
      (err) => {
        if (cancelled) return;
        setRuns([]);
        setError(runErrorMessage(err, 'Could not load past payroll runs.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink">Past payroll runs</h2>
          <p className="text-[11.5px] text-muted-foreground">Every month payroll was started, and whether it is a draft, approved or paid.</p>
        </div>
        <button
          type="button"
          onClick={onUploadHistory}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile border border-border bg-white text-[11.5px] font-semibold text-ink hover:bg-secondary transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload history
        </button>
      </div>

      {!runs && <FigbloomLoader label="Loading payroll runs" size={48} />}
      {error && <div className="rounded-tile bg-orange-tint text-status-danger text-[11.5px] font-semibold px-3 py-2">{error}</div>}
      {runs && !error && runs.length === 0 && (
        <Card>
          <EmptyState icon={<History className="w-5 h-5" />} title="No payroll runs yet" description="Start a month's payroll on the Run tab and it shows here." />
        </Card>
      )}
      {runs && runs.length > 0 && (
        <Card padding="none" className="overflow-hidden">
          <TableScroll>
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 border-b border-border">
                <tr className="text-left text-[10px] font-bold uppercase text-subtle">
                  <th className="px-4 py-2.5">Month</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Started</th>
                  <th className="px-4 py-2.5">Approved</th>
                  <th className="px-4 py-2.5">Paid</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-[#F1F5F2] last:border-0 text-ink">
                    <td className="px-4 py-2.5 font-bold whitespace-nowrap">{monthLabel(run.pay_period)}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill label={RUN_STATUS[run.status].label} tone={RUN_STATUS[run.status].tone} />
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{date(run.created_at)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{date(run.approved_at)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{date(run.paid_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => onOpen(run.pay_period)} className="text-brand font-semibold whitespace-nowrap">
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}
    </div>
  );
}
