import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { PageHeader, TabBar, type TabBarItem } from '../../UI';
import { today as localToday } from '../../../lib/casualPay';
import { loadWorkRates, loadWorkTypes } from '../../../lib/pieceRateApi';
import { DEFAULT_PAST_DAYS, type MyWorkProfile } from '../../../lib/myWork';
import type { WorkRate, WorkType } from '../../../lib/pieceRate';
import RecordMyWork from './RecordMyWork';
import MyEntries from './MyEntries';
import MyJobs from './MyJobs';
import MyEarnings from './MyEarnings';

// The staff portal's "My work" (FIG-812 stage 3), for someone paid by work or given contract jobs: record my work (it
// counts once my supervisor approves it), my entries, my jobs (mark one done) and what I have earned this month, gross
// before deductions. The database keeps all of it to the worker's own rows (20261020100000).

type Part = 'record' | 'entries' | 'jobs' | 'earnings';

export default function MyWork({ profile }: { profile: MyWorkProfile }) {
  const byWork = profile.pay_basis === 'work';
  const [part, setPart] = useState<Part>(byWork ? 'record' : profile.has_jobs ? 'jobs' : 'earnings');
  const [editDay, setEditDay] = useState<string | null>(null);
  const [types, setTypes] = useState<WorkType[]>([]);
  const [rates, setRates] = useState<WorkRate[]>([]);
  const [version, setVersion] = useState(0);

  const today = profile.today ?? localToday();
  const closed = profile.closed_months ?? [];
  const pastDays = profile.past_days ?? DEFAULT_PAST_DAYS;
  const employeeNumber = profile.employee_number ?? '';

  useEffect(() => {
    if (!byWork) return;
    Promise.all([loadWorkTypes(), loadWorkRates()])
      .then(([t, r]) => {
        setTypes(t);
        setRates(r);
      })
      .catch((e) => toast.error((e as Error).message));
  }, [byWork]);

  const tabs: TabBarItem[] = [
    ...(byWork ? [{ id: 'record', label: 'Record my work' }, { id: 'entries', label: 'My entries' }] : []),
    ...(profile.has_jobs ? [{ id: 'jobs', label: 'My jobs' }] : []),
    { id: 'earnings', label: 'Earnings' },
  ];
  const changed = () => setVersion((v) => v + 1);

  return (
    <div className="px-1 py-2 md:p-6">
      <PageHeader title="My work" subtitle="Record the work you do, mark your jobs done and see what you have earned" />
      <TabBar items={tabs} activeId={part} onChange={(id) => setPart(id as Part)} className="mb-4" />
      {part === 'record' && byWork && (
        <RecordMyWork
          key={editDay ?? 'today'}
          employeeNumber={employeeNumber}
          types={types}
          rates={rates}
          today={today}
          pastDays={pastDays}
          closedMonths={closed}
          initialDay={editDay ?? undefined}
          onChanged={changed}
        />
      )}
      {part === 'entries' && byWork && (
        <MyEntries
          key={version}
          employeeNumber={employeeNumber}
          types={types}
          today={today}
          pastDays={pastDays}
          closedMonths={closed}
          onEdit={(day) => {
            setEditDay(day);
            setPart('record');
          }}
        />
      )}
      {part === 'jobs' && profile.has_jobs && <MyJobs employeeNumber={employeeNumber} today={today} onChanged={changed} />}
      {part === 'earnings' && <MyEarnings key={version} today={today} />}
    </div>
  );
}
