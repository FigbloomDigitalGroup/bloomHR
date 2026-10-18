import { Wallet } from 'lucide-react';
import { Card, StatCard } from '../UI';
import { money } from '../../lib/payroll/currency';
import { PER_CURRENCY_NOTE } from '../../lib/reports/groupReports';

// Money cards that never add currencies together (FIG-905): with one currency, one card per figure as the dashboard
// always showed; with more, one card per currency listing its figures, and the note that totals are per currency.

export interface CurrencyFigures {
  currency: string;
  figures: { label: string; amount: number }[];
}

export const PerCurrencyNote = () => <p className="text-[11.5px] text-muted-foreground">{PER_CURRENCY_NOTE}</p>;

export default function CurrencyCards({ items, caption }: { items: CurrencyFigures[]; caption?: string }) {
  if (items.length === 0) return null;
  if (items.length === 1) {
    const [only] = items;
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {only.figures.map((f) => (
          <StatCard
            key={f.label}
            label={caption ? `${f.label} · ${caption}` : f.label}
            value={money(Math.round(f.amount), only.currency)}
            icon={<Wallet className="w-[18px] h-[18px]" strokeWidth={1.8} />}
            tint="green"
          />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {items.map((c) => (
          <Card key={c.currency} data-testid={`currency-card-${c.currency}`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-bold text-ink">{c.currency}</h3>
              {caption && <span className="text-[11px] text-muted-foreground">{caption}</span>}
            </div>
            <dl className="space-y-1">
              {c.figures.map((f) => (
                <div key={f.label} className="flex justify-between gap-3 text-[12.5px]">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="font-semibold text-ink">{money(Math.round(f.amount), c.currency)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
      <PerCurrencyNote />
    </div>
  );
}
