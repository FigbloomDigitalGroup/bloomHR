import { type ReactNode, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { saveAs } from 'file-saver';
import { AlertTriangle, Download, FileSpreadsheet, Globe2 } from 'lucide-react';
import { Card } from '../UI';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { getRunPayslips, type PayrollRun, type PayrollRunCountry } from '../../lib/payrollRuns';
import type { EmployeeRecord } from '../../lib/profileCompleteness';
import { type ExportFile, type Rates, lastDayOf, remittanceTotals, toCsv } from '../../lib/payrollExports';
import { type CountryFile, type CountryFiles, type RunCountry, filesByCountry } from '../../lib/payroll/multiCountry';
import { XLSX_TYPE, toXlsx } from '../../lib/xlsxExport';
import { tanzaniaRemittance } from '../../lib/payroll/countries/tanzania';
import FigbloomLoader from '../UI/FigbloomLoader';

// The Files tab's downloads, per country (FIG-905 stage 2): each approved (or paid) country's statutory returns, built
// from its own staff's payslips only (Kenya: KRA P10, SHA, NSSF, housing levy, NITA, and the WHT return in a month with
// contractors), and its bulk-payment files in its currency (KES: M-Pesa, bank and the Equity Eazzy Biz file; other
// currencies: the bank file). CSV or Excel, each with who is missing what. A country still a draft has no files yet.

export interface Files {
  countries: CountryFiles[];
  /** the company's Equity account salaries are paid from ('' until payroll sets it) */
  debitAccount: string;
  /** what each country owes its tax and social security bodies (Kenya: KRA, SHA, NSSF, housing levy, NITA) */
  totals: Map<string, ReturnType<typeof remittanceTotals>>;
}

type Format = 'csv' | 'xlsx';

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

/** The run's countries; a run from before countries were recorded is Kenya's. */
const countriesOf = (run: PayrollRun, runCountries?: PayrollRunCountry[] | RunCountry[]): RunCountry[] =>
  runCountries && runCountries.length ? runCountries : [{ country: 'Kenya', status: run.status }];

export async function loadExportFiles(run: PayrollRun, runCountries?: PayrollRunCountry[] | RunCountry[]): Promise<Files> {
  const countries = countriesOf(run, runCountries);
  const filed = countries.filter((c) => c.status !== 'draft').map((c) => c.country);
  const [payslips, employees, rates, debitAccount] = await Promise.all([
    getRunPayslips(run.id),
    fetchAll((from, to) => supabase.from('employees').select('*').order('id').range(from, to)),
    // each filed country's own rates, for the month's last day
    Promise.all(
      filed.map((country) =>
        supabase.rpc('statutory_rates_on', { p_day: lastDayOf(run.pay_period), p_country: country }).then(({ data, error }) => {
          if (error) throw error;
          return [country, (data ?? {}) as Rates] as const;
        })
      )
    ),
    loadDebitAccount(),
  ]);
  const ratesByCountry = new Map(rates);
  const files = filesByCountry({
    payslips: payslips as Record<string, unknown>[],
    employees: employees as EmployeeRecord[],
    runCountries: countries,
    ratesByCountry,
    payPeriod: run.pay_period,
    debitAccount,
  });
  return {
    countries: files,
    debitAccount,
    // what is remitted is in local currency, a USD payslip's local figures included (FIG-906)
    totals: new Map(files.map((c) => [c.country, remittanceTotals(c.statutoryPayslips, ratesByCountry.get(c.country) ?? {})])),
  };
}

/** Saves one file as CSV or Excel, named after it and the month (kra-p10-2026-10.csv, kra-p10-2026-10.xlsx). */
const saveFile = (f: ExportFile, name: string, payPeriod: string, format: Format, sheet: string) =>
  format === 'xlsx'
    ? saveAs(new Blob([toXlsx(f.headers, f.rows, sheet)], { type: XLSX_TYPE }), `${name}-${payPeriod}.xlsx`)
    : saveAs(new Blob([toCsv(f.headers, f.rows)], { type: 'text/csv;charset=utf-8' }), `${name}-${payPeriod}.csv`);

/** The payroll page's P10 button: Kenya's KRA P10 for the month, Kenya's staff only (CSV unless asked). Returns who is missing details. */
export async function downloadP10(run: PayrollRun, format: Format = 'csv', runCountries?: PayrollRunCountry[] | RunCountry[]) {
  const files = await loadExportFiles(run, runCountries);
  const p10 = files.countries.find((c) => c.country === 'Kenya')?.returns.find((r) => r.key === 'p10');
  if (!p10) throw new Error('Kenya’s payroll for this month is not approved yet');
  saveFile(p10.file, 'kra-p10', run.pay_period, format, 'KRA P10');
  return p10.file.problems;
}

function FileRow({ f, disabled, onDownload, open, onToggle, children }: {
  f: CountryFile;
  disabled: boolean;
  onDownload: (format: Format) => void;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-tile border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[180px]">
          <p className="text-sm font-medium text-ink">{f.label}</p>
          <p className="text-xs text-muted-foreground">
            {f.file.rows.length} {f.file.rows.length === 1 ? 'row' : 'rows'}, {f.what}
          </p>
        </div>
        {f.file.problems.length > 0 && (
          <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-text-alt">
            <AlertTriangle className="w-3.5 h-3.5" />
            {f.file.problems.length} missing details
          </button>
        )}
        {/* CSV or Excel: the same rows; in Excel every cell is text so account and phone numbers stay as typed */}
        <div className="inline-flex items-stretch rounded-tile border border-border bg-white text-[11px] font-semibold text-ink overflow-hidden">
          <span className="inline-flex items-center px-2 text-muted-foreground" aria-hidden>
            <Download className="w-3 h-3" />
          </span>
          {(['csv', 'xlsx'] as const).map((format) => (
            <button key={format} type="button" aria-label={format === 'csv' ? 'Download CSV' : 'Download Excel'}
              disabled={f.file.rows.length === 0 || disabled} onClick={() => onDownload(format)}
              className="px-2.5 py-1.5 border-l border-border hover:bg-secondary disabled:opacity-50">
              {format === 'csv' ? 'CSV' : 'Excel'}
            </button>
          ))}
        </div>
      </div>
      {f.file.note && (
        <p role="note" className="mt-1 text-xs text-muted-foreground">
          {f.file.note}
        </p>
      )}
      {children}
      {open && (
        <ul className="mt-2 border-t border-border pt-2 space-y-0.5 text-xs text-ink">
          {f.file.problems.map((p) => (
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
}

export default function PayrollExportsPanel({ run, runCountries }: { run: PayrollRun; runCountries?: PayrollRunCountry[] }) {
  const [files, setFiles] = useState<Files | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);

  const load = useCallback(() => {
    setFiles(null);
    setProblem(null);
    loadExportFiles(run, runCountries).then(setFiles, (err) => setProblem((err as { message?: string })?.message || 'Could not prepare the files.'));
  }, [run, runCountries]);

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

  const several = (files?.countries.length ?? 0) > 1;

  return (
    <Card className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <FileSpreadsheet className="w-4 h-4 text-brand" />
        <h3 className="text-sm font-semibold text-ink">Statutory returns and bulk payments, {run.pay_period}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        CSV or Excel files ready to upload, per country: each country’s returns list only its own staff, as each is filed with
        that country’s tax and social security bodies. Bulk payment files are in each country’s currency.
      </p>

      {problem && <p role="alert" className="text-sm text-status-danger">{problem}</p>}
      {!files && !problem && <FigbloomLoader label="Preparing files" size={48} />}
      {files && files.countries.length === 0 && <p className="text-xs text-muted-foreground">No country is approved for this month yet.</p>}

      {files?.countries.map((c) => (
        <section key={c.country} className="mb-5 last:mb-0" aria-label={`${c.country} files`} data-testid={`files-${c.country}`}>
          {several && (
            <h4 className="flex items-center gap-1.5 text-xs font-bold text-ink mb-2">
              <Globe2 className="w-3.5 h-3.5 text-brand" />
              {c.country} <span className="font-semibold text-subtle">· {c.currency} · {c.payslips.length} {c.payslips.length === 1 ? 'payslip' : 'payslips'}</span>
            </h4>
          )}
          {c.country === 'Kenya' && files.totals.get(c.country) && <RemittanceTotals totals={files.totals.get(c.country)!} />}
          {c.country === 'Tanzania' && <TanzaniaRemittance payslips={c.payslips} />}
          {c.returns.length === 0 && (
            <p className="text-xs text-muted-foreground mb-2">{c.country}’s returns come with its payroll rules.</p>
          )}
          <div className="space-y-2">
            {c.returns.map((f) => (
              <FileRow key={f.key} f={f} disabled={false} open={open === `${c.country}:${f.key}`}
                onToggle={() => setOpen(open === `${c.country}:${f.key}` ? null : `${c.country}:${f.key}`)}
                onDownload={(format) => saveFile(f.file, f.name, run.pay_period, format, f.label)} />
            ))}
            <p className="pt-1 text-[10.5px] font-bold uppercase text-subtle">Bulk payments in {c.currency}</p>
            {c.payments.map((f) => (
              <FileRow key={f.key} f={f} disabled={f.key === 'equity' && !files.debitAccount} open={open === `${c.country}:${f.key}`}
                onToggle={() => setOpen(open === `${c.country}:${f.key}` ? null : `${c.country}:${f.key}`)}
                onDownload={(format) => saveFile(f.file, f.name, run.pay_period, format, f.label)}>
                {f.key === 'equity' && (
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
              </FileRow>
            ))}
          </div>
        </section>
      ))}
    </Card>
  );
}

const ksh = (n: number) => `KSh ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tsh = (n: number) => `TSh ${Math.round(n).toLocaleString('en-KE')}`;

/** Tanzania's amounts to pay over for the month (FIG-905): PAYE, NSSF (both shares), SDL, WCF and HESLB. */
function TanzaniaRemittance({ payslips }: { payslips: CountryFiles['payslips'] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3" aria-label="Tanzania amounts to pay">
      {tanzaniaRemittance(payslips).map((i) => (
        <div key={i.label} className="rounded-tile border border-border px-3 py-2">
          <p className="text-[10px] font-bold uppercase text-subtle">{i.label}</p>
          <p className="text-sm font-semibold text-ink">{tsh(i.amount)}</p>
          <p className="text-[10.5px] text-muted-foreground">{i.note}</p>
        </div>
      ))}
    </div>
  );
}

/** Kenya's amounts to pay over for the month: PAYE, SHIF, NSSF and housing levy (both shares), and the employer's NITA levy. */
function RemittanceTotals({ totals }: { totals: ReturnType<typeof remittanceTotals> }) {
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
