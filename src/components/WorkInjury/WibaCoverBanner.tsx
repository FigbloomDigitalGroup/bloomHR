import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { coverState, dayKeyOf, type CoverState } from '../../lib/workInjury';
import { loadWibaCover } from '../../lib/workInjuryApi';

/**
 * On the dashboard, for whoever handles incident reports: a warning when the company's work injury (WIBA) insurance
 * is missing, expired or ends within 30 days. Nothing when it is in place (or can't be read).
 */
export default function WibaCoverBanner({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<{ state: CoverState; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    loadWibaCover()
      .then((cover) => {
        if (live) setState(coverState(cover, dayKeyOf(new Date())));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!state || state.state === 'ok') return null;
  const danger = state.state !== 'expiring';
  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-3 flex-wrap rounded-xl border px-4 py-3 text-xs ${
        danger ? 'border-status-danger/30 bg-orange-tint text-status-danger' : 'border-orange/30 bg-orange-tint-alt text-orange-text-alt'
      } ${className}`}
    >
      <span className="flex items-center gap-2 font-semibold">
        <ShieldAlert className="w-4 h-4 shrink-0" /> {state.message}
      </span>
      <button type="button" className="underline font-semibold" onClick={() => navigate('/work-injuries')}>
        {state.state === 'missing' ? 'Add the insurance' : 'Update the insurance'}
      </button>
    </div>
  );
}
