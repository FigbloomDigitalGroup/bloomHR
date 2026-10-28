import React from "react";
import toast from "react-hot-toast";
import {
  Briefcase,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  FileDown,
  FileSpreadsheet,
  FolderDown,
  Loader,
  MapPin,
  Plus,
  Send,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { Card, SearchInput, TableScroll } from "../UI";
import SearchableDropdown from "../UI/SearchableDropdown";
import type { PayrollRun } from "../../lib/payrollRuns";
import type { EmployeeRecord } from "../../lib/profileCompleteness";
import { IN_APP_PAYMENTS } from "../../lib/inAppPayments";
import { payslipDeductionLines } from "../../lib/voluntaryDeductions";
import { payslipEarningLines } from "../../lib/earnings";
import { leaveLineLabel, payslipLeaveLines } from "../../lib/leavePay";
import { overtimeLineLabel, payslipOvertimeLines, payslipOvertimePay } from "../../lib/overtimePay";
import PayrollRunBar from "./PayrollRunBar";
import ReturnsReadiness from "./ReturnsReadiness";
import { BulkPayButton } from "./RunPayActions";
import { DemoPayButton } from "./DemoPayments";
import type { DemoPayLine } from "../../lib/demoPayments";
import { Pagination } from "./PayrollPagination";
import { PayslipSettlementBlock, WhtDeductionLine, WorkEarningLines } from "./PayslipSettlement";
import WorkSettlementCard from "./WorkSettlementCard";
import MinimumWageWarning from "./MinimumWageWarning";
import CountryReadinessPanel, { type CountryActions, CurrencyTotalsText } from "./CountryReadinessPanel";
import { type Branch, employeeBranch } from "../../lib/branches";
import type { CountryReadiness, CurrencyTotals } from "../../lib/payroll/multiCountry";
import { payslipCountry } from "../../lib/payroll/multiCountry";
import { currencyOf, moneyRounded } from "../../lib/payroll/currency";
import { countryPayslipLines } from "../../lib/payroll/countries";
import { localPayslip } from "../../lib/payroll/usdPay";
import LocalStatutorySection from "./LocalStatutorySection";
import { type ReimbursementType, afterDeductionsOf, parseReimbursement, reimbursementItemsOf, reimbursementNamesFor, reimbursementOf } from "../../lib/reimbursements";
import { runRowFigures, runTotalsByCurrency, statutoryColumnsFor } from "../../lib/payrollRunColumns";

// The Run tab: the month's payroll run (start, recalculate, approve, mark paid), the returns check, and the list of
// employees on the payroll with their pay. The figures are worked out by PayrollDashboard; this only shows them.
// Phones get a stacked list; wider screens a table with the month's totals at the foot.

/* eslint-disable @typescript-eslint/no-explicit-any -- payroll rows are the untyped records PayrollDashboard builds */
interface PayrollRunTabProps {
  periodLabel: string;
  /** saves the listed payslips as a PDF payroll register */
  onDownloadPdf: () => void;
  monthRun: PayrollRun | null;
  runLoading: boolean;
  runBusy: boolean;
  onStart: () => void;
  onApprove: () => void;
  onReopen: () => void;
  onMarkPaid: () => void;
  onDiscard: () => void;
  onPayroll: EmployeeRecord[];
  onOpenFiles: () => void;
  userRole: string;
  handleBulkMpesaPayment: () => void;
  onOpenSpreadsheet: () => void;
  onOpenApprovals: () => void;
  pendingCount: number;
  branches: { value: string; label: string }[];
  selectedBranch: string;
  setSelectedBranch: (v: string) => void;
  departments: string[];
  selectedDepartment: string;
  setSelectedDepartment: (v: string) => void;
  paymentMethods: string[];
  selectedPaymentMethod: string;
  setSelectedPaymentMethod: (v: string) => void;
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  finalFilteredRecords: any[];
  currentItems: any[];
  totals: {
    totalGrossPay: number;
    totalDeductions: number;
    totalNetPay: number;
    totalPAYE: number;
    totalNHIF: number;
    totalNSSF: number;
    totalHousingLevy: number;
  };
  /** the month's NITA training levy, paid by the employer on top of pay (FIG-898) */
  nitaLevy?: { total: number; employees: number };
  /** per diem, mileage and the company's other reimbursement columns, typed in for each row (lib/reimbursements) */
  reimbursements?: RunReimbursements;
  /** every payslip of the month, whatever the filters (the piece rate settlement summary and WHT report, FIG-812) */
  payrollRecords?: any[];
  /** the month, 'YYYY-MM' */
  payPeriod?: string;
  /** the company's branches, each in a country (FIG-905): each employee's branch and country show */
  companyBranches?: Branch[];
  /** one run for every country (FIG-905 stage 2): each country's readiness, and its own approve / reopen / pay */
  readiness?: CountryReadiness[];
  countryActions?: CountryActions;
  /** what the run bar shows and allows when countries are in different states */
  runBarCountries?: { ready: number; draft: boolean; approved: boolean; summary?: string };
  /** the filtered payslips' totals, one per currency (never added across currencies) */
  currencyTotals?: CurrencyTotals[];
  /** who Kenya's returns check covers (Kenya's staff); everyone on payroll when not given */
  returnsEmployees?: EmployeeRecord[];
  /** reports who is below their country's minimum wage, by country, for the readiness check */
  onBelowMinimum?: (byCountry: Map<string, number>) => void;
  /** the country filter: "all" or a country */
  countryOptions?: string[];
  selectedCountry?: string;
  setSelectedCountry?: (v: string) => void;
  expandedRows: Set<unknown>;
  toggleRowExpand: (id: any, e: React.MouseEvent) => void;
  smsSendingStatus: Record<string, any>;
  sendingSMS: boolean;
  sendPayslipNotification: (record: any) => void;
  handleSingleMpesaPayment: (record: any) => void;
  handleViewPayslip: (record: any, index: number) => void;
  currentPage: number;
  totalPages: number;
  handlePageChange: (page: number) => void;
  itemsPerPage: number;
  /** "Email payslips" for an approved month (EmailPayslipsPanel, FIG-732) */
  payslipEmails?: React.ReactNode;
  /** "USD rate for Kenya this month", for countries paid in USD (UsdRatePanel, FIG-906) */
  usdRates?: React.ReactNode;
  /** pretend paying for demos (lib/inAppPayments PAYMENTS_DEMO) */
  demoPay: {
    /** the Pay buttons show (demo mode is on) */
    shown: boolean;
    /** paying can happen: the month is approved */
    enabled: boolean;
    /** why paying can't happen yet ("Approve October 2026's payroll first"), when it can't */
    blockedReason: string | null;
    lineFor: (employeeNumber: string) => DemoPayLine | undefined;
    isPaid: (employeeNumber: string) => boolean;
    onPaid: (employeeNumber: string) => void;
    onPayAll: () => void;
  };
}

export interface RunReimbursements {
  /** the company's columns, in order */
  columns: ReimbursementType[];
  /** the row's amounts can be typed in (the month isn't started, or its country is still a draft) */
  canEdit: (record: any) => boolean;
  /** saves one amount (0 clears it); false when it wasn't saved */
  onSet: (record: any, type: ReimbursementType, amount: number) => Promise<boolean>;
  onAddColumn: (name: string) => Promise<boolean>;
  onRemoveColumn: (type: ReimbursementType) => void;
}

const ksh = (n: number, currency = "KES") => moneyRounded(n, currency);

/** One reimbursement amount, typed in: saved when the box loses focus or on Enter, put back on Escape. */
function ReimbursementInput({ value, label, onSave }: { value: number; label: string; onSave: (amount: number) => Promise<boolean> }) {
  const shown = value ? String(value) : "";
  const [text, setText] = React.useState(shown);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setText(shown), [shown]);
  const save = async () => {
    const amount = parseReimbursement(text);
    if (amount === null) {
      toast.error(`${label}: type an amount, like 1500`);
      setText(shown);
      return;
    }
    if (amount === value) {
      setText(shown);
      return;
    }
    setSaving(true);
    if (!(await onSave(amount))) setText(shown);
    setSaving(false);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={text}
      placeholder="0"
      disabled={saving}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          // put back what was saved, then leave the box (blur saves nothing: it matches)
          const box = e.currentTarget;
          setText(shown);
          setTimeout(() => box.blur());
        }
      }}
      className="w-[4.5rem] rounded-md border border-border bg-white px-1.5 py-1 text-right text-xs text-ink placeholder:text-subtle focus:border-brand focus:outline-none disabled:opacity-50"
    />
  );
}

/** "+ Column": names a new reimbursement column (Fuel, Airtime...) in place. */
function AddReimbursementColumn({ onAdd }: { onAdd: (name: string) => Promise<boolean> }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add a reimbursement column (not taxed, added to net pay)"
        className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] font-semibold normal-case text-muted-foreground hover:border-brand hover:text-brand"
      >
        <Plus className="w-3 h-3" />
        Column
      </button>
    );
  }
  const add = async () => {
    if (!name.trim()) {
      setOpen(false);
      return;
    }
    setBusy(true);
    if (await onAdd(name)) {
      setName("");
      setOpen(false);
    }
    setBusy(false);
  };
  return (
    <form
      className="flex items-center justify-end gap-1 normal-case"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <input
        autoFocus
        aria-label="New column name"
        value={name}
        maxLength={40}
        placeholder="e.g. Fuel"
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="w-24 rounded-md border border-border bg-white px-1.5 py-1 text-xs font-normal text-ink focus:border-brand focus:outline-none"
      />
      <button type="submit" disabled={busy} className="rounded-md bg-brand px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">
        Add
      </button>
    </form>
  );
}

/** One employee's pay, line by line, in the payslip's currency: shown when their row is opened. */
function PayBreakdown({ record }: { record: any }) {
  const cur = currencyOf(record);
  const country = countryPayslipLines(record);
  const ksh = (n: number) => moneyRounded(n, cur);
  const line = (label: string, value: number, tone = "") => (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`whitespace-nowrap ${tone}`}>{ksh(value)}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-ink">
      <div className="space-y-1.5">
        <h4 className="text-[10px] font-bold uppercase text-subtle">Earnings</h4>
        {line("Basic salary", record.basic_salary)}
        {payslipLeaveLines(record).map((l, i) => (
          <React.Fragment key={`leave-${l.name}-${i}`}>{line(leaveLineLabel(l), -l.amount, "text-status-danger")}</React.Fragment>
        ))}
        {line("House allowance", record.house_allowance)}
        {line("Transport allowance", record.transport_allowance)}
        {payslipOvertimeLines(record).length > 0
          ? payslipOvertimeLines(record).map((l, i) => (
              <React.Fragment key={`overtime-${l.day_type}-${i}`}>{line(overtimeLineLabel(l), l.amount)}</React.Fragment>
            ))
          : line("Overtime", payslipOvertimePay(record))}
        {payslipEarningLines(record).map((l, i) => (
          <React.Fragment key={`${l.name}-${i}`}>{line(l.name, l.amount)}</React.Fragment>
        ))}
        <WorkEarningLines record={record} amountClassName="" />
        {/* the per diem share of basic salary, on payslips from before per diem was typed in as a reimbursement */}
        {!country && Number(record.per_diem) > 0 && line("Per diem (share of basic, not taxed)", record.per_diem)}
      </div>
      <div className="space-y-1.5">
        <h4 className="text-[10px] font-bold uppercase text-subtle">Statutory deductions</h4>
        {country ? (
          <>
            {/* another country's lines (FIG-905): Tanzania's or Uganda's tax and contributions, then the employer's costs */}
            {country.deductions.map((l) => (
              <React.Fragment key={l.label}>{line(l.label, l.amount, "text-status-danger")}</React.Fragment>
            ))}
            {country.employerCosts.map((l) => (
              <React.Fragment key={l.label}>{line(`${l.label}, paid by the employer`, l.amount)}</React.Fragment>
            ))}
          </>
        ) : (
          <>
            {line("PAYE", record.paye_tax, "text-status-danger")}
            {line("SHIF", record.nhif_deduction, "text-status-danger")}
            {line("NSSF", record.nssf_deduction, "text-status-danger")}
            {line("Housing levy", record.housing_levy, "text-status-danger")}
            <WhtDeductionLine record={record} amountClassName="text-status-danger" />
            {line("Tax relief", record.tax_relief || 0, "text-status-success")}
          </>
        )}
      </div>
      <div className="space-y-1.5">
        <h4 className="text-[10px] font-bold uppercase text-subtle">Other deductions</h4>
        {line("Advances", record.advance_deduction || 0, "text-status-danger")}
        {payslipDeductionLines(record).map((l, i) => (
          <React.Fragment key={`${l.name}-${i}`}>{line(l.name, l.amount, "text-status-danger")}</React.Fragment>
        ))}
        <div className="flex justify-between gap-3 pt-1.5 border-t border-border font-bold">
          <span>Total deductions</span>
          <span className="whitespace-nowrap text-status-danger">{ksh(record.total_deductions)}</span>
        </div>
        {reimbursementItemsOf(record).length > 0 && (
          <>
            {line("Gross pay (after deductions)", afterDeductionsOf(record))}
            {reimbursementItemsOf(record).map((l, i) => (
              <React.Fragment key={`reimbursement-${l.name}-${i}`}>{line(`${l.name} (not taxed)`, l.amount, "text-status-success")}</React.Fragment>
            ))}
            <div className="flex justify-between gap-3 pt-1.5 border-t border-border font-bold">
              <span>Net pay</span>
              <span className="whitespace-nowrap text-brand-dark">{ksh(record.net_pay)}</span>
            </div>
          </>
        )}
      </div>
      {/* a month of piece rate work or contract jobs: from the month's net pay to what is paid now (FIG-812) */}
      <div className="sm:col-span-3 empty:hidden">
        <PayslipSettlementBlock record={record} compact />
      </div>
      {/* paid in USD (FIG-906): the statutory figures in the local currency, as filed */}
      <div className="sm:col-span-3 empty:hidden">
        <LocalStatutorySection record={record} compact />
      </div>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// a payslip changed by hand in the month's draft run (FIG-883)
const editedBadge = (record: any) =>
  record.payslip_edited ? (
    <span className="ml-1.5 align-middle rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[9px] font-bold uppercase" title="Edited by hand">
      Edited
    </span>
  ) : null;

const chip = "inline-flex items-center gap-1 px-2.5 py-1 rounded-[7px] text-[10.5px] font-semibold transition-colors";

export default function PayrollRunTab({
  periodLabel,
  onDownloadPdf,
  monthRun,
  runLoading,
  runBusy,
  onStart,
  onApprove,
  onReopen,
  onMarkPaid,
  onDiscard,
  onPayroll,
  onOpenFiles,
  userRole,
  handleBulkMpesaPayment,
  onOpenSpreadsheet,
  onOpenApprovals,
  pendingCount,
  branches,
  selectedBranch,
  setSelectedBranch,
  departments,
  selectedDepartment,
  setSelectedDepartment,
  paymentMethods,
  selectedPaymentMethod,
  setSelectedPaymentMethod,
  searchTerm,
  setSearchTerm,
  finalFilteredRecords,
  currentItems,
  totals: { totalGrossPay, totalDeductions, totalNetPay },
  nitaLevy,
  reimbursements,
  payrollRecords,
  payPeriod,
  companyBranches,
  readiness,
  returnsEmployees,
  onBelowMinimum,
  countryActions,
  runBarCountries,
  currencyTotals,
  countryOptions,
  selectedCountry = "all",
  setSelectedCountry,
  expandedRows,
  toggleRowExpand,
  smsSendingStatus,
  sendingSMS,
  sendPayslipNotification,
  handleSingleMpesaPayment,
  handleViewPayslip,
  currentPage,
  totalPages,
  handlePageChange,
  itemsPerPage,
  payslipEmails,
  usdRates,
  demoPay,
}: PayrollRunTabProps) {
  const approved = monthRun?.status === "approved" || monthRun?.status === "paid";
  const count = finalFilteredRecords.length;
  const blocked = () => toast.error(demoPay.blockedReason || "This month can't be paid yet");

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a payroll row from PayrollDashboard */
  const rowActions = (record: any, index: number) => {
    const smsStatus = smsSendingStatus[record.employee_id];
    const line = demoPay.shown && !IN_APP_PAYMENTS ? demoPay.lineFor(record.employee_id) : undefined;
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {IN_APP_PAYMENTS && (
          <button
            type="button"
            onClick={() => handleSingleMpesaPayment(record)}
            className={`${chip} font-bold bg-green-tint text-brand-dark hover:bg-[#d3e6d9]`}
          >
            {userRole === "credit_analyst_officer" ? "M-Pesa" : "Pay"}
          </button>
        )}
        {line &&
          (demoPay.enabled ? (
            <DemoPayButton line={line} paid={demoPay.isPaid(line.employeeNumber)} onPaid={demoPay.onPaid} />
          ) : (
            <button
              type="button"
              onClick={blocked}
              aria-disabled="true"
              title={demoPay.blockedReason ?? undefined}
              className={`${chip} font-bold bg-secondary text-subtle cursor-not-allowed`}
            >
              Pay
            </button>
          ))}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleViewPayslip(record, index);
          }}
          className={`${chip} bg-status-info-tint text-status-info hover:bg-[#dbe7f1]`}
        >
          Payslip
        </button>
        {record.employeeNu && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              sendPayslipNotification(record);
            }}
            disabled={sendingSMS || smsStatus === "sending"}
            className={`${chip} disabled:opacity-50 ${
              smsStatus === "success"
                ? "bg-green-tint text-brand-dark"
                : smsStatus === "failed"
                  ? "bg-orange-tint text-status-danger"
                  : "bg-secondary text-muted-foreground hover:bg-border"
            }`}
          >
            {smsStatus === "sending" ? (
              <Loader className="w-3 h-3 animate-spin" />
            ) : smsStatus === "success" ? (
              <CheckCircle className="w-3 h-3" />
            ) : smsStatus === "failed" ? (
              <XCircle className="w-3 h-3" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            {smsStatus === "sending" ? "Sending" : smsStatus === "success" ? "Sent" : smsStatus === "failed" ? "Failed" : "SMS"}
          </button>
        )}
      </div>
    );
  };

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a payroll row from PayrollDashboard */
  const expandButton = (record: any) => {
    const isExpanded = expandedRows.has(record.id);
    return (
      <button
        type="button"
        aria-label={isExpanded ? "Hide breakdown" : "Show breakdown"}
        aria-expanded={isExpanded}
        onClick={(e) => toggleRowExpand(record.id, e)}
        className="mt-0.5 text-subtle hover:text-ink shrink-0"
      >
        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
    );
  };

  // each payslip's employee's branch (FIG-905), from the employee records
  const branchByNumber = new Map<string, Branch>();
  if (companyBranches?.length) {
    for (const e of onPayroll) {
      const b = employeeBranch(e, companyBranches);
      if (b) branchByNumber.set(String(e["Employee Number"] ?? "").trim(), b);
    }
  }
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a payroll row from PayrollDashboard */
  const branchOfRecord = (record: any) => branchByNumber.get(String(record.employee_id ?? "").trim());

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a payroll row from PayrollDashboard */
  const subline = (record: any) => {
    const b = branchOfRecord(record);
    return [
      // the employee number (employeeNu is the phone number)
      record.employee_id,
      record.position,
      b ? `${b.name} (${b.country})` : record.department === "Branch Staff" ? record.branch : record.department,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  // several countries on the run: each row says which (its pay is in that country's currency)
  const severalCountries = new Set((payrollRecords ?? finalFilteredRecords).map((r) => payslipCountry(r))).size > 1;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a payroll row from PayrollDashboard */
  const countryFlag = (record: any) =>
    severalCountries ? (
      <span className="ml-1.5 inline-block align-middle rounded-full border border-border px-1.5 py-px text-[9.5px] font-semibold text-subtle">
        {payslipCountry(record)} · {currencyOf(record)}
      </span>
    ) : null;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a payroll row from PayrollDashboard */
  const amount = (record: any, n: number) => ksh(n, currencyOf(record));
  const totalsList = currencyTotals ?? [];

  // the table's columns: each deduction on its own (as in the P10), then the reimbursements typed in after them
  const statutory = statutoryColumnsFor(finalFilteredRecords);
  const reimbursementTypes = reimbursements?.columns ?? [];
  // a column a saved payslip still pays after it was removed shows too (read only), so every row adds up
  const reimbursementNames = reimbursementNamesFor(reimbursementTypes.map((t) => t.name), finalFilteredRecords);
  const typeNamed = new Map(reimbursementTypes.map((t) => [t.name, t]));
  const columnTotals = runTotalsByCurrency(finalFilteredRecords, statutory, reimbursementNames);
  // employee, basic pay, the deductions, other deductions, gross pay, the reimbursements (+ "Column"), net pay, actions
  const columnCount = 6 + statutory.length + reimbursementNames.length + (reimbursements ? 1 : 0);
  const th = "px-3 py-2.5 text-right whitespace-nowrap";
  const td = "px-3 py-3 text-right whitespace-nowrap";
  const tint = "bg-green-tint/40";
  // subtle lines between every row and column (thin and light, so the figures stay what stands out)
  const grid =
    "[&_th]:border [&_td]:border [&_th]:border-[#E8ECE9] [&_td]:border-[#E8ECE9] [&_tr>*:first-child]:border-l-0 [&_tr>*:last-child]:border-r-0 [&_thead_th]:border-t-0";
  // the employee column stays on the left while the table scrolls sideways
  const pinned = "sticky left-0 z-10 min-w-[220px] shadow-[1px_0_0_0_theme(colors.border)]";

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a payroll row from PayrollDashboard */
  const reimbursementCell = (record: any, name: string) => {
    const type = typeNamed.get(name);
    const value = reimbursementOf(record, name);
    if (!type || !reimbursements?.canEdit(record)) return value ? amount(record, value) : <span className="text-subtle">-</span>;
    return (
      <ReimbursementInput
        value={value}
        label={`${name} for ${record.employee_name || record.employee_id}`}
        onSave={(n) => reimbursements.onSet(record, type, n)}
      />
    );
  };

  return (
    <div className="space-y-4">
      <PayrollRunBar
        periodLabel={periodLabel}
        run={monthRun}
        loading={runLoading}
        busy={runBusy}
        onStart={onStart}
        onRecalculate={onStart}
        onApprove={onApprove}
        onReopen={onReopen}
        onMarkPaid={onMarkPaid}
        onDiscard={onDiscard}
        countries={runBarCountries}
      />

      {(!monthRun || monthRun.status === "draft") && <ReturnsReadiness employees={returnsEmployees ?? onPayroll} />}
      {(!monthRun || monthRun.status !== "paid") && usdRates}
      {readiness && countryActions && (
        <CountryReadinessPanel readiness={readiness} runStarted={!!monthRun} busy={runBusy} actions={countryActions} />
      )}
      {/* a warning before approval, never a block (FIG-812 stage 6) */}
      {!approved && payPeriod && (
        <MinimumWageWarning
          // the minimum wage is the local currency's: a USD payslip is checked on its local figures (FIG-906)
          payslips={(payrollRecords ?? finalFilteredRecords).map(localPayslip)}
          employees={onPayroll}
          payPeriod={payPeriod}
          periodLabel={periodLabel}
          onShortfalls={onBelowMinimum}
        />
      )}
      {approved && (
        <Card padding="sm" className="!rounded-xl">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <FolderDown className="w-4 h-4 text-brand shrink-0" />
            <span className="flex-1 min-w-0 basis-48 text-ink">The returns and bank files for {periodLabel} are on the Files tab, per country.</span>
            <button type="button" onClick={onOpenFiles} className="font-semibold text-brand">
              Open Files
            </button>
          </div>
        </Card>
      )}
      {approved && payslipEmails}

      {payPeriod && (
        <WorkSettlementCard payslips={payrollRecords ?? finalFilteredRecords} employees={onPayroll} payPeriod={payPeriod} periodLabel={periodLabel} />
      )}

      {nitaLevy && nitaLevy.total > 0 && (
        <Card padding="sm" className="!rounded-xl">
          <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="nita-levy-summary">
            <Briefcase className="w-4 h-4 text-brand shrink-0" />
            <span className="flex-1 min-w-0 basis-48 text-ink">
              <span className="font-semibold">Employer contributions:</span> NITA training levy {ksh(nitaLevy.total)} for{" "}
              {nitaLevy.employees} {nitaLevy.employees === 1 ? "employee" : "employees"}, payable to NITA for {periodLabel}. Not taken from pay.
            </span>
          </div>
        </Card>
      )}

      <Card padding="none" className="overflow-hidden">
        {/* the list's header: how many people, what the month costs, and paying them */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 border-b border-border">
          <div className="min-w-0 flex-1 basis-56">
            <h2 className="text-sm font-bold text-ink">
              Employees on payroll <span className="text-subtle font-semibold">({count})</span>
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {currencyTotals ? (
                <>
                  Net pay <span className="font-bold text-brand-dark" data-testid="net-totals"><CurrencyTotalsText totals={totalsList} field="net" /></span>
                  <span className="mx-1.5">·</span>Basic pay <CurrencyTotalsText totals={totalsList} field="gross" />
                  <span className="mx-1.5">·</span>Deductions <CurrencyTotalsText totals={totalsList} field="deductions" />
                </>
              ) : (
                <>
                  Net pay <span className="font-bold text-brand-dark">{ksh(totalNetPay)}</span>
                  <span className="mx-1.5">·</span>Basic pay {ksh(totalGrossPay)}
                  <span className="mx-1.5">·</span>Deductions {ksh(totalDeductions)}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <button
              type="button"
              onClick={onDownloadPdf}
              disabled={count === 0}
              className="inline-flex items-center justify-center gap-1.5 flex-1 sm:flex-none px-3.5 py-2 rounded-tile border border-border bg-white text-xs font-semibold text-ink hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileDown className="w-3.5 h-3.5" />
              Download PDF
            </button>
            {demoPay.shown && !IN_APP_PAYMENTS && (
              <button
                type="button"
                onClick={demoPay.enabled ? demoPay.onPayAll : blocked}
                aria-disabled={!demoPay.enabled}
                title={demoPay.blockedReason ?? undefined}
                className={`inline-flex items-center justify-center gap-1.5 flex-1 sm:flex-none px-4 py-2 rounded-tile text-xs font-bold transition-colors ${
                  demoPay.enabled ? "bg-brand text-white hover:bg-brand-dark" : "bg-brand/70 text-white cursor-not-allowed"
                }`}
              >
                <Wallet className="w-3.5 h-3.5" />
                Pay all employees
              </button>
            )}
            <BulkPayButton
              label={userRole === "credit_analyst_officer" ? "M-PESA Bulk Pay" : "Make Bulk Pay"}
              onClick={handleBulkMpesaPayment}
              // an approved month is paid with "Pay staff" on the Files tab, which records every payment; never both
              disabled={count === 0 || approved}
              title={approved ? `Pay ${periodLabel}'s approved payroll with "Pay staff" on the Files tab: it records every payment` : undefined}
            />
          </div>
          {demoPay.shown && !IN_APP_PAYMENTS && !demoPay.enabled && demoPay.blockedReason && (
            <p className="w-full text-[11px] text-muted-foreground sm:text-right">{demoPay.blockedReason}</p>
          )}
        </div>

        {/* search and filters */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 px-4 py-3 border-b border-border bg-background">
          <div className="col-span-2 sm:w-64">
            <SearchInput
              placeholder="Search by name or employee ID"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="!bg-white !border-border"
            />
          </div>
          {countryOptions && countryOptions.length > 1 && setSelectedCountry && (
            <div className="min-w-0 sm:w-36">
              <SearchableDropdown
                options={[{ label: "All countries", value: "all" }, ...countryOptions.map((c) => ({ label: c, value: c }))]}
                value={selectedCountry}
                onChange={setSelectedCountry}
                placeholder="Country"
                icon={MapPin}
              />
            </div>
          )}
          <div className="min-w-0 sm:w-36">
            <SearchableDropdown options={branches} value={selectedBranch} onChange={setSelectedBranch} placeholder="Branch" icon={MapPin} />
          </div>
          <div className="min-w-0 sm:w-40">
            <SearchableDropdown
              options={departments.map((dept) => ({ label: dept === "all" ? "All Departments" : dept, value: dept }))}
              value={selectedDepartment}
              onChange={setSelectedDepartment}
              placeholder="Department"
              icon={Briefcase}
            />
          </div>
          <div className="min-w-0 sm:w-36">
            <SearchableDropdown
              options={paymentMethods.map((method) => ({ label: method === "all" ? "All Methods" : method, value: method }))}
              value={selectedPaymentMethod}
              onChange={setSelectedPaymentMethod}
              placeholder="Method"
              icon={CreditCard}
            />
          </div>
          {IN_APP_PAYMENTS && (
            <button
              type="button"
              onClick={onOpenSpreadsheet}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-tile border border-border bg-white text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-ink transition-colors"
            >
              <FileSpreadsheet className="w-3 h-3" />
              M-PESA Spreadsheet
            </button>
          )}
          {IN_APP_PAYMENTS && (userRole === "checker" || userRole === "credit_analyst_officer") && (
            <button
              type="button"
              onClick={onOpenApprovals}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-tile border border-border bg-white text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-ink transition-colors"
            >
              <Clock className="w-3 h-3" />
              Approvals ({pendingCount})
            </button>
          )}
        </div>

        {count === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">
            {searchTerm || selectedCountry !== "all" || selectedBranch !== "all" || selectedDepartment !== "all" || selectedPaymentMethod !== "all"
              ? "No employees match the search or filters."
              : `No one is on the payroll for ${periodLabel} yet.`}
          </div>
        ) : (
          <>
            {/* phones and tablets: one stacked row per person (the table has too many columns for them) */}
            <ul className="lg:hidden divide-y divide-border">
              {currentItems.map((record, index) => (
                <li key={record.id} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    {expandButton(record)}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-ink truncate">{record.employee_name}{editedBadge(record)}{countryFlag(record)}</div>
                      <div className="text-[10px] text-subtle truncate">{subline(record)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-brand-dark whitespace-nowrap">{amount(record, record.net_pay)}</div>
                      <div className="text-[10px] text-subtle whitespace-nowrap">basic {amount(record, record.gross_pay)}</div>
                    </div>
                  </div>
                  <div className="mt-2 pl-6">{rowActions(record, index)}</div>
                  {expandedRows.has(record.id) && (
                    <div className="mt-3 ml-6 p-3 rounded-xl bg-background">
                      <PayBreakdown record={record} />
                      {reimbursements?.canEdit(record) && reimbursementTypes.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                          <h4 className="text-[10px] font-bold uppercase text-subtle">Reimbursements (not taxed, added to net pay)</h4>
                          {reimbursementTypes.map((t) => (
                            <div key={t.id} className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground">{t.name}</span>
                              {reimbursementCell(record, t.name)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* laptops and wider: the table, with the month's totals at the foot; the names stay in view when it scrolls */}
            <div className="hidden lg:block">
              <TableScroll>
                <table className={`min-w-full text-xs border-collapse ${grid}`}>
                  <thead className="border-b border-border">
                    <tr className="text-left text-[10px] font-bold uppercase text-subtle">
                      <th className={`px-4 py-2.5 ${pinned} bg-white`}>Employee</th>
                      <th className={th}>Basic pay</th>
                      {statutory.map((c) => (
                        <th key={c.key} className={th}>{c.label}</th>
                      ))}
                      <th className={th}>Other deductions</th>
                      <th className={th} title="Basic pay less deductions">Gross pay</th>
                      {reimbursementNames.map((name) => {
                        const type = typeNamed.get(name);
                        return (
                          <th
                            key={name}
                            className={`${th} ${tint}`}
                            title={
                              type?.from_job_group
                                ? "Each employee's job group per diem (set on Job groups); type to change one person's for this month. Not taxed: added to net pay"
                                : "Not taxed: added to net pay after deductions"
                            }
                          >
                            <span className="inline-flex items-center gap-1">
                              {name}
                              {type && reimbursements && (
                                <button
                                  type="button"
                                  aria-label={`Remove the ${name} column`}
                                  onClick={() => reimbursements.onRemoveColumn(type)}
                                  className="text-subtle hover:text-status-danger"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </span>
                          </th>
                        );
                      })}
                      {reimbursements && (
                        <th className={`${th} ${tint}`}>
                          <AddReimbursementColumn onAdd={reimbursements.onAddColumn} />
                        </th>
                      )}
                      <th className={th}>Net pay</th>
                      <th className="px-4 py-2.5 pl-6"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentItems.map((record, index) => {
                      const f = runRowFigures(record, statutory, reimbursementNames);
                      return (
                        <React.Fragment key={record.id}>
                          <tr className="group hover:bg-background transition-colors text-ink">
                            <td className={`px-4 py-3 ${pinned} bg-white group-hover:bg-background`}>
                              <div className="flex items-start gap-2">
                                {expandButton(record)}
                                <div className="min-w-0">
                                  <div className="font-bold whitespace-nowrap">{record.employee_name}{editedBadge(record)}{countryFlag(record)}</div>
                                  <div className="text-[10px] text-subtle truncate max-w-[200px]" title={subline(record)}>{subline(record)}</div>
                                </div>
                              </div>
                            </td>
                            <td className={td}>{amount(record, f.basic)}</td>
                            {f.deductions.map((n, i) => (
                              <td key={statutory[i].key} className={`${td} text-muted-foreground`}>{amount(record, n)}</td>
                            ))}
                            <td className={`${td} text-muted-foreground`}>{amount(record, f.other)}</td>
                            <td className={td}>{amount(record, f.gross)}</td>
                            {reimbursementNames.map((name) => (
                              <td key={name} className={`${td} ${tint}`}>{reimbursementCell(record, name)}</td>
                            ))}
                            {reimbursements && <td className={tint} />}
                            <td className={`${td} font-bold text-brand-dark`}>{amount(record, f.net)}</td>
                            <td className="px-4 py-3 pl-6">{rowActions(record, index)}</td>
                          </tr>
                          {expandedRows.has(record.id) && (
                            <tr className="bg-background">
                              <td colSpan={columnCount} className="px-4 py-4 border-b border-border">
                                <PayBreakdown record={record} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {/* a total per currency, never one sum across currencies */}
                    {columnTotals.map((t) => (
                      <tr
                        key={t.currency}
                        className="bg-background text-ink font-bold"
                        data-testid={columnTotals.length > 1 ? `total-${t.currency}` : undefined}
                      >
                        <td className={`px-4 py-3 whitespace-nowrap ${pinned} bg-background`}>
                          {columnTotals.length > 1 ? `Total ${t.currency}` : "Total"} · {t.count} {t.count === 1 ? "employee" : "employees"}
                        </td>
                        <td className={td}>{ksh(t.figures.basic, t.currency)}</td>
                        {t.figures.deductions.map((n, i) => (
                          <td key={statutory[i].key} className={td}>{ksh(n, t.currency)}</td>
                        ))}
                        <td className={td}>{ksh(t.figures.other, t.currency)}</td>
                        <td className={td}>{ksh(t.figures.gross, t.currency)}</td>
                        {t.figures.reimbursements.map((n, i) => (
                          <td key={reimbursementNames[i]} className={`${td} ${tint}`}>{ksh(n, t.currency)}</td>
                        ))}
                        {reimbursements && <td className={tint} />}
                        <td className={`${td} text-brand-dark`}>{ksh(t.figures.net, t.currency)}</td>
                        <td />
                      </tr>
                    ))}
                  </tfoot>
                </table>
              </TableScroll>
            </div>
          </>
        )}
      </Card>

      {count > 0 && <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        totalItems={count}
        itemsPerPage={itemsPerPage}
        currentItemsCount={currentItems.length}
      />}
    </div>
  );
}
