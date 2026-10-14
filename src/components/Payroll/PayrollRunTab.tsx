import React from "react";
import {
  Briefcase,
  Calculator,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  DollarSign,
  FileSpreadsheet,
  FolderDown,
  Loader,
  MapPin,
  Send,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { Card, SearchInput, StatCard, TableScroll } from "../UI";
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

// The Run tab: the month's payroll run (start, recalculate, approve, mark paid), the returns check, and the payslip
// table with its totals and filters. The figures are worked out by PayrollDashboard; this only shows them.

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
  /** pretend paying for demos (lib/inAppPayments PAYMENTS_DEMO): on only for an approved month */
  demoPay: {
    enabled: boolean;
    lineFor: (employeeNumber: string) => DemoPayLine | undefined;
    isPaid: (employeeNumber: string) => boolean;
    onPaid: (employeeNumber: string) => void;
    onPayAll: () => void;
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
  totals: { totalGrossPay, totalDeductions, totalNetPay, totalPAYE, totalNHIF, totalNSSF, totalHousingLevy },
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

      {/* the month's main pay action: demo "Pay all employees" on an approved month, or (with in-app paying on) bulk pay */}
      {(demoPay.enabled || IN_APP_PAYMENTS) && (
        <div className="flex items-center justify-end gap-2.5 flex-wrap">
          {demoPay.enabled && (
            <button
              type="button"
              onClick={demoPay.onPayAll}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-tile bg-brand text-white text-xs font-bold hover:bg-brand-dark transition-colors"
            >
              <Wallet className="w-3.5 h-3.5" />
              Pay all employees
            </button>
          )}
          <BulkPayButton
            label={userRole === "credit_analyst_officer" ? "M-PESA Bulk Pay" : "Make Bulk Pay"}
            onClick={handleBulkMpesaPayment}
            // an approved month is paid with "Pay staff" on the Files tab, which records every payment; never both
            disabled={finalFilteredRecords.length === 0 || approved}
            title={approved ? `Pay ${periodLabel}'s approved payroll with "Pay staff" on the Files tab: it records every payment` : undefined}
          />
        </div>
      )}

      {(!monthRun || monthRun.status === "draft") && <ReturnsReadiness employees={onPayroll} />}
      {approved && (
        <Card padding="sm" className="!rounded-xl">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <FolderDown className="w-4 h-4 text-brand shrink-0" />
            <span className="flex-1 min-w-[200px] text-ink">The P10, SHA, NSSF, bank and Equity files for {periodLabel} are on the Files tab.</span>
            <button type="button" onClick={onOpenFiles} className="font-semibold text-brand">
              Open Files
            </button>
          </div>
        </Card>
      )}

      {/* filters and search */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-[calc(50%-4px)] sm:w-36">
          <SearchableDropdown
            options={branches}
            value={selectedBranch}
            onChange={setSelectedBranch}
            placeholder="Select Branch"
            icon={MapPin}
          />
        </div>
        <div className="w-[calc(50%-4px)] sm:w-40">
          <SearchableDropdown
            options={departments.map((dept) => ({
              label: dept === "all" ? "All Departments" : dept,
              value: dept,
            }))}
            value={selectedDepartment}
            onChange={setSelectedDepartment}
            placeholder="Select Department"
            icon={Briefcase}
          />
        </div>
        <div className="w-[calc(50%-4px)] sm:w-36">
          <SearchableDropdown
            options={paymentMethods.map((method) => ({
              label: method === "all" ? "All Methods" : method,
              value: method,
            }))}
            value={selectedPaymentMethod}
            onChange={setSelectedPaymentMethod}
            placeholder="Select Method"
            icon={CreditCard}
          />
        </div>
        <div className="w-full sm:w-64">
          <SearchInput
            placeholder="Search by name or employee ID"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="!bg-white !border-border"
          />
        </div>

        <div className="flex-1" />

        {IN_APP_PAYMENTS && <button
          type="button"
          onClick={onOpenSpreadsheet}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-tile border border-border bg-white text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-ink transition-colors"
        >
          <FileSpreadsheet className="w-3 h-3" />
          M-PESA Spreadsheet
        </button>}
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

    {/* ── PAYROLL REPORT ──────────────────────────────────── */}
    <div>
      {/* Summary tiles: totals are over every filtered record, not just the visible page */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <StatCard label="Employees" value={finalFilteredRecords.length} icon={<Users className="w-4 h-4" />} tint="info" />
        <StatCard label="Gross pay" value={`KSh ${totalGrossPay.toLocaleString()}`} icon={<TrendingUp className="w-4 h-4" />} tint="purple" />
        <StatCard label="Deductions" value={`KSh ${totalDeductions.toLocaleString()}`} icon={<Calculator className="w-4 h-4" />} tint="orange" />
        <StatCard label="Net pay" value={`KSh ${totalNetPay.toLocaleString()}`} icon={<DollarSign className="w-4 h-4" />} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        {[
          { label: "PAYE", value: totalPAYE, color: "text-orange-text" },
          { label: "SHIF", value: totalNHIF, color: "text-status-purple" },
          { label: "NSSF", value: totalNSSF, color: "text-status-info" },
          { label: "Housing levy", value: totalHousingLevy, color: "text-orange-text-alt" },
        ].map((tile) => (
          <Card key={tile.label} padding="sm" className="!rounded-xl">
            <div className="text-[9.5px] font-bold uppercase text-subtle">{tile.label}</div>
            <div className={`text-[14.5px] font-bold mt-0.5 truncate ${tile.color}`}>KSh {tile.value.toLocaleString()}</div>
          </Card>
        ))}
      </div>

      <Card padding="none" className="overflow-hidden">
        <TableScroll>
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 border-b border-border">
              <tr className="text-left text-[10px] font-bold uppercase text-subtle">
                <th className="px-4 py-2.5">Employee</th>
                <th className="px-4 py-2.5">Gross Pay</th>
                <th className="px-4 py-2.5">PAYE</th>
                <th className="px-4 py-2.5">Net Pay</th>
                <th className="px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentItems.map((record, index) => {
                const isExpanded = expandedRows.has(record.id);
                const smsStatus = (smsSendingStatus as Record<string, any>)[record.employee_id];

                return (
                  <React.Fragment key={record.id}>
                    <tr className="border-b border-[#F1F5F2] hover:bg-background transition-colors text-ink">
                      <td className="px-4 py-3">
                        <div className="flex items-start">
                          <button
                            type="button"
                            aria-label={isExpanded ? "Hide breakdown" : "Show breakdown"}
                            onClick={(e) => toggleRowExpand(record.id, e)}
                            className="mr-2 mt-0.5 text-subtle hover:text-ink shrink-0"
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                          <div>
                            <div className="font-bold">{record.employee_name}</div>
                            <div className="text-[10px] text-subtle">
                              {record.employeeNu || record.employee_id} &middot; {record.position}
                              {" "}&middot;{" "}
                              {record.department === "Branch Staff" ? record.branch : record.department}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">KSh {record.gross_pay.toLocaleString()}</td>
                      <td className="px-4 py-3 whitespace-nowrap">KSh {Math.round(record.paye_tax).toLocaleString()}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-bold text-brand-dark">
                        KSh {Math.round(record.net_pay).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {IN_APP_PAYMENTS && (
                            <button
                              type="button"
                              onClick={() => handleSingleMpesaPayment(record)}
                              className="px-2.5 py-1 rounded-[7px] bg-green-tint text-brand-dark text-[10.5px] font-bold hover:bg-[#d3e6d9] transition-colors"
                            >
                              {userRole === "credit_analyst_officer" ? "M-Pesa" : "Pay"}
                            </button>
                          )}
                          {!IN_APP_PAYMENTS && demoPay.enabled && (() => {
                            const line = demoPay.lineFor(record.employee_id);
                            return line ? (
                              <DemoPayButton line={line} paid={demoPay.isPaid(line.employeeNumber)} onPaid={demoPay.onPaid} />
                            ) : null;
                          })()}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewPayslip(record, index);
                            }}
                            className="px-2.5 py-1 rounded-[7px] bg-status-info-tint text-status-info text-[10.5px] font-semibold hover:bg-[#dbe7f1] transition-colors"
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
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-[7px] text-[10.5px] font-semibold transition-colors disabled:opacity-50 ${
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
                              {smsStatus === "sending"
                                ? "Sending"
                                : smsStatus === "success"
                                  ? "Sent"
                                  : smsStatus === "failed"
                                    ? "Failed"
                                    : "SMS"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-background">
                        <td
                          colSpan={5}
                          className="px-4 py-4 border-t border-border"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900">
                                Earnings
                              </h4>
                              <div className="flex justify-between">
                                <span>Total Basic Salary:</span>
                                <span>
                                  KSh {record.basic_salary.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>House Allowance:</span>
                                <span>
                                  KSh{" "}
                                  {record.house_allowance.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Transport Allowance:</span>
                                <span>
                                  KSh{" "}
                                  {record.transport_allowance.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Overtime:</span>
                                <span>
                                  KSh{" "}
                                  {(
                                    record.overtime_hours *
                                    record.overtime_rate
                                  ).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between font-bold bg-yellow-50 p-1">
                                <span>Per Diem:</span>
                                <span>
                                  KSh{" "}
                                  {record.per_diem?.toLocaleString() || "0"}
                                </span>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900">
                                Statutory Deductions
                              </h4>
                              <div className="flex justify-between">
                                <span>PAYE:</span>
                                <span className="text-red-600">
                                  KSh {record.paye_tax.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>SHIF:</span>
                                <span className="text-red-600">
                                  KSh {record.nhif_deduction.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>NSSF:</span>
                                <span className="text-red-600">
                                  KSh {record.nssf_deduction.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Housing Levy:</span>
                                <span className="text-red-600">
                                  KSh {record.housing_levy.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between text-green-600">
                                <span>Tax Relief:</span>
                                <span>
                                  KSh{" "}
                                  {record.tax_relief?.toLocaleString() || "0"}
                                </span>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900">
                                Other Deductions
                              </h4>
                              <div className="flex justify-between">
                                <span>Advances:</span>
                                <span className="text-red-600">
                                  KSh{" "}
                                  {record.advance_deduction.toLocaleString()}
                                </span>
                              </div>
                              {payslipDeductionLines(record).map((line, i) => (
                                <div key={`${line.name}-${i}`} className="flex justify-between">
                                  <span>{line.name}:</span>
                                  <span className="text-red-600">KSh {line.amount.toLocaleString()}</span>
                                </div>
                              ))}
                              <div className="flex justify-between font-medium">
                                <span>Total Deductions:</span>
                                <span className="text-red-600">
                                  KSh{" "}
                                  {record.total_deductions.toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        totalItems={finalFilteredRecords.length}
        itemsPerPage={itemsPerPage}
        currentItemsCount={currentItems.length}
      />
    </div>
    </div>
  );
}
