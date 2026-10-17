import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { PageHeader, StatusPill, TabBar } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import { loadOvertimePeople, loadWaitingOvertime, type OvertimeEntry, type OvertimePerson } from '../../lib/overtimeApi';
import OvertimeWeekGrid from './OvertimeWeekGrid';
import OvertimeWaiting from './OvertimeWaiting';
import OvertimeMonthTotals from './OvertimeMonthTotals';
import OvertimeSettingsCard from './OvertimeSettingsCard';

// Overtime (FIG-889): supervisors and payroll record overtime hours per day, approve what employees ask for in the
// staff portal, and see the month's totals; payroll uploads a spreadsheet and sees what it pays. Approved overtime goes
// straight into the month's payroll, rated by the kind of day. The database shows each person only what they may see.

type Tab = 'week' | 'waiting' | 'month' | 'settings';

export default function OvertimePage() {
  const { hasPermission, hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const canManage = !permissionsLoading && hasAnyPermission(['payroll', 'work-records']);
  const canSeePay = !permissionsLoading && hasPermission('payroll');

  const [tab, setTab] = useState<Tab>('week');
  const [people, setPeople] = useState<OvertimePerson[]>([]);
  const [waiting, setWaiting] = useState<OvertimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [p, w] = await Promise.all([loadOvertimePeople(), loadWaitingOvertime()]);
      setPeople(p);
      // their own requests wait for someone else
      const mine = new Set(p.map((x) => x.employee_number));
      setWaiting(w.filter((e) => mine.has(e.employee_number)));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const changed = () => {
    setVersion((v) => v + 1);
    void reload();
  };

  const tabs = useMemo(() => [
    { id: 'week', label: 'Record hours' },
    { id: 'waiting', label: `Waiting for approval (${waiting.length})` },
    { id: 'month', label: 'Month totals' },
    ...(canSeePay ? [{ id: 'settings', label: 'Settings' }] : []),
  ], [waiting.length, canSeePay]);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Overtime"
        subtitle={
          <>
            <span>Hours worked beyond the normal day, paid with the month&apos;s salary</span>
            {waiting.length > 0 && <StatusPill label={`${waiting.length} waiting`} tone="warning" />}
          </>
        }
      />

      <TabBar items={tabs} activeId={tab} onChange={(id) => setTab(id as Tab)} className="mb-4" />

      {tab === 'week' && <OvertimeWeekGrid people={people} canUpload={canManage} onChanged={changed} />}
      {tab === 'waiting' && <OvertimeWaiting entries={waiting} people={people} loading={loading} onChanged={changed} />}
      {tab === 'month' && <OvertimeMonthTotals people={people} canManage={canManage} canSeePay={canSeePay} version={version} />}
      {tab === 'settings' && canSeePay && <OvertimeSettingsCard canEdit={canSeePay} onChanged={changed} />}
    </div>
  );
}
