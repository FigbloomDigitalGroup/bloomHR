import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, HardHat, Plus, Upload } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, SearchInput, StatusPill, TabBar, TableScroll } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import { confirmDialog } from '../../lib/confirmDialog';
import { finishCasual, loadCasuals, loadDayLimit, loadLimitAlerts, rejoinCasual, saveDayLimit } from '../../lib/casualApi';
import { casualName, formatKsh, longDate, today, type CasualWorker, type LimitAlert } from '../../lib/casualPay';
import CasualFormModal from './CasualFormModal';
import CasualUploadModal from './CasualUploadModal';
import CasualDaysGrid from './CasualDaysGrid';
import CasualPayRuns from './CasualPayRuns';
import { casualRateShortfall } from '../../lib/minimumWage';
import { useMinimumWages } from '../../hooks/useMinimumWages';
import { LoaderBlock } from '../UI/FigbloomLoader';

// Casual workers: people paid by the day who are not on the monthly payroll. Payroll and HR register them; their
// supervisor and payroll record the days they work; payroll pays them in pay runs and downloads the payout files.
// A warning shows when someone has worked more days in a row than the company's limit (Employment Act s.37: a casual
// who works continuously for about a month becomes a term employee).

type Tab = 'casuals' | 'days' | 'pay';

function LimitCard({ alerts, limit, canSet, onLimit }: { alerts: LimitAlert[]; limit: number; canSet: boolean; onLimit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(limit));
  const over = alerts.filter((a) => a.level === 'over');
  const near = alerts.filter((a) => a.level === 'near');
  if (!alerts.length && !canSet) return null;
  return (
    <Card className={`mb-4 ${over.length ? 'border-status-danger' : ''}`}>
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle className={`w-4 h-4 mt-0.5 ${over.length ? 'text-status-danger' : 'text-orange-text-alt'}`} />
        <div className="flex-1 min-w-[220px] text-xs text-ink">
          <p className="font-semibold text-[13px]">
            {alerts.length === 0
              ? `Nobody is near ${limit} working days in a row`
              : `${over.length ? `${over.length} over` : ''}${over.length && near.length ? ', ' : ''}${near.length ? `${near.length} near` : ''} the limit of ${limit} days in a row`}
          </p>
          <p className="text-muted-foreground mt-0.5">
            Under the Employment Act (s.37), a casual who works continuously for about a month becomes a term employee, with
            the rights that go with it. A break of 2 days or less (a weekend) doesn&apos;t end a run of days.
          </p>
          {alerts.length > 0 && (
            <ul className="mt-2 space-y-1">
              {alerts.map((a) => (
                <li key={a.employee_number} className="flex flex-wrap items-center gap-2">
                  <StatusPill label={a.level === 'over' ? 'Over the limit' : 'Near the limit'} tone={a.level === 'over' ? 'danger' : 'warning'} />
                  <span className="font-semibold">{a.worker_name}</span>
                  <span className="text-muted-foreground">{a.days_in_a_row} days in a row since {longDate(a.since)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {canSet && (
          editing ? (
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="casual-limit">Warn after</label>
              <input id="casual-limit" inputMode="numeric" className="w-16 rounded-lg border border-border px-2 py-1" value={value} onChange={(e) => setValue(e.target.value)} />
              <span>days</span>
              <Button onClick={() => { onLimit(Number(value)); setEditing(false); }}>Save</Button>
            </div>
          ) : (
            <button type="button" className="text-xs font-semibold text-brand" onClick={() => setEditing(true)}>Change the limit</button>
          )
        )}
      </div>
    </Card>
  );
}

export default function CasualWorkers() {
  const { hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const canPay = !permissionsLoading && hasAnyPermission(['work-records', 'payroll']);
  const canRegister = !permissionsLoading && hasAnyPermission(['work-records', 'payroll', 'employees']);

  const [tab, setTab] = useState<Tab>('casuals');
  const [casuals, setCasuals] = useState<CasualWorker[]>([]);
  const [alerts, setAlerts] = useState<LimitAlert[]>([]);
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [showFinished, setShowFinished] = useState(false);
  const [editing, setEditing] = useState<CasualWorker | null | 'new'>(null);
  const [uploading, setUploading] = useState(false);

  const reloadAlerts = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([loadLimitAlerts(), loadDayLimit()]);
      setAlerts(a);
      setLimit(l);
    } catch (err) {
      console.error('Could not load the day-limit warnings:', err);
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      setCasuals(await loadCasuals());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
    void reloadAlerts();
  }, [reloadAlerts]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const current = useMemo(() => casuals.filter((c) => !c.finished_on), [casuals]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (showFinished ? casuals : current).filter(
      (c) => !q || [casualName(c), c.employee_number, c.id_number, c.phone, c.department].some((v) => String(v ?? '').toLowerCase().includes(q))
    );
  }, [casuals, current, query, showFinished]);
  const alertFor = useMemo(() => new Map(alerts.map((a) => [a.employee_number, a])), [alerts]);
  // daily rates below the per-day minimum wage today (FIG-812 stage 6): a badge, never a block
  const wages = useMinimumWages(today());

  const tabs = [
    { id: 'casuals', label: `Casual workers (${current.length})` },
    { id: 'days', label: 'Days worked' },
    ...(canPay ? [{ id: 'pay', label: 'Pay runs' }] : []),
  ];

  const finish = async (c: CasualWorker) => {
    if (!(await confirmDialog({ title: `Mark ${casualName(c)} as finished today?`, message: 'They stay on record and in past pay runs.', confirmLabel: 'Mark finished' }))) return;
    try {
      await finishCasual(c.employee_number, today());
      toast.success(`${casualName(c)} marked finished`);
      void reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const rejoin = async (c: CasualWorker) => {
    try {
      await rejoinCasual(c.employee_number, today());
      toast.success(`${casualName(c)} taken on again from today`);
      void reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const changeLimit = async (n: number) => {
    try {
      await saveDayLimit(n);
      void reloadAlerts();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const overCount = alerts.filter((a) => a.level === 'over').length;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Casual workers"
        subtitle={
          <>
            <span>Paid by the day, outside the monthly payroll</span>
            {overCount > 0 && <StatusPill label={`${overCount} over the day limit`} tone="danger" />}
          </>
        }
        actions={canRegister && (
          <>
            <Button variant="secondary" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => setUploading(true)}>Upload casuals</Button>
            <Button icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setEditing('new')}>Register a casual</Button>
          </>
        )}
      />

      <LimitCard alerts={alerts} limit={limit} canSet={canRegister} onLimit={(n) => void changeLimit(n)} />

      <TabBar items={tabs} activeId={tab} onChange={(id) => setTab(id as Tab)} className="mb-4" />

      {tab === 'casuals' && (
        <Card padding="none">
          <div className="flex flex-wrap items-center gap-3 p-3 border-b border-border">
            <SearchInput placeholder="Search by name, number, ID or phone" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="inline-flex items-center gap-1.5 text-xs text-ink">
              <input type="checkbox" checked={showFinished} onChange={(e) => setShowFinished(e.target.checked)} />
              Show people who finished
            </label>
          </div>
          {shown.length === 0 ? (
            loading ? <LoaderBlock label="Loading" compact /> : <EmptyState icon={<HardHat className="w-5 h-5" />} title="No casual workers"
              description={canRegister ? 'Register people paid by the day, one at a time or from a spreadsheet.' : 'Casuals you supervise show here.'} />
          ) : (
            <TableScroll>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">ID number</th>
                    <th className="px-3 py-2 font-semibold">Phone</th>
                    <th className="px-3 py-2 font-semibold text-right">Daily rate</th>
                    <th className="px-3 py-2 font-semibold">Department or site</th>
                    <th className="px-3 py-2 font-semibold">Started</th>
                    <th className="px-3 py-2 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => {
                    const alert = alertFor.get(c.employee_number);
                    return (
                      <tr key={c.employee_number} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-ink">{casualName(c)}</span>
                            {c.finished_on && <StatusPill label={`Finished ${longDate(c.finished_on)}`} />}
                            {alert && <StatusPill label={`${alert.days_in_a_row} days in a row`} tone={alert.level === 'over' ? 'danger' : 'warning'} />}
                            {!c.finished_on && casualRateShortfall(c.daily_rate, wages.minimumFor(c.employee_number), wages.settings) !== null && (
                              <StatusPill label="Below minimum wage" tone="warning" />
                            )}
                          </div>
                          <div className="text-[10.5px] text-subtle">{c.employee_number}</div>
                        </td>
                        <td className="px-3 py-2">{c.id_number}</td>
                        <td className="px-3 py-2">{c.phone}</td>
                        <td className="px-3 py-2 text-right">{formatKsh(c.daily_rate)}</td>
                        <td className="px-3 py-2">{c.department}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{longDate(c.start_date)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {canRegister && (
                            <>
                              <button type="button" className="text-brand font-semibold mr-3" onClick={() => setEditing(c)}>Change</button>
                              {c.finished_on ? (
                                <button type="button" className="text-brand font-semibold" onClick={() => void rejoin(c)}>Take on again</button>
                              ) : (
                                <button type="button" className="text-muted-foreground font-semibold" aria-label={`Mark ${casualName(c)} finished`} onClick={() => void finish(c)}>Finished</button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>
      )}

      {tab === 'days' && <CasualDaysGrid casuals={casuals} canApprove={canPay} onChanged={() => void reloadAlerts()} />}
      {tab === 'pay' && canPay && <CasualPayRuns />}

      {editing && (
        <CasualFormModal open casual={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void reload()} />
      )}
      {uploading && <CasualUploadModal open kind="casuals" casuals={casuals} onClose={() => setUploading(false)} onDone={() => void reload()} />}
    </div>
  );
}
