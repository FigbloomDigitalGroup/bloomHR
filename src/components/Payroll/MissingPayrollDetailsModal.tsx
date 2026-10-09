import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { CheckCircle2, Download, ExternalLink, Loader, Upload } from 'lucide-react';
import { SearchInput } from '../UI';
import { readEmployeeRows } from '../../lib/employeeSheet';
import { runErrorMessage } from '../../lib/payrollRuns';
import type { EmployeeRecord } from '../../lib/profileCompleteness';
import {
  DETAILS_SHEET_COLUMNS,
  detailsSheetRows,
  employeesMissingDetails,
  parseDetailsSheet,
  saveDetailsUpdates,
  type DetailsUpdate,
} from '../../lib/missingPayrollDetails';

interface MissingPayrollDetailsModalProps {
  /** the employee rows the payroll page loaded */
  employees: EmployeeRecord[];
  onClose: () => void;
  /** called after a save, so the payroll page loads the employees again */
  onChanged: () => void;
  /** how changes reach this month's payroll run, if it has one */
  draftNotice: string | null;
}

const button =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile text-[11.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${button} bg-brand text-white hover:bg-brand-dark`;
const secondary = `${button} border border-border bg-white text-ink hover:bg-secondary`;
const label = 'block text-[10px] font-bold uppercase text-subtle mb-1';

/** Who is missing a KRA PIN, NSSF or SHA number, or payment details, and a spreadsheet to fill the gaps in bulk. */
export default function MissingPayrollDetailsModal({ employees, onClose, onChanged, draftNotice }: MissingPayrollDetailsModalProps) {
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [upload, setUpload] = useState<{ file: string; updates: DetailsUpdate[]; errors: string[]; unchanged: number } | null>(null);
  const [notSaved, setNotSaved] = useState<string[]>([]);

  const missing = useMemo(() => employeesMissingDetails(employees), [employees]);

  const countByItem = useMemo(() => {
    const counts = new Map<string, number>();
    missing.forEach((e) => e.missing.forEach((m) => counts.set(m, (counts.get(m) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [missing]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return missing.filter(
      (e) => !q || e.name.toLowerCase().includes(q) || e.employeeNumber.toLowerCase().includes(q) || e.missing.some((m) => m.toLowerCase().includes(q))
    );
  }, [missing, search]);

  const downloadSheet = () => {
    const sheet = XLSX.utils.aoa_to_sheet([DETAILS_SHEET_COLUMNS, ...detailsSheetRows(employees)]);
    sheet['!cols'] = DETAILS_SHEET_COLUMNS.map((c) => ({ wch: c === 'Missing' ? 36 : c === 'Name' ? 24 : 16 }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Missing details');
    XLSX.writeFile(book, 'missing_payroll_details.xlsx');
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const rows = readEmployeeRows(await file.arrayBuffer());
      const byNumber = new Map(employees.map((e) => [String(e['Employee Number'] ?? '').trim(), e]));
      setUpload({ file: file.name, ...parseDetailsSheet(rows, byNumber) });
      setNotSaved([]);
    } catch (err) {
      toast.error(runErrorMessage(err, 'Could not read that file.'));
    }
  };

  const handleSave = async () => {
    if (!upload?.updates.length) return;
    setBusy(true);
    try {
      const { saved, failed } = await saveDetailsUpdates(upload.updates);
      if (saved) toast.success(`Updated ${saved} employee(s).`);
      if (failed.length) toast.error(`${failed.length} employee(s) were not updated. See the list below.`);
      setNotSaved(failed);
      setUpload(null);
      if (saved) onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[10px] border border-gray-200 shadow-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Missing payroll details</h2>
            <p className="text-[11px] text-muted-foreground">
              KRA PIN, NSSF and SHA numbers, and bank or M-Pesa details, needed to pay staff and file returns.
            </p>
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

          {missing.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-border p-4 text-xs text-ink">
              <CheckCircle2 className="w-4 h-4 text-brand" />
              Every employee has their KRA PIN, NSSF and SHA numbers and payment details.
            </div>
          ) : (
            <section>
              <h3 className={label}>
                {missing.length} of {employees.length} employees are missing something
              </h3>
              <div className="flex flex-wrap gap-2">
                {countByItem.map(([item, count]) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setSearch(search === item ? '' : item)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-pill border text-[11.5px] font-semibold ${
                      search === item ? 'border-brand bg-secondary text-ink' : 'border-border bg-white text-ink hover:bg-secondary'
                    }`}
                  >
                    {item}
                    <span className="text-[10px] font-normal text-subtle">{count}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* bulk fix */}
          <section className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[220px]">
                <div className="text-xs font-bold text-ink">Fix many at once</div>
                <div className="text-[11px] text-muted-foreground">
                  Download the employees with gaps, fill in the empty cells and upload the sheet. Blank cells are left as they are.
                </div>
              </div>
              <button type="button" className={secondary} onClick={downloadSheet} disabled={missing.length === 0}>
                <Download className="w-3.5 h-3.5" />
                Download ({missing.length})
              </button>
              <label className={`${secondary} cursor-pointer`}>
                <Upload className="w-3.5 h-3.5" />
                Upload filled sheet
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
                  <span className="font-bold">{upload.file}</span>: {upload.updates.length} employee(s) to update
                  {upload.unchanged > 0 && `, ${upload.unchanged} unchanged`}
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
                  <button type="button" className={primary} onClick={handleSave} disabled={busy || upload.updates.length === 0}>
                    Save {upload.updates.length}
                    {upload.errors.length > 0 ? ' (skip the rest)' : ''}
                  </button>
                  <button type="button" className={secondary} onClick={() => setUpload(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {notSaved.length > 0 && (
              <div className="mt-3">
                <div className="text-[11.5px] font-bold text-status-danger">Not updated:</div>
                <ul className="max-h-28 overflow-y-auto text-[11px] text-status-danger list-disc pl-5">
                  {notSaved.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* list */}
          {missing.length > 0 && (
            <>
              <div className="w-64">
                <SearchInput placeholder="Search employee or detail" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 border-b border-border">
                    <tr className="text-left text-[10px] font-bold uppercase text-subtle">
                      <th className="px-3 py-2">Employee</th>
                      <th className="px-3 py-2">Missing</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                          Nothing matches that search.
                        </td>
                      </tr>
                    )}
                    {visible.map((e) => (
                      <tr key={e.employeeNumber} className="border-b border-[#F1F5F2] last:border-0 text-ink">
                        <td className="px-3 py-2">
                          <div className="font-semibold">{e.name || 'No name'}</div>
                          <div className="text-[10px] text-subtle">{e.employeeNumber}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {e.missing.map((m) => (
                              <span key={m} className="px-2 py-0.5 rounded-pill bg-orange-tint-alt text-orange-text-alt text-[10.5px] font-semibold">
                                {m}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <a
                            href={`/edit-employee/${encodeURIComponent(e.employeeNumber)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline"
                          >
                            Fix
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
