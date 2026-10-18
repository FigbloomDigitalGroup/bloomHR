import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { TabBar } from '../UI';
import { loadWorkRates, loadWorkTypes } from '../../lib/pieceRateApi';
import type { WorkPerson, WorkRate, WorkType } from '../../lib/pieceRate';
import DailyEntry from './DailyEntry';
import WorkApprovals from './WorkApprovals';
import ContractJobs from './ContractJobs';

// My team > Work (staff portal): a supervisor whose reports are paid by work records their day's work, approves what
// they submit for themselves, and gives and approves their contract jobs. The same screens as the Piece rate page.

type View = 'entry' | 'approvals' | 'jobs';

export default function TeamWork({ people }: { people: WorkPerson[] }) {
  const [view, setView] = useState<View>('entry');
  const [types, setTypes] = useState<WorkType[]>([]);
  const [rates, setRates] = useState<WorkRate[]>([]);

  useEffect(() => {
    Promise.all([loadWorkTypes(), loadWorkRates()])
      .then(([t, r]) => {
        setTypes(t);
        setRates(r);
      })
      .catch((err) => toast.error((err as Error).message));
  }, []);

  return (
    <div className="space-y-3">
      <TabBar
        variant="pill"
        items={[{ id: 'entry', label: 'Record work' }, { id: 'approvals', label: 'Approvals' }, { id: 'jobs', label: 'Contract jobs' }]}
        activeId={view}
        onChange={(id) => setView(id as View)}
      />
      {view === 'entry' && <DailyEntry people={people} types={types} rates={rates} canManage={false} />}
      {view === 'approvals' && <WorkApprovals people={people} types={types} canManage={false} />}
      {view === 'jobs' && <ContractJobs people={people} canManage={false} />}
    </div>
  );
}
