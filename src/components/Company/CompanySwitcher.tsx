import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useMyCompanies, switchToCompany } from '../../hooks/useMyCompanies';
import { supabase } from '../../lib/supabase';

const roleLabel = (role: string) => role.charAt(0) + role.slice(1).toLowerCase();

/** A small menu in the top bar to move between the companies the person belongs to, or (for one company) to add one. */
export default function CompanySwitcher() {
  const { data: companies } = useMyCompanies();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!companies || companies.length === 0) return null;

  // one company: nothing to switch to, but adding another must still be one click away
  if (companies.length === 1) {
    if (companies[0].role === 'STAFF') return null;
    return (
      <Link
        to="/create-company"
        className="px-2.5 py-1.5 rounded-tile border border-border text-[12px] font-semibold text-ink hover:bg-secondary transition-colors whitespace-nowrap"
      >
        + New company
      </Link>
    );
  }

  const choose = async (tenantId: string, isCurrent: boolean) => {
    if (isCurrent || busy) return;
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) throw new Error('Please sign in again.');
      await switchToCompany(userId, tenantId);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="px-2.5 py-1.5 rounded-tile border border-border text-[12px] font-semibold text-ink hover:bg-secondary transition-colors"
      >
        Switch company
      </button>
      {open && (
        <div role="menu" className="absolute left-0 mt-1.5 w-[260px] bg-white border border-border rounded-card shadow-lg z-50 p-1.5">
          {companies.map((c) => (
            <button
              key={c.tenant_id}
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => choose(c.tenant_id, c.is_current)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-tile hover:bg-secondary text-left disabled:opacity-60"
            >
              <span className="w-6 h-6 rounded-[6px] bg-brand text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                {c.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-ink truncate">{c.name}</span>
                <span className="block text-[11px] text-muted-foreground">{roleLabel(c.role)}</span>
              </span>
              {c.is_current && <span className="text-[11px] font-semibold text-brand">Current</span>}
            </button>
          ))}
          <div className="border-t border-border mt-1 pt-1">
            <Link to="/create-company" className="block px-2.5 py-2 text-[12px] font-semibold text-brand rounded-tile hover:bg-secondary">
              Create a new company
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
