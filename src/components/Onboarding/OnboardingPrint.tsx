import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Printer } from 'lucide-react';
import OnboardingSummary from './OnboardingSummary';
import { type OnboardingRecord, errorMessage, loadOnboardingForReview, statusLabel } from '../../lib/onboarding';
import { supabase } from '../../lib/supabase';

// The onboarding form as a printable page: the company, the employee's name and position, the date they submitted,
// and everything they and HR entered. Opened from HR's review panel (/onboarding/:id/print).

interface Company {
  name: string;
  logo: string | null;
}

async function loadCompany(): Promise<Company> {
  const { data: logo } = await supabase.from('company_logo').select('company_name, image_url').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (logo?.company_name) return { name: String(logo.company_name), logo: logo.image_url ? String(logo.image_url) : null };
  const { data: tenant } = await supabase.from('tenants').select('name').limit(1).maybeSingle();
  return { name: String(tenant?.name ?? ''), logo: logo?.image_url ? String(logo.image_url) : null };
}

const date = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleDateString('en-KE', { dateStyle: 'long' }) : 'Not submitted yet');

export default function OnboardingPrint() {
  const { id = '' } = useParams();
  const [record, setRecord] = useState<OnboardingRecord | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadOnboardingForReview(id), loadCompany()]).then(
      ([r, c]) => {
        setRecord(r);
        setCompany(c);
      },
      (err) => setProblem(errorMessage(err, 'Could not load this form.'))
    );
  }, [id]);

  if (problem) return <p className="p-8 text-sm text-status-danger">{problem}</p>;
  if (!record || !company) return <Loader2 className="h-6 w-6 animate-spin text-brand m-8" aria-label="Loading" />;

  const e = record.employee;
  const name = [e['First Name'], e['Middle Name'], e['Last Name']].filter(Boolean).join(' ');
  return (
    <div className="bg-white min-h-screen">
      <div className="max-w-3xl mx-auto p-8 print:p-0">
        <div className="flex justify-end mb-4 print:hidden">
          <button type="button" onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>

        <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-4 mb-6">
          <div className="flex items-center gap-3">
            {company.logo && <img src={company.logo} alt="" className="h-12 w-12 object-contain" />}
            <div>
              <p className="text-lg font-semibold text-ink">{company.name}</p>
              <p className="text-sm text-muted-foreground">Employee onboarding form</p>
            </div>
          </div>
          <dl className="text-sm text-right space-y-0.5">
            <div><dt className="inline text-muted-foreground">Employee: </dt><dd className="inline font-medium text-ink">{name || '—'}</dd></div>
            <div><dt className="inline text-muted-foreground">Position: </dt><dd className="inline text-ink">{String(e['Job Title'] ?? '—')}</dd></div>
            <div><dt className="inline text-muted-foreground">Date submitted: </dt><dd className="inline text-ink">{date(e['onboarding_submitted_at'])}</dd></div>
            <div><dt className="inline text-muted-foreground">Status: </dt><dd className="inline text-ink">{statusLabel(e['onboarding_status'])}</dd></div>
          </dl>
        </header>

        <OnboardingSummary record={record} />

        <footer className="mt-8 pt-4 border-t border-border text-xs text-muted-foreground">
          Payroll number {String(e['Payroll Number'] ?? '—')} · printed {new Date().toLocaleDateString('en-KE', { dateStyle: 'long' })}
        </footer>
      </div>
    </div>
  );
}
