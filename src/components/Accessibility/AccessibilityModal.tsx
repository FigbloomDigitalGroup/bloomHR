import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AccessibilityPanel from './AccessibilityPanel';

/** The accessibility options in a small dialog (Escape or Done closes it). */
export function AccessibilityModal({ onClose }: { onClose: () => void }) {
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="a11y-title"
        className="w-full max-w-[520px] max-h-[90vh] overflow-y-auto rounded-card bg-white p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="a11y-title" className="m-0 text-[17px] font-bold text-ink">
          Accessibility
        </h2>
        <p className="mt-1 mb-4 text-[12.5px] text-muted-foreground">
          Saved on this device only, so a shared computer does not carry one person's settings to the next.
        </p>
        <AccessibilityPanel />
        <div className="mt-5 flex justify-end">
          <button ref={doneRef} type="button" onClick={onClose} className="rounded-tile bg-brand px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-brand-dark">
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** A small button that opens the dialog: for headers and the sign-in page. */
export function AccessibilityButton({ className = '', label = 'Accessibility' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
        className={className || 'inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-ink'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="4.5" r="1.8" />
          <path d="M5 8.5l7 1.2 7-1.2M12 9.7V14m0 0l-3 6.5M12 14l3 6.5" />
        </svg>
      </button>
      {open && <AccessibilityModal onClose={() => setOpen(false)} />}
    </>
  );
}
