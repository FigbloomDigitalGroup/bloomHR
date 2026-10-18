import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { BriefcaseBusiness, Plus } from 'lucide-react';
import { Button, Card, EmptyState, Modal, StatusPill, TabBar, TableScroll } from '../UI';
import { formatKsh, longDate } from '../../lib/casualPay';
import { createJob, loadJobs, moveJob } from '../../lib/pieceRateApi';
import { JOB_STATUS_LABEL, KIND_LABEL, personName, type ContractJob, type JobStatus, type WorkPerson } from '../../lib/pieceRate';
import { openPrivateFile } from '../../lib/privateFiles';

// Contract jobs: a set amount for a piece of work, paid only once it is completed and approved. Payroll or the
// worker's supervisor gives the job; the worker (in the staff portal) or the supervisor marks it completed; payroll or
// the supervisor approves it or sends it back with a reason. Approved jobs are what the payout stage pays.

interface Props {
  people: WorkPerson[];
  canManage: boolean;
  onChanged?: () => void;
}

type View = 'open' | 'completed' | 'approved' | 'all';
const TONE: Record<JobStatus, 'neutral' | 'warning' | 'success' | 'danger'> = {
  open: 'neutral', completed: 'warning', approved: 'success', cancelled: 'danger',
};

const empty = { employee_number: '', title: '', description: '', amount: '', start_date: '', due_date: '' };

export default function ContractJobs({ people, canManage, onChanged }: Props) {
  const [jobs, setJobs] = useState<ContractJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>('open');
  const [form, setForm] = useState<typeof empty | null>(null);
  const [sendingBack, setSendingBack] = useState<ContractJob | null>(null);
  const [reason, setReason] = useState('');

  const byNumber = useMemo(() => new Map(people.map((p) => [p.employee_number, p])), [people]);

  const reload = useCallback(async () => {
    try {
      setJobs(await loadJobs());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const count = (s: JobStatus) => jobs.filter((j) => j.status === s).length;
  const shown = jobs.filter((j) => view === 'all' || j.status === view);

  const act = async (job: ContractJob, status: JobStatus, note?: string, done?: string) => {
    setBusy(true);
    try {
      await moveJob(job.id, status, note);
      toast.success(done ?? `Job ${JOB_STATUS_LABEL[status].toLowerCase()}`);
      setSendingBack(null);
      setReason('');
      await reload();
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const amount = form ? Number(form.amount.replace(/,/g, '')) : 0;
  const formOk = !!form && !!form.employee_number && !!form.title.trim() && amount > 0 && (!form.start_date || !form.due_date || form.due_date >= form.start_date);

  const save = async () => {
    if (!form || !formOk) return;
    setBusy(true);
    try {
      await createJob({
        employee_number: form.employee_number,
        title: form.title.trim(),
        description: form.description.trim() || null,
        amount,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
      });
      toast.success('Job created; the worker has been told');
      setForm(null);
      setView('open');
      await reload();
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (n: string) => {
    const p = byNumber.get(n);
    return p ? personName(p) : n;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <TabBar
          variant="pill"
          items={[
            { id: 'open', label: `Open (${count('open')})` },
            { id: 'completed', label: `To approve (${count('completed')})` },
            { id: 'approved', label: `Approved (${count('approved')})` },
            { id: 'all', label: 'All' },
          ]}
          activeId={view}
          onChange={(id) => setView(id as View)}
        />
        {people.length > 0 && (
          <div className="ml-auto">
            <Button icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setForm({ ...empty })}>New job</Button>
          </div>
        )}
      </div>

      <Card padding="none">
        {shown.length === 0 ? (
          <EmptyState icon={<BriefcaseBusiness className="w-5 h-5" />} title={loading ? 'Loading...' : 'No jobs here'}
            description={loading ? undefined : 'Give someone a job for a set amount; it is paid once it is completed and approved.'} />
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                  <th className="px-3 py-2 font-semibold">Job</th>
                  <th className="px-3 py-2 font-semibold">Worker</th>
                  <th className="px-3 py-2 font-semibold text-right">Amount</th>
                  <th className="px-3 py-2 font-semibold">Due</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {shown.map((j) => {
                  const p = byNumber.get(j.employee_number);
                  return (
                    <tr key={j.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-ink">{j.title}</div>
                        {j.description && <div className="text-[11px] text-muted-foreground">{j.description}</div>}
                        {j.completion_notes && j.status !== 'open' && <div className="text-[11px] text-muted-foreground">Done: {j.completion_notes}</div>}
                        {j.completion_file && j.status !== 'open' && (
                          <button type="button" className="text-[11px] font-semibold text-brand"
                            onClick={() => openPrivateFile('work-files', j.completion_file as string).catch((e) => toast.error((e as Error).message))}>
                            View {j.completion_file_name || 'file'}
                          </button>
                        )}
                        {j.sent_back_reason && j.status === 'open' && <div className="text-[11px] text-status-danger">Sent back: {j.sent_back_reason}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-ink">{nameOf(j.employee_number)}</div>
                        <div className="text-[10.5px] text-subtle">{j.employee_number}{p ? ` · ${KIND_LABEL[p.worker_kind]}` : ''}</div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{formatKsh(j.amount)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{longDate(j.due_date)}</td>
                      <td className="px-3 py-2">
                        <StatusPill label={j.paid_out_at ? 'Paid' : JOB_STATUS_LABEL[j.status]} tone={TONE[j.status]} />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {j.status === 'open' && (
                          <>
                            <button type="button" className="text-brand font-semibold mr-3" disabled={busy} aria-label={`Mark ${j.title} completed`}
                              onClick={() => void act(j, 'completed', undefined, 'Marked completed')}>Mark completed</button>
                            <button type="button" className="text-muted-foreground font-semibold" disabled={busy} aria-label={`Cancel ${j.title}`}
                              onClick={() => void act(j, 'cancelled')}>Cancel</button>
                          </>
                        )}
                        {j.status === 'completed' && (
                          <>
                            <button type="button" className="text-brand font-semibold mr-3" disabled={busy} aria-label={`Approve ${j.title}`}
                              onClick={() => void act(j, 'approved')}>Approve</button>
                            <button type="button" className="text-status-danger font-semibold" disabled={busy} aria-label={`Send back ${j.title}`}
                              onClick={() => setSendingBack(j)}>Send back</button>
                          </>
                        )}
                        {j.status === 'approved' && canManage && !j.paid_out_at && (
                          <button type="button" className="text-muted-foreground font-semibold" disabled={busy} aria-label={`Reopen ${j.title}`}
                            onClick={() => void act(j, 'completed', undefined, 'Reopened: waiting for approval again')}>Reopen</button>
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

      {form && (
        <Modal open onClose={() => setForm(null)} title="New contract job" size="md" closeOnBackdrop={!busy}>
          <div className="space-y-3 text-xs text-ink">
            <label className="block">
              <span className="font-semibold">Worker</span>
              <select aria-label="Worker" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={form.employee_number}
                onChange={(e) => setForm({ ...form, employee_number: e.target.value })}>
                <option value="">Pick someone</option>
                {people.map((p) => (
                  <option key={p.employee_number} value={p.employee_number}>
                    {personName(p)} ({p.employee_number}, {KIND_LABEL[p.worker_kind].toLowerCase()})
                  </option>
                ))}
              </select>
              <span className="block mt-1 text-muted-foreground">
                Paid as they are set up under Workers: an employee through payroll, a contractor with withholding tax.
              </span>
            </label>
            <label className="block">
              <span className="font-semibold">What the job is</span>
              <input aria-label="Job" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={form.title}
                placeholder="Fence the east block" onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className="block">
              <span className="font-semibold">Details (optional)</span>
              <textarea aria-label="Details" rows={2} className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="block">
                <span className="font-semibold">Agreed amount (KSh)</span>
                <input aria-label="Agreed amount" inputMode="decimal" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </label>
              <label className="block">
                <span className="font-semibold">Starts</span>
                <input aria-label="Starts" type="date" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </label>
              <label className="block">
                <span className="font-semibold">Due</span>
                <input aria-label="Due" type="date" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void save()} disabled={busy || !formOk}>Create job</Button>
            </div>
          </div>
        </Modal>
      )}

      {sendingBack && (
        <Modal open onClose={() => setSendingBack(null)} title={`Send back "${sendingBack.title}"`} size="md" closeOnBackdrop={!busy}>
          <div className="space-y-3 text-xs text-ink">
            <p>Say what still needs doing. The worker is told, and the job is open again.</p>
            <textarea aria-label="Reason" className="w-full rounded-lg border border-border p-2" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSendingBack(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void act(sendingBack, 'open', reason, 'Sent back')} disabled={busy || !reason.trim()}>Send back</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
