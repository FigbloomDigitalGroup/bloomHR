import { useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, Globe2, Lock, MoreHorizontal } from 'lucide-react';
import { Card, StatusPill } from '../UI';
import type { StatusTone } from '../UI';
import type { CountryReadiness, CurrencyTotals } from '../../lib/payroll/multiCountry';
import { approvalSummary } from '../../lib/payroll/multiCountry';
import { moneyRounded } from '../../lib/payroll/currency';

// The Run tab's readiness check per country (FIG-905 stage 2): one run for everyone, but each country is worked out
// on its own rules and approved on its own. Shows each country's payslips and net pay in its currency, what holds it
// back (no rules yet, no rates, a currency mismatch, someone who moved branch) and what is worth checking (missing
// tax or statutory numbers, payment details, pay below the minimum wage). Per-country approve, reopen, mark paid and
// discard are in each country's "…" menu; the main Approve on the run bar approves every country that is ready.

const STATE: Record<CountryReadiness['state'], { label: string; tone: StatusTone }> = {
  ready: { label: 'Ready', tone: 'success' },
  blocked: { label: 'Held back', tone: 'danger' },
  waiting: { label: 'Waiting for rules', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
};

export interface CountryActions {
  onApprove: (country: string) => void;
  onReopen: (country: string) => void;
  onMarkPaid: (country: string) => void;
  onDiscard: (country: string) => void;
}

interface Props {
  readiness: CountryReadiness[];
  /** the run has been started (payslips saved): per-country actions only then */
  runStarted: boolean;
  busy: boolean;
  actions: CountryActions;
}

const item = 'block w-full text-left px-3 py-1.5 text-[11.5px] hover:bg-secondary disabled:opacity-50';

function CountryMenu({ r, busy, actions }: { r: CountryReadiness; busy: boolean; actions: CountryActions }) {
  const [open, setOpen] = useState(false);
  const choices: { label: string; run: () => void }[] = [];
  if (r.state === 'ready') choices.push({ label: `Approve ${r.country} only`, run: () => actions.onApprove(r.country) });
  if (r.state === 'approved') {
    choices.push({ label: `Mark ${r.country} as paid`, run: () => actions.onMarkPaid(r.country) });
    choices.push({ label: `Reopen ${r.country}`, run: () => actions.onReopen(r.country) });
  }
  if ((r.state === 'ready' || r.state === 'blocked') && r.payslips > 0) {
    choices.push({ label: `Discard ${r.country}'s draft`, run: () => actions.onDiscard(r.country) });
  }
  if (choices.length === 0) return null;
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`${r.country} actions`}
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className="p-1 rounded hover:bg-secondary text-subtle disabled:opacity-50"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-52 rounded-tile border border-border bg-white shadow-lg py-1">
          {choices.map((c) => (
            <button
              key={c.label}
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                c.run();
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CountryReadinessPanel({ readiness, runStarted, busy, actions }: Props) {
  const shown = readiness.filter((r) => r.employees > 0 || r.payslips > 0);
  // one country, ready, with nothing to say: the run bar says it all
  if (shown.length === 0) return null;
  if (shown.length === 1 && shown[0].state !== 'waiting' && shown[0].blocking.length === 0 && shown[0].warnings.length === 0 && shown[0].problems.length === 0) {
    return null;
  }
  return (
    <Card padding="none" className="!rounded-xl overflow-hidden" data-testid="country-readiness">
      <div className="flex items-start gap-2 px-4 py-3 border-b border-border">
        <Globe2 className="w-4 h-4 text-brand shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-bold text-ink m-0">By country</h3>
          <p className="text-[11px] text-muted-foreground m-0" data-testid="approval-summary">{approvalSummary(shown)}</p>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((r) => (
          <li key={r.country} className="px-4 py-3 text-xs" data-testid={`country-${r.country}`}>
            <div className="flex flex-wrap items-center gap-2">
              {r.state === 'approved' || r.state === 'paid' ? (
                <Lock className="w-3.5 h-3.5 text-subtle" aria-hidden />
              ) : r.state === 'ready' ? (
                <CheckCircle className="w-3.5 h-3.5 text-status-success" aria-hidden />
              ) : r.state === 'waiting' ? (
                <Clock className="w-3.5 h-3.5 text-subtle" aria-hidden />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-status-danger" aria-hidden />
              )}
              <span className="font-bold text-ink">{r.country}</span>
              <span className="text-subtle">{r.currency}</span>
              <StatusPill label={STATE[r.state].label} tone={STATE[r.state].tone} />
              <span className="flex-1 min-w-0 text-muted-foreground">
                {r.state === 'waiting'
                  ? `${r.employees} ${r.employees === 1 ? 'person' : 'people'}, not calculated`
                  : `${r.payslips} ${r.payslips === 1 ? 'payslip' : 'payslips'} · net ${moneyRounded(r.totals.net, r.currency)}`}
              </span>
              {runStarted && <CountryMenu r={r} busy={busy} actions={actions} />}
            </div>
            {r.blocking.length > 0 && (
              <ul className="mt-1.5 ml-5 space-y-0.5 text-status-danger">
                {r.blocking.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {r.waitingNames.length > 0 && (
              <p className="mt-1 ml-5 text-muted-foreground">
                {r.waitingNames.slice(0, 8).join(', ')}
                {r.waitingNames.length > 8 ? ` and ${r.waitingNames.length - 8} more` : ''}. They are not paid on another country’s rules.
              </p>
            )}
            {r.warnings.length > 0 && (
              <ul className="mt-1.5 ml-5 space-y-0.5 text-orange-text-alt">
                {r.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {r.problems.length > 0 && (
              <details className="mt-1 ml-5">
                <summary className="cursor-pointer text-muted-foreground">Who is missing what</summary>
                <ul className="mt-1 space-y-0.5 text-ink">
                  {r.problems.map((p) => (
                    <li key={`${p.employeeNumber}-${p.problem}`}>
                      <span className="font-semibold">{p.name}</span>: {p.problem}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "KSh 3,100,000 · TSh 12,000,000": totals per currency, side by side, never added together. */
export function CurrencyTotalsText({ totals, field }: { totals: CurrencyTotals[]; field: 'net' | 'gross' | 'deductions' }) {
  if (totals.length === 0) return <>{moneyRounded(0, 'KES')}</>;
  return <>{totals.map((t) => moneyRounded(t[field], t.currency)).join(' · ')}</>;
}
