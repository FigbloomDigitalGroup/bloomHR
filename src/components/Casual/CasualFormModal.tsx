import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, EmployeePicker, Modal } from '../UI';
import DepartmentPicker from '../UI/DepartmentPicker';
import { saveCasual, type CasualInput } from '../../lib/casualApi';
import { today, type CasualWorker } from '../../lib/casualPay';
import { casualRateShortfall, money, perDayMinimum } from '../../lib/minimumWage';
import { useMinimumWages } from '../../hooks/useMinimumWages';

// Register a casual worker, or change one: who they are, how they're paid (M-Pesa or bank), their daily rate, when
// they started, where they work and who supervises them. A daily rate below the per-day minimum wage shows a warning
// (FIG-812 stage 6), never a block.

const field = 'w-full px-3 py-2 text-xs border border-border rounded-tile bg-white text-ink outline-none focus:border-brand';
const labelClass = 'block text-[11.5px] font-semibold text-ink mb-1';

const fromWorker = (c?: CasualWorker | null): CasualInput => ({
  employee_number: c?.employee_number,
  first_name: c?.first_name ?? '',
  last_name: c?.last_name ?? '',
  id_number: c?.id_number ?? '',
  phone: c?.phone ?? '',
  daily_rate: c ? String(c.daily_rate) : '',
  start_date: c?.start_date?.slice(0, 10) ?? today(),
  department_id: c?.department_id ?? null,
  supervisor_email: c?.supervisor_email ?? '',
  payment_method: c?.payment_method === 'Bank Transfer' ? 'Bank Transfer' : 'M-Pesa',
  bank: c?.bank ?? '',
  bank_branch: c?.bank_branch ?? '',
  account_name: c?.account_name ?? '',
  account_number: c?.account_number ?? '',
});

interface Props {
  open: boolean;
  casual?: CasualWorker | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function CasualFormModal({ open, casual, onClose, onSaved }: Props) {
  const [form, setForm] = useState<CasualInput>(() => fromWorker(casual));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<CasualInput>) => setForm((f) => ({ ...f, ...patch }));
  const bank = form.payment_method === 'Bank Transfer';
  const wages = useMinimumWages(form.start_date || today(), { perEmployee: Boolean(casual) });
  const minimum = wages.minimumFor(casual?.employee_number);
  const short = casualRateShortfall(form.daily_rate, minimum, wages.settings);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!form.first_name.trim() || !form.last_name.trim()) return setProblem('Add a first and last name.');
    if (!(Number(form.daily_rate) > 0)) return setProblem('Add a daily rate of more than 0.');
    if (!bank && !form.phone?.trim()) return setProblem('Add their M-Pesa phone number.');
    if (bank && (!form.bank?.trim() || !form.account_number?.trim())) return setProblem('Add the bank and account number.');
    setBusy(true);
    try {
      const number = await saveCasual(form);
      toast.success(casual ? 'Saved' : `${form.first_name} registered (${number})`);
      onSaved();
      onClose();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={casual ? `Change ${casual.first_name ?? 'casual worker'}` : 'Register a casual worker'} size="xl" closeOnBackdrop={!busy}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="casual-first">First name</label>
            <input id="casual-first" className={field} value={form.first_name} onChange={(e) => set({ first_name: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="casual-last">Last name</label>
            <input id="casual-last" className={field} value={form.last_name} onChange={(e) => set({ last_name: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="casual-id">ID number</label>
            <input id="casual-id" className={field} inputMode="numeric" value={form.id_number} onChange={(e) => set({ id_number: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="casual-rate">Daily rate (KSh)</label>
            <input id="casual-rate" className={field} inputMode="decimal" value={String(form.daily_rate)} onChange={(e) => set({ daily_rate: e.target.value })} />
            {short !== null && minimum?.monthly && (
              <p role="status" className="text-[11px] text-orange-text-alt mt-1" data-testid="casual-minimum-wage">
                Below the minimum wage: {money(perDayMinimum(minimum.monthly, wages.settings.daysPerMonth), minimum.currency)} a day in{' '}
                {minimum.country} ({money(minimum.monthly, minimum.currency)} a month / {wages.settings.daysPerMonth} days), short by{' '}
                {money(short, minimum.currency)} a day. You can still save.
              </p>
            )}
          </div>
          <div>
            <label className={labelClass} htmlFor="casual-start">Start date</label>
            <input id="casual-start" type="date" className={field} value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
          </div>
          <DepartmentPicker label="Department or site" value={form.department_id} onChange={(d) => set({ department_id: d?.id ?? null })} />
          <div className="sm:col-span-2">
            <EmployeePicker
              label="Supervisor"
              value={null}
              fallbackLabel={form.supervisor_email || undefined}
              placeholder={form.supervisor_email || 'Who records their days'}
              onChange={(emp) => set({ supervisor_email: emp?.email ?? '' })}
            />
            {form.supervisor_email && <p className="text-[11px] text-muted-foreground mt-1">Supervisor: {form.supervisor_email}</p>}
          </div>
        </div>

        <fieldset className="rounded-tile border border-border p-3">
          <legend className="px-1 text-[11.5px] font-semibold text-ink">Paid by</legend>
          <div className="flex gap-4 text-xs mb-2">
            {(['M-Pesa', 'Bank Transfer'] as const).map((m) => (
              <label key={m} className="inline-flex items-center gap-1.5">
                <input type="radio" name="casual-method" checked={form.payment_method === m} onChange={() => set({ payment_method: m })} />
                {m === 'M-Pesa' ? 'M-Pesa' : 'Bank'}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="casual-phone">Phone (M-Pesa)</label>
              <input id="casual-phone" className={field} inputMode="tel" placeholder="0712345678" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
            </div>
            {bank && (
              <>
                <div>
                  <label className={labelClass} htmlFor="casual-bank">Bank</label>
                  <input id="casual-bank" className={field} value={form.bank} onChange={(e) => set({ bank: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="casual-branch">Branch</label>
                  <input id="casual-branch" className={field} value={form.bank_branch} onChange={(e) => set({ bank_branch: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="casual-account-name">Account name</label>
                  <input id="casual-account-name" className={field} value={form.account_name} onChange={(e) => set({ account_name: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="casual-account">Account number</label>
                  <input id="casual-account" className={field} value={form.account_number} onChange={(e) => set({ account_number: e.target.value })} />
                </div>
              </>
            )}
          </div>
        </fieldset>

        {problem && <p role="alert" className="text-xs text-status-danger">{problem}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving...' : casual ? 'Save' : 'Register'}</Button>
        </div>
      </form>
    </Modal>
  );
}
