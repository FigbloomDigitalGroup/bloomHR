import { Wallet } from 'lucide-react';
import { Card, StatCard } from '../UI';
import { money } from '../../lib/payroll/currency';
import { PER_CURRENCY_NOTE } from '../../lib/reports/groupReports';
import { percentChange } from '../../lib/dashboardStats';
import { ChangeNote } from '../Dashboard/DashboardCharts';

// Money cards that never add currencies together (FIG-905): with one currency, one card per figure as the dashboard
// always showed; with more, one card per currency listing its figures, and the note that totals are per currency.
// A figure with the period before's amount shows the change on it ("+4% on September"), in text colours: a cost going
// up is neither good nor bad on its own.

export interface CurrencyFigures {
  currency: string;
  /** `previous`: the same figure for the period before, when it is known */
  figures: { label: string; amount: number; previous?: number | null }[];
}

export const PerCurrencyNote = () => <p className="text-[11.5px] text-muted-foreground">{PER_CURRENCY_NOTE}</p>;

export default function CurrencyCards({ items, caption, previousLabel }: { items: CurrencyFigures[]; caption?: string; previousLabel?: string }) {
  if (items.length === 0) return null;
  const changeOf = (f: CurrencyFigures['figures'][number]) => (previousLabel ? percentChange(f.amount, f.previous) : null);
  if (items.length === 1) {
    const [only] = items;
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {only.figures.map((f) => {
          const change = changeOf(f);
          return (
            <StatCard
              key={f.label}
              label={caption ? `${f.label} · ${caption}` : f.label}
              value={money(Math.round(f.amount), only.currency)}
              icon={<Wallet className="w-[18px] h-[18px]" strokeWidth={1.8} />}
              tint="green"
              note={change !== null && previousLabel ? <ChangeNote change={change} against={previousLabel} /> : undefined}
            />
          );
        })}
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
            <dl className="space-y-1.5">
              {c.figures.map((f) => {
                const change = changeOf(f);
                return (
                  <div key={f.label} className="flex justify-between gap-3 text-[12.5px]">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="text-right">
                      <span className="font-semibold text-ink">{money(Math.round(f.amount), c.currency)}</span>
                      {change !== null && previousLabel && (
                        <span className="block text-[11px] text-muted-foreground"><ChangeNote change={change} against={previousLabel} /></span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Card>
        ))}
      </div>
      <PerCurrencyNote />
    </div>
  );
}
