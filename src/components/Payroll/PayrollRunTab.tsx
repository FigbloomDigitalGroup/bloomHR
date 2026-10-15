import React from "react";
import toast from "react-hot-toast";
import {
  Briefcase,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  FileSpreadsheet,
  FolderDown,
  Loader,
  MapPin,
  Send,
  Wallet,
  XCircle,
} from "lucide-react";
import { Card, SearchInput, TableScroll } from "../UI";
import SearchableDropdown from "../UI/SearchableDropdown";
import type { PayrollRun } from "../../lib/payrollRuns";
import type { EmployeeRecord } from "../../lib/profileCompleteness";
import { IN_APP_PAYMENTS } from "../../lib/inAppPayments";
import { payslipDeductionLines } from "../../lib/voluntaryDeductions";
import PayrollRunBar from "./PayrollRunBar";
import ReturnsReadiness from "./ReturnsReadiness";
import { BulkPayButton } from "./RunPayActions";
import { DemoPayButton } from "./DemoPayments";
import type { DemoPayLine } from "../../lib/demoPayments";
import { Pagination } from "./PayrollPagination";

// The Run tab: the month's payroll run (start, recalculate, approve, mark paid), the returns check, and the list of
// employees on the payroll with their pay. The figures are worked out by PayrollDashboard; this only shows them.
// Phones get a stacked list; wider screens a table with the month's totals at the foot.

/* eslint-disable @typescript-eslint/no-explicit-any -- payroll rows are the untyped records PayrollDashboard builds */
interface PayrollRunTabProps {
  periodLabel: string;
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

const ksh = (n: number) => `KSh ${Math.round(n || 0).toLocaleString()}`;

/** One employee's pay, line by line: shown when their row is opened. */
function PayBreakdown({ record }: { record: any }) {
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
        {line("House allowance", record.house_allowance)}
        {line("Transport allowance", record.transport_allowance)}
        {line("Overtime", (record.overtime_hours || 0) * (record.overtime_rate || 0))}
        {line("Per diem", record.per_diem || 0)}
      </div>
      <div className="space-y-1.5">
        <h4 className="text-[10px] font-bold uppercase text-subtle">Statutory deductions</h4>
        {line("PAYE", record.paye_tax, "text-status-danger")}
        {line("SHIF", record.nhif_deduction, "text-status-danger")}
        {line("NSSF", record.nssf_deduction, "text-status-danger")}
        {line("Housing levy", record.housing_levy, "text-status-danger")}
        {line("Tax relief", record.tax_relief || 0, "text-status-success")}
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
      </div>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const chip = "inline-flex items-center gap-1 px-2.5 py-1 rounded-[7px] text-[10.5px] font-semibold transition-colors";

export default function PayrollRunTab({
  periodLabel,
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

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a payroll row from PayrollDashboard */
  const subline = (record: any) =>
    [record.employeeNu || record.employee_id, record.position, record.department === "Branch Staff" ? record.branch : record.department]
      .filter(Boolean)
      .join(" · ");

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
      />

      {(!monthRun || monthRun.status === "draft") && <ReturnsReadiness employees={onPayroll} />}
      {approved && (
        <Card padding="sm" className="!rounded-xl">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <FolderDown className="w-4 h-4 text-brand shrink-0" />
            <span className="flex-1 min-w-0 basis-48 text-ink">The P10, SHA, NSSF, bank and Equity files for {periodLabel} are on the Files tab.</span>
            <button type="button" onClick={onOpenFiles} className="font-semibold text-brand">
              Open Files
            </button>
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
              Net pay <span className="font-bold text-brand-dark">{ksh(totalNetPay)}</span>
              <span className="mx-1.5">·</span>Gross {ksh(totalGrossPay)}
              <span className="mx-1.5">·</span>Deductions {ksh(totalDeductions)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            {demoPay.shown && !IN_APP_PAYMENTS && (
              <button
                type="button"
                onClick={demoPay.enabled ? demoPay.onPayAll : blocked}
                aria-disabled={!demoPay.enabled}
                title={demoPay.blockedReason ?? undefined}
                className={`inline-flex items-center justify-center gap-1.5 w-full sm:w-auto px-4 py-2 rounded-tile text-xs font-bold transition-colors ${
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
            {searchTerm || selectedBranch !== "all" || selectedDepartment !== "all" || selectedPaymentMethod !== "all"
              ? "No employees match the search or filters."
              : `No one is on the payroll for ${periodLabel} yet.`}
          </div>
        ) : (
          <>
            {/* phones: one stacked row per person */}
            <ul className="sm:hidden divide-y divide-border">
              {currentItems.map((record, index) => (
                <li key={record.id} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    {expandButton(record)}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-ink truncate">{record.employee_name}</div>
                      <div className="text-[10px] text-subtle truncate">{subline(record)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-brand-dark whitespace-nowrap">{ksh(record.net_pay)}</div>
                      <div className="text-[10px] text-subtle whitespace-nowrap">of {ksh(record.gross_pay)}</div>
                    </div>
                  </div>
                  <div className="mt-2 pl-6">{rowActions(record, index)}</div>
                  {expandedRows.has(record.id) && (
                    <div className="mt-3 ml-6 p-3 rounded-xl bg-background">
                      <PayBreakdown record={record} />
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* wider screens: the table, with the month's totals at the foot */}
            <div className="hidden sm:block">
              <TableScroll>
                <table className="min-w-full text-xs">
                  <thead className="border-b border-border">
                    <tr className="text-left text-[10px] font-bold uppercase text-subtle">
                      <th className="px-4 py-2.5">Employee</th>
                      <th className="px-4 py-2.5 text-right">Gross pay</th>
                      <th className="px-4 py-2.5 text-right">Deductions</th>
                      <th className="px-4 py-2.5 text-right">Net pay</th>
                      <th className="px-4 py-2.5 pl-6"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentItems.map((record, index) => (
                      <React.Fragment key={record.id}>
                        <tr className="border-b border-[#F1F5F2] hover:bg-background transition-colors text-ink">
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-2">
                              {expandButton(record)}
                              <div className="min-w-0">
                                <div className="font-bold">{record.employee_name}</div>
                                <div className="text-[10px] text-subtle">{subline(record)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">{ksh(record.gross_pay)}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap text-muted-foreground">{ksh(record.total_deductions)}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap font-bold text-brand-dark">{ksh(record.net_pay)}</td>
                          <td className="px-4 py-3 pl-6">{rowActions(record, index)}</td>
                        </tr>
                        {expandedRows.has(record.id) && (
                          <tr className="bg-background">
                            <td colSpan={5} className="px-4 py-4 border-b border-border">
                              <PayBreakdown record={record} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-background text-ink font-bold">
                      <td className="px-4 py-3">Total · {count} {count === 1 ? "employee" : "employees"}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{ksh(totalGrossPay)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{ksh(totalDeductions)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-brand-dark">{ksh(totalNetPay)}</td>
                      <td />
                    </tr>
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
