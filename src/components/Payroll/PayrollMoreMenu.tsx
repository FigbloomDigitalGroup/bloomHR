import { ReactNode, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

// The payroll page's "More" menu: the tools used now and then (P9, exports, salary history upload, the statutory
// override), kept out of the way so each tab shows only its main action.

export interface MoreMenuItem {
  label: string;
  icon?: ReactNode;
  /** shown on the right, e.g. a switch's On / Off */
  hint?: string;
  onSelect: () => void;
}

export default function PayrollMoreMenu({ items }: { items: MoreMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-tile border border-border bg-white text-xs font-semibold text-ink hover:bg-secondary transition-colors"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
        More
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1.5 z-40 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-white shadow-lg py-1">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-ink hover:bg-secondary"
            >
              <span className="text-subtle shrink-0">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.hint && <span className="text-[10.5px] font-semibold text-muted-foreground">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
