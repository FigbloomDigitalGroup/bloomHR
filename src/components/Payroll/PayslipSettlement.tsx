import {
  isContractorPayslip,
  isSettlementPayslip,
  payslipSettlementLines,
  payslipWorkLines,
  whtLabel,
} from '../../lib/workSettlement';
import { currencyOf, money } from '../../lib/payroll/currency';

// The payslip's piece rate parts (FIG-812 stage 5, lib/workSettlement), shared by the admin payslip (PayslipDocument,
// also the emailed PDF), the Run tab's breakdown and the staff portal's payslip: the work earnings ("Piece rate work",
// "Contract jobs"), a contractor's withholding tax, and the month-end settlement from the month's net pay to what is
// paid at month end. Each shows nothing on a salaried payslip.

type Payslip = Record<string, unknown>;
/** an amount in the payslip's own currency (FIG-905): KSh, TSh, USh */
const ksh = (n: number, record: Payslip) => money(n, currencyOf(record));

/** "Piece rate work" (with its kinds of work) and "Contract jobs", as earnings lines. */
export function WorkEarningLines({ record, amountClassName = 'font-semibold' }: { record: Payslip; amountClassName?: string }) {
  return (
    <>
      {payslipWorkLines(record).map((line) => (
        <div key={line.name} className="flex justify-between gap-3" data-testid="work-earning">
          <span>
            {line.name}
            {line.detail.length > 0 && <span className="block text-gray-500 text-xs">{line.detail.join('; ')}</span>}
          </span>
          <span className={`${amountClassName} whitespace-nowrap`}>{ksh(line.amount, record)}</span>
        </div>
      ))}
    </>
  );
}

/** A contractor's withholding tax, as a deductions line. */
export function WhtDeductionLine({ record, amountClassName = 'font-semibold' }: { record: Payslip; amountClassName?: string }) {
  if (!isContractorPayslip(record)) return null;
  return (
    <div className="flex justify-between gap-3" data-testid="wht-line">
      <span>{whtLabel(record)}</span>
      <span className={`${amountClassName} whitespace-nowrap`}>{ksh(Number(record.wht_tax) || 0, record)}</span>
    </div>
  );
}

/** From the month's net pay to what is paid at month end: payouts, holdbacks, arrears. */
export function PayslipSettlementBlock({ record, compact = false }: { record: Payslip; compact?: boolean }) {
  if (!isSettlementPayslip(record)) return null;
  const lines = payslipSettlementLines(record);
  return (
    <div className={compact ? 'space-y-1.5' : 'border border-gray-300 p-4 mb-6 text-black'} data-testid="payslip-settlement">
      <h4 className={compact ? 'text-[10px] font-bold uppercase text-subtle' : 'font-bold border-b border-gray-300 pb-2 mb-2 text-sm text-gray-900'}>
        Month-end settlement
      </h4>
      <div className={compact ? 'space-y-1.5' : 'space-y-1.5 text-xs'}>
        {lines.map((l) => (
          <div key={l.label} className={`flex justify-between gap-3 ${l.kind === 'total' ? 'font-bold' : ''} ${l.kind === 'info' ? 'text-gray-500' : ''}`}>
            <span>
              {l.label}
              {l.note && <span className="block text-gray-500 text-[11px] font-normal">{l.note}</span>}
            </span>
            <span className="whitespace-nowrap">
              {l.kind === 'minus' ? `−${ksh(l.amount, record)}` : l.kind === 'plus' ? `+${ksh(l.amount, record)}` : l.kind === 'info' ? `(${ksh(l.amount, record)})` : ksh(l.amount, record)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The payslip's last line: "Net pay", or "Net to pay at month end" when it settles a month of work. */
export const netPayLabel = (record: Payslip) => (isSettlementPayslip(record) ? 'Net to pay at month end' : 'Net pay');
