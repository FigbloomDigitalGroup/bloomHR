import Card from '../UI/Card';
import type { Bar } from '../../lib/consoleAnalytics';

// A small horizontal bar chart as a list: every row has its label and its number in text, and the bar only shows the
// size (so it reads without colour, with a screen reader, and in light or dark themes: the bar uses the brand colour on
// the theme's secondary background). Plain CSS: no chart library needed for this, and it fits a phone.

interface BarListProps {
  title: string;
  bars: Bar[];
  /** shown when there is nothing to chart */
  empty?: string;
  /** the label column's width (Tailwind class) */
  labelWidth?: string;
  className?: string;
}

export default function BarList({ title, bars, empty = 'Nothing yet.', labelWidth = 'w-28', className = '' }: BarListProps) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const total = bars.reduce((n, b) => n + b.value, 0);
  return (
    <Card className={className}>
      <h2 className="text-sm font-semibold text-ink mb-3">{title}</h2>
      {bars.length === 0 || total === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5" aria-label={title}>
          {bars.map((b) => (
            <li key={b.key} className="flex items-center gap-3 text-xs">
              <span className={`${labelWidth} shrink-0 text-muted-foreground truncate`} title={b.label}>{b.label}</span>
              <span className="flex-1 h-2 rounded-full bg-secondary overflow-hidden" aria-hidden="true">
                <span className="block h-full bg-brand rounded-full" style={{ width: `${(b.value / max) * 100}%` }} />
              </span>
              <span className="w-8 text-right font-semibold text-ink tabular-nums">{b.value.toLocaleString('en-KE')}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
