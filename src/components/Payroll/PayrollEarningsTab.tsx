import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { Download, Loader, Pause, Pencil, Play, Plus, Trash2, Upload } from 'lucide-react';
import EmployeePicker from '../UI/EmployeePicker';
import { Card, SearchInput, TableScroll } from '../UI';
import { useEmployeeDirectory } from '../../hooks/useEmployeeDirectory';
import { readEmployeeRows } from '../../lib/employeeSheet';
import { runErrorMessage } from '../../lib/payrollRuns';
import { appliesInPeriod } from '../../lib/voluntaryDeductions';
import {
  EARNING_SHEET_COLUMNS,
  isOneOff,
  parseEarningSheet,
  type EarningType,
  type EmployeeEarning,
  type ParsedEarningRow,
} from '../../lib/earnings';
import {
  addEarningType,
  importEarningRows,
  loadEarningSetup,
  removeEmployeeEarning,
  saveEmployeeEarning,
  updateEarningType,
} from '../../lib/earningsDb';
import { confirmDialog } from '../../lib/confirmDialog';

// The Earnings tab: the company's kinds of earnings on top of salary (Bonus, Commission, incentives...) and what each
// employee is paid for the month on screen, once or every month. Payroll adds them to gross pay (lib/earnings).

interface PayrollEarningsTabProps {
  /** the month on screen, 'YYYY-MM' */
  payPeriod: string;
  /** the month on screen, e.g. "October 2026" */
  periodLabel: string;
  /** called after any change, so the payroll figures are worked out again */
  onChanged: () => void;
  /** how changes reach this month's payroll run, if it has one */
  draftNotice: string | null;
}

interface FormState {
  id?: string;
  employee_number: string;
  earning_type_id: string;
  amount: string;
  recurring: boolean;
  start_period: string;
  end_period: string;
  notes: string;
}

interface TypeForm {
  name: string;
  taxable: boolean;
  pensionable: boolean;
  description: string;
}

const EMPTY_TYPE: TypeForm = { name: '', taxable: true, pensionable: true, description: '' };

const monthLabel = (period: string | null) =>
  period ? new Date(`${period}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';

const periodText = (e: EmployeeEarning) =>
  isOneOff(e)
    ? `${monthLabel(e.start_period)} only`
    : e.end_period
      ? `Every month, ${monthLabel(e.start_period)} – ${monthLabel(e.end_period)}`
      : `Every month from ${monthLabel(e.start_period)}`;

const ksh = (n: number) => `KSh ${n.toLocaleString()}`;

const button =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile text-[11.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${button} bg-brand text-white hover:bg-brand-dark`;
const secondary = `${button} border border-border bg-white text-ink hover:bg-secondary`;
const input = 'w-full px-2.5 py-1.5 rounded-tile border border-border bg-white text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand';
const label = 'block text-[10px] font-bold uppercase text-subtle mb-1';

/** Bonuses, commissions and incentives: the company's earning types and each employee's earnings for the month. */
export default function PayrollEarningsTab({ payPeriod, periodLabel, onChanged, draftNotice }: PayrollEarningsTabProps) {
  const { employees } = useEmployeeDirectory();
  const [types, setTypes] = useState<EarningType[]>([]);
  const [earnings, setEarnings] = useState<EmployeeEarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newType, setNewType] = useState<TypeForm | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [search, setSearch] = useState('');
  const [upload, setUpload] = useState<{ file: string; valid: ParsedEarningRow[]; errors: string[] } | null>(null);

  const reload = async () => {
    try {
      const setup = await loadEarningSetup();
      setTypes(setup.types);
      setEarnings(setup.earnings);
    } catch (err) {
      toast.error(runErrorMessage(err, 'Could not load earnings.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  /** runs a change, then reloads and tells the payroll page */
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

  const employeeName = useMemo(() => new Map(employees.map((e) => [e.employeeNumber, e.fullName])), [employees]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  // the earnings paid in the month on screen (a paused type's are listed but not paid)
  const thisMonth = useMemo(() => earnings.filter((e) => appliesInPeriod(e, payPeriod)), [earnings, payPeriod]);
  const totals = useMemo(() => {
    const paid = thisMonth.filter((e) => typeById.get(e.earning_type_id)?.active);
    const sum = (list: EmployeeEarning[]) => list.reduce((s, e) => s + Number(e.amount), 0);
    return {
      total: sum(paid),
      taxable: sum(paid.filter((e) => typeById.get(e.earning_type_id)?.taxable)),
      employees: new Set(paid.map((e) => e.employee_number)).size,
    };
  }, [thisMonth, typeById]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return thisMonth
      .filter(
        (e) =>
          !q ||
          e.employee_number.toLowerCase().includes(q) ||
          (employeeName.get(e.employee_number) ?? '').toLowerCase().includes(q) ||
          (typeById.get(e.earning_type_id)?.name ?? '').toLowerCase().includes(q)
      )
      .sort(
        (a, b) =>
          (employeeName.get(a.employee_number) ?? a.employee_number).localeCompare(employeeName.get(b.employee_number) ?? b.employee_number) ||
          (typeById.get(a.earning_type_id)?.name ?? '').localeCompare(typeById.get(b.earning_type_id)?.name ?? '')
      );
  }, [thisMonth, search, employeeName, typeById]);

  const handleAddType = async () => {
    if (!newType) return;
    const name = newType.name.trim();
    if (!name) return toast.error('Give the earning a name.');
    if (await change(() => addEarningType({ ...newType, name }), `Added "${name}".`)) setNewType(null);
  };

  const handleSave = async () => {
    if (!form) return;
    const amount = Number(form.amount);
    if (!form.employee_number) return toast.error('Choose an employee.');
    if (!form.earning_type_id) return toast.error('Choose an earning.');
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter an amount above 0.');
    if (!form.start_period) return toast.error('Choose the month.');
    if (form.recurring && form.end_period && form.start_period > form.end_period) return toast.error('"Until" is before "From".');
    const saved = await change(
      () =>
        saveEmployeeEarning({
          id: form.id,
          employee_number: form.employee_number,
          earning_type_id: form.earning_type_id,
          amount,
          start_period: form.start_period,
          end_period: form.recurring ? form.end_period || null : form.start_period,
          notes: form.notes.trim() || null,
        }),
      form.id ? 'Earning updated.' : 'Earning added.'
    );
    if (saved) setForm(null);
  };

  const handleRemove = async (e: EmployeeEarning) => {
    const who = employeeName.get(e.employee_number) ?? e.employee_number;
    const what = typeById.get(e.earning_type_id)?.name ?? 'earning';
    const ok = await confirmDialog({
      title: `Remove ${what} for ${who}?`,
      message: isOneOff(e)
        ? `KSh ${Number(e.amount).toLocaleString()} will not be paid in ${monthLabel(e.start_period)}. Payslips already approved keep it.`
        : `It will no longer be paid in any month. Payslips already approved keep it.`,
      confirmLabel: 'Remove earning',
      tone: 'danger',
    });
    if (!ok) return;
    change(() => removeEmployeeEarning(e.id), `${what} removed for ${who}.`);
  };

  const downloadTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      [...EARNING_SHEET_COLUMNS],
      ['EMP-001', 'Bonus', 10000, payPeriod],
      ['EMP-002', 'Commission', 4500, payPeriod],
    ]);
    sheet['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 10 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Earnings');
    XLSX.writeFile(book, 'earnings_template.xlsx');
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const rows = readEmployeeRows(await file.arrayBuffer());
      const { valid, errors } = parseEarningSheet(rows, new Set(employees.map((e) => e.employeeNumber)), payPeriod);
      setUpload({ file: file.name, valid, errors });
    } catch (err) {
      toast.error(runErrorMessage(err, 'Could not read that file.'));
    }
  };

  const handleImport = async () => {
    if (!upload?.valid.length) return;
    const rows = upload.valid;
    const done = await change(async () => {
      const added = await importEarningRows(rows, types);
      if (added) toast.success(`Added ${added} new earning type(s), taxable. Change that under Earning types if needed.`);
    }, `Imported ${rows.length} earnings.`);
    if (done) setUpload(null);
  };

  const activeTypes = types.filter((t) => t.active || t.id === form?.earning_type_id);
  const flag = (on: boolean, yes: string, no: string) => (
    <span className={`text-[10px] font-normal ${on ? 'text-subtle' : 'text-orange-text-alt'}`}>{on ? yes : no}</span>
  );

  return (
    <Card padding="none">
      <div className="px-4 sm:px-5 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink">Bonuses & incentives</h2>
          <p className="text-[11px] text-muted-foreground">
            Bonuses, commissions, incentives, arrears… paid on top of salary for a month, or every month.
          </p>
        </div>
        {busy && <Loader className="w-3.5 h-3.5 animate-spin text-subtle shrink-0" aria-label="Saving" />}
      </div>

      <div className="p-4 sm:p-5 space-y-5">
        {draftNotice && (
          <div className="rounded-tile bg-orange-tint-alt text-orange-text-alt text-[11.5px] font-semibold px-3 py-2">{draftNotice}</div>
        )}

        {/* earning types */}
        <section>
          <h3 className={label}>Earning types</h3>
          <div className="flex flex-wrap items-center gap-2">
            {types.map((t) => (
              <span
                key={t.id}
                title={t.description ?? undefined}
                className={`inline-flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-pill border text-[11.5px] font-semibold ${
                  t.active ? 'border-border bg-white text-ink' : 'border-dashed border-border bg-secondary text-muted-foreground'
                }`}
              >
                {t.name}
                <button
                  type="button"
                  className="hover:underline"
                  disabled={busy}
                  title={t.taxable ? 'Counts for PAYE. Click to make it not taxed.' : 'Not taxed. Click to make it count for PAYE.'}
                  onClick={() =>
                    change(() => updateEarningType(t.id, { taxable: !t.taxable }), `${t.name} is ${t.taxable ? 'no longer taxed' : 'taxed'}.`)
                  }
                >
                  {flag(t.taxable, 'taxed', 'not taxed')}
                </button>
                <button
                  type="button"
                  className="hover:underline"
                  disabled={busy}
                  title={t.pensionable ? 'Counts for NSSF. Click to leave it out.' : 'Not counted for NSSF. Click to count it.'}
                  onClick={() =>
                    change(
                      () => updateEarningType(t.id, { pensionable: !t.pensionable }),
                      `${t.name} ${t.pensionable ? 'no longer counts' : 'now counts'} for NSSF.`
                    )
                  }
                >
                  {flag(t.pensionable, 'NSSF', 'no NSSF')}
                </button>
                {!t.active && <span className="text-[10px] font-normal text-subtle">paused</span>}
                <button
                  type="button"
                  title={t.active ? `Pause ${t.name}: stop paying it to everyone` : `Resume ${t.name}`}
                  aria-label={t.active ? `Pause ${t.name}` : `Resume ${t.name}`}
                  disabled={busy}
                  onClick={() => change(() => updateEarningType(t.id, { active: !t.active }), t.active ? `${t.name} paused.` : `${t.name} resumed.`)}
                  className="p-1 rounded-full text-subtle hover:text-ink hover:bg-secondary"
                >
                  {t.active ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
              </span>
            ))}
            {!newType && (
              <button type="button" className={secondary} onClick={() => setNewType(EMPTY_TYPE)} disabled={busy}>
                <Plus className="w-3.5 h-3.5" />
                New type
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Every earning adds to gross pay, and SHIF and the housing levy are worked out on it. Taxed earnings count for PAYE; NSSF
            ones for NSSF. Click a label to change it.
          </p>
          {newType && (
            <div className="mt-3 rounded-xl border border-brand/40 p-3 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className={label} htmlFor="earning-type-name">Name</label>
                <input
                  id="earning-type-name"
                  className={input}
                  value={newType.name}
                  placeholder="e.g. 13th month pay"
                  onChange={(e) => setNewType({ ...newType, name: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className={label} htmlFor="earning-type-description">Description</label>
                <input
                  id="earning-type-description"
                  className={input}
                  value={newType.description}
                  onChange={(e) => setNewType({ ...newType, description: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1 text-[11.5px] text-ink">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={newType.taxable} onChange={(e) => setNewType({ ...newType, taxable: e.target.checked })} />
                  Taxed (PAYE)
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={newType.pensionable}
                    onChange={(e) => setNewType({ ...newType, pensionable: e.target.checked })}
                  />
                  Counts for NSSF
                </label>
              </div>
              <div className="md:col-span-4 flex gap-2">
                <button type="button" className={primary} onClick={handleAddType} disabled={busy || !newType.name.trim()}>
                  Add type
                </button>
                <button type="button" className={secondary} onClick={() => setNewType(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        {/* bulk upload */}
        <section className="rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[220px]">
              <div className="text-xs font-bold text-ink">Many employees at once</div>
              <div className="text-[11px] text-muted-foreground">
                Fill in the template ({EARNING_SHEET_COLUMNS.join(', ')}) and upload it. Each row is paid once, in its period ({periodLabel} when
                empty). New earning names are added for you.
              </div>
            </div>
            <button type="button" className={secondary} onClick={downloadTemplate}>
              <Download className="w-3.5 h-3.5" />
              Template
            </button>
            <label className={`${secondary} cursor-pointer`}>
              <Upload className="w-3.5 h-3.5" />
              Upload spreadsheet
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                aria-label="Upload earnings spreadsheet"
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {upload && (
            <div className="mt-3 space-y-2">
              <div className="text-[11.5px] text-ink">
                <span className="font-bold">{upload.file}</span>: {upload.valid.length} ready to import
                {upload.errors.length > 0 && `, ${upload.errors.length} row(s) need fixing`}.
              </div>
              {upload.errors.length > 0 && (
                <ul className="max-h-28 overflow-y-auto text-[11px] text-status-danger list-disc pl-5">
                  {upload.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <button type="button" className={primary} onClick={handleImport} disabled={busy || upload.valid.length === 0}>
                  Import {upload.valid.length}
                  {upload.errors.length > 0 ? ' (skip the rest)' : ''}
                </button>
                <button type="button" className={secondary} onClick={() => setUpload(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        {/* add / edit one */}
        {form ? (
          <section className="rounded-xl border border-brand/40 p-3 space-y-3">
            <div className="text-xs font-bold text-ink">{form.id ? 'Edit earning' : 'Add an earning'}</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <EmployeePicker
                  label="Employee"
                  value={form.employee_number}
                  onChange={(e) => setForm({ ...form, employee_number: e?.employeeNumber ?? '' })}
                  disabled={!!form.id}
                />
              </div>
              <div>
                <label className={label} htmlFor="earning-type">Earning</label>
                <select
                  id="earning-type"
                  className={input}
                  value={form.earning_type_id}
                  onChange={(e) => setForm({ ...form, earning_type_id: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {activeTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="earning-amount">Amount (KSh)</label>
                <input
                  id="earning-amount"
                  type="number"
                  min="0"
                  step="any"
                  className={input}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div>
                <span className={label}>Paid</span>
                <div className="flex gap-3 text-[11.5px] text-ink pt-1">
                  <label className="inline-flex items-center gap-1.5">
                    <input type="radio" name="earning-recurring" checked={!form.recurring} onChange={() => setForm({ ...form, recurring: false })} />
                    Once
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input type="radio" name="earning-recurring" checked={form.recurring} onChange={() => setForm({ ...form, recurring: true })} />
                    Every month
                  </label>
                </div>
              </div>
              <div>
                <label className={label} htmlFor="earning-from">{form.recurring ? 'From' : 'Month'}</label>
                <input
                  id="earning-from"
                  type="month"
                  className={input}
                  value={form.start_period}
                  onChange={(e) => setForm({ ...form, start_period: e.target.value })}
                />
              </div>
              {form.recurring && (
                <div>
                  <label className={label} htmlFor="earning-until">Until</label>
                  <input
                    id="earning-until"
                    type="month"
                    className={input}
                    value={form.end_period}
                    onChange={(e) => setForm({ ...form, end_period: e.target.value })}
                  />
                </div>
              )}
              <div className={form.recurring ? '' : 'md:col-span-2'}>
                <label className={label} htmlFor="earning-note">Note</label>
                <input
                  id="earning-note"
                  className={input}
                  value={form.notes}
                  placeholder="e.g. Q3 sales target met"
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            {form.recurring && <p className="text-[11px] text-muted-foreground">Leave Until empty to keep paying it until removed.</p>}
            <div className="flex gap-2">
              <button type="button" className={primary} onClick={handleSave} disabled={busy}>
                Save
              </button>
              <button type="button" className={secondary} onClick={() => setForm(null)}>
                Cancel
              </button>
            </div>
          </section>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-64">
              <SearchInput placeholder="Search employee or earning" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex-1" />
            <button
              type="button"
              className={primary}
              onClick={() =>
                setForm({
                  employee_number: '',
                  earning_type_id: types.find((t) => t.active)?.id ?? '',
                  amount: '',
                  recurring: false,
                  start_period: payPeriod,
                  end_period: '',
                  notes: '',
                })
              }
              disabled={types.every((t) => !t.active)}
              title={types.every((t) => !t.active) ? 'Add an earning type first' : undefined}
            >
              <Plus className="w-3.5 h-3.5" />
              Add earning
            </button>
          </div>
        )}

        {/* this month's earnings */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-ink" data-testid="earnings-totals">
          <span>
            <span className="text-subtle">{periodLabel}: </span>
            <span className="font-bold">{ksh(totals.total)}</span> to {totals.employees} employee{totals.employees === 1 ? '' : 's'}
          </span>
          <span>
            <span className="text-subtle">Taxed: </span>
            <span className="font-semibold">{ksh(totals.taxable)}</span>
          </span>
          <span>
            <span className="text-subtle">Not taxed: </span>
            <span className="font-semibold">{ksh(totals.total - totals.taxable)}</span>
          </span>
        </div>
        <div className="rounded-xl border border-border overflow-hidden">
          <TableScroll>
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 border-b border-border">
                <tr className="text-left text-[10px] font-bold uppercase text-subtle">
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Earning</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Paid</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      {thisMonth.length ? 'Nothing matches that search.' : `No earnings for ${periodLabel} yet. Add one, or upload a spreadsheet.`}
                    </td>
                  </tr>
                )}
                {visible.map((e) => {
                  const type = typeById.get(e.earning_type_id);
                  return (
                    <tr key={e.id} className="border-b border-[#F1F5F2] last:border-0 text-ink">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{employeeName.get(e.employee_number) ?? 'Not in employee list'}</div>
                        <div className="text-[10px] text-subtle">{e.employee_number}</div>
                      </td>
                      <td className="px-3 py-2">
                        {type?.name}
                        {type && !type.taxable && <span className="ml-1 text-[10px] text-subtle">(not taxed)</span>}
                        {type && !type.active && <span className="ml-1 text-[10px] text-subtle">(paused)</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{ksh(Number(e.amount))}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{periodText(e)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.notes}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            aria-label="Edit"
                            className="p-1.5 rounded-tile text-subtle hover:text-ink hover:bg-secondary"
                            onClick={() =>
                              setForm({
                                id: e.id,
                                employee_number: e.employee_number,
                                earning_type_id: e.earning_type_id,
                                amount: String(e.amount),
                                recurring: !isOneOff(e),
                                start_period: e.start_period,
                                end_period: isOneOff(e) ? '' : e.end_period ?? '',
                                notes: e.notes ?? '',
                              })
                            }
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Remove"
                            className="p-1.5 rounded-tile text-subtle hover:text-status-danger hover:bg-secondary"
                            onClick={() => handleRemove(e)}
                            disabled={busy}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </div>
      </div>
    </Card>
  );
}
