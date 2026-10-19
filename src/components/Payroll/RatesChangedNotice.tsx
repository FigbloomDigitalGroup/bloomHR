import { useEffect, useState } from 'react';
import { AlertTriangle, Globe } from 'lucide-react';
import { isPlatformAdmin } from '../../lib/platformRates';

// FIG-813: a draft payroll worked out before the statutory rates for its month changed (a new platform rate, or the
// company's own) is held back from approval until it is recalculated. Approved and paid months never change.

export function RatesChangedNotice({
  countries,
  periodLabel,
  busy,
  onRecalculate,
}: {
  countries: string[];
  periodLabel: string;
  busy: boolean;
  onRecalculate: () => void;
}) {
  if (countries.length === 0) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-orange/40 bg-orange-tint px-4 py-3">
      <AlertTriangle className="h-4 w-4 text-orange shrink-0" />
      <div className="flex-1 min-w-[220px]">
        <p className="text-sm font-semibold text-ink">Rates changed since this was calculated</p>
        <p className="text-xs text-muted-foreground">
          The statutory rates for {periodLabel} changed after {countries.join(', ')} {countries.length === 1 ? 'was' : 'were'} worked out. Recalculate before
          approving: until then {countries.length === 1 ? 'it is' : 'they are'} held back. Approved months keep their payslips.
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onRecalculate}
        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Recalculating…' : 'Recalculate'}
      </button>
    </div>
  );
}

/** On the Rates tab, for Figbloom platform admins only: the way to the platform rates screen. */
export function PlatformRatesLink({ onOpen }: { onOpen: () => void }) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let live = true;
    void isPlatformAdmin().then((ok) => live && setAllowed(ok));
    return () => {
      live = false;
    };
  }, []);
  if (!allowed) return null;
  return (
    <button type="button" onClick={onOpen} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand underline">
      <Globe className="h-3.5 w-3.5" /> Platform rates (Figbloom): new rates from a date for every company
    </button>
  );
}
