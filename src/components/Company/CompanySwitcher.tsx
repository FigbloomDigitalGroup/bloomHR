import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Building2, Check, ChevronDown, Plus } from 'lucide-react';
import { useMyCompanies, switchToCompany } from '../../hooks/useMyCompanies';
import { supabase } from '../../lib/supabase';

const roleLabel = (role: string) => role.charAt(0) + role.slice(1).toLowerCase();

interface CompanySwitcherProps {
  /** what the top bar shows: the company profile's name and logo, else the company's own name */
  name: string;
  logoUrl?: string | null;
  onOpenProfile: () => void;
}

/**
 * The company name in the top bar opens one menu: the person's companies (to switch between them), the company
 * profile, and "New company". Staff in a single company only get the profile.
 */
export default function CompanySwitcher({ name, logoUrl, onOpenProfile }: CompanySwitcherProps) {
  const { data: companies = [] } = useMyCompanies();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const canCreate = !(companies.length === 1 && companies[0].role === 'STAFF');

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
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 min-w-0 max-w-full px-1.5 py-1 -mx-1.5 rounded-tile hover:bg-secondary transition-colors"
      >
        {logoUrl ? (
          <img src={logoUrl} alt="" className="w-[26px] h-[26px] rounded-[7px] object-cover flex-shrink-0" />
        ) : (
          <span className="w-[26px] h-[26px] bg-brand rounded-[7px] flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
            {(name || 'F')[0].toUpperCase()}
          </span>
        )}
        <span className="text-[13.5px] font-bold text-ink tracking-tight leading-tight truncate hidden sm:block">{name}</span>
        <ChevronDown className={`w-3 h-3 text-subtle flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2.2} />
      </button>

      {open && (
        <div role="menu" className="absolute left-0 mt-1.5 w-[272px] max-w-[calc(100vw-24px)] bg-white border border-border rounded-card shadow-lg z-50 p-1.5">
          {companies.length > 1 && (
            <>
              <p className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Switch company</p>
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
                  {c.is_current && <Check className="w-4 h-4 text-brand flex-shrink-0" aria-label="Current" />}
                </button>
              ))}
              <div className="border-t border-border my-1" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenProfile();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-tile hover:bg-secondary text-left text-[12.5px] font-semibold text-ink"
          >
            <Building2 className="w-4 h-4 text-muted-foreground" /> Company profile
          </button>
          {canCreate && (
            <Link
              to="/create-company"
              role="menuitem"
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-tile hover:bg-secondary text-[12.5px] font-semibold text-brand"
            >
              <Plus className="w-4 h-4" /> New company
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
