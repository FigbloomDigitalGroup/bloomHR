import type { ReactNode } from 'react';

// Pieces the product previews share. A preview is a picture of the app drawn with the app's own look (tokens, radii,
// type sizes), filled with made-up people and numbers. It is never interactive and says "Sample data": nothing in it is
// a customer or a result.

/** Wraps a preview so a screen reader gets one sentence about it instead of a pile of fragments. */
export function PreviewFrame({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="img" aria-label={label} className={className}>
      <div aria-hidden="true" className="select-none">
        {children}
      </div>
    </div>
  );
}

export function SampleTag({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-pill bg-secondary px-2 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground ${className}`}>
      Sample data
    </span>
  );
}

/** The surface every preview sits on: the app's card, with a soft lift. */
export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-card border border-border bg-white shadow-[0_1px_0_rgba(22,32,26,0.04),0_22px_48px_-28px_rgba(22,32,26,0.35)] ${className}`}>{children}</div>
  );
}

export function Initials({ name, tone = 'brand', size = 32 }: { name: string; tone?: 'brand' | 'tint' | 'orange'; size?: number }) {
  const letters = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');
  const colours = { brand: 'bg-brand text-white', tint: 'bg-green-tint text-brand', orange: 'bg-orange-tint-alt text-orange-text-alt' }[tone];
  return (
    <span className={`grid shrink-0 place-items-center rounded-full text-[11px] font-semibold ${colours}`} style={{ width: size, height: size }}>
      {letters}
    </span>
  );
}

/** A thin progress bar with its value as text beside it (never colour alone). */
export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-pill bg-secondary">
        <div className="h-full rounded-pill bg-brand" style={{ width: `${value}%` }} />
      </div>
      <div className="mt-1 text-[10.5px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** Small uppercase mono label, the page's way of naming things. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[11px] font-medium uppercase tracking-[0.14em] ${className}`}>{children}</span>;
}
