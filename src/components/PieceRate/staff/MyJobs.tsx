import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BriefcaseBusiness, CheckCircle2, Paperclip } from 'lucide-react';
import { Button, Card, EmptyState, StatusPill } from '../../UI';
import { formatKsh, longDate } from '../../../lib/casualPay';
import { completeMyJob, loadMyJobs, MAX_JOB_FILE_BYTES } from '../../../lib/myWorkApi';
import { openPrivateFile } from '../../../lib/privateFiles';
import { JOB_STATUS_LABEL, type JobStatus } from '../../../lib/pieceRate';
import { jobDue, type MyJob } from '../../../lib/myWork';

// My contract jobs: what was agreed, for how much, by when, and where each stands. I mark an open job done, with an
// optional note and photo or document; my supervisor (or payroll) is told and approves it or sends it back. It is paid
// once approved.

const TONE: Record<JobStatus, 'neutral' | 'warning' | 'success' | 'danger'> = {
  open: 'neutral', completed: 'warning', approved: 'success', cancelled: 'danger',
};
const STATE: Record<JobStatus, string> = { ...JOB_STATUS_LABEL, completed: 'Waiting for approval' };

interface Props {
  employeeNumber: string;
  today: string;
  onChanged?: () => void;
}

export default function MyJobs({ employeeNumber, today, onChanged }: Props) {
  const [jobs, setJobs] = useState<MyJob[] | null>(null);
  const [doing, setDoing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setJobs(await loadMyJobs(employeeNumber));
    } catch (err) {
      toast.error((err as Error).message);
      setJobs([]);
    }
  }, [employeeNumber]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const start = (id: string) => {
    setDoing(id);
    setNote('');
    setFile(null);
  };

  const markDone = async (job: MyJob) => {
    if (file && file.size > MAX_JOB_FILE_BYTES) {
      toast.error('Files can be up to 10 MB');
      return;
    }
    setBusy(true);
    try {
      await completeMyJob(job.id, note, file);
      toast.success('Marked done. Your supervisor has been told.');
      setDoing(null);
      await reload();
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (jobs === null || jobs.length === 0) {
    return (
      <Card>
        <EmptyState icon={<BriefcaseBusiness className="w-5 h-5" />} title={jobs === null ? 'Loading...' : 'No jobs yet'}
          description={jobs === null ? undefined : 'Jobs your supervisor or payroll gives you, for a set amount, show here.'} />
      </Card>
    );
  }

  return (
    <ul className="list-none m-0 p-0 space-y-3">
      {jobs.map((j) => {
        const due = jobDue(j, today);
        return (
          <li key={j.id}>
            <Card padding="sm">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-bold text-ink">{j.title}</div>
                  {j.description && <p className="m-0 text-[12px] text-muted-foreground">{j.description}</p>}
                  <p className="m-0 mt-0.5 text-[12px] text-ink">
                    <strong>{formatKsh(j.amount)}</strong>
                    {j.due_date && (
                      <span className={due === 'overdue' ? 'text-status-danger' : 'text-muted-foreground'}>
                        {' '}· due {longDate(j.due_date)}{due === 'overdue' ? ' (overdue)' : due === 'today' ? ' (today)' : ''}
                      </span>
                    )}
                  </p>
                </div>
                <StatusPill label={j.paid_out_at ? 'Paid' : STATE[j.status]} tone={TONE[j.status]} />
              </div>
              {j.status === 'open' && j.sent_back_reason && (
                <p className="m-0 mt-1 text-[11.5px] text-status-danger">Sent back: {j.sent_back_reason}</p>
              )}
              {j.status !== 'open' && j.completion_notes && <p className="m-0 mt-1 text-[11.5px] text-muted-foreground">Your note: {j.completion_notes}</p>}
              {j.status !== 'open' && j.completion_file && (
                <button type="button" className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand"
                  onClick={() => openPrivateFile('work-files', j.completion_file as string).catch((e) => toast.error((e as Error).message))}>
                  <Paperclip className="w-3 h-3" /> {j.completion_file_name || 'File'}
                </button>
              )}
              {j.status === 'approved' && !j.paid_out_at && <p className="m-0 mt-1 text-[11.5px] text-muted-foreground">Approved: it will be paid with your next payout.</p>}

              {j.status === 'open' && doing !== j.id && (
                <div className="mt-2">
                  <Button icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => start(j.id)}>Mark done</Button>
                </div>
              )}
              {j.status === 'open' && doing === j.id && (
                <div className="mt-2 space-y-2">
                  <label className="block text-[12px] text-ink">
                    Note (optional)
                    <textarea aria-label="Note" rows={2} maxLength={1000} className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-[13px]"
                      value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything your supervisor should know" />
                  </label>
                  <label className="block text-[12px] text-ink">
                    Photo or document (optional, up to 10 MB)
                    <input aria-label="Photo or document" type="file" accept="image/*,application/pdf" className="mt-1 block w-full text-[12px]"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                  <div className="flex gap-2">
                    <Button disabled={busy} onClick={() => void markDone(j)}>Confirm done</Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setDoing(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
