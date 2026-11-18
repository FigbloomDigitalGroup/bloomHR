import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pause, Pencil, Play, Plus } from 'lucide-react';
import { Button, Card } from '../UI';
import {
  INTEREST_METHODS,
  formatKsh,
  loanSchedule,
  rateFieldLabel,
  rateText,
  currentPeriod,
  scheduleTotals,
  settingsError,
  type InterestMethod,
  type LoanProduct,
  type LoanSettings,
} from '../../lib/loans';
import { usePermissions } from '../../hooks/usePermissions';
import { loadLoanProducts, loadLoanSettings, saveLoanProduct, saveLoanSettings } from '../../lib/loansApi';

// The company's loan terms (interest rate and how it is charged, the shortest and longest term, the most anyone may
// borrow, whether staff may apply) and its loan types, each with its own rate and longest term. Changing them never
// changes a loan already approved: the rate is copied onto each loan when it is approved.

const inputClass = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand';

interface Form {
  annual_rate: string;
  interest_method: InterestMethod;
  min_months: string;
  max_months: string;
  max_amount: string;
  max_salary_multiple: string;
  max_instalment_divisor: string;
  staff_can_apply: boolean;
  terms: { months: string; rate: string }[];
}

const toForm = (s: LoanSettings): Form => ({
  annual_rate: String(s.annual_rate),
  interest_method: s.interest_method,
  min_months: String(s.min_months),
  max_months: String(s.max_months),
  max_amount: s.max_amount === null ? '' : String(s.max_amount),
  max_salary_multiple: s.max_salary_multiple === null ? '' : String(s.max_salary_multiple),
  max_instalment_divisor: s.max_instalment_divisor === null ? '' : String(s.max_instalment_divisor),
  staff_can_apply: s.staff_can_apply,
  terms: s.term_rates.map((t) => ({ months: String(t.months), rate: String(t.rate) })),
});

const fromForm = (f: Form): LoanSettings => ({
  annual_rate: Number(f.annual_rate),
  interest_method: f.interest_method,
  min_months: Number(f.min_months),
  max_months: Number(f.max_months),
  max_amount: f.max_amount.trim() === '' ? null : Number(f.max_amount),
  max_salary_multiple: f.max_salary_multiple.trim() === '' ? null : Number(f.max_salary_multiple),
  max_instalment_divisor: f.max_instalment_divisor.trim() === '' ? null : Number(f.max_instalment_divisor),
  staff_can_apply: f.staff_can_apply,
  term_rates: f.terms.filter((t) => t.months.trim() !== '' || t.rate.trim() !== '').map((t) => ({ months: Number(t.months), rate: Number(t.rate) })),
});

/** With fixed terms, the shortest and longest term are theirs (staff can ask for nothing else). */
const withTermLimits = (s: LoanSettings): LoanSettings =>
  s.term_rates.length === 0
    ? s
    : {
        ...s,
        term_rates: [...s.term_rates].sort((a, b) => a.months - b.months),
        min_months: Math.min(...s.term_rates.map((t) => t.months)),
        max_months: Math.max(...s.term_rates.map((t) => t.months)),
      };

interface ProductForm {
  id?: string;
  name: string;
  annual_rate: string;
  interest_method: InterestMethod;
  max_months: string;
  active: boolean;
}

const productError = (p: ProductForm): string | null => {
  if (!p.name.trim()) return 'Give the loan type a name';
  if (p.name.trim().length > 60) return 'The name may be up to 60 characters';
  const rate = Number(p.annual_rate);
  if (p.annual_rate.trim() === '' || !(rate >= 0 && rate <= 100)) return 'The rate must be between 0% and 100%';
  const months = Number(p.max_months);
  if (!Number.isInteger(months) || months < 1 || months > 120) return 'The longest term must be 1 to 120 months';
  return null;
};

/** `canEdit` defaults to who the database lets change them: HR, admins and payroll users. */
export default function LoanSettingsCard({ canEdit: canEditProp, className = '' }: { canEdit?: boolean; className?: string }) {
  const { hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const canEdit = canEditProp ?? (!permissionsLoading && hasAnyPermission(['loans', 'payroll']));
  const [saved, setSaved] = useState<LoanSettings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [products, setProducts] = useState<LoanProduct[]>([]);
  const [editing, setEditing] = useState<ProductForm | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadProducts = async () => setProducts(await loadLoanProducts());

  useEffect(() => {
    let live = true;
    Promise.all([loadLoanSettings(), loadLoanProducts()])
      .then(([s, p]) => {
        if (!live) return;
        setSaved(s);
        setForm(toForm(s));
        setProducts(p);
      })
      .catch((error) => {
        console.error('Error loading loan settings:', error);
        toast.error('Could not load the loan settings');
      });
    return () => {
      live = false;
    };
  }, []);

  if (!saved || !form) return null;

  const next = withTermLimits(fromForm(form));
  const problem = settingsError(next);
  const changed = JSON.stringify(next) !== JSON.stringify(saved);
  const exampleMonths = next.term_rates[0]?.months ?? Math.min(12, next.max_months);
  const example = scheduleTotals(loanSchedule(100000, next.term_rates[0]?.rate ?? next.annual_rate, exampleMonths, next.interest_method, currentPeriod()));

  const save = async () => {
    setBusy(true);
    try {
      await saveLoanSettings(next);
      setSaved(next);
      toast.success('Loan settings saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveProduct = async () => {
    if (!editing || productError(editing)) return;
    setBusy(true);
    try {
      await saveLoanProduct({
        id: editing.id,
        name: editing.name,
        annual_rate: Number(editing.annual_rate),
        interest_method: editing.interest_method,
        max_months: Number(editing.max_months),
        active: editing.active,
      });
      toast.success(editing.id ? 'Loan type saved' : 'Loan type added');
      setEditing(null);
      await reloadProducts();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleProduct = async (p: LoanProduct) => {
    try {
      await saveLoanProduct({ ...p, active: !p.active });
      toast.success(p.active ? `${p.name} paused: staff can no longer choose it` : `${p.name} offered again`);
      await reloadProducts();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const field = (key: keyof Form, label: string, hint: string, props: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`loan-settings-${key}`} className="block text-[12px] font-semibold text-ink mb-1">
        {label}
      </label>
      <input
        id={`loan-settings-${key}`}
        className={inputClass}
        type="number"
        inputMode="decimal"
        value={form[key] as string}
        disabled={!canEdit}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...props}
      />
      <span className="block mt-1 text-[11px] text-muted-foreground">{hint}</span>
    </div>
  );

  const productProblem = editing ? productError(editing) : null;

  return (
    <Card className={className}>
      <h2 className="m-0 text-[14px] font-bold text-ink">Loans</h2>
      <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">
        The interest and terms for staff loans. Changes apply to loans approved from now on; loans already approved keep their rate.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {field('annual_rate', rateFieldLabel(form.interest_method), form.interest_method === 'upfront' ? 'For example 20' : 'For example 12', { min: 0, max: 100, step: '0.1' })}
        <label className="block sm:col-span-2">
          <span className="block text-[12px] font-semibold text-ink mb-1">How interest is charged</span>
          <select
            className={inputClass}
            value={form.interest_method}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, interest_method: e.target.value as InterestMethod })}
          >
            {INTEREST_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="block mt-1 text-[11px] text-muted-foreground">{INTEREST_METHODS.find((m) => m.id === form.interest_method)?.hint}</span>
        </label>
        {field('min_months', 'Shortest term (months)', 'At least 1', { min: 1, max: 120 })}
        {field('max_months', 'Longest term (months)', 'Up to 120', { min: 1, max: 120 })}
        <span />
        {field('max_amount', 'Most anyone may borrow (KSh)', 'Leave empty for no fixed limit', { min: 1 })}
        {field('max_salary_multiple', 'Or up to this many times basic salary', 'For example 3. The lower limit wins', { min: 0.1, step: '0.1' })}
        {field(
          'max_instalment_divisor',
          'Monthly repayment up to basic salary ÷',
          'For example 3: each month’s repayment is at most a third of basic salary, so the loan is up to basic ÷ 3 × its months. Empty: no such limit',
          { min: 1, step: '0.5' }
        )}
        <label className="flex items-start gap-2 pt-6">
          <input
            type="checkbox"
            className="mt-0.5 accent-brand"
            checked={form.staff_can_apply}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, staff_can_apply: e.target.checked })}
          />
          <span className="text-[12.5px] text-ink">Staff can apply in the staff portal</span>
        </label>
      </div>

      <div className="mt-4 pt-3 border-t border-border">
        <h3 className="m-0 text-[13px] font-bold text-ink">Fixed terms</h3>
        <p className="mt-0.5 mb-2 text-[11.5px] text-muted-foreground">
          Optional: lend only for these terms, each with its own rate (for example 3 months at 20% and 6 months at 25%). Staff then choose only these, the
          rate follows the term, and the shortest and longest term above are set from them. Leave empty to allow any term.
        </p>
        <ul className="space-y-2 m-0 p-0 list-none">
          {form.terms.map((t, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <label className="block w-36">
                <span className="block text-[11.5px] text-ink mb-1">Term (months)</span>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={120}
                  aria-label={`Fixed term ${i + 1}: months`}
                  value={t.months}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, terms: form.terms.map((x, j) => (j === i ? { ...x, months: e.target.value } : x)) })}
                />
              </label>
              <label className="block w-44">
                <span className="block text-[11.5px] text-ink mb-1">{rateFieldLabel(form.interest_method)}</span>
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  aria-label={`Fixed term ${i + 1}: rate`}
                  value={t.rate}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, terms: form.terms.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })}
                />
              </label>
              {canEdit && (
                <Button variant="ghost" onClick={() => setForm({ ...form, terms: form.terms.filter((_, j) => j !== i) })}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <Button variant="secondary" className="mt-2" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setForm({ ...form, terms: [...form.terms, { months: '', rate: '' }] })}>
            Add a term
          </Button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[12.5px]" role="status" aria-live="polite">
          {problem ? (
            <span className="text-red-600">{problem}</span>
          ) : (
            <span className="text-muted-foreground">
              Example: KSh 100,000 over {exampleMonths} months is {formatKsh(example.instalment)} a month, {formatKsh(example.totalInterest)} interest
              {next.interest_method === 'upfront' ? `, ${formatKsh(example.paidOut)} paid out` : ''}.
            </span>
          )}
        </p>
        {canEdit && (
          <Button onClick={() => void save()} disabled={busy || !changed || !!problem}>
            {busy ? 'Saving...' : 'Save'}
          </Button>
        )}
      </div>

      <div className="mt-5 pt-4 border-t border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <h3 className="m-0 text-[13px] font-bold text-ink">Loan types</h3>
            <p className="m-0 text-[11.5px] text-muted-foreground">Optional: for example an emergency loan or a school fees loan, each with its own rate.</p>
          </div>
          {canEdit && !editing && (
            <Button
              variant="secondary"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setEditing({ name: '', annual_rate: String(next.annual_rate), interest_method: next.interest_method, max_months: String(next.max_months), active: true })}
            >
              Add loan type
            </Button>
          )}
        </div>

        {products.length === 0 && !editing && <p className="text-[12px] text-muted-foreground m-0">No loan types. Every loan uses the terms above.</p>}

        <ul className="divide-y divide-border">
          {products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className={p.active ? '' : 'opacity-60'}>
                <span className="text-[12.5px] font-semibold text-ink">{p.name}</span>
                <span className="ml-2 text-[11.5px] text-muted-foreground">
                  {rateText(p.annual_rate, p.interest_method)}, {INTEREST_METHODS.find((m) => m.id === p.interest_method)?.label.toLowerCase()}, up to {p.max_months} months
                  {p.active ? '' : ' · paused'}
                </span>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    aria-label={`Change ${p.name}`}
                    icon={<Pencil className="w-3.5 h-3.5" />}
                    onClick={() => setEditing({ id: p.id, name: p.name, annual_rate: String(p.annual_rate), interest_method: p.interest_method, max_months: String(p.max_months), active: p.active })}
                  >
                    Change
                  </Button>
                  <Button variant="ghost" icon={p.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} onClick={() => void toggleProduct(p)}>
                    {p.active ? 'Pause' : 'Offer again'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {editing && (
          <div className="mt-3 p-3 rounded-tile border border-border bg-secondary/40">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <label className="block sm:col-span-2">
                <span className="block text-[12px] font-semibold text-ink mb-1">Name</span>
                <input className={inputClass} value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="For example: School fees loan" />
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">{editing.interest_method === 'upfront' ? 'Rate (% of the loan)' : 'Rate (% a year)'}</span>
                <input className={inputClass} type="number" min={0} max={100} step="0.1" value={editing.annual_rate} onChange={(e) => setEditing({ ...editing, annual_rate: e.target.value })} />
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">Longest term for this type (months)</span>
                <input className={inputClass} type="number" min={1} max={120} value={editing.max_months} onChange={(e) => setEditing({ ...editing, max_months: e.target.value })} />
              </label>
              <label className="block sm:col-span-2">
                <span className="block text-[12px] font-semibold text-ink mb-1">How interest is charged</span>
                <select className={inputClass} value={editing.interest_method} onChange={(e) => setEditing({ ...editing, interest_method: e.target.value as InterestMethod })}>
                  {INTEREST_METHODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-red-600" role="status">
                {productProblem}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button onClick={() => void saveProduct()} disabled={busy || !!productProblem}>
                  {editing.id ? 'Save loan type' : 'Add loan type'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
