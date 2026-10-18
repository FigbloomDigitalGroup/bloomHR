import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { saveAs } from 'file-saver';
import { CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import { Button, Card, EmptyState, StatusPill, TableScroll } from '../UI';
import { readEmployeeRows } from '../../lib/employeeSheet';
import { XLSX_TYPE, toXlsx } from '../../lib/xlsxExport';
import { formatKsh, longDate, today } from '../../lib/casualPay';
import { checkImport, importEntries, loadImports } from '../../lib/pieceRateApi';
import {
  WORK_SHEET_HEADERS, formatQty, templateRows, workRowsFromSheet,
  type ImportRow, type SheetWorkRow, type WorkImport, type WorkPerson, type WorkType,
} from '../../lib/pieceRate';

// Payroll's spreadsheet of work: download the template, fill it in, upload it. Every row is checked first (unknown
// worker or kind of work, a bad quantity or date, a locked month, the same row twice or work already recorded) and
// shown; then the good rows are imported, approved, and the upload is kept on record.

interface Props {
  people: WorkPerson[];
  types: WorkType[];
  onDone?: () => void;
}

interface Checked {
  fileName: string;
  rows: SheetWorkRow[];
  results: ImportRow[];
}

export default function WorkUpload({ people, types, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [history, setHistory] = useState<WorkImport[]>([]);

  const reloadHistory = useCallback(async () => {
    try {
      setHistory(await loadImports());
    } catch (err) {
      console.error('Could not load past uploads:', err);
    }
  }, []);

  useEffect(() => {
    void reloadHistory();
  }, [reloadHistory]);

  const template = () => {
    saveAs(new Blob([toXlsx(WORK_SHEET_HEADERS, templateRows(people, types, today()), 'Work')], { type: XLSX_TYPE }), 'work-template.xlsx');
  };

  const choose = async (file: File) => {
    setBusy(true);
    setChecked(null);
    setProblem(null);
    try {
      const rows = workRowsFromSheet(readEmployeeRows(await file.arrayBuffer()));
      if (!rows.length) {
        setProblem('The sheet has no rows of work. Use the template: Employee Number, Date, Kind of Work, Quantity.');
        return;
      }
      setChecked({ fileName: file.name, rows, results: await checkImport(rows) });
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const good = checked?.results.filter((r) => r.ok) ?? [];
  const bad = checked?.results.filter((r) => !r.ok) ?? [];
  const goodTotal = good.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  const doImport = async () => {
    if (!checked || !good.length) return;
    setBusy(true);
    try {
      const out = await importEntries(checked.fileName, checked.rows);
      toast.success(`${out.imported} ${out.imported === 1 ? 'row' : 'rows'} imported`);
      if (out.problems.length) toast.error(`${out.problems.length} ${out.problems.length === 1 ? 'row was' : 'rows were'} left out`);
      setChecked(null);
      void reloadHistory();
      onDone?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <div className="space-y-3 text-xs text-ink">
          <p className="m-0 text-muted-foreground">
            One row per worker, day and kind of work: their employee number, the date (2026-10-16 or 16/10/2026), the kind of work
            as named under Work types, and the quantity. Uploaded work is approved as it is imported. Casual workers&apos; days go on
            the Casual workers page.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Download className="w-3.5 h-3.5" />} onClick={template}>Download the template</Button>
            <label className={`inline-flex items-center gap-[7px] px-3.5 py-2 rounded-tile text-[12.5px] font-semibold bg-brand text-white cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
              <Upload className="w-3.5 h-3.5" />
              {busy ? 'Working...' : 'Choose a file'}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                aria-label="Spreadsheet"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void choose(f);
                }}
              />
            </label>
          </div>
          {problem && <p role="alert" className="m-0 text-status-danger">{problem}</p>}
        </div>
      </Card>

      {checked && (
        <Card padding="none">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
            <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
            <span className="text-[13px] font-semibold text-ink">{checked.fileName}</span>
            <StatusPill label={`${good.length} ready`} tone="success" />
            {bad.length > 0 && <StatusPill label={`${bad.length} with problems`} tone="danger" />}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setChecked(null)}>Cancel</Button>
              <Button disabled={busy || !good.length} onClick={() => void doImport()}>
                Import {good.length} {good.length === 1 ? 'row' : 'rows'} ({formatKsh(goodTotal)})
              </Button>
            </div>
          </div>
          <TableScroll>
            <table className="w-full text-xs" aria-label="Rows checked">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                  <th className="px-3 py-2 font-semibold">Row</th>
                  <th className="px-3 py-2 font-semibold">Worker</th>
                  <th className="px-3 py-2 font-semibold">Day</th>
                  <th className="px-3 py-2 font-semibold">Kind of work</th>
                  <th className="px-3 py-2 font-semibold text-right">Quantity</th>
                  <th className="px-3 py-2 font-semibold text-right">Amount</th>
                  <th className="px-3 py-2 font-semibold">Check</th>
                </tr>
              </thead>
              <tbody>
                {checked.results.map((r, i) => {
                  const src = checked.rows[i];
                  return (
                    <tr key={r.row} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">{r.row}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-ink">{r.worker_name ?? r.employee_number ?? src?.employee_number}</div>
                        {r.worker_name && <div className="text-[10.5px] text-subtle">{r.employee_number}</div>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.work_date ? longDate(r.work_date) : src?.work_date}</td>
                      <td className="px-3 py-2">{r.work_type ?? src?.work_type}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{r.quantity !== null ? `${formatQty(r.quantity)} ${r.unit ?? ''}` : src?.quantity}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{r.amount !== null ? formatKsh(r.amount) : ''}</td>
                      <td className="px-3 py-2">
                        {r.ok ? (
                          <span className="inline-flex items-center gap-1 text-status-success"><CheckCircle2 className="w-3.5 h-3.5" /> Ready</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-status-danger"><XCircle className="w-3.5 h-3.5 shrink-0" /> {r.error}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <Card padding="none">
        <div className="p-3 border-b border-border text-[13px] font-semibold text-ink">Past uploads</div>
        {history.length === 0 ? (
          <EmptyState icon={<FileSpreadsheet className="w-5 h-5" />} title="No uploads yet" />
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">File</th>
                  <th className="px-3 py-2 font-semibold text-right">Rows</th>
                  <th className="px-3 py-2 font-semibold text-right">Imported</th>
                  <th className="px-3 py-2 font-semibold">Left out</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(h.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className="px-3 py-2">{h.file_name}</td>
                    <td className="px-3 py-2 text-right">{h.row_count}</td>
                    <td className="px-3 py-2 text-right">{h.imported_count}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {h.problem_count === 0 ? 'None' : (
                        <details>
                          <summary className="cursor-pointer">{h.problem_count} {h.problem_count === 1 ? 'row' : 'rows'}</summary>
                          <ul className="m-0 mt-1 pl-4 list-disc">
                            {h.problems.slice(0, 50).map((p) => <li key={p.row}>Row {p.row}: {p.error}</li>)}
                          </ul>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </div>
  );
}
