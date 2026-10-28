import BrandMark from '../BrandMark';
import { PAYSLIP_SAMPLE as P, type SampleLine } from './payslipSample';
import { PreviewFrame, SampleTag } from './parts';

// A payslip, drawn the way the app's payslip document lays it out (earnings, deductions, net pay), with the sample
// figures from payslipSample.ts. Always labelled as sample data.

const money = (n: number) => new Intl.NumberFormat('en-GB', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);

function Lines({ title, lines }: { title: string; lines: SampleLine[] }) {
  return (
    <div>
      <div className="border-b border-border pb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
      <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
        {lines.map((line) => (
          <li key={line.label} className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-ink">{line.label}</span>
            <span className="font-mono tabular-nums text-ink">{money(line.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PayslipPreview({ className = '' }: { className?: string }) {
  return (
    <PreviewFrame label={`Sample payslip for a fictional employee: gross pay ${money(P.gross)}, deductions ${money(P.totalDeductions)}, net pay ${money(P.net)} ${P.currency}.`} className={className}>
      <div className="rounded-card bg-white p-5 text-ink shadow-[0_40px_90px_-40px_rgba(0,0,0,0.55)] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-tile bg-brand text-white">
              <BrandMark className="h-5 w-5" />
            </span>
            <div>
              <div className="text-[13.5px] font-bold">{P.company}</div>
              <div className="text-[11.5px] text-muted-foreground">Payslip · {P.month}</div>
            </div>
          </div>
          <SampleTag />
        </div>

        <div className="mt-4 rounded-tile bg-secondary/70 px-3.5 py-2.5">
          <div className="text-[13px] font-semibold">{P.employee}</div>
          <div className="text-[11.5px] text-muted-foreground">
            {P.number} · {P.position}
          </div>
        </div>

        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <Lines title="Earnings" lines={P.earnings} />
          <Lines title="Deductions" lines={P.deductions} />
        </div>

        <div className="mt-5 grid gap-x-8 gap-y-1.5 border-t border-border pt-4 text-[12.5px] sm:grid-cols-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Gross pay</span>
            <span className="font-mono tabular-nums">{money(P.gross)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Deductions</span>
            <span className="font-mono tabular-nums">{money(P.totalDeductions)}</span>
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-3 rounded-tile bg-brand px-4 py-3 text-white">
          <span className="text-[12.5px] font-semibold">Net pay ({P.currency})</span>
          <span className="font-mono text-[20px] font-semibold tabular-nums">{money(P.net)}</span>
        </div>
      </div>
    </PreviewFrame>
  );
}
