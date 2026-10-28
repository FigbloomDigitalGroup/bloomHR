import { Download, FileText, FolderDown } from 'lucide-react';
import { Card, EmptyState } from '../UI';
import type { PayrollRun, PayrollRunCountry } from '../../lib/payrollRuns';
import { ApprovedRunPanels } from './RunPayActions';
import PayrollExportsPanel from './PayrollExportsPanel';

// The Files tab: grouped by country (FIG-905), each approved country's statutory returns (Kenya: KRA P10, SHA, NSSF,
// housing levy, NITA) and its bulk-payment files in its currency (the exports panel), plus the P9 tax card and the
// payroll table export. A started month that isn't approved yet has its returns as drafts, to check before approving.

interface PayrollFilesTabProps {
  periodLabel: string;
  /** the month's run, null when it hasn't been started (or is still loading) */
  run: PayrollRun | null;
  /** the run's countries: each approved one has its own files */
  runCountries?: PayrollRunCountry[];
  onOpenP9: () => void;
  onOpenExport: () => void;
  onGoToRun: () => void;
}

const tool =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile border border-border bg-white text-[11.5px] font-semibold text-ink hover:bg-secondary transition-colors';

export default function PayrollFilesTab({ periodLabel, run, runCountries, onOpenP9, onOpenExport, onGoToRun }: PayrollFilesTabProps) {
  const filed = !!run && (runCountries && runCountries.length ? runCountries.some((c) => c.status !== 'draft') : run.status === 'approved' || run.status === 'paid');
  return (
    <div className="space-y-4">
      {run && filed ? (
        <ApprovedRunPanels run={run} runCountries={runCountries} />
      ) : run ? (
        <PayrollExportsPanel run={run} runCountries={runCountries} />
      ) : (
        <Card>
          <EmptyState
            icon={<FolderDown className="w-5 h-5" />}
            title={`Start payroll for ${periodLabel} first`}
            description="The returns are made from the month’s payslips: press Start on the Run tab (no approval needed to download drafts)."
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
