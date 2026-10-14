import { Download, FileText, FolderDown } from 'lucide-react';
import { Card, EmptyState } from '../UI';
import type { PayrollRun } from '../../lib/payrollRuns';
import { ApprovedRunPanels } from './RunPayActions';

// The Files tab: the month's KRA P10, SHA and NSSF returns and the bank, M-Pesa and Equity bulk-payment files (the
// exports panel, once the month is approved), plus the P9 tax card and the payroll table export.

interface PayrollFilesTabProps {
  periodLabel: string;
  /** the month's run, null when it hasn't been started (or is still loading) */
  run: PayrollRun | null;
  onOpenP9: () => void;
  onOpenExport: () => void;
  onGoToRun: () => void;
}

const tool =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile border border-border bg-white text-[11.5px] font-semibold text-ink hover:bg-secondary transition-colors';

export default function PayrollFilesTab({ periodLabel, run, onOpenP9, onOpenExport, onGoToRun }: PayrollFilesTabProps) {
  return (
    <div className="space-y-4">
      {run && (run.status === 'approved' || run.status === 'paid') ? (
        <ApprovedRunPanels run={run} />
      ) : (
        <Card>
          <EmptyState
            icon={<FolderDown className="w-5 h-5" />}
            title={`Approve payroll for ${periodLabel} first`}
            description="The P10, SHA, NSSF, bank and Equity files are made from the approved payslips."
            action={
              <button type="button" onClick={onGoToRun} className={tool}>
                Go to Run
              </button>
            }
          />
        </Card>
      )}

      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px]">
            <div className="text-xs font-bold text-ink">Other downloads</div>
            <div className="text-[11px] text-muted-foreground">An employee's P9 tax card for the year, or this month's payroll table.</div>
          </div>
          <button type="button" onClick={onOpenP9} className={tool}>
            <FileText className="w-3.5 h-3.5" />
            P9
          </button>
          <button type="button" onClick={onOpenExport} className={tool}>
            <Download className="w-3.5 h-3.5" />
            Export payroll table
          </button>
        </div>
      </Card>
    </div>
  );
}
