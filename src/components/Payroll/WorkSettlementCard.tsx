import { saveAs } from 'file-saver';
import { Download, Hammer } from 'lucide-react';
import { Card } from '../UI';
import { isSettlementPayslip } from '../../lib/workSettlement';
import { toCsv, whtFile } from '../../lib/payrollExports';
import type { EmployeeRecord } from '../../lib/profileCompleteness';
import { XLSX_TYPE, toXlsx } from '../../lib/xlsxExport';

// The Run tab's summary of the month-end settlement (FIG-812 stage 5): how many on the payroll are paid for work or
// contract jobs, their work, what payouts already paid during the month, arrears carried forward, and the
// contractors' withholding tax with the WHT report for iTax (CSV or Excel), from the month's payslips. Nothing shows
// for a payroll with no one paid for work.

type Payslip = Record<string, unknown>;
const ksh = (n: number) => `KSh ${Math.round(n || 0).toLocaleString()}`;
const sum = (rows: Payslip[], key: string) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

export default function WorkSettlementCard({ payslips, employees, payPeriod, periodLabel }: {
  payslips: Payslip[];
  employees: EmployeeRecord[];
  payPeriod: string;
  periodLabel: string;
}) {
  const settling = payslips.filter(isSettlementPayslip);
  if (settling.length === 0) return null;
  const wht = whtFile(payslips, employees, payPeriod);
  const work = sum(settling, 'work_pay') + sum(settling, 'jobs_pay');
  const carried = sum(settling, 'arrears_carried_forward');

  const download = (format: 'csv' | 'xlsx') =>
    format === 'xlsx'
      ? saveAs(new Blob([toXlsx(wht.headers, wht.rows, 'KRA WHT')], { type: XLSX_TYPE }), `kra-wht-${payPeriod}.xlsx`)
      : saveAs(new Blob([toCsv(wht.headers, wht.rows)], { type: 'text/csv;charset=utf-8' }), `kra-wht-${payPeriod}.csv`);

  return (
    <Card padding="sm" className="!rounded-xl">
      <div className="flex flex-wrap items-start gap-2 text-xs" data-testid="work-settlement-summary">
        <Hammer className="w-4 h-4 text-brand shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 basis-56 text-ink space-y-0.5">
          <p className="m-0">
            <span className="font-semibold">Piece rate and contract jobs:</span> {settling.length}{' '}
            {settling.length === 1 ? 'person is' : 'people are'} settled for {periodLabel}. Work and jobs {ksh(work)}, already paid during
            the month {ksh(sum(settling, 'paid_out'))}, to pay now {ksh(sum(settling, 'net_pay'))}.
          </p>
          {carried > 0 && (
            <p className="m-0 text-muted-foreground">{ksh(carried)} carried forward as arrears, taken from next month&apos;s pay.</p>
          )}
          {wht.rows.length > 0 && (
            <p className="m-0 text-muted-foreground">
              Withholding tax on {wht.rows.length} {wht.rows.length === 1 ? 'contractor' : 'contractors'}: {ksh(sum(payslips.filter((p) => p.worker_kind === 'contractor'), 'wht_tax'))}
              {wht.problems.length > 0 && `, ${wht.problems.length} without a KRA PIN`}.
            </p>
          )}
        </div>
        {wht.rows.length > 0 && (
          <div className="inline-flex items-stretch rounded-tile border border-border bg-white text-[11px] font-semibold text-ink overflow-hidden">
            <span className="inline-flex items-center gap-1 px-2 text-muted-foreground">
              <Download className="w-3 h-3" aria-hidden />
              WHT report
            </span>
            <button type="button" aria-label="Download WHT report CSV" onClick={() => download('csv')} className="px-2.5 py-1.5 border-l border-border hover:bg-secondary">
              CSV
            </button>
            <button type="button" aria-label="Download WHT report Excel" onClick={() => download('xlsx')} className="px-2.5 py-1.5 border-l border-border hover:bg-secondary">
              Excel
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
