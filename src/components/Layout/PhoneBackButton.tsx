import { ChevronLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { canGoBackInApp } from '../../hooks/useBackToClose';

interface PhoneBackButtonProps {
  /** on the start page there is nothing to go back to: the button is not shown */
  atHome: boolean;
  /** where Back goes when this is the first page of the visit (e.g. opened from an email link) */
  onHome: () => void;
  /** only the arrow, for a crowded header */
  compact?: boolean;
  className?: string;
}

// "‹ Back" for phones: the previous page of the app, or the start page when there is none.
export default function PhoneBackButton({ atHome, onHome, compact = false, className = '' }: PhoneBackButtonProps) {
  const navigate = useNavigate();
  const { key } = useLocation();
  if (atHome) return null;

  return (
    <button
      type="button"
      onClick={() => (canGoBackInApp(key) ? navigate(-1) : onHome())}
      aria-label="Back"
      className={`flex items-center shrink-0 rounded-pill text-muted-foreground hover:text-brand hover:bg-secondary transition-colors ${compact ? 'w-9 h-9 justify-center' : 'gap-0.5 -ml-1 pl-1 pr-2.5 py-1.5 text-sm font-semibold'} ${className}`}
    >
      <ChevronLeft className="w-5 h-5 stroke-[2px]" aria-hidden />
      {!compact && <span>Back</span>}
    </button>
  );
}
