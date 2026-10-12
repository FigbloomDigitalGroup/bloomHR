import { useEffect, useState } from 'react';
import { saveAs } from 'file-saver';
import { AlertTriangle, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Card } from '../UI';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { getRunPayslips, type PayrollRun } from '../../lib/payrollRuns';
import type { EmployeeRecord } from '../../lib/profileCompleteness';
import { type ExportFile, type Rates, bankFile, lastDayOf, mpesaFile, nssfFile, p10File, shaFile, toCsv } from '../../lib/payrollExports';

// For an approved (or paid) month: download the KRA P10, SHA and NSSF returns and the M-Pesa and bank bulk-payment
// files as CSV, each with everyone on that month's payroll, ready to upload. Before each one, who is missing what.

interface Files {
  p10: ExportFile;
  sha: ExportFile;
  nssf: ExportFile;
  mpesa: ExportFile;
  bank: ExportFile;
}

const FILES: { key: keyof Files; label: string; name: string; what: string }[] = [
  { key: 'p10', label: 'KRA PAYE (P10)', name: 'kra-p10', what: 'iTax P10 return' },
  { key: 'sha', label: 'SHA', name: 'sha', what: 'SHA contributions' },
  { key: 'nssf', label: 'NSSF', name: 'nssf', what: 'NSSF contributions' },
  { key: 'mpesa', label: 'M-Pesa bulk pay', name: 'bulk-pay-mpesa', what: 'staff paid by M-Pesa' },
  { key: 'bank', label: 'Bank bulk pay', name: 'bulk-pay-bank', what: 'staff paid by bank' },
];

export async function loadExportFiles(run: PayrollRun): Promise<Files> {
  const [payslips, employees, rates] = await Promise.all([
    getRunPayslips(run.id),
    fetchAll((from, to) => supabase.from('employees').select('*').order('id').range(from, to)),
    supabase.rpc('statutory_rates_on', { p_day: lastDayOf(run.pay_period) }).then(({ data, error }) => {
      if (error) throw error;
      return (data ?? {}) as Rates;
    }),
  ]);
  const ps = payslips as Record<string, unknown>[];
  const es = employees as EmployeeRecord[];
  return {
    p10: p10File(ps, es, rates),
    sha: shaFile(ps, es),
    nssf: nssfFile(ps, es),
    mpesa: mpesaFile(ps, es, run.pay_period),
    bank: bankFile(ps, es, run.pay_period),
  };
}

export default function PayrollExportsPanel({ run }: { run: PayrollRun }) {
  const [files, setFiles] = useState<Files | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<keyof Files | null>(null);

  useEffect(() => {
    setFiles(null);
    setProblem(null);
    loadExportFiles(run).then(setFiles, (err) => setProblem((err as { message?: string })?.message || 'Could not prepare the files.'));
  }, [run]);

  const download = (key: keyof Files, name: string) => {
    if (!files) return;
    const f = files[key];
    saveAs(new Blob([toCsv(f.headers, f.rows)], { type: 'text/csv;charset=utf-8' }), `${name}-${run.pay_period}.csv`);
  };

  return (
    <Card className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <FileSpreadsheet className="w-4 h-4 text-brand" />
        <h3 className="text-sm font-semibold text-ink">Statutory returns and bulk payments, {run.pay_period}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        CSV files with everyone on this month’s payroll, ready to upload to iTax, SHA, NSSF, M-Pesa or the bank.
      </p>

      {problem && <p role="alert" className="text-sm text-status-danger">{problem}</p>}
      {!files && !problem && <Loader2 className="w-5 h-5 animate-spin text-brand" aria-label="Preparing files" />}

      {files && (
        <div className="space-y-2">
          {FILES.map(({ key, label, name, what }) => {
            const f = files[key];
            return (
              <div key={key} className="rounded-tile border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-medium text-ink">{label}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.rows.length} {f.rows.length === 1 ? 'row' : 'rows'}, {what}
                    </p>
                  </div>
                  {f.problems.length > 0 && (
                    <button type="button" onClick={() => setOpen(open === key ? null : key)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-orange-text-alt">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {f.problems.length} missing details
                    </button>
                  )}
                  <button type="button" disabled={f.rows.length === 0} onClick={() => download(key, name)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-tile border border-border bg-white text-[11px] font-semibold text-ink hover:bg-secondary disabled:opacity-50">
                    <Download className="w-3 h-3" />
                    Download CSV
                  </button>
                </div>
                {open === key && (
                  <ul className="mt-2 border-t border-border pt-2 space-y-0.5 text-xs text-ink">
                    {f.problems.map((p) => (
                      <li key={p.employeeNumber}>
                        <span className="font-medium">{p.name || p.employeeNumber}</span>: {p.missing.join(', ')}
                      </li>
                    ))}
                    <li className="text-muted-foreground pt-1">
                      Their rows are still in the file; the portal may refuse them until the details are filled in.
                    </li>
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
