import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Info, Users } from 'lucide-react';
import { Button, Card, EmptyState, Modal, SearchInput, StatusPill, TableScroll } from '../UI';
import { saveWorkSettings, setWorkerPay } from '../../lib/pieceRateApi';
import {
  BASIS_LABEL, FREQUENCY_LABEL, KIND_LABEL, WHT_LABEL, personName,
  type PayBasis, type PayFrequency, type WhtCategory, type WorkPerson, type WorkSettings,
} from '../../lib/pieceRate';

// Each worker's pay setup: employee (PAYE, NSSF, SHIF, AHL through payroll) or contractor (withholding tax instead),
// paid a salary or for the work they record, and how often work pay goes out. Casual workers, paid their own daily
// rate in casual pay runs, are set up on the Casual workers page and don't show here. Also the company's setting for
// whether what supervisors submit waits for payroll.

interface Props {
  people: WorkPerson[];
  settings: WorkSettings;
  onChanged: () => void;
}

interface Form {
  person: WorkPerson;
  kind: 'employee' | 'contractor';
  basis: PayBasis;
  frequency: PayFrequency;
  wht: WhtCategory;
}

export default function WorkerSetup({ people, settings, onChanged }: Props) {
  const [query, setQuery] = useState('');
  const [onlyWork, setOnlyWork] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => !onlyWork || p.pay_basis === 'work')
      .filter((p) => !q || [personName(p), p.employee_number, p.department, p.job_title].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [people, query, onlyWork]);
  const byWork = people.filter((p) => p.pay_basis === 'work').length;

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await setWorkerPay(form.person.employee_number, form.kind, form.basis, form.basis === 'salary' ? 'monthly' : form.frequency,
        form.kind === 'contractor' ? form.wht : null);
      toast.success(`${personName(form.person)} saved`);
      setForm(null);
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleApproval = async (on: boolean) => {
    try {
      await saveWorkSettings({ supervisor_work_needs_approval: on });
      toast.success(on ? "Supervisors' work now waits for payroll's approval" : "Supervisors' work now counts as they submit it");
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <Card padding="sm">
        <div className="flex items-start gap-2 text-xs text-ink">
          <Info className="w-4 h-4 mt-0.5 text-status-info shrink-0" />
          <div className="space-y-1">
            <p className="m-0">
              <strong>Paid by work</strong>: an employee or contractor paid for what they produce (kg, crates, pieces, rows) at the
              company&apos;s rate for each kind of work, or a set amount per contract job. Employees stay on the monthly payroll for
              PAYE, NSSF, SHIF and AHL; contractors have withholding tax taken instead.
            </p>
            <p className="m-0 text-muted-foreground">
              Someone paid their own daily rate for days present, outside the payroll, is a <strong>casual worker</strong>: register
              them on the <Link to="/casual-workers" className="text-brand font-semibold">Casual workers</Link> page instead. A person
              is one or the other, never both.
            </p>
          </div>
        </div>
      </Card>

      <Card padding="sm">
        <label className="flex items-start gap-2 text-xs text-ink">
          <input type="checkbox" className="mt-0.5" checked={settings.supervisor_work_needs_approval}
            onChange={(e) => void toggleApproval(e.target.checked)} aria-label="Supervisors' work waits for payroll" />
          <span>
            <strong>Work a supervisor submits waits for payroll&apos;s approval</strong> (recommended, as for casual days). Untick to
            count it as soon as the supervisor submits it. Workers&apos; own submissions always wait for their supervisor.
          </span>
        </label>
      </Card>

      <Card padding="none">
        <div className="flex flex-wrap items-center gap-3 p-3 border-b border-border">
          <SearchInput placeholder="Search by name, number or department" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="inline-flex items-center gap-1.5 text-xs text-ink">
            <input type="checkbox" checked={onlyWork} onChange={(e) => setOnlyWork(e.target.checked)} />
            Only people paid by work ({byWork})
          </label>
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={<Users className="w-5 h-5" />} title="Nobody here" />
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Worker</th>
                  <th className="px-3 py-2 font-semibold">Paid</th>
                  <th className="px-3 py-2 font-semibold">How often</th>
                  <th className="px-3 py-2 font-semibold">Withholding tax</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.employee_number} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{personName(p)}</div>
                      <div className="text-[10.5px] text-subtle">{[p.employee_number, p.department].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-3 py-2">{KIND_LABEL[p.worker_kind]}</td>
                    <td className="px-3 py-2">{p.pay_basis === 'work' ? <StatusPill label={BASIS_LABEL.work} tone="success" /> : BASIS_LABEL.salary}</td>
                    <td className="px-3 py-2">{FREQUENCY_LABEL[p.pay_frequency]}</td>
                    <td className="px-3 py-2">{p.wht_category ? WHT_LABEL[p.wht_category] : ''}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="text-brand font-semibold" aria-label={`Change how ${personName(p)} is paid`}
                        onClick={() => setForm({
                          person: p, kind: p.worker_kind === 'contractor' ? 'contractor' : 'employee', basis: p.pay_basis,
                          frequency: p.pay_frequency, wht: p.wht_category ?? 'contractual',
                        })}>
                        Change
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {form && (
        <Modal open onClose={() => setForm(null)} title={`How ${personName(form.person)} is paid`} size="md" closeOnBackdrop={!busy}>
          <div className="space-y-3 text-xs text-ink">
            <fieldset>
              <legend className="font-semibold mb-1">They are</legend>
              {(['employee', 'contractor'] as const).map((k) => (
                <label key={k} className="flex items-start gap-1.5 mb-1">
                  <input type="radio" name="kind" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} />
                  <span>
                    {KIND_LABEL[k]}{' '}
                    <span className="text-muted-foreground">
                      {k === 'employee' ? '(PAYE, NSSF, SHIF and AHL through the monthly payroll)' : '(withholding tax instead of PAYE and the rest)'}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {form.kind === 'contractor' && (
              <label className="block">
                <span className="font-semibold">Withholding tax</span>
                <select aria-label="Withholding tax" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={form.wht}
                  onChange={(e) => setForm({ ...form, wht: e.target.value as WhtCategory })}>
                  {(Object.keys(WHT_LABEL) as WhtCategory[]).map((w) => <option key={w} value={w}>{WHT_LABEL[w]}</option>)}
                </select>
              </label>
            )}
            <fieldset>
              <legend className="font-semibold mb-1">Paid</legend>
              {(['salary', 'work'] as const).map((b) => (
                <label key={b} className="flex items-center gap-1.5 mb-1">
                  <input type="radio" name="basis" checked={form.basis === b}
                    onChange={() => setForm({ ...form, basis: b, frequency: b === 'salary' ? 'monthly' : form.frequency })} />
                  {b === 'salary' ? 'A salary (Basic Salary, monthly)' : 'For the work they record, or per contract job'}
                </label>
              ))}
            </fieldset>
            {form.basis === 'work' && (
              <label className="block">
                <span className="font-semibold">Work pay goes out</span>
                <select aria-label="How often" className="mt-1 w-full rounded-lg border border-border px-2 py-1.5" value={form.frequency}
                  onChange={(e) => setForm({ ...form, frequency: e.target.value as PayFrequency })}>
                  {(Object.keys(FREQUENCY_LABEL) as PayFrequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
                </select>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void save()} disabled={busy}>Save</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
