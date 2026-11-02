import type { ReactNode } from 'react';

// A number card in the style of Figbloom Schools' platform console (StatCard there): a small uppercase tracked label,
// a large figure, a short sub-line. Theme tokens only (the card, its border and text follow light and dark pages); the
// figure turns orange only for a number that is genuinely bad, never for decoration.

export interface ConsoleStatProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  alarming?: boolean;
}

export function ConsoleStat({ label, value, sub, alarming }: ConsoleStatProps) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-white px-4 py-3.5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      <div className={`mt-1.5 font-mono text-2xl tracking-tight tabular-nums ${alarming ? 'text-orange' : 'text-ink'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Cards that flow, never squeezed below 180px (four across on a wide screen, one or two on a phone). */
export default function ConsoleStatRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }} role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  );
}
