import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { saveAs } from 'file-saver';
import { AlertTriangle, Download, FileSpreadsheet } from 'lucide-react';
import { Card } from '../UI';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { getRunPayslips, type PayrollRun } from '../../lib/payrollRuns';
import type { EmployeeRecord } from '../../lib/profileCompleteness';
import {
  type ExportFile,
  type Rates,
  bankFile,
  equityFile,
  lastDayOf,
  mpesaFile,
  nitaFile,
  nssfFile,
  p10File,
  remittanceTotals,
  shaFile,
  toCsv,
  whtFile,
} from '../../lib/payrollExports';
import { XLSX_TYPE, toXlsx } from '../../lib/xlsxExport';
import FigbloomLoader from '../UI/FigbloomLoader';

// For an approved (or paid) month: download the KRA P10, SHA and NSSF returns and the M-Pesa and bank bulk-payment
// files as CSV or Excel, each with everyone on that month's payroll, ready to upload. Before each one, who is missing what.

interface Files {
  p10: ExportFile;
  sha: ExportFile;
  nssf: ExportFile;
  mpesa: ExportFile;
  bank: ExportFile;
  equity: ExportFile;
  nita: ExportFile;
  /** withholding tax on contractors, for the iTax WHT return (FIG-812) */
  wht: ExportFile;
  /** the company's Equity account salaries are paid from ('' until payroll sets it) */
  debitAccount: string;
  /** what the month owes KRA, SHA, NSSF, the housing levy and NITA */
  totals: ReturnType<typeof remittanceTotals>;
}

type FileKey = Exclude<keyof Files, 'debitAccount' | 'totals'>;

type Format = 'csv' | 'xlsx';

const FILES: { key: FileKey; label: string; name: string; what: string }[] = [
  { key: 'p10', label: 'KRA PAYE (P10)', name: 'kra-p10', what: 'iTax P10 return' },
  { key: 'sha', label: 'SHA', name: 'sha', what: 'SHA contributions' },
  { key: 'nssf', label: 'NSSF', name: 'nssf', what: 'NSSF contributions' },
  { key: 'mpesa', label: 'M-Pesa bulk pay', name: 'bulk-pay-mpesa', what: 'staff paid by M-Pesa' },
  { key: 'bank', label: 'Bank bulk pay', name: 'bulk-pay-bank', what: 'staff paid by bank' },
  { key: 'equity', label: 'Equity Bank (Eazzy Biz)', name: 'equity-eazzy-biz', what: 'everyone paid by bank or M-Pesa, from the company’s Equity account' },
  { key: 'nita', label: 'NITA training levy', name: 'nita-levy', what: 'employer levy per employee (not taken from pay)' },
  { key: 'wht', label: 'KRA withholding tax (contractors)', name: 'kra-wht', what: 'iTax WHT return: each contractor’s gross, rate and tax' },
];

/** The company's Equity account salaries are paid from (company_payroll_settings). */
export async function loadDebitAccount(): Promise<string> {
  const { data, error } = await supabase.from('company_payroll_settings').select('equity_debit_account').maybeSingle();
  if (error) throw error;
  return String(data?.equity_debit_account ?? '');
}

export async function saveDebitAccount(account: string): Promise<void> {
  const digits = account.replace(/[\s-]/g, '');
  if (!/^\d{6,20}$/.test(digits)) throw new Error('An account number is 6 to 20 digits.');
  const { error } = await supabase
    .from('company_payroll_settings')
    .upsert({ equity_debit_account: digits, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

export async function loadExportFiles(run: PayrollRun): Promise<Files> {
  const [payslips, employees, rates, debitAccount] = await Promise.all([
    getRunPayslips(run.id),
    fetchAll((from, to) => supabase.from('employees').select('*').order('id').range(from, to)),
    supabase.rpc('statutory_rates_on', { p_day: lastDayOf(run.pay_period) }).then(({ data, error }) => {
      if (error) throw error;
      return (data ?? {}) as Rates;
    }),
    loadDebitAccount(),
  ]);
  const ps = payslips as Record<string, unknown>[];
  const es = employees as EmployeeRecord[];
  return {
    p10: p10File(ps, es, rates),
    sha: shaFile(ps, es),
    nssf: nssfFile(ps, es),
    mpesa: mpesaFile(ps, es, run.pay_period),
    bank: bankFile(ps, es, run.pay_period),
    equity: equityFile(ps, es, debitAccount),
    nita: nitaFile(ps, es),
    wht: whtFile(ps, es, run.pay_period),
    debitAccount,
    totals: remittanceTotals(ps, rates),
  };
}

/** Saves one file as CSV or Excel, named after it and the month (kra-p10-2026-10.csv, kra-p10-2026-10.xlsx). */
const saveFile = (f: ExportFile, name: string, payPeriod: string, format: Format, sheet: string) =>
  format === 'xlsx'
    ? saveAs(new Blob([toXlsx(f.headers, f.rows, sheet)], { type: XLSX_TYPE }), `${name}-${payPeriod}.xlsx`)
    : saveAs(new Blob([toCsv(f.headers, f.rows)], { type: 'text/csv;charset=utf-8' }), `${name}-${payPeriod}.csv`);

/** The payroll page's P10 button: the month's KRA P10 (CSV unless asked). Returns who is missing details the return needs. */
export async function downloadP10(run: PayrollRun, format: Format = 'csv') {
  const files = await loadExportFiles(run);
  saveFile(files.p10, 'kra-p10', run.pay_period, format, 'KRA P10');
  return files.p10.problems;
}

export default function PayrollExportsPanel({ run }: { run: PayrollRun }) {
  const [files, setFiles] = useState<Files | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<FileKey | null>(null);
  const [account, setAccount] = useState<string | null>(null);

  const load = useCallback(() => {
    setFiles(null);
    setProblem(null);
    loadExportFiles(run).then(setFiles, (err) => setProblem((err as { message?: string })?.message || 'Could not prepare the files.'));
  }, [run]);

  useEffect(load, [load]);

  const saveAccount = async () => {
    try {
      await saveDebitAccount(account ?? '');
      setAccount(null);
      load();
    } catch (err) {
      toast.error((err as { message?: string })?.message || 'The account was not saved.');
    }
  };

  const download = (key: FileKey, name: string, format: Format, sheet: string) => {
    if (!files) return;
    saveFile(files[key], name, run.pay_period, format, sheet);
  };

  return (
    <Card className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <FileSpreadsheet className="w-4 h-4 text-brand" />
        <h3 className="text-sm font-semibold text-ink">Statutory returns and bulk payments, {run.pay_period}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        CSV or Excel files with everyone on this month’s payroll, ready to upload to iTax, SHA, NSSF, M-Pesa or the bank.
      </p>

      {problem && <p role="alert" className="text-sm text-status-danger">{problem}</p>}
      {!files && !problem && <FigbloomLoader label="Preparing files" size={48} />}

      {files && <RemittanceTotals totals={files.totals} />}

      {files && (
        <div className="space-y-2">
          {/* the WHT return only when the month paid contractors (FIG-812) */}
          {FILES.filter(({ key }) => key !== 'wht' || files.wht.rows.length > 0).map(({ key, label, name, what }) => {
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
                  {/* CSV or Excel: the same rows; in Excel every cell is text so account and phone numbers stay as typed */}
                  <div className="inline-flex items-stretch rounded-tile border border-border bg-white text-[11px] font-semibold text-ink overflow-hidden">
                    <span className="inline-flex items-center px-2 text-muted-foreground" aria-hidden>
                      <Download className="w-3 h-3" />
                    </span>
                    {(['csv', 'xlsx'] as const).map((format) => (
                      <button key={format} type="button" aria-label={format === 'csv' ? 'Download CSV' : 'Download Excel'}
                        disabled={f.rows.length === 0 || (key === 'equity' && !files.debitAccount)} onClick={() => download(key, name, format, label)}
                        className="px-2.5 py-1.5 border-l border-border hover:bg-secondary disabled:opacity-50">
                        {format === 'csv' ? 'CSV' : 'Excel'}
                      </button>
                    ))}
                  </div>
                </div>
                {key === 'equity' && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {files.debitAccount && account === null ? (
                      <>
                        <span className="text-muted-foreground">Paid from Equity account {files.debitAccount}</span>
                        <button type="button" className="text-brand font-semibold" onClick={() => setAccount(files.debitAccount)}>Change</button>
                      </>
                    ) : (
                      <>
                        <label htmlFor="equity-debit-account" className="text-ink">The company’s Equity account salaries are paid from</label>
                        <input id="equity-debit-account" inputMode="numeric" value={account ?? ''} onChange={(e) => setAccount(e.target.value)}
                          placeholder="Account number" className="w-44 rounded-lg border border-border px-2 py-1" />
                        <button type="button" disabled={!account?.trim()} onClick={() => void saveAccount()}
                          className="rounded-lg bg-brand px-2.5 py-1 font-semibold text-white disabled:opacity-50">Save</button>
                        {files.debitAccount && <button type="button" className="text-muted-foreground" onClick={() => setAccount(null)}>Cancel</button>}
                      </>
                    )}
                  </div>
                )}
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

const ksh = (n: number) => `KSh ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The month's amounts to pay over: PAYE, SHIF, NSSF and housing levy (both shares), and the employer's NITA levy. */
function RemittanceTotals({ totals }: { totals: Files['totals'] }) {
  const items: { label: string; amount: number; note: string }[] = [
    { label: 'PAYE (KRA)', amount: totals.paye, note: 'From employees' },
    { label: 'SHIF (SHA)', amount: totals.shif, note: 'From employees' },
    { label: 'NSSF', amount: totals.nssf.employee + totals.nssf.employer, note: `${ksh(totals.nssf.employee)} employees + ${ksh(totals.nssf.employer)} employer` },
    { label: 'Housing levy', amount: totals.ahl.employee + totals.ahl.employer, note: `${ksh(totals.ahl.employee)} employees + ${ksh(totals.ahl.employer)} employer` },
    { label: 'NITA levy', amount: totals.nita.total, note: `Employer only, ${totals.nita.employees} ${totals.nita.employees === 1 ? 'employee' : 'employees'}` },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3" aria-label="Amounts to pay">
      {items.map((i) => (
        <div key={i.label} className="rounded-tile border border-border px-3 py-2">
          <p className="text-[10px] font-bold uppercase text-subtle">{i.label}</p>
          <p className="text-sm font-semibold text-ink">{ksh(i.amount)}</p>
          <p className="text-[10.5px] text-muted-foreground">{i.note}</p>
        </div>
      ))}
    </div>
  );
}
