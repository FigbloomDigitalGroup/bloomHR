import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileSignature, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, EmployeePicker, EmptyState, Modal, StatusPill, TabBar } from '../UI';
import { useEmployeeDirectory } from '../../hooks/useEmployeeDirectory';
import { employeeLabel } from '../../lib/employeeDirectory';
import { formatDay, parseDay } from '../../lib/contract';
import { confirmDialog } from '../../lib/confirmDialog';
import {
  CONTRACT_FILE_ACCEPT,
  STATUS_LABEL,
  STATUS_TONE,
  canCancel,
  cancelContract,
  contractFileProblem,
  dueState,
  listContracts,
  matchesFilter,
  openContractFile,
  reviewContract,
  sendContracts,
  type ContractFilter,
  type SigningContract,
} from '../../lib/contractSigning';

const input = 'w-full border border-border rounded-xl px-3 py-2.5 text-[12.5px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/40';
const day = (d: string | null | undefined) => formatDay(parseDay(d)) || '—';
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** onSent(true) when everyone got it (the form closes); onSent(false) when some didn't (it stays open with just them). */
function SendContractModal({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: (all: boolean) => void }) {
  const { employees } = useEmployeeDirectory();
  const [chosen, setChosen] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [signBy, setSignBy] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const names = useMemo(() => new Map(employees.map((e) => [e.employeeNumber, employeeLabel(e)])), [employees]);
  const fileProblem = file ? contractFileProblem(file, 'contract') : null;
  const notChosen = useCallback((e: { employeeNumber: string }) => !chosen.includes(e.employeeNumber), [chosen]);

  const reset = () => {
    setChosen([]);
    setTitle('');
    setMessage('');
    setSignBy('');
    setFile(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen.length || !title.trim() || !file || fileProblem) return;
    setBusy(true);
    try {
      const { sent, failed } = await sendContracts({ employeeNumbers: chosen, title, message, signBy: signBy || null, file });
      if (sent.length) toast.success(sent.length === 1 ? 'Contract sent' : `Contract sent to ${sent.length} people`);
      if (failed.length) {
        toast.error(
          failed.map((f) => `${names.get(f.employeeNumber) || f.employeeNumber}: ${f.error}`).join('\n'),
          { duration: 8000 }
        );
        // keep the form open with only the people it didn't reach
        setChosen(failed.map((f) => f.employeeNumber));
        if (sent.length) onSent(false);
      } else {
        reset();
        onSent(true);
      }
    } catch (err) {
      toast.error(errorText(err, 'Could not send the contract'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Send a contract to sign" size="xl">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <EmployeePicker
            label="Send to"
            value=""
            onChange={(emp) => emp && setChosen((prev) => (prev.includes(emp.employeeNumber) ? prev : [...prev, emp.employeeNumber]))}
            filter={notChosen}
            placeholder={chosen.length ? 'Add someone else…' : 'Search by name or ID...'}
          />
          {chosen.length > 0 && (
            <ul className="m-0 mt-2 p-0 list-none flex flex-wrap gap-1.5" aria-label="Sending to">
              {chosen.map((n) => (
                <li key={n} className="inline-flex items-center gap-1 rounded-full bg-green-tint text-brand px-2.5 py-1 text-[11.5px] font-semibold">
                  {names.get(n) || n}
                  <button type="button" aria-label={`Remove ${names.get(n) || n}`} onClick={() => setChosen((prev) => prev.filter((x) => x !== n))}>
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 mt-1 text-[11px] text-subtle">Each person gets their own copy to sign, tracked separately.</p>
        </div>
        <div>
          <label htmlFor="contract-title" className="block text-xs font-semibold text-ink mb-1">Title</label>
          <input id="contract-title" className={input} value={title} maxLength={200} placeholder="e.g. Employment contract 2027" onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="contract-file" className="block text-xs font-semibold text-ink mb-1">Contract file (PDF or Word, up to 20 MB)</label>
          <input id="contract-file" type="file" accept={CONTRACT_FILE_ACCEPT} className="block w-full text-[12.5px] text-ink" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          {fileProblem && <p role="alert" className="m-0 mt-1 text-[11.5px] text-status-danger">{fileProblem}</p>}
        </div>
        <div>
          <label htmlFor="contract-message" className="block text-xs font-semibold text-ink mb-1">Message (optional)</label>
          <textarea id="contract-message" rows={3} maxLength={2000} className={`${input} resize-none`} value={message} placeholder="Anything they should know before signing" onChange={(e) => setMessage(e.target.value)} />
        </div>
        <div className="sm:w-1/2">
          <label htmlFor="contract-sign-by" className="block text-xs font-semibold text-ink mb-1">Sign by (optional)</label>
          <input id="contract-sign-by" type="date" min={today()} className={input} value={signBy} onChange={(e) => setSignBy(e.target.value)} />
        </div>
        <p className="m-0 text-[11px] text-subtle">They are notified, download it from Contracts in the staff portal and upload the signed copy for you to review.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !chosen.length || !title.trim() || !file || !!fileProblem} icon={<Send className="w-3.5 h-3.5" />}>
            {busy ? 'Sending…' : chosen.length > 1 ? `Send to ${chosen.length} people` : 'Send contract'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ContractDetailModal({ contract, onClose, onChanged }: { contract: SigningContract | null; onClose: () => void; onChanged: () => void }) {
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSendingBack(false);
    setReason('');
  }, [contract?.id]);

  if (!contract) return null;
  const c = contract;

  const open = async (which: 'contract' | 'signed') => {
    try {
      await openContractFile(c, which);
    } catch (err) {
      toast.error(errorText(err, 'Could not open the file'));
    }
  };
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, 'Something went wrong'));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    const ok = await confirmDialog({
      title: 'Cancel this contract?',
      message: `${c.employee_name || c.employee_number} will be told it was cancelled, and will no longer see "${c.title}" or be able to sign it.`,
      confirmLabel: 'Cancel contract',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (ok) await act(() => cancelContract(c.id), 'Contract cancelled');
  };

  const timeline: [string, string | null][] = [
    ['Sent', c.sent_at],
    ['First opened', c.viewed_at],
    ['Signed copy uploaded', c.signed_at],
    [c.status === 'accepted' ? 'Accepted' : 'Reviewed', c.reviewed_at],
    ['Cancelled', c.cancelled_at],
  ];

  return (
    <Modal open onClose={onClose} title={c.title} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} />
          <span className="text-[12.5px] text-ink font-semibold">{c.employee_name || c.employee_number}</span>
          <span className="text-[11.5px] text-muted-foreground">{c.employee_number}</span>
        </div>
        <dl className="m-0 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sign by</dt>
            <dd className="m-0 text-[13px] text-ink">{c.sign_by ? day(c.sign_by) : 'No date set'}</dd>
          </div>
          {timeline.filter(([, at]) => at).map(([label, at]) => (
            <div key={label}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="m-0 text-[13px] text-ink">{day(at)}</dd>
            </div>
          ))}
        </dl>
        {c.message && <p className="m-0 text-[12.5px] text-ink whitespace-pre-line"><span className="font-semibold">Message: </span>{c.message}</p>}
        {c.send_back_reason && (c.status === 'sent_back' || c.status === 'signed') && (
          <p className="m-0 text-[12.5px] text-ink"><span className="font-semibold">{c.status === 'signed' ? 'Last sent back because: ' : 'Sent back because: '}</span>{c.send_back_reason}</p>
        )}
        {c.cancel_reason && <p className="m-0 text-[12.5px] text-ink"><span className="font-semibold">Cancelled because: </span>{c.cancel_reason}</p>}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => open('contract')} icon={<Download className="w-3.5 h-3.5" />}>Contract sent</Button>
          {c.signed_path && (
            <Button variant="secondary" onClick={() => open('signed')} icon={<Download className="w-3.5 h-3.5" />}>Signed copy</Button>
          )}
        </div>

        {c.status === 'signed' && !sendingBack && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
            <Button variant="secondary" disabled={busy} onClick={() => setSendingBack(true)}>Send back</Button>
            <Button disabled={busy} onClick={() => act(() => reviewContract(c.id, true), 'Signed contract accepted')}>Accept signed copy</Button>
          </div>
        )}
        {c.status === 'signed' && sendingBack && (
          <div className="space-y-2 border-t border-border pt-3">
            <label htmlFor="contract-send-back" className="block text-xs font-semibold text-ink">What needs fixing?</label>
            <textarea
              id="contract-send-back"
              rows={3}
              maxLength={1000}
              className={`${input} resize-none`}
              value={reason}
              placeholder="e.g. Signature missing on page 3"
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setSendingBack(false)}>Back</Button>
              <Button disabled={busy || !reason.trim()} onClick={() => act(() => reviewContract(c.id, false, reason), 'Sent back to the employee')}>
                Send back
              </Button>
            </div>
          </div>
        )}
        {canCancel(c.status) && (
          <div className="flex justify-start">
            <Button variant="ghost" disabled={busy} onClick={cancel}>Cancel this contract</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

const filters: { id: ContractFilter; label: string }[] = [
  { id: 'review', label: 'To review' },
  { id: 'waiting', label: 'With the employee' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'all', label: 'All' },
];

/** HR Lifecycle > Contracts: send contracts to sign, and follow each one until the signed copy is accepted. */
export default function ContractsModule() {
  const [contracts, setContracts] = useState<SigningContract[] | null>(null);
  const [filter, setFilter] = useState<ContractFilter>('review');
  const [selected, setSelected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await listContracts();
      setContracts(list);
      return list;
    } catch (err) {
      toast.error(errorText(err, 'Could not load contracts'));
      setContracts([]);
      return [];
    }
  }, []);

  useEffect(() => {
    // open on "To review" when something is waiting, otherwise on everything still with employees
    load().then((list) => {
      if (!list.some((c) => c.status === 'signed')) setFilter(list.some((c) => matchesFilter(c, 'waiting')) ? 'waiting' : 'all');
    });
  }, [load]);

  const counts = useMemo(() => {
    const all = contracts ?? [];
    return Object.fromEntries(filters.map((f) => [f.id, all.filter((c) => matchesFilter(c, f.id)).length])) as Record<ContractFilter, number>;
  }, [contracts]);
  const shown = useMemo(() => (contracts ?? []).filter((c) => matchesFilter(c, filter)), [contracts, filter]);
  const current = useMemo(() => (contracts ?? []).find((c) => c.id === selected) ?? null, [contracts, selected]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <TabBar items={filters.map((f) => ({ id: f.id, label: `${f.label} (${counts[f.id]})` }))} activeId={filter} onChange={(id) => setFilter(id as ContractFilter)} />
        <Button onClick={() => setSending(true)} icon={<Send className="w-3.5 h-3.5" />}>Send contract</Button>
      </div>
      {contracts === null ? (
        <div className="p-6 text-sm text-gray-500">Loading…</div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<FileSignature className="w-4 h-4" />}
          title={filter === 'review' ? 'No signed contracts to review' : 'No contracts here'}
          description="Send a contract to one or more employees; they download it in the staff portal and upload the signed copy here for you to review."
        />
      ) : (
        <Card padding="none">
          <ul className="m-0 p-0 list-none divide-y divide-border">
            {shown.map((c) => {
              const due = dueState(c);
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => setSelected(c.id)} className="w-full text-left px-4 py-3 hover:bg-background flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-ink truncate">{c.employee_name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {c.employee_number} · {c.title}
                      </div>
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">
                      Sent {day(c.sent_at)}
                      {c.sign_by && (
                        <span className={due === 'overdue' ? 'text-status-danger font-semibold' : due === 'due-soon' ? 'text-orange-text-alt font-semibold' : ''}>
                          {' '}· sign by {day(c.sign_by)}{due === 'overdue' ? ' (overdue)' : ''}
                        </span>
                      )}
                    </div>
                    <StatusPill label={STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <SendContractModal
        open={sending}
        onClose={() => setSending(false)}
        onSent={(all) => {
          if (all) setSending(false);
          setFilter('waiting');
          load();
        }}
      />
      <ContractDetailModal contract={current} onClose={() => setSelected(null)} onChanged={() => load()} />
    </div>
  );
}
