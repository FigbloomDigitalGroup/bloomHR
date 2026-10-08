import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { Download, Loader, Pause, Pencil, Play, Plus, Trash2, Upload } from 'lucide-react';
import EmployeePicker from '../UI/EmployeePicker';
import { SearchInput } from '../UI';
import { useEmployeeDirectory } from '../../hooks/useEmployeeDirectory';
import { readEmployeeRows } from '../../lib/employeeSheet';
import { runErrorMessage } from '../../lib/payrollRuns';
import {
  DEDUCTION_SHEET_COLUMNS,
  addDeductionType,
  importDeductionRows,
  loadDeductionSetup,
  parseDeductionSheet,
  removeEmployeeDeduction,
  saveEmployeeDeduction,
  setDeductionTypeActive,
  type DeductionType,
  type EmployeeDeduction,
  type ParsedDeductionRow,
} from '../../lib/voluntaryDeductions';

interface VoluntaryDeductionsModalProps {
  onClose: () => void;
  /** called after any change, so the payroll figures are worked out again */
  onChanged: () => void;
  /** how changes reach this month's payroll run, if it has one */
  draftNotice: string | null;
}

interface FormState {
  id?: string;
  employee_number: string;
  deduction_type_id: string;
  amount: string;
  start_period: string;
  end_period: string;
}

const EMPTY_FORM: FormState = { employee_number: '', deduction_type_id: '', amount: '', start_period: '', end_period: '' };

const monthLabel = (period: string | null) =>
  period ? new Date(`${period}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';

const periodText = (d: EmployeeDeduction) =>
  d.start_period && d.end_period
    ? `${monthLabel(d.start_period)} – ${monthLabel(d.end_period)}`
    : d.start_period
      ? `From ${monthLabel(d.start_period)}`
      : d.end_period
        ? `Until ${monthLabel(d.end_period)}`
        : 'Every month';

const button =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile text-[11.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${button} bg-brand text-white hover:bg-brand-dark`;
const secondary = `${button} border border-border bg-white text-ink hover:bg-secondary`;
const input = 'w-full px-2.5 py-1.5 rounded-tile border border-border bg-white text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand';
const label = 'block text-[10px] font-bold uppercase text-subtle mb-1';

/** The company's voluntary deductions (SACCO, insurance, welfare...) and what each employee has taken every month. */
export default function VoluntaryDeductionsModal({ onClose, onChanged, draftNotice }: VoluntaryDeductionsModalProps) {
  const { employees } = useEmployeeDirectory();
  const [types, setTypes] = useState<DeductionType[]>([]);
  const [deductions, setDeductions] = useState<EmployeeDeduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newType, setNewType] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [search, setSearch] = useState('');
  const [upload, setUpload] = useState<{ file: string; valid: ParsedDeductionRow[]; errors: string[] } | null>(null);

  const reload = async () => {
    try {
      const setup = await loadDeductionSetup();
      setTypes(setup.types);
      setDeductions(setup.deductions);
    } catch (err) {
      toast.error(runErrorMessage(err, 'Could not load deductions.'));
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
  const countByType = useMemo(() => {
    const counts = new Map<string, number>();
    deductions.forEach((d) => counts.set(d.deduction_type_id, (counts.get(d.deduction_type_id) ?? 0) + 1));
    return counts;
  }, [deductions]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deductions
      .filter(
        (d) =>
          !q ||
          d.employee_number.toLowerCase().includes(q) ||
          (employeeName.get(d.employee_number) ?? '').toLowerCase().includes(q) ||
          (typeById.get(d.deduction_type_id)?.name ?? '').toLowerCase().includes(q)
      )
      .sort(
        (a, b) =>
          (employeeName.get(a.employee_number) ?? a.employee_number).localeCompare(employeeName.get(b.employee_number) ?? b.employee_number) ||
          (typeById.get(a.deduction_type_id)?.name ?? '').localeCompare(typeById.get(b.deduction_type_id)?.name ?? '')
      );
  }, [deductions, search, employeeName, typeById]);

  const handleAddType = async () => {
    const name = newType.trim();
    if (!name) return;
    if (await change(() => addDeductionType(name), `Added "${name}".`)) setNewType('');
  };

  const handleSave = async () => {
    if (!form) return;
    const amount = Number(form.amount);
    if (!form.employee_number) return toast.error('Choose an employee.');
    if (!form.deduction_type_id) return toast.error('Choose a deduction.');
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter an amount above 0.');
    if (form.start_period && form.end_period && form.start_period > form.end_period) return toast.error('"Until" is before "From".');
    const saved = await change(
      () =>
        saveEmployeeDeduction({
          id: form.id,
          employee_number: form.employee_number,
          deduction_type_id: form.deduction_type_id,
          amount,
          start_period: form.start_period || null,
          end_period: form.end_period || null,
          notes: null,
        }),
      form.id ? 'Deduction updated.' : 'Deduction added.'
    );
    if (saved) setForm(null);
  };

  const handleRemove = (d: EmployeeDeduction) => {
    const who = employeeName.get(d.employee_number) ?? d.employee_number;
    const what = typeById.get(d.deduction_type_id)?.name ?? 'deduction';
    if (!window.confirm(`Stop taking ${what} from ${who}? Payslips already approved keep it.`)) return;
    change(() => removeEmployeeDeduction(d.id), `${what} removed for ${who}.`);
  };

  const downloadTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      [...DEDUCTION_SHEET_COLUMNS],
      ['EMP-001', 'SACCO', 2000, '2026-10', ''],
      ['EMP-002', 'Loan repayment', 5000, '2026-10', '2027-03'],
    ]);
    sheet['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Deductions');
    XLSX.writeFile(book, 'voluntary_deductions_template.xlsx');
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const rows = readEmployeeRows(await file.arrayBuffer());
      const { valid, errors } = parseDeductionSheet(rows, new Set(employees.map((e) => e.employeeNumber)));
      setUpload({ file: file.name, valid, errors });
    } catch (err) {
      toast.error(runErrorMessage(err, 'Could not read that file.'));
    }
  };

  const handleImport = async () => {
    if (!upload?.valid.length) return;
    const rows = upload.valid;
    const done = await change(async () => {
      const added = await importDeductionRows(rows, types);
      if (added) toast.success(`Added ${added} new deduction type(s).`);
    }, `Imported ${rows.length} deductions.`);
    if (done) setUpload(null);
  };

  const activeTypes = types.filter((t) => t.active || t.id === form?.deduction_type_id);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[10px] border border-gray-200 shadow-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Voluntary deductions</h2>
            <p className="text-[11px] text-muted-foreground">SACCO, insurance, welfare, loan repayments… taken from pay every month.</p>
          </div>
          <div className="flex items-center gap-2">
            {busy && <Loader className="w-3.5 h-3.5 animate-spin text-subtle" aria-label="Saving" />}
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1 rounded-[25px] hover:bg-gray-100 transition-colors border border-gray-200"
            >
              Close
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {draftNotice && (
            <div className="rounded-tile bg-orange-tint-alt text-orange-text-alt text-[11.5px] font-semibold px-3 py-2">{draftNotice}</div>
          )}

          {/* deduction types */}
          <section>
            <h3 className={label}>Deduction types</h3>
            <div className="flex flex-wrap items-center gap-2">
              {types.map((t) => (
                <span
                  key={t.id}
                  className={`inline-flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-pill border text-[11.5px] font-semibold ${
                    t.active ? 'border-border bg-white text-ink' : 'border-dashed border-border bg-secondary text-muted-foreground'
                  }`}
                >
                  {t.name}
                  <span className="text-[10px] font-normal text-subtle">
                    {countByType.get(t.id) ?? 0}
                    {t.active ? '' : ' · paused'}
                  </span>
                  <button
                    type="button"
                    title={t.active ? `Pause ${t.name}: stop taking it from everyone` : `Resume ${t.name}`}
                    aria-label={t.active ? `Pause ${t.name}` : `Resume ${t.name}`}
                    disabled={busy}
                    onClick={() =>
                      change(() => setDeductionTypeActive(t.id, !t.active), t.active ? `${t.name} paused.` : `${t.name} resumed.`)
                    }
                    className="p-1 rounded-full text-subtle hover:text-ink hover:bg-secondary"
                  >
                    {t.active ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  </button>
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <input
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddType()}
                  placeholder="New type, e.g. SACCO"
                  aria-label="New deduction type"
                  className={`${input} !w-44`}
                />
                <button type="button" className={secondary} onClick={handleAddType} disabled={busy || !newType.trim()}>
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </span>
            </div>
          </section>

          {/* bulk upload */}
          <section className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[220px]">
                <div className="text-xs font-bold text-ink">Many employees at once</div>
                <div className="text-[11px] text-muted-foreground">
                  Fill in the template ({DEDUCTION_SHEET_COLUMNS.join(', ')}) and upload it. New deduction names are added for you.
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
              <div className="text-xs font-bold text-ink">{form.id ? 'Edit deduction' : 'Add a deduction'}</div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className="md:col-span-2">
                  <EmployeePicker
                    label="Employee"
                    value={form.employee_number}
                    onChange={(e) => setForm({ ...form, employee_number: e?.employeeNumber ?? '' })}
                    disabled={!!form.id}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="deduction-type">Deduction</label>
                  <select
                    id="deduction-type"
                    className={input}
                    value={form.deduction_type_id}
                    onChange={(e) => setForm({ ...form, deduction_type_id: e.target.value })}
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
                  <label className={label} htmlFor="deduction-amount">Amount (KSh / month)</label>
                  <input
                    id="deduction-amount"
                    type="number"
                    min="0"
                    step="any"
                    className={input}
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 md:col-span-1">
                  <div>
                    <label className={label} htmlFor="deduction-from">From</label>
                    <input
                      id="deduction-from"
                      type="month"
                      className={input}
                      value={form.start_period}
                      onChange={(e) => setForm({ ...form, start_period: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={label} htmlFor="deduction-until">Until</label>
                    <input
                      id="deduction-until"
                      type="month"
                      className={input}
                      value={form.end_period}
                      onChange={(e) => setForm({ ...form, end_period: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">Leave From empty to start now, and Until empty to keep taking it until removed.</p>
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
            <div className="flex items-center gap-2">
              <div className="w-64">
                <SearchInput placeholder="Search employee or deduction" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="flex-1" />
              <button
                type="button"
                className={primary}
                onClick={() => setForm({ ...EMPTY_FORM, deduction_type_id: types.find((t) => t.active)?.id ?? '' })}
                disabled={types.every((t) => !t.active)}
                title={types.every((t) => !t.active) ? 'Add a deduction type first' : undefined}
              >
                <Plus className="w-3.5 h-3.5" />
                Add deduction
              </button>
            </div>
          )}

          {/* list */}
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 border-b border-border">
                <tr className="text-left text-[10px] font-bold uppercase text-subtle">
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Deduction</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Months</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && visible.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      {deductions.length ? 'Nothing matches that search.' : 'No deductions yet. Add one, or upload a spreadsheet.'}
                    </td>
                  </tr>
                )}
                {visible.map((d) => {
                  const type = typeById.get(d.deduction_type_id);
                  return (
                    <tr key={d.id} className="border-b border-[#F1F5F2] last:border-0 text-ink">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{employeeName.get(d.employee_number) ?? 'Not in employee list'}</div>
                        <div className="text-[10px] text-subtle">{d.employee_number}</div>
                      </td>
                      <td className="px-3 py-2">
                        {type?.name}
                        {type && !type.active && <span className="ml-1 text-[10px] text-subtle">(paused)</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">KSh {Number(d.amount).toLocaleString()}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{periodText(d)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            aria-label="Edit"
                            className="p-1.5 rounded-tile text-subtle hover:text-ink hover:bg-secondary"
                            onClick={() =>
                              setForm({
                                id: d.id,
                                employee_number: d.employee_number,
                                deduction_type_id: d.deduction_type_id,
                                amount: String(d.amount),
                                start_period: d.start_period ?? '',
                                end_period: d.end_period ?? '',
                              })
                            }
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Remove"
                            className="p-1.5 rounded-tile text-subtle hover:text-status-danger hover:bg-secondary"
                            onClick={() => handleRemove(d)}
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
          </div>
        </div>
      </div>
    </div>
  );
}
