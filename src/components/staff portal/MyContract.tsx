import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Card, EmptyState, PageHeader } from '../UI';
import { formatDay, parseDay, summarizeContract, type ContractRecord, type ContractState } from '../../lib/contract';

const TONE: Record<ContractState, string> = {
  'no-end': 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  'ending-soon': 'bg-amber-100 text-amber-800',
  expired: 'bg-red-100 text-red-800',
  'not-started': 'bg-blue-100 text-blue-800',
};

const COLUMNS = '"Employee Type", "Job Title", "Job Group", "Manager", "Start Date", "Contract Start Date", "Contract End Date"';

/** The signed-in employee's own contract terms, read from their record. HR keeps these up to date under Employees. */
export default function MyContract() {
  const [record, setRecord] = useState<ContractRecord | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const email = auth.user?.email;
        if (!email) return void (!cancelled && setState('none'));
        const { data, error } = await supabase.from('employees').select(COLUMNS).eq('"Work Email"', email).maybeSingle();
        if (cancelled) return;
        if (error) return setState('error');
        setRecord((data as ContractRecord | null) ?? null);
        setState(data ? 'ready' : 'none');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') return <div className="p-6 text-sm text-gray-500">Loading your contract…</div>;
  if (state === 'error') return <EmptyState icon={<FileText className="w-4 h-4" />} title="Could not load your contract" description="Please refresh the page. If it keeps happening, tell HR." />;
  if (state === 'none' || !record) {
    return <EmptyState icon={<FileText className="w-4 h-4" />} title="No employee record yet" description="Your contract appears here once HR has added you to the company's employee list with your work email." />;
  }

  const summary = summarizeContract(record);
  const rows: [string, string][] = [
    ['Employment type', record['Employee Type'] || '—'],
    ['Job title', record['Job Title'] || '—'],
    ['Job group', record['Job Group'] || '—'],
    ['Reports to', record.Manager || '—'],
    ['Employment start', formatDay(parseDay(record['Start Date'])) || '—'],
    ['Contract start', formatDay(parseDay(record['Contract Start Date'])) || '—'],
    ['Contract end', formatDay(parseDay(record['Contract End Date'])) || 'No end date'],
  ];

  return (
    <div className="p-6">
      <PageHeader title="My contract" subtitle="Your employment terms, as HR has them on record." />
      <Card className="mb-4">
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${TONE[summary.state]}`}>{summary.headline}</span>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 text-[13.5px] text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <p className="text-[12px] text-muted-foreground">Something wrong or out of date? Ask HR to correct it.</p>
    </div>
  );
}
