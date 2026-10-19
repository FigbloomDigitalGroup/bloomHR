import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';
import { type RateAnnouncement, longDate, recentPlatformChanges } from '../../lib/platformRates';
import { rateLabel } from '../../lib/statutoryRates';

// FIG-813: tells payroll when Figbloom adds new statutory rates for a country the company pays in: "New Kenya rates
// from 1 July 2026". Each announcement is shown until dismissed (remembered on this device).

const KEY = 'figbloom.platformRatesSeen';

const seenKeys = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
const keyOf = (a: RateAnnouncement) => `${a.country}|${a.from}|${a.addedAt}`;

export default function PlatformRatesBanner({ countries, onOpenRates }: { countries: string[]; onOpenRates: () => void }) {
  const [items, setItems] = useState<RateAnnouncement[]>([]);
  const [seen, setSeen] = useState<string[]>(seenKeys);
  const wanted = countries.map((c) => c.toLowerCase()).sort().join('|');

  useEffect(() => {
    let live = true;
    void recentPlatformChanges().then((all) => {
      if (live) setItems(all.filter((a) => wanted.split('|').includes(a.country.toLowerCase())));
    });
    return () => {
      live = false;
    };
  }, [wanted]);

  const shown = items.filter((a) => !seen.includes(keyOf(a)));
  if (shown.length === 0) return null;
  const dismiss = (a: RateAnnouncement) => {
    const next = [...seen, keyOf(a)].slice(-50);
    setSeen(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // private browsing: shown again next time
    }
  };

  return (
    <div className="space-y-2">
      {shown.map((a) => (
        <div key={keyOf(a)} role="status" className="flex items-start gap-3 rounded-[10px] border border-status-info/30 bg-status-info-tint px-4 py-3">
          <Info className="h-4 w-4 text-status-info shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink">New {a.country} rates from {longDate(a.from)}</p>
            <p className="text-xs text-muted-foreground">
              {a.codes.map((c) => rateLabel(c, a.country)).join(', ')}. Draft payrolls they reach are flagged for recalculation; approved months keep their payslips.{' '}
              <button type="button" className="font-semibold text-brand underline" onClick={onOpenRates}>See the rates</button>
            </p>
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(a)} className="p-1 text-muted-foreground hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
