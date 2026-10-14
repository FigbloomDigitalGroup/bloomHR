import { ReactNode, useEffect, useId, useRef } from 'react';

const maxWidths = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
} as const;

export type ModalSize = keyof typeof maxWidths;

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** names the dialog for screen readers; shown as a heading unless `hideTitle` */
  title: ReactNode;
  hideTitle?: boolean;
  children: ReactNode;
  size?: ModalSize;
  /** classes for the panel (padding, rounding, background) */
  className?: string;
  /** set false for dialogs that must not close on a stray tap, e.g. while saving */
  closeOnBackdrop?: boolean;
}

// One modal shell that fits any screen: the overlay pads the panel off the edges and scrolls when the
// panel is taller than the screen, and the panel never grows wider than the screen. Escape and a tap
// on the backdrop close it.
export default function Modal({
  open,
  onClose,
  title,
  hideTitle = false,
  children,
  size = 'lg',
  className = 'bg-white rounded-2xl shadow-xl p-6',
  closeOnBackdrop = true,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-black/50"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full ${maxWidths[size]} max-h-[90vh] overflow-y-auto outline-none ${className}`}
      >
        <h2 id={titleId} className={hideTitle ? 'sr-only' : 'text-lg font-semibold text-ink mb-4 pr-8'}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
