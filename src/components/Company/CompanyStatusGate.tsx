import { ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { myCompanyStatus, type MyCompanyStatus } from '../../lib/platformOrganisations';
import { isPlatformAdmin } from '../../lib/platformRates';
import { switchToCompany, useMyCompanies } from '../../hooks/useMyCompanies';
import AuthShell, { AuthButton } from './AuthShell';
import FigbloomLoader from '../UI/FigbloomLoader';

/**
 * A company Figbloom has not approved yet (or has rejected, or suspended) gets this screen instead of the app
 * (migration 20261029100000_platform_organisations.sql). The database shuts it out anyway; this says why. Someone who
 * also belongs to an active company can switch to it from here. A platform admin can still open the platform pages.
 * When the status cannot be read (the migration is not applied yet) the app carries on as before.
 */
export default function CompanyStatusGate({ userId, children }: { userId: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const [state, setState] = useState<{ status: MyCompanyStatus | null; platformAdmin: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const status = await myCompanyStatus().catch(() => null);
      const platformAdmin = status && status.status !== 'active' ? await isPlatformAdmin().catch(() => false) : false;
      if (live) setState({ status, platformAdmin });
    })();
    return () => {
      live = false;
    };
  }, [userId]);

  if (!state) return <FigbloomLoader fullScreen label="Loading your workspace" />;
  const { status, platformAdmin } = state;
  if (!status || status.status === 'active') return <>{children}</>;
  if (platformAdmin && pathname.startsWith('/platform/')) return <>{children}</>;
  return <CompanyNotActive userId={userId} company={status} platformAdmin={platformAdmin} />;
}

const COPY: Record<Exclude<MyCompanyStatus['status'], 'active'>, { title: string; text: (name: string) => string }> = {
  pending: {
    title: 'Your company is waiting for approval',
    text: (name) => `Thanks for signing up ${name}. The Figbloom team checks every new company before it opens. We will email you as soon as it is approved, usually within one working day.`,
  },
  rejected: {
    title: 'Your company was not approved',
    text: (name) => `${name} was not approved to use Figbloom HR. If you think this is a mistake, contact the Figbloom team.`,
  },
  suspended: {
    title: 'Your company is suspended',
    text: (name) => `${name} is suspended, so nobody in it can use Figbloom HR for now. Contact the Figbloom team to reactivate it.`,
  },
};

function CompanyNotActive({ userId, company, platformAdmin }: { userId: string; company: MyCompanyStatus; platformAdmin: boolean }) {
  const copy = COPY[company.status as keyof typeof COPY] ?? COPY.suspended;
  const { data: companies } = useMyCompanies();
  const others = (companies ?? []).filter((c) => c.tenant_id !== company.tenant_id);
  const [switching, setSwitching] = useState<string | null>(null);

  const switchTo = async (tenantId: string) => {
    setSwitching(tenantId);
    try {
      await switchToCompany(userId, tenantId);
    } catch (err) {
      toast.error((err as Error).message);
      setSwitching(null);
    }
  };

  return (
    <AuthShell title={copy.title} subtitle={copy.text(company.name)}>
      {company.status !== 'pending' && company.status_reason && (
        <p className="mb-6 text-sm text-gray-700">
          <span className="font-semibold">Reason: </span>
          {company.status_reason}
        </p>
      )}
      {others.length > 0 && (
        <div className="space-y-3 mb-8">
          <p className="text-xs text-gray-500">Meanwhile, you can work in your other company:</p>
          {others.map((c) => (
            <AuthButton key={c.tenant_id} onClick={() => void switchTo(c.tenant_id)} disabled={switching !== null}>
              {switching === c.tenant_id ? 'Switching…' : `Open ${c.name}`}
            </AuthButton>
          ))}
        </div>
      )}
      {platformAdmin && (
        <AuthButton variant="secondary" onClick={() => window.location.assign('/platform/organisations')}>
          Open Organisations
        </AuthButton>
      )}
      <button type="button" onClick={() => supabase.auth.signOut()} className="mt-8 text-gray-500 text-xs font-medium hover:text-gray-900 transition-colors">
        Sign out
      </button>
    </AuthShell>
  );
}
