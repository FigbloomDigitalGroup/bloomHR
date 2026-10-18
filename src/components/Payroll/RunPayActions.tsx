import { TabletSmartphone } from 'lucide-react';
import { IN_APP_PAYMENTS } from '../../lib/inAppPayments';
import type { PayrollRun, PayrollRunCountry } from '../../lib/payrollRuns';
import RunPaymentsPanel from './RunPaymentsPanel';
import PayrollExportsPanel from './PayrollExportsPanel';

// The payroll page's ways to pay staff. With in-app paying off (lib/inAppPayments) finance pays by uploading the
// downloaded files to the bank, so only the downloads show.

interface BulkPayButtonProps {
  label: string;
  onClick: () => void;
  disabled: boolean;
  title?: string;
}

/** "Make Bulk Pay": sends money through the M-Pesa server. Hidden while in-app paying is off. */
export function BulkPayButton({ label, onClick, disabled, title }: BulkPayButtonProps) {
  if (!IN_APP_PAYMENTS) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-tile bg-brand text-white text-xs font-bold hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <TabletSmartphone className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

/**
 * A month with an approved or paid country (FIG-905: each country is approved on its own): "Pay staff" (when in-app
 * paying is on) and the returns and bulk-payment downloads, per country.
 */
export function ApprovedRunPanels({ run, runCountries }: { run: PayrollRun; runCountries?: PayrollRunCountry[] }) {
  const filed = runCountries && runCountries.length ? runCountries.some((c) => c.status !== 'draft') : run.status === 'approved' || run.status === 'paid';
  if (!filed) return null;
  return (
    <>
      {IN_APP_PAYMENTS && <RunPaymentsPanel run={run} />}
      <PayrollExportsPanel run={run} runCountries={runCountries} />
    </>
  );
}
