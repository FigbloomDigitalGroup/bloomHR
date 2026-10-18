import React from 'react';
import { payPeriodLabel } from '../../lib/payPeriod';
import { payslipEarningLines } from '../../lib/earnings';
import { leaveLineLabel, leaveLineWorking, payslipLeaveLines } from '../../lib/leavePay';
import { overtimeLineLabel, overtimeLineWorking, payslipOvertimeLines, payslipOvertimePay } from '../../lib/overtimePay';
import { currencyOf, money } from '../../lib/payroll/currency';
import { payslipResultFor } from '../../lib/payroll/countries';
import { employeeTaxLabel, idNumberLabel, noReliefNote, payslipDeductionGroups, type GroupLine } from '../../lib/payroll/payslipSections';
import { DEFAULT_DESIGN, employerTaxLabel, type PayslipDesign, type PayslipEmployer } from '../../lib/payslipDesign';
import { payslipCountry, type PayslipExtras } from '../../lib/payslipExtras';
import { PayslipSettlementBlock, WorkEarningLines, netPayLabel } from './PayslipSettlement';
import LocalStatutorySection from './LocalStatutorySection';

// The payslip (FIG-814): ONE layout for the admin payslip, the staff portal, the downloaded PDF and the emailed PDF
// (payslipPdf.tsx renders this same component off screen). It only draws: the figures come from the payslip and its
// country's engine (payslipResultFor), the rest (employer block, employee numbers, year to date, run, design) from
// loadPayslipExtras, loaded before. Sections, top to bottom:
//
//   employer (letterhead or logo, name, address and contacts, tax number) · employee (name, number, position,
//   department, job group, branch, country; tax number, NSSF, SHA in Kenya, ID; payment details) · earnings (and
//   taxable benefits) · deductions (before tax / tax / after tax) · taxable pay and reliefs · month-end settlement ·
//   local statutory figures of a USD payslip · net pay · employer contributions · year to date · footer (run, pay date,
//   computer generated).
//
// The company's design (lib/payslipDesign) picks the letterhead, contacts, footer, heading colour, and whether employer
// contributions, the year to date, bank details and the leave balance show. Statutory deductions and net pay always do.

/* eslint-disable @typescript-eslint/no-explicit-any -- a payroll row or saved payslip (untyped rows) */
interface Props {
  record: any;
  companyInfo: any;
  id?: string;
  extras?: PayslipExtras | null;
  /** a design to show instead of the saved one (the design page's live preview) */
  design?: PayslipDesign | null;
}

const dateText = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

function Row({ label, value, testId }: { label: React.ReactNode; value: React.ReactNode; testId?: string }) {
  return (
    <div className="flex justify-between gap-3" data-testid={testId}>
      <span className="font-semibold text-gray-600">{label}</span>
      <span className="font-bold text-right break-all">{value}</span>
    </div>
  );
}

function Amount({ label, amount, fmt, sign = '', note, testId, strong = false }: {
  label: React.ReactNode; amount: number; fmt: (n: number) => string; sign?: '' | '−' | '+'; note?: string; testId?: string; strong?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-bold border-t border-gray-200 pt-1 mt-1' : ''}`} data-testid={testId}>
      <span>
        {label}
        {note && <span className="block text-gray-500 text-xs">{note}</span>}
      </span>
      <span className={`${strong ? '' : 'font-semibold'} whitespace-nowrap`}>{sign}{fmt(amount)}</span>
    </div>
  );
}

export function PayslipDocument({ record, companyInfo, id, extras, design: designOverride }: Props) {
  const design = designOverride ?? extras?.design ?? DEFAULT_DESIGN;
  const currency = currencyOf(record);
  const fmt = (n: number) => money(n, currency);
  const fmtRound = (n: number) => money(Math.round(Number(n) || 0), currency);
  const country = payslipCountry(record);
  const result = payslipResultFor(record);
  const working = result.working;
  const groups = payslipDeductionGroups(record, result);
  const employee = extras?.employee;
  const employer: PayslipEmployer = extras?.employer ?? {
    name: companyInfo?.company_name ?? null, logoUrl: companyInfo?.image_url ?? null, letterheadUrl: null, address: null, phone: null, email: null,
    website: null, taxLabel: employerTaxLabel(country), taxNumber: null,
  };
  const name = employer.name || companyInfo?.company_name || 'Your Company Name';
  const logo = employer.logoUrl || companyInfo?.image_url || null;
  const brand = design.brand_color ?? undefined;
  const heading = { color: brand };
  const isKenya = country === 'Kenya';
  const contractor = String(record.worker_kind ?? '') === 'contractor';
  const period = (() => {
    const now = new Date();
    return record.pay_period || record['Pay Period'] || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();
  const contacts = [employer.phone, employer.email, employer.website].filter(Boolean).join(' · ');
  const run = extras?.run;
  const payDate = run?.paidAt ? `Paid ${dateText(run.paidAt)}` : run?.approvedAt ? `Approved ${dateText(run.approvedAt)}` : null;
  const ytd = extras?.ytd;
  const dash = '—';
  const method = record.payment_method || 'M-Pesa';

  const groupLines = (title: string, lines: GroupLine[], testId: string) =>
    lines.length > 0 && (
      <div data-testid={testId}>
        <div className="text-[10px] font-bold uppercase text-gray-500 mt-1" style={heading}>{title}</div>
        {lines.map((l, i) => (
          <div key={`${l.key}-${l.label}-${i}`} className="flex justify-between gap-3" data-testid={l.testId}>
            <span>{l.label}</span>
            <span className="font-semibold whitespace-nowrap">{fmt(l.amount)}</span>
          </div>
        ))}
      </div>
    );

  return (
    <div
      id={id}
      className="bg-white border text-black border-gray-300 text-xs leading-tight mx-auto"
      style={{ maxWidth: '800px', boxShadow: '0 4px 15px rgba(0, 0, 0, 0.05)', fontFamily: 'Calibri, Helvetica, sans-serif' }}
      data-testid="payslip-document"
    >
      {/* employer */}
      {employer.letterheadUrl && <img src={employer.letterheadUrl} alt={`${name} letterhead`} className="block w-full" data-testid="payslip-letterhead" />}
      <div className="bg-white text-black p-4 sm:p-6 flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end border-b-[3px] border-double border-gray-300" data-testid="payslip-employer">
        {!employer.letterheadUrl ? (
          <div className="flex items-center min-w-0">
            {logo && <img src={logo} alt="Company Logo" className="h-16 w-16 mr-4 object-contain shrink-0" />}
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold uppercase text-gray-900 break-words" style={heading}>{name}</h1>
              <div className="text-gray-600 text-sm font-semibold mt-1">{companyInfo?.company_tagline || 'Excellence in service'}</div>
              {employer.address && <div className="text-gray-600 mt-1">{employer.address}</div>}
              {contacts && <div className="text-gray-600">{contacts}</div>}
              <div className="text-gray-600">{employer.taxLabel}: {employer.taxNumber || dash}</div>
            </div>
          </div>
        ) : (
          <div className="min-w-0 text-gray-600">
            {employer.address && <div>{employer.address}</div>}
            {contacts && <div>{contacts}</div>}
            <div>{employer.taxLabel}: {employer.taxNumber || dash}</div>
          </div>
        )}
        <div className="sm:text-right">
          <h2 className="text-2xl sm:text-3xl font-bold uppercase text-gray-900 mb-1" style={heading}>PAYSLIP</h2>
          <div className="text-gray-600 font-semibold text-sm">{payPeriodLabel(period)}</div>
          <div className="text-gray-600">{country} · {currency}</div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {/* employee */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6" data-testid="payslip-employee">
          <div className="border border-gray-300 p-4">
            <h3 className="font-bold border-b border-gray-300 pb-2 mb-3 text-gray-900 text-sm" style={heading}>Employee information</h3>
            <div className="space-y-1.5 text-black">
              <Row label="Full name:" value={record.employee_name || record['Employee Name'] || 'N/A'} />
              <Row label="Employee no:" value={record.employee_id || record['Employee ID'] || 'N/A'} />
              <Row label="Position:" value={employee?.position || record.position || 'N/A'} />
              <Row label="Department:" value={employee?.department || record.department || 'N/A'} />
              <Row label="Job group:" value={employee?.jobGroup || record.jobGroup || 'N/A'} />
              <Row label="Branch:" value={employee?.branch || record.branch || 'N/A'} />
              <Row label="Country:" value={country} />
            </div>
          </div>
          <div className="border border-gray-300 p-4">
            <h3 className="font-bold border-b border-gray-300 pb-2 mb-3 text-gray-900 text-sm" style={heading}>Tax and social security</h3>
            <div className="space-y-1.5 text-black">
              <Row label={`${employeeTaxLabel(country)}:`} value={employee?.taxNumber || dash} testId="employee-tax-number" />
              <Row label="NSSF number:" value={employee?.nssfNumber || dash} />
              {isKenya && <Row label="SHA number:" value={employee?.shaNumber || dash} testId="employee-sha-number" />}
              <Row label={`${idNumberLabel(country)}:`} value={employee?.idNumber || record.employeeNat || dash} />
            </div>
            <h3 className="font-bold border-b border-gray-300 pb-2 mb-3 mt-4 text-gray-900 text-sm" style={heading}>Payment details</h3>
            <div className="space-y-1.5 text-black" data-testid="payslip-payment">
              <Row label="Method:" value={method} />
              {design.show_bank_details && record.payment_method === 'Bank Transfer' && (
                <>
                  <Row label="Bank:" value={record.bank_name || 'N/A'} />
                  <Row label="Account:" value={record.account_number || 'N/A'} />
                </>
              )}
              {design.show_bank_details && record.payment_method === 'M-Pesa' && <Row label="M-Pesa no:" value={record.employeeNu || 'N/A'} />}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6">
          {/* earnings */}
          <div className="border border-gray-300" data-testid="payslip-earnings">
            <div className="bg-gray-100 border-b border-gray-300 font-bold p-3 text-gray-900" style={heading}>Earnings</div>
            <div className="p-3 space-y-2 text-black">
              <div className="flex justify-between"><span>Basic</span><span className="font-semibold">{fmt(Number(record.basic_salary) || 0)}</span></div>
              {payslipLeaveLines(record).map((line, i) => (
                <div key={`leave-${line.name}-${i}`} className="flex justify-between gap-3">
                  <span>{leaveLineLabel(line)}<span className="block text-gray-500 text-xs">{leaveLineWorking(line)}</span></span>
                  <span className="font-semibold text-red-700 whitespace-nowrap">−{fmt(line.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between"><span>House</span><span className="font-semibold">{fmt(Number(record.house_allowance) || 0)}</span></div>
              <div className="flex justify-between"><span>Transport</span><span className="font-semibold">{fmt(Number(record.transport_allowance) || 0)}</span></div>
              <div className="flex justify-between"><span>Medical</span><span className="font-semibold">{fmt(Number(record.medical_allowance) || 0)}</span></div>
              <div className="flex justify-between"><span>Other</span><span className="font-semibold">{fmt(Number(record.other_allowances) || 0)}</span></div>
              {payslipOvertimeLines(record).length > 0 ? (
                payslipOvertimeLines(record).map((line, i) => (
                  <div key={`overtime-${line.day_type}-${i}`} className="flex justify-between gap-3">
                    <span>{overtimeLineLabel(line)}<span className="block text-gray-500 text-xs">{overtimeLineWorking(line)}</span></span>
                    <span className="font-semibold whitespace-nowrap">{fmt(line.amount)}</span>
                  </div>
                ))
              ) : (
                <div className="flex justify-between"><span>Overtime</span><span className="font-semibold">{fmt(payslipOvertimePay(record))}</span></div>
              )}
              {payslipEarningLines(record).map((line, i) => (
                <div key={`${line.name}-${i}`} className="flex justify-between">
                  <span>{line.name}{!line.taxable && <span className="text-gray-500 text-xs"> (not taxed)</span>}</span>
                  <span className="font-semibold">{fmt(line.amount)}</span>
                </div>
              ))}
              {/* the month's piece rate work and contract jobs (FIG-812) */}
              <WorkEarningLines record={record} />
              {isKenya && (
                <div className="flex justify-between bg-gray-50 p-1 border border-gray-200 mt-2">
                  <span>Per diem</span>
                  <span className="font-bold">{fmt(Number(record.per_diem) || 0)}</span>
                </div>
              )}
              <Amount label="Gross pay" amount={Number(record.gross_pay) || 0} fmt={fmt} strong testId="earnings-gross" />
              {working && working.taxable_benefits.length > 0 && (
                <div className="mt-2 text-gray-600" data-testid="taxable-benefits">
                  <div className="text-[10px] font-bold uppercase">Taxable benefits (for tax only, not paid in cash)</div>
                  {working.taxable_benefits.map((l) => <Amount key={l.key} label={l.label} amount={l.amount} fmt={fmt} />)}
                </div>
              )}
            </div>
          </div>

          {/* deductions */}
          <div className="border border-gray-300" data-testid="payslip-deductions">
            <div className="bg-gray-100 border-b border-gray-300 font-bold p-3 text-gray-900" style={heading}>Deductions</div>
            <div className="p-3 space-y-2 text-black">
              {groupLines('Before tax', groups.beforeTax, 'deductions-before-tax')}
              {groupLines('Tax', groups.tax, 'deductions-tax')}
              {groupLines('After tax', groups.afterTax, 'deductions-after-tax')}
              {groups.beforeTax.length + groups.tax.length + groups.afterTax.length === 0 && <div className="text-gray-500">No deductions this month</div>}
              <Amount label="Total deductions" amount={Number(record.total_deductions) || 0} fmt={fmt} strong />
            </div>
          </div>
        </div>

        {/* taxable pay and reliefs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6">
          <div className="border border-gray-300 p-3 space-y-1.5" data-testid="payslip-taxable-pay">
            <div className="font-bold text-sm text-gray-900 border-b border-gray-300 pb-1 mb-1" style={heading}>Taxable pay</div>
            {!working ? (
              <p className="text-gray-600">Withholding tax is on gross pay: no taxable pay or reliefs.</p>
            ) : !working.recorded ? (
              <p className="text-gray-600">Taxable pay wasn’t kept on payslips worked out before October 2026.</p>
            ) : (
              <>
                <Amount label="Gross pay" amount={Number(record.gross_pay) || 0} fmt={fmt} />
                {working.not_taxed.map((l) => <Amount key={l.key} label={l.label} amount={l.amount} fmt={fmt} sign="−" />)}
                {working.taxable_benefits.map((l) => <Amount key={l.key} label={l.label} amount={l.amount} fmt={fmt} sign="+" />)}
                {working.before_tax.length > 0 && <div className="text-[10px] font-bold uppercase text-gray-500">Allowed before tax</div>}
                {working.before_tax.map((l) => <Amount key={l.key} label={l.label} amount={l.amount} fmt={fmt} sign="−" />)}
                <Amount label="Taxable pay" amount={result.taxablePay} fmt={fmt} strong testId="taxable-pay" />
              </>
            )}
          </div>
          <div className="border border-gray-300 p-3 space-y-1.5" data-testid="payslip-reliefs">
            <div className="font-bold text-sm text-gray-900 border-b border-gray-300 pb-1 mb-1" style={heading}>Reliefs</div>
            {working && working.tax_before_reliefs !== null && working.reliefs.length > 0 && (
              <Amount label="Tax on taxable pay" amount={working.tax_before_reliefs} fmt={fmt} />
            )}
            {working && working.reliefs.length > 0 ? (
              working.reliefs.map((l) => <Amount key={l.key} label={l.label} amount={l.amount} fmt={fmt} sign="−" testId={`relief-${l.key}`} />)
            ) : (
              <p className="text-gray-600" data-testid="no-reliefs">{contractor ? 'None (withholding tax)' : noReliefNote(country)}</p>
            )}
            {!contractor && <Amount label="PAYE" amount={result.tax} fmt={fmtRound} strong testId="reliefs-paye" />}
          </div>
        </div>

        <PayslipSettlementBlock record={record} />
        {/* paid in USD (FIG-906): the statutory figures in the local currency at the month's rate */}
        <LocalStatutorySection record={record} />

        {/* net pay */}
        <div className="border border-gray-300 p-4 mb-6 bg-gray-50" data-testid="payslip-net">
          <div className="flex justify-between border-b border-gray-300 pb-2 mb-2 text-sm text-black">
            <span className="font-bold">Gross pay</span>
            <span className="font-bold">{fmt(Number(record.gross_pay) || 0)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-300 pb-2 mb-3 text-sm text-black">
            <span className="font-bold">Total deductions</span>
            <span className="font-bold">{fmt(Number(record.total_deductions) || 0)}</span>
          </div>
          <div className="flex justify-between items-center text-lg text-black mt-2">
            <span className="font-bold" style={heading}>{netPayLabel(record)}</span>
            <span className="font-bold border-b-[3px] border-gray-400 border-double pb-0.5">{fmtRound(Number(record.net_pay) || 0)}</span>
          </div>
        </div>

        {/* employer contributions */}
        {design.show_employer_contributions && result.employerCosts.length > 0 && (
          <div className="border border-dashed border-gray-300 p-3 mb-6 text-gray-700" data-testid="employer-contributions">
            <div className="font-bold text-sm text-gray-900" style={heading}>Employer contributions</div>
            <div className="text-gray-500 mb-1">Paid by your employer, not deducted from your pay</div>
            {result.employerCosts.map((l) => <Amount key={l.label} label={l.label} amount={l.amount} fmt={fmt} />)}
          </div>
        )}

        {/* year to date */}
        {design.show_ytd && ytd && (
          <div className="border border-gray-300 p-3 mb-6 text-black" data-testid="payslip-ytd">
            <div className="font-bold text-sm text-gray-900" style={heading}>
              Year to date ({country} tax year {ytd.taxYear.label}, {ytd.months} {ytd.months === 1 ? 'month' : 'months'}, in {ytd.currency})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full mt-1 text-right">
                <thead>
                  <tr className="text-gray-500">
                    <th className="font-semibold py-1 text-left">Gross</th>
                    <th className="font-semibold py-1">Taxable pay</th>
                    <th className="font-semibold py-1">PAYE</th>
                    <th className="font-semibold py-1">NSSF</th>
                    <th className="font-semibold py-1">Net</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="font-semibold whitespace-nowrap">
                    <td className="py-1 text-left" data-testid="ytd-gross">{fmt(ytd.gross_pay)}</td>
                    <td className="py-1" data-testid="ytd-taxable">{ytd.taxable_pay === null ? dash : fmt(ytd.taxable_pay)}</td>
                    <td className="py-1" data-testid="ytd-paye">{fmt(ytd.paye_tax)}</td>
                    <td className="py-1" data-testid="ytd-nssf">{fmt(ytd.nssf_deduction)}</td>
                    <td className="py-1" data-testid="ytd-net">{fmt(ytd.net_pay)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-gray-500 mt-1">
              This payslip and the approved payslips before it in the tax year.
              {ytd.taxable_pay !== null && ytd.taxable_missing > 0 && ` Taxable pay covers ${ytd.months - ytd.taxable_missing} of the ${ytd.months} months.`}
              {ytd.other_currencies.length > 0 &&
                ` Not included: ${ytd.other_currencies.map((o) => `${o.months} ${o.months === 1 ? 'month' : 'months'} paid in ${o.currency}`).join(', ')} (currencies are never added together).`}
            </p>
          </div>
        )}

        {design.show_leave_balance && extras?.leaveBalance && extras.leaveBalance.length > 0 && (
          <div className="border border-gray-300 p-3 mb-6 text-black" data-testid="payslip-leave-balance">
            <div className="font-bold text-sm text-gray-900" style={heading}>Leave balance</div>
            {extras.leaveBalance.map((l) => (
              <div key={l.label} className="flex justify-between"><span>{l.label}</span><span className="font-semibold">{l.days} days</span></div>
            ))}
          </div>
        )}

        {record.payslip_note && (
          <div className="border border-gray-300 p-3 mb-6 text-black">
            <span className="font-bold">Note: </span>
            <span className="whitespace-pre-line">{record.payslip_note}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-4 text-center text-xs">
          <div className="p-2 pt-8">
            <div className="border-t border-gray-300 pt-2 font-bold text-gray-800">Employee signature</div>
            <div className="text-gray-500 mt-1">Date: ________________________</div>
          </div>
          <div className="p-2 pt-8">
            <div className="border-t border-gray-300 pt-2 font-bold text-gray-800">Authorized signatory</div>
            <div className="text-gray-500 mt-1">Date: ________________________</div>
          </div>
        </div>

        {/* footer */}
        <div className="text-center text-gray-500 text-xs border-t border-gray-300 pt-4 mt-6 space-y-1" data-testid="payslip-footer">
          {design.footer_text && <div className="whitespace-pre-line text-gray-700">{design.footer_text}</div>}
          <div>
            {run ? `Payroll run ${run.ref}` : 'Payroll run: not started'}
            {payDate && <> &bull; {payDate}</>}
          </div>
          <div>
            This payslip is computer generated &bull; Generated on {new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}{' '}
            {new Date().toLocaleTimeString()} &bull; {name} &bull; Strictly confidential
          </div>
        </div>
      </div>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export default PayslipDocument;
