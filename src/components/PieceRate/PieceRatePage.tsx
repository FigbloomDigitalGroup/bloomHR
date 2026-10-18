import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { PageHeader, StatusPill, TabBar, type TabBarItem } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import { loadWaitingEntries, loadWorkPeople, loadWorkRates, loadWorkSettings, loadWorkTypes } from '../../lib/pieceRateApi';
import { DEFAULT_WORK_SETTINGS, type WorkPerson, type WorkRate, type WorkSettings, type WorkType } from '../../lib/pieceRate';
import DailyEntry from './DailyEntry';
import WorkApprovals from './WorkApprovals';
import WorkUpload from './WorkUpload';
import ContractJobs from './ContractJobs';
import WorkTotals from './WorkTotals';
import WorkTypes from './WorkTypes';
import WorkerSetup from './WorkerSetup';

// Piece rate and contract jobs (FIG-812 stage 2). Payroll ('work-records' or 'payroll') sets up kinds of work, rates
// and each worker's pay, records and uploads work, approves it, and runs contract jobs. A supervisor records their
// team's work for the day, approves their workers' own submissions and gives and approves their jobs. The database
// decides who may do what (20261014100000, 20261019800000).

type Tab = 'entry' | 'approvals' | 'upload' | 'jobs' | 'totals' | 'types' | 'workers';

export default function PieceRatePage() {
  const { hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const canManage = !permissionsLoading && hasAnyPermission(['work-records', 'payroll']);

  const [tab, setTab] = useState<Tab>('entry');
  const [people, setPeople] = useState<WorkPerson[]>([]);
  const [types, setTypes] = useState<WorkType[]>([]);
  const [rates, setRates] = useState<WorkRate[]>([]);
  const [settings, setSettings] = useState<WorkSettings>(DEFAULT_WORK_SETTINGS);
  const [waiting, setWaiting] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [p, t, r, s] = await Promise.all([loadWorkPeople(), loadWorkTypes(), loadWorkRates(), loadWorkSettings()]);
      setPeople(p);
      setTypes(t);
      setRates(r);
      setSettings(s);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, []);

  const reloadWaiting = useCallback(async () => {
    try {
      setWaiting((await loadWaitingEntries()).length);
    } catch {
      setWaiting(0);
    }
  }, []);

  useEffect(() => {
    void reload();
    void reloadWaiting();
  }, [reload, reloadWaiting]);

  const tabs: TabBarItem[] = [
    { id: 'entry', label: 'Record work' },
    { id: 'approvals', label: waiting ? `Approvals (${waiting})` : 'Approvals' },
    ...(canManage ? [{ id: 'upload', label: 'Upload' }] : []),
    { id: 'jobs', label: 'Contract jobs' },
    { id: 'totals', label: 'Totals' },
    ...(canManage ? [{ id: 'types', label: 'Work types' }, { id: 'workers', label: 'Workers' }] : []),
  ];

  const byWork = people.filter((p) => p.pay_basis === 'work').length;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Piece rate and jobs"
        subtitle={
          <>
            <span>Paid for the work they record, or per job; casual workers on a daily rate are on their own page</span>
            {byWork > 0 && <StatusPill label={`${byWork} paid by work`} tone="info" />}
            {settings.supervisor_work_needs_approval && canManage && <StatusPill label="Supervisors' work waits for payroll" />}
          </>
        }
      />
      <TabBar items={tabs} activeId={tab} onChange={(id) => setTab(id as Tab)} className="mb-4" />
      {tab === 'entry' && <DailyEntry people={people} types={types} rates={rates} canManage={canManage} onChanged={() => void reloadWaiting()} />}
      {tab === 'approvals' && <WorkApprovals people={people} types={types} canManage={canManage} onChanged={() => void reloadWaiting()} />}
      {tab === 'upload' && canManage && <WorkUpload people={people} types={types} />}
      {tab === 'jobs' && <ContractJobs people={people} canManage={canManage} />}
      {tab === 'totals' && <WorkTotals />}
      {tab === 'types' && canManage && <WorkTypes types={types} rates={rates} onChanged={() => void reload()} />}
      {tab === 'workers' && canManage && <WorkerSetup people={people} settings={settings} onChanged={() => void reload()} />}
    </div>
  );
}
