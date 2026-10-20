import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Pause, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { Card, TableScroll } from '../UI';
import EmployeePicker from '../UI/EmployeePicker';
import TaxTreatmentHint, { type TaxTreatmentSource } from './TaxTreatmentHint';
import { useEmployeeDirectory } from '../../hooks/useEmployeeDirectory';
import { useDepartments } from '../../hooks/useDepartments';
import { useBranches } from '../../hooks/useBranches';
import { useJobGroups } from '../../hooks/useJobGroups';
import { runErrorMessage } from '../../lib/payrollRuns';
import { confirmDialog } from '../../lib/confirmDialog';
import { TREATMENT_LABELS, treatmentLabel, type TaxTreatment } from '../../lib/kenyaTaxTreatment';
import type { Rates } from '../../lib/statutoryCalc';
import {
  AMOUNT_TYPE_LABELS,
  APPLIES_TO_LABELS,
  KIND_LABELS,
  payItemError,
  ruleKindOf,
  type AmountType,
  type AppliesTo,
  type CatalogueKind,
  type CompanyPayItem,
} from '../../lib/payItems';
import { loadPayItems, removePayItem, savePayItem, setPayItemActive } from '../../lib/payItemsApi';
import { LoaderBlock } from '../UI/FigbloomLoader';

// The Pay items tab: the company's standard deductions, allowances and benefits (lib/payItems), each with who it
// covers and how it is taxed. Typing a name shows the cited rule (lib/kenyaTaxTreatment) or offers to ask the AI;
// nothing is saved until the person confirms the treatment.

interface PayrollPayItemsTabProps {
  onChanged: () => void;
  draftNotice: string | null;
  rates?: Rates | null;
  canEdit: boolean;
  /** this month's payslips whose deductions are over two-thirds of gross pay (Employment Act s.19(3)) */
  overLimit: { employeeNumber: string; name: string; gross: number; deductions: number }[];
}

interface FormState {
  id?: string;
  name: string;
  kind: CatalogueKind;
  amount_type: AmountType;
  amount: string;
  applies_to: AppliesTo;
  scope_id: string;
  employee_numbers: string[];
  tax_treatment: TaxTreatment | '';
  tax_rule_id: string | null;
  tax_source: string | null;
  confirmed: boolean;
  notes: string;
}

const EMPTY: FormState = {
  name: '',
  kind: 'deduction',
  amount_type: 'per_day',
  amount: '',
  applies_to: 'casuals',
  scope_id: '',
  employee_numbers: [],
  tax_treatment: '',
  tax_rule_id: null,
  tax_source: null,
  confirmed: false,
  notes: '',
};

const button =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile text-[11.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${button} bg-brand text-white hover:bg-brand-dark`;
const secondary = `${button} border border-border bg-white text-ink hover:bg-secondary`;
const input = 'w-full px-2.5 py-1.5 rounded-tile border border-border bg-white text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand';
const label = 'block text-[10px] font-bold uppercase text-subtle mb-1';

const ksh = (n: number) => `KSh ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

const amountText = (item: Pick<CompanyPayItem, 'amount_type' | 'amount'>) =>
  item.amount_type === 'percent_of_basic'
    ? `${item.amount}% of basic`
    : item.amount_type === 'per_day'
      ? `${ksh(item.amount)} a day worked`
      : `${ksh(item.amount)} a month`;

const fromItem = (i: CompanyPayItem): FormState => ({
  id: i.id,
  name: i.name,
  kind: i.kind,
  amount_type: i.amount_type,
  amount: String(i.amount),
  applies_to: i.applies_to,
  scope_id: i.scope_id ?? '',
  employee_numbers: i.employee_numbers,
  tax_treatment: i.tax_treatment,
  tax_rule_id: i.tax_rule_id,
  tax_source: i.tax_source,
  confirmed: true,
  notes: i.notes ?? '',
});

export default function PayrollPayItemsTab({ onChanged, draftNotice, rates, canEdit, overLimit }: PayrollPayItemsTabProps) {
  const { employees } = useEmployeeDirectory();
  const { departments } = useDepartments();
  const { branches } = useBranches();
  const jobGroups = useJobGroups();
  const [items, setItems] = useState<CompanyPayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = async () => {
    try {
      setItems(await loadPayItems());
    } catch (err) {
      toast.error(runErrorMessage(err, 'Could not load the pay items.'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
  }, []);

  const change = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      await reload();
      onChanged();
      return true;
    } catch (err) {
      toast.error(runErrorMessage(err, 'Could not save the change.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const nameOf = useMemo(() => new Map(employees.map((e) => [e.employeeNumber, e.fullName])), [employees]);
  const scopeOptions = (appliesTo: AppliesTo) =>
    appliesTo === 'department'
      ? departments.filter((d) => d.active).map((d) => ({ id: d.id, name: d.name }))
      : appliesTo === 'branch'
        ? branches.filter((b) => b.active).map((b) => ({ id: b.id, name: `${b.name} · ${b.country}` }))
        : appliesTo === 'job_group'
          ? (jobGroups ?? []).filter((g) => g.active).map((g) => ({ id: g.id, name: `${g.code} ${g.name}`.trim() }))
          : [];
  const scopeName = (i: CompanyPayItem) => {
    if (i.applies_to === 'chosen') {
      const names = i.employee_numbers.map((n) => nameOf.get(n) ?? n);
      return names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
    }
    const option = scopeOptions(i.applies_to).find((o) => o.id === i.scope_id);
    return option ? `${APPLIES_TO_LABELS[i.applies_to]}: ${option.name}` : APPLIES_TO_LABELS[i.applies_to];
  };

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  // a new name or kind needs its treatment confirmed again
  const rename = (patch: Partial<FormState>) =>
    set({ ...patch, tax_treatment: '', tax_rule_id: null, tax_source: null, confirmed: false });
  const applyTreatment = (treatment: TaxTreatment, source: TaxTreatmentSource) =>
    set({ tax_treatment: treatment, tax_rule_id: source.ruleId, tax_source: source.text, confirmed: false });

  const save = async () => {
    if (!form) return;
    const item = {
      name: form.name,
      kind: form.kind,
      amount_type: form.amount_type,
      amount: Number(form.amount),
      applies_to: form.applies_to,
      scope_id: form.scope_id || null,
      employee_numbers: form.applies_to === 'chosen' ? form.employee_numbers : [],
      tax_treatment: (form.tax_treatment || undefined) as TaxTreatment,
      tax_rule_id: form.tax_rule_id,
      tax_source: form.tax_source ?? 'Chosen by the person who saved it',
      active: true,
      notes: form.notes,
    };
    const error = payItemError({ ...item, amount: form.amount.trim() === '' ? NaN : item.amount });
    if (error) return setProblem(error);
    if (!form.confirmed) return setProblem('Tick the box to confirm how it is taxed.');
    setProblem(null);
    const existing = form.id ? items.find((i) => i.id === form.id) : undefined;
    if (await change(() => savePayItem({ ...item, id: form.id, active: existing?.active ?? true }), form.id ? 'Pay item saved.' : 'Pay item added.')) setForm(null);
  };

  if (loading) return <LoaderBlock label="Loading pay items" compact />;

  return (
    <div className="space-y-4">
      {draftNotice && <p className="text-xs text-muted-foreground">{draftNotice}</p>}
      {overLimit.length > 0 && (
        <Card padding="sm" data-testid="over-two-thirds">
          <div className="flex items-start gap-2 text-xs text-ink">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-orange-text-alt shrink-0" aria-hidden />
            <div>
              <p className="m-0 font-semibold">
                {overLimit.length} {overLimit.length === 1 ? "person's" : "people's"} deductions this month are more than two-thirds of their pay
              </p>
              <ul className="m-0 mt-1 space-y-0.5 text-muted-foreground">
                {overLimit.slice(0, 10).map((p) => (
                  <li key={p.employeeNumber}>
                    <span className="font-semibold text-ink">{p.name || p.employeeNumber}</span>: {ksh(p.deductions)} of {ksh(p.gross)}
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-1 text-muted-foreground">
                The Employment Act 2007 s.19(3) limits all deductions to two-thirds of wages. Lower or pause an item for them before you approve.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card padding="none">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
          <div className="flex-1 min-w-[200px]">
            <h3 className="text-sm font-semibold text-ink">Standard deductions and benefits</h3>
            <p className="text-xs text-muted-foreground">
              Set once for the company, then taken or paid automatically on the monthly payroll and on casual pay runs (lunch at KSh 100 a
              day worked, staff medical cover, a transport allowance...).
            </p>
          </div>
          {canEdit && (
            <button type="button" className={primary} onClick={() => { setProblem(null); setForm({ ...EMPTY }); }}>
              <Plus className="w-3.5 h-3.5" aria-hidden /> Add a pay item
            </button>
          )}
        </div>
        <TableScroll>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-semibold">Item</th>
                <th className="px-3 py-2 font-semibold">Amount</th>
                <th className="px-3 py-2 font-semibold">Applies to</th>
                <th className="px-3 py-2 font-semibold">Tax</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={`border-b border-border last:border-0 ${i.active ? '' : 'opacity-60'}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink">{i.name}{!i.active && ' (paused)'}</div>
                    <div className="text-[10.5px] text-subtle">{KIND_LABELS[i.kind]}</div>
                  </td>
                  <td className="px-3 py-2">{amountText(i)}</td>
                  <td className="px-3 py-2">{scopeName(i)}</td>
                  <td className="px-3 py-2">
                    <div>{treatmentLabel(i.tax_treatment, ruleKindOf(i.kind))}{i.tax_treatment === 'depends' && ' (taxed until decided)'}</div>
                    {i.tax_source && <div className="text-[10.5px] text-subtle max-w-[260px]">{i.tax_source}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    {canEdit && (
                      <span className="inline-flex gap-1">
                        <button type="button" className={secondary} aria-label={`Edit ${i.name}`} disabled={busy} onClick={() => { setProblem(null); setForm(fromItem(i)); }}>
                          <Pencil className="w-3 h-3" aria-hidden />
                        </button>
                        <button type="button" className={secondary} aria-label={i.active ? `Pause ${i.name}` : `Resume ${i.name}`} disabled={busy}
                          onClick={() => void change(() => setPayItemActive(i.id, !i.active), i.active ? 'Paused.' : 'Resumed.')}>
                          {i.active ? <Pause className="w-3 h-3" aria-hidden /> : <Play className="w-3 h-3" aria-hidden />}
                        </button>
                        <button type="button" className={secondary} aria-label={`Remove ${i.name}`} disabled={busy}
                          onClick={async () => {
                            if (await confirmDialog({ title: `Remove ${i.name}?`, message: 'Payslips already worked out keep it; it stops applying from the next calculation.', confirmLabel: 'Remove', tone: 'danger' })) {
                              await change(() => removePayItem(i.id), 'Removed.');
                            }
                          }}>
                          <Trash2 className="w-3 h-3" aria-hidden />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">No standard pay items yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      {form && (
        <Card>
          <div className="space-y-3" role="form" aria-label={form.id ? 'Edit pay item' : 'New pay item'}>
            <div className="flex items-center">
              <h3 className="text-sm font-semibold text-ink flex-1">{form.id ? `Edit ${form.name}` : 'New pay item'}</h3>
              <button type="button" className={secondary} aria-label="Close" onClick={() => setForm(null)}><X className="w-3 h-3" aria-hidden /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="pay-item-name">Name</label>
                <input id="pay-item-name" className={input} value={form.name} placeholder="Lunch, staff meals, medical cover..." onChange={(e) => rename({ name: e.target.value })} />
              </div>
              <div>
                <label className={label} htmlFor="pay-item-kind">Kind</label>
                <select id="pay-item-kind" className={input} value={form.kind} onChange={(e) => rename({ kind: e.target.value as CatalogueKind })}>
                  {(Object.keys(KIND_LABELS) as CatalogueKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="pay-item-amount-type">How much</label>
                <select id="pay-item-amount-type" className={input} value={form.amount_type} onChange={(e) => set({ amount_type: e.target.value as AmountType })}>
                  {(Object.keys(AMOUNT_TYPE_LABELS) as AmountType[]).map((k) => <option key={k} value={k}>{AMOUNT_TYPE_LABELS[k]}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="pay-item-amount">{form.amount_type === 'percent_of_basic' ? 'Percent' : 'Amount (KSh)'}</label>
                <input id="pay-item-amount" className={input} inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
              </div>
              <div>
                <label className={label} htmlFor="pay-item-applies">Applies to</label>
                <select id="pay-item-applies" className={input} value={form.applies_to} onChange={(e) => set({ applies_to: e.target.value as AppliesTo, scope_id: '' })}>
                  {(Object.keys(APPLIES_TO_LABELS) as AppliesTo[]).map((k) => <option key={k} value={k}>{APPLIES_TO_LABELS[k]}</option>)}
                </select>
              </div>
              {['department', 'branch', 'job_group'].includes(form.applies_to) && (
                <div>
                  <label className={label} htmlFor="pay-item-scope">Which one</label>
                  <select id="pay-item-scope" className={input} value={form.scope_id} onChange={(e) => set({ scope_id: e.target.value })}>
                    <option value="">Choose...</option>
                    {scopeOptions(form.applies_to).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              )}
              {form.applies_to === 'chosen' && (
                <div className="sm:col-span-2 space-y-1.5">
                  <EmployeePicker
                    label="Add a person (employees and casual workers)"
                    value={null}
                    filter={(e) => !form.employee_numbers.includes(e.employeeNumber)}
                    onChange={(e) => e && set({ employee_numbers: [...form.employee_numbers, e.employeeNumber] })}
                  />
                  <div className="flex flex-wrap gap-1">
                    {form.employee_numbers.map((n) => (
                      <span key={n} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-secondary text-[11px] text-ink">
                        {nameOf.get(n) ?? n}
                        <button type="button" aria-label={`Remove ${nameOf.get(n) ?? n}`} onClick={() => set({ employee_numbers: form.employee_numbers.filter((x) => x !== n) })}>
                          <X className="w-3 h-3" aria-hidden />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className={label}>Is it taxable, and can you go ahead?</p>
              <TaxTreatmentHint
                kind={ruleKindOf(form.kind)}
                name={form.name}
                description={`${KIND_LABELS[form.kind]}, ${amountText({ amount_type: form.amount_type, amount: Number(form.amount) || 0 })}, ${APPLIES_TO_LABELS[form.applies_to].toLowerCase()}`}
                rates={rates}
                onUse={applyTreatment}
                askLabel="Ask AI whether this is taxable and if I can go ahead"
                showGoAhead
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="pay-item-tax">Tax treatment</label>
                  <select id="pay-item-tax" className={input} value={form.tax_treatment}
                    onChange={(e) => set({ tax_treatment: e.target.value as TaxTreatment, tax_rule_id: null, tax_source: 'Chosen by the person who saved it', confirmed: false })}>
                    <option value="">Choose, or press “Use this” above</option>
                    {(Object.keys(TREATMENT_LABELS) as TaxTreatment[]).map((t) => <option key={t} value={t}>{treatmentLabel(t, ruleKindOf(form.kind))}</option>)}
                  </select>
                  {form.tax_source && <p className="mt-1 text-[10.5px] text-subtle">Source: {form.tax_source}</p>}
                  {form.tax_treatment === 'depends' && <p className="mt-1 text-[10.5px] text-orange-text">Payroll taxes it until you choose Taxable or Not taxable.</p>}
                </div>
                <div>
                  <label className={label} htmlFor="pay-item-notes">Notes</label>
                  <input id="pay-item-notes" className={input} value={form.notes} placeholder="e.g. agreed in writing at induction" onChange={(e) => set({ notes: e.target.value })} />
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs text-ink">
                <input type="checkbox" className="mt-0.5" checked={form.confirmed} disabled={!form.tax_treatment} onChange={(e) => set({ confirmed: e.target.checked })} />
                <span>I confirm this tax treatment{form.kind === 'deduction' ? ', and that the deduction is allowed (required by law or agreed by the employee in writing)' : ''}.</span>
              </label>
            </div>

            {problem && <p role="alert" className="text-xs text-status-danger">{problem}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={secondary} onClick={() => setForm(null)} disabled={busy}>Cancel</button>
              <button type="button" className={primary} onClick={() => void save()} disabled={busy}>Save</button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
