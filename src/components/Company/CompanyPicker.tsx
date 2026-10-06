import { useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import type { Company } from '../../lib/companyApi';
import { markCompanyChosen } from '../../lib/companyChoice';
import { switchToCompany } from '../../hooks/useMyCompanies';
import AuthShell from './AuthShell';

const roleLabel = (role: string) => role.charAt(0) + role.slice(1).toLowerCase();

interface CompanyPickerProps {
  userId: string;
  companies: Company[];
  /** Called when the person keeps the company they are already in. */
  onChosen: () => void;
}

/** Shown after sign-in to someone who belongs to several companies: they work in one at a time. */
export default function CompanyPicker({ userId, companies, onChosen }: CompanyPickerProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const choose = async (company: Company) => {
    if (busyId) return;
    if (company.is_current) {
      markCompanyChosen(userId);
      onChosen();
      return;
    }
    setBusyId(company.tenant_id);
    try {
      await switchToCompany(userId, company.tenant_id);
    } catch (err) {
      toast.error((err as Error).message);
      setBusyId(null);
    }
  };

  return (
    <AuthShell title="Which company are you working in?" subtitle="You belong to more than one. You can switch any time from the top bar.">
      <ul className="space-y-2">
        {companies.map((c) => (
          <li key={c.tenant_id}>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => choose(c)}
              className="w-full flex items-center gap-3 px-3.5 py-3 rounded-tile border border-border bg-white hover:bg-secondary text-left transition-colors disabled:opacity-60"
            >
              <span className="w-8 h-8 rounded-[8px] bg-brand text-white font-bold text-sm flex items-center justify-center flex-shrink-0">
                {c.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] font-bold text-ink truncate">{c.name}</span>
                <span className="block text-[12px] text-muted-foreground">{roleLabel(c.role)}</span>
              </span>
              {busyId === c.tenant_id ? (
                <span className="text-[12px] text-muted-foreground">Opening…</span>
              ) : c.is_current ? (
                <span className="text-[11px] font-semibold text-brand">Last used</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => supabase.auth.signOut()} className="mt-5 text-[12.5px] font-semibold text-muted-foreground">
        Sign out
      </button>
    </AuthShell>
  );
}
