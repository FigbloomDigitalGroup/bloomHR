import React, { useState, useEffect, useMemo } from "react";
import FigbloomLoader from '../UI/FigbloomLoader';
import {
  DollarSign,
  Calculator,
  FileText,
  Download,
  TrendingUp,
  Trash2,
  Upload,
  ChevronDown,
  Loader,
  CheckCircle,
  X,
  Clock,
  Users,
  Settings,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import toast from "react-hot-toast";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { PageHeader, TabBar } from "../UI";
import MPesaSpreadsheetFullPage from "./MpesaSpreadSheet";
import useCountryRates from "../../hooks/useCountryRates";
import { usePermissions } from "../../hooks/usePermissions";
import StatutoryRatesModal from "./StatutoryRatesModal";
import { supportedCountries } from "../../lib/payroll/countries";
import { tanzaniaEditContext } from "../../lib/payroll/countries/tanzania";
import {
  type CountryReadiness,
  type RunCalculation,
  approvalSummary,
  calculateRun,
  countriesToApprove,
  countryOrder,
  countryReadiness,
  currencyMismatch,
  payrollCountryOf,
  payslipCountry,
  savableRecords,
  totalsByCurrency,
} from "../../lib/payroll/multiCountry";
import { moneyRounded } from "../../lib/payroll/currency";
import { isUsdPayslip, localPayslip, paidInUsd } from "../../lib/payroll/usdPay";
import { type FxRate, loadFxRates, saveFxRate } from "../../lib/payroll/usdPayApi";
import { usePayCurrencies } from "../../hooks/usePayCurrencies";
import UsdRatePanel from "./UsdRatePanel";
import PayCurrencySetting from "./PayCurrencySetting";
import { loadDeductionCap, loadWorkSettlement } from "../../lib/workSettlementApi";
import { loadLstCollection, loadLstPaidThisYear } from "../../lib/payroll/ugandaApi";
import { recalculateUgandaPayslip } from "../../lib/payroll/countries/uganda";
import type { SalaryHistoryRecord } from "../../lib/salaryHistory";
import {
  type PayrollRun,
  type PayrollRunCountry,
  type PayrollRunStatus,
  discardDraftCountries,
  discardDraftRun,
  getPayrollRun,
  getRunCountries,
  getStaleCountries,
  getRunPayslips,
  runErrorMessage,
  saveDraftRun,
  setCountriesStatus,
} from "../../lib/payrollRuns";
import MissingPayrollDetailsModal from "./MissingPayrollDetailsModal";
import { IN_APP_PAYMENTS, IN_APP_PAYMENTS_OFF_MESSAGE, PAYMENTS_DEMO } from "../../lib/inAppPayments";
import { demoPayLines } from "../../lib/demoPayments";
import { DemoPayAllDialog } from "./DemoPayments";
import PayrollMoreMenu, { type MoreMenuItem } from "./PayrollMoreMenu";
import { returnsReadiness } from "../../lib/payrollExports";
import { employeesMissingDetails } from "../../lib/missingPayrollDetails";
import { isKesPayslip, isPaidByMpesa, mpesaKenyaNote, paymentMethodLabel } from "../../lib/paymentMethods";
import { fetchAll } from "../../lib/fetchAll";
import { isPayrollReady } from "../../lib/onboardingValidation";
import { isCasual } from "../../lib/casualPay";
import { nitaTotal } from "../../lib/nitaLevy";

const withoutCasuals = <T extends Record<string, unknown>>(rows: T[] | null | undefined): T[] => (rows ?? []).filter((e) => !isCasual(e));
import { advanceDeductionFor, type AdvanceTaken } from "../../lib/salaryAdvance";
import { loadAdvancesTaken } from "../../lib/salaryAdvanceApi";
import { loadCompanyIdentity } from "../../lib/companyProfile";
import { useNavigate } from "react-router-dom";
import { deductionsForPeriod, loadDeductionSetup } from "../../lib/voluntaryDeductions";
import { loadPayrollLoans } from "../../lib/loansApi";
import { earningsForPeriod } from "../../lib/earnings";
import { loadEarningSetup } from "../../lib/earningsDb";
import { loadLeavePay, loadLeavePayouts, loadLeaveRateBasis } from "../../lib/leavePayDb";
import { loadAbsencePay } from "../../lib/leaveDisciplineApi";
import LeavePaySetting from "./LeavePaySetting";
import { loadOvertimeMonth } from "../../lib/overtimeApi";
import OvertimeSettingsCard from "../Overtime/OvertimeSettingsCard";
import { checkSMSBalance, formatPhoneNumber, sendSMSWithRetry, smsTemplates } from "../../lib/payrollSms";
import BulkSalaryHistoryUpload from "./BulkSalaryHistoryUpload";
import {
  CommentModal,
  MpesaBulkPaymentModal,
  MpesaSinglePaymentModal,
  PaymentDetailsModal,
  PendingPaymentCard,
  RejectionModal,
  type PayRecipient,
} from "./PaymentApprovalModals";
import { ExportModal, P9FormGenerator } from "./PayrollToolModals";
import { downloadPayrollRegisterPdf } from "../../lib/payrollPdf";
import { PayslipModal } from "./PayrollPayslipModal";
import EmailPayslipsPanel from "./EmailPayslipsPanel";
import PayslipEmailSetting from "./PayslipEmailSetting";
import DeductionCapSetting from "./DeductionCapSetting";
import MinimumWageCard from "./MinimumWageCard";
import { markEditedPayslips, statutoryContextFor } from "../../lib/payslipOverrides";
import { withRunEdits } from "../../lib/payslipOverridesDb";
import { usePayslipOverrides } from "../../hooks/usePayslipOverrides";
import { confirmDialog, type DialogOptions } from "../../lib/confirmDialog";
import { PAYROLL_TABS, usePayrollTab } from "./payrollTabs";
import PayrollRunTab from "./PayrollRunTab";
import { useBranches } from "../../hooks/useBranches";
import PayrollEmployeesTab from "./PayrollEmployeesTab";
import PayrollDeductionsTab from "./PayrollDeductionsTab";
import PayrollEarningsTab from "./PayrollEarningsTab";
import PayrollPayItemsTab from "./PayrollPayItemsTab";
import { applyCatalogue, daysWorkedInMonth, overTwoThirds, workingDaysInMonth } from "../../lib/payItems";
import { loadPayItems } from "../../lib/payItemsApi";
import { loadCompanyWorkWeek, MONDAY_TO_FRIDAY } from "../../lib/workWeek";
import { employeeBranch } from "../../lib/branches";
import PayrollRatesTab from "./PayrollRatesTab";
import { PlatformRatesLink, RatesChangedNotice } from "./RatesChangedNotice";
import PlatformRatesBanner from "./PlatformRatesBanner";
import UgandaLstSettings from "./UgandaLstSettings";
import PayrollFilesTab from "./PayrollFilesTab";
import PayrollHistoryTab from "./PayrollHistoryTab";

// The payroll page: a month picker and seven tabs (Run, Employees' pay, Deductions, Earnings, Rates, Files, History). This shell
// works out the month's figures and owns the run, the shared state and the pop-ups; each tab only shows its part.

const PAYSLIP_AMOUNTS = [
  "basic_salary", "gross_pay", "net_pay", "total_deductions", "nssf_deduction", "nhif_deduction", "paye_tax",
  "housing_levy", "house_allowance", "transport_allowance", "medical_allowance", "other_allowances", "overtime_hours",
  "overtime_rate", "commission", "bonus", "per_diem", "tax_relief", "loan_deduction", "advance_deduction",
  "welfare_deduction", "other_deductions", "leave_deduction", "overtime_pay",
  // the month-end settlement of piece rate work and contract jobs (FIG-812, lib/workSettlement)
  "work_pay", "jobs_pay", "paid_out", "ahl_withheld", "reserve_released", "wht_withheld", "wht_rate", "wht_tax",
  "arrears_brought_forward", "arrears_carried_forward",
  // Tanzania and Uganda (FIG-905): the employer's NSSF (both, never taken from pay); Tanzania's HESLB repayment and
  // the employer's SDL and WCF; Uganda's Local Service Tax
  "employer_nssf", "heslb_deduction", "sdl_levy", "wcf_levy", "lst_deduction",
] as const;

/** A calculated payroll row as the salary_history row saved for it */
const toSalaryHistory = (record: any): SalaryHistoryRecord => ({
  ...(Object.fromEntries(PAYSLIP_AMOUNTS.map((k) => [k, Number(record[k]) || 0])) as Record<(typeof PAYSLIP_AMOUNTS)[number], number>),
  employee_id: record.employee_id,
  employee_name: record.employee_name,
  pay_period: record.pay_period,
  deduction_items: record.deduction_items ?? [],
  earning_items: record.earning_items ?? [],
  leave_items: record.leave_items ?? [],
  payslip_note: record.payslip_note ?? null,
  overtime_items: record.overtime_items ?? [],
  work_items: record.work_items ?? [],
  arrears_note: record.arrears_note ?? null,
  worker_kind: record.worker_kind ?? null,
  work_settlement: record.work_settlement === true,
  // the payslip's country and currency (FIG-905): worked out by that country's engine
  country: record.country || "Kenya",
  currency: record.currency || "KES",
  // paid in USD (FIG-906): the month's rate and the local statutory figures the returns are filed from
  fx_rate: record.fx_rate ?? null,
  local_currency: record.local_currency ?? null,
  local_amounts: record.local_amounts ?? null,
  // the pay PAYE was worked out on (Tanzania's taxable pay, Uganda's chargeable income) and the residency it was taxed on
  taxable_pay: record.taxable_pay ?? null,
  tax_resident: record.tax_resident ?? null,
  // how taxable pay and PAYE were worked out, for the payslip (FIG-814)
  tax_details: record.tax_details ?? null,
  payment_method: record.payment_method || "",
  bank_name: record.bank_name || "",
  account_number: record.account_number || "",
});

/** A saved payslip shown like a calculated row: saved figures, plus the employee's current branch, department, phone... */
const fromSalaryHistory = (saved: any, live: any | undefined) => ({
  ...(live ?? { id: saved.id, branch: "", department: "", position: "" }),
  ...Object.fromEntries(PAYSLIP_AMOUNTS.map((k) => [k, Number(saved[k]) || 0])),
  employee_id: saved.employee_id,
  employee_name: saved.employee_name || live?.employee_name || saved.employee_id,
  pay_period: saved.pay_period,
  deduction_items: saved.deduction_items ?? [],
  earning_items: saved.earning_items ?? [],
  leave_items: saved.leave_items ?? [],
  payslip_note: saved.payslip_note ?? null,
  overtime_items: saved.overtime_items ?? [],
  work_items: saved.work_items ?? [],
  arrears_note: saved.arrears_note ?? null,
  worker_kind: saved.worker_kind ?? live?.worker_kind ?? null,
  work_settlement: saved.work_settlement === true,
  // the employer's NITA levy the database saved on the payslip (FIG-898)
  nita_levy: Number(saved.nita_levy) || 0,
  country: saved.country || "Kenya",
  currency: saved.currency || "KES",
  fx_rate: saved.fx_rate == null ? null : Number(saved.fx_rate),
  local_currency: saved.local_currency ?? null,
  local_amounts: saved.local_amounts ?? null,
  taxable_pay: saved.taxable_pay ?? null,
  tax_resident: saved.tax_resident ?? null,
  tax_details: saved.tax_details ?? null,
  payment_method: paymentMethodLabel(saved.payment_method),
  bank_name: saved.bank_name || "",
  account_number: saved.account_number || "",
});

export default function PayrollDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState<Date | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("all");
  const [selectedBranch, setSelectedBranch] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [currentRecordIndex, setCurrentRecordIndex] = useState<number | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  // the company's branches (FIG-905): the Run tab shows each employee's branch and flags staff outside Kenya
  const { branches: companyBranches, loading: branchesLoading } = useBranches();
  // the currency each country is paid in, and this month's USD rates (FIG-906)
  const { payCurrencies, loading: payCurrenciesLoading } = usePayCurrencies();
  const [fx, setFx] = useState<{ period: string; confirmed: Map<string, FxRate>; previous: Map<string, FxRate> } | null>(null);
  const [fxVersion, setFxVersion] = useState(0);
  const [heldBack, setHeldBack] = useState<RunCalculation["heldBack"]>([]);
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [departments, setDepartments] = useState(["all"]);
  const [branches, setBranches] = useState([
    { value: "all", label: "All Branches" },
  ]);
  // this month's figures worked out from current employee details; shown until the month's payroll run is started
  const [liveRecords, setLiveRecords] = useState<any[]>([]);
  // employee records with the company's standard pay items' benefits and tax details added (lib/payItems), so an
  // edited payslip is worked out again with them
  const [catalogueEmployees, setCatalogueEmployees] = useState<Map<string, any>>(new Map());
  // the month's payroll run and its saved payslips (runPeriod says which month they were loaded for)
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [runPayslips, setRunPayslips] = useState<any[]>([]);
  // each country's part of the run (FIG-905): approved, reopened and paid on its own
  const [runCountries, setRunCountries] = useState<PayrollRunCountry[]>([]);
  // draft countries worked out with other statutory rates than those in force now (FIG-813): recalculate before approving
  const [staleCountries, setStaleCountries] = useState<string[]>([]);
  // staff nobody worked out this month: their country has no engine yet, no rates, or a currency mismatch
  const [notCalculated, setNotCalculated] = useState<RunCalculation["notCalculated"]>([]);
  const [selectedCountry, setSelectedCountry] = useState("all");
  // people below their country's minimum wage, by country (the readiness check's warning)
  const [belowMinimum, setBelowMinimum] = useState<Map<string, number>>(new Map());
  const [runPeriod, setRunPeriod] = useState<string | null>(null);
  const [runVersion, setRunVersion] = useState(0);
  const [runBusy, setRunBusy] = useState(false);
  // bumped when this person approves the month: payslips are emailed then if the company emails them automatically
  const [payslipEmailAutoStart, setPayslipEmailAutoStart] = useState(0);
  // the open tab (?tab=...), and a counter bumped when the rates editor saves so the Rates tab reloads
  const [tab, setTab] = usePayrollTab();
  const [ratesVersion, setRatesVersion] = useState(0);
  // whose rates the Rates tab shows (FIG-905): one country at a time
  const [ratesCountry, setRatesCountry] = useState("Kenya");
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  // changing the company's rates needs payroll access (the statutory_rates policy checks the same)
  const canEditRates = !permissionsLoading && hasPermission("payroll");
  // bumped when voluntary deductions change, so this month's figures are worked out again
  const [deductionsVersion, setDeductionsVersion] = useState(0);
  const [showMissingDetails, setShowMissingDetails] = useState(false);
  // bumped when payroll details (KRA PIN, bank...) are filled in, so the employees are loaded again
  const [detailsVersion, setDetailsVersion] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [companyInfo, setCompanyInfo] = useState<any>(null);

  const [showSingleMpesaModal, setShowSingleMpesaModal] = useState(false);
  const [showBulkMpesaModal, setShowBulkMpesaModal] = useState(false);
  const [selectedEmployeeForMpesa, setSelectedEmployeeForMpesa] =
    useState<any>(null);

  const [showP9Modal, setShowP9Modal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  // the country whose rates the editor is open for (FIG-905); null when it is closed
  const [showStatutorySettings, setShowStatutorySettings] = useState<string | null>(null);
  const [showDemoPayAll, setShowDemoPayAll] = useState(false);
  const [demoPaid, setDemoPaid] = useState<{ period: string; numbers: Set<string> }>({ period: "", numbers: new Set() });
  const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);

  const [paymentRequests, setPaymentRequests] = useState<any[]>([]);
  const [userRole, setUserRole] = useState("maker");
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [showApprovalQueue, setShowApprovalQueue] = useState(false);
  const [selectedPaymentForDetails, setSelectedPaymentForDetails] =
    useState<any>(null);
  const [showPaymentDetails, setShowPaymentDetails] = useState(false);
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [paymentToReject, setPaymentToReject] = useState<any>(null);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  // NEW: Bulk approval states
  const [selectedPayments, setSelectedPayments] = useState(new Set());
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [commentModalConfig, setCommentModalConfig] = useState<{
    title: string;
    submitText: string;
    onSubmit: ((comment: string) => void) | null;
  }>({
    title: "",
    submitText: "",
    onSubmit: null,
  });
  const [showClearQueueModal, setShowClearQueueModal] = useState(false);

  // SMS balance state
  const [, setSmsBalance] = useState<any>(null);
  const [sendingSMS] = useState(false);
  const [smsSendingStatus] = useState({});
  // Add this with your other state declarations
  const [salaryAdvances, setSalaryAdvances] = useState<any[]>([]);
  // what approved payslips already took back, so a part payroll missed comes off the next run
  const [advancesTaken, setAdvancesTaken] = useState<AdvanceTaken[]>([]);
  const [currentView, setCurrentView] = useState("dashboard");

  // Statutory override state
  const [overrideStatutoryChecks, setOverrideStatutoryChecks] = useState(true);
  // Employment Act s.19(3): deductions on a month-end settlement kept within two-thirds of wages (FIG-812)
  const [deductionCap, setDeductionCap] = useState(true);

  const itemsPerPage = 5;


  // Add this useEffect - fetches salary advances once when component loads
  useEffect(() => {
    const fetchAllSalaryAdvances = async () => {
      try {
        console.log("Fetching ALL salary advances...");

        // every paid advance, a page at a time (the list grows every month)
        const { data, error } = await fetchAll((from, to) =>
          supabase
            .from("salary_advance")
            .select(
              // every column: repayment_months is read when the database has it (one month when not)
              '*',
            )
            .eq("payment_processed", "true")
            .eq("status", "paid")
            .order("time_added", { ascending: false })
            .order("id")
            .range(from, to),
        ).then(
          (rows) => ({ data: rows, error: null }),
          (err) => ({ data: null, error: err }),
        );

        if (error) {
          console.warn("Salary advances fetch error:", error.message);
          setSalaryAdvances([]);
          return;
        }

        console.log(`Loaded ${data?.length || 0} salary advances for payroll`);
        setSalaryAdvances(data || []);
        // without it, each month's own parts are still taken (no catching up)
        setAdvancesTaken(
          await loadAdvancesTaken((data || []).map((a: any) => String(a["Employee Number"] ?? ""))).catch((err) => {
            console.warn("Failed to load advance deductions already taken:", err?.message);
            return [];
          }),
        );
      } catch (error: any) {
        console.warn("Failed to load salary advances:", error.message);
        setSalaryAdvances([]);
      }
    };

    fetchAllSalaryAdvances();
  }, []); // Empty dependency array = runs once when component mounts

  // What comes off this pay for advances (no database call): a one-month advance in full in the month it was asked
  // for, an advance spread over N months in N parts from that month, plus any part an approved payslip missed
  // (src/lib/salaryAdvance.ts)
  const calculateAdvanceDeduction = (employeeNumber: any, period: any) =>
    advanceDeductionFor(salaryAdvances, employeeNumber, period, advancesTaken);
  // Enhanced SMS notification functions
  const sendPayslipNotification = async (employee: any) => {
    if (!employee.employeeNu) {
      console.warn(`No phone number for employee ${employee.employee_name}`);
      return { success: false, error: "No phone number available" };
    }

    const message = smsTemplates.payslipNotification(
      employee.employee_name,
      employee.net_pay,
      employee.pay_period,
    );

    try {
      const result = await sendSMSWithRetry(employee.employeeNu, message);
      return result;
    } catch (error: any) {
      console.error(
        `Failed to send payslip SMS to ${employee.employee_name}:`,
        error,
      );
      return { success: false, error: error.message };
    }
  };

  const sendPaymentConfirmation = async (employee: any) => {
    if (!employee.employeeNu) {
      console.warn(`No phone number for employee ${employee.employee_name}`);
      return { success: false, error: "No phone number available" };
    }

    const message = smsTemplates.paymentConfirmation(
      employee.employee_name,
      employee.net_pay,
    );

    try {
      const result = await sendSMSWithRetry(employee.employeeNu, message);
      return result;
    } catch (error: any) {
      console.error(
        `Failed to send payment confirmation to ${employee.employee_name}:`,
        error,
      );
      return { success: false, error: error.message };
    }
  };

  // NEW: Clear payment queue function
  const clearPaymentQueue = async () => {
    try {
      setIsLoadingRequests(true);

      // Filter only pending payments that can be cleared
      const pendingPayments = paymentRequests.filter(
        (p) => p.status === "pending",
      );

      if (pendingPayments.length === 0) {
        toast("No pending payments to clear", { icon: 'ℹ️' });
        return;
      }

      // Delete pending payments from the database
      const paymentIds = pendingPayments.map((p) => p.id);

      const { error } = await supabase
        .from("payment_flows")
        .delete()
        .in("id", paymentIds);

      if (error) {
        throw error;
      }

      // Update local state
      setPaymentRequests((prev) => prev.filter((p) => p.status !== "pending"));
      setSelectedPayments(new Set());

      toast.success(
        `Successfully cleared ${pendingPayments.length} pending payments from the queue`,
      );
      setShowClearQueueModal(false);
    } catch (error) {
      console.error("Error clearing payment queue:", error);
      toast.error("Failed to clear payment queue");
    } finally {
      setIsLoadingRequests(false);
    }
  };

  // NEW: Bulk approve payments function
  const bulkApprovePayments = async (comment: string) => {
    if (selectedPayments.size === 0) {
      toast.error("No payments selected for approval");
      return;
    }

    setIsLoadingRequests(true);
    const results = [];
    const selectedPaymentIds = Array.from(selectedPayments);

    for (const paymentId of selectedPaymentIds) {
      const payment = paymentRequests.find((p) => p.id === paymentId);
      if (payment && payment.status === "pending") {
        try {
          // Approve with comment
          await approvePayment(payment, comment);
          results.push({ paymentId, success: true });
        } catch (error: any) {
          results.push({ paymentId, success: false, error: error.message });
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const totalCount = results.length;

    if (successCount === totalCount) {
      toast.success(`All ${totalCount} payments approved successfully!`);
    } else if (successCount > 0) {
      toast.success(
        `${successCount} of ${totalCount} payments approved successfully`,
      );

      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        console.log("Failed approvals:", failed);
        toast.error(
          `${failed.length} approvals failed. Check console for details.`,
        );
      }
    } else {
      toast.error("All approvals failed");
    }

    setSelectedPayments(new Set());
    setIsLoadingRequests(false);
  };

  // NEW: Select/deselect all payments
  const toggleSelectAllPayments = () => {
    if (selectedPayments.size === pendingPayments.length) {
      // Deselect all
      setSelectedPayments(new Set());
    } else {
      // Select all pending payments
      const allPendingIds = paymentRequests
        .filter((p) => p.status === "pending")
        .map((p) => p.id);
      setSelectedPayments(new Set(allPendingIds));
    }
  };

  // NEW: Toggle selection for a single payment
  const togglePaymentSelection = (paymentId: any, isSelected: boolean) => {
    const newSelected = new Set(selectedPayments);
    if (isSelected) {
      newSelected.add(paymentId);
    } else {
      newSelected.delete(paymentId);
    }
    setSelectedPayments(newSelected);
  };

  const getCurrentPeriod = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  };

  const getPeriodString = (period: any) => {
    if (!period || period === "current") {
      return getCurrentPeriod();
    }
    if (period instanceof Date) {
      return `${period.getFullYear()}-${String(period.getMonth() + 1).padStart(2, "0")}`;
    }
    return period;
  };

  const actualPeriod = getPeriodString(selectedPeriod);
  // the month's confirmed USD rate per country (null while loading)
  const fxRates = useMemo(
    () => (fx && fx.period === actualPeriod ? new Map([...fx.confirmed].map(([c, r]) => [c, r.rate])) : null),
    [fx, actualPeriod],
  );
  // the statutory rates in force this month for each country with a payroll engine (statutory_rates by country);
  // `rates` is Kenya's (the deductions and payslip editing screens use it)
  const payrollCountries = useMemo(() => supportedCountries(), []);
  const { ratesByCountry, errors: rateErrors, isLoading: settingsLoading, reload: reloadRates } = useCountryRates(actualPeriod, payrollCountries);
  const rates = ratesByCountry?.get("Kenya") ?? null;
  useEffect(() => {
    for (const [country, message] of rateErrors) toast.error(`${country} payroll can't be worked out: ${message}`);
  }, [rateErrors]);

  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          console.warn("User not authenticated");
          return;
        }

        setCurrentUser(user);

        const { data: profile, error: profileError } = await supabase
          .from("user_profiles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (profileError) {
          console.warn("No user profile found, defaulting to maker role");
          setUserRole("maker");
        } else {
          setUserRole(profile.role || "maker");
        }
      } catch (error) {
        console.error("Error fetching user profile:", error);
        setUserRole("maker");
      }
    };

    fetchUserProfile();
  }, []);

  const fetchPaymentRequests = async () => {
    try {
      setIsLoadingRequests(true);
      const { data, error } = await supabase
        .from("payment_flows")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching payment requests:", error);
        toast.error("Failed to load payment requests");
        return;
      }

      setPaymentRequests(data || []);
    } catch (error) {
      console.error("Error fetching payment requests:", error);
      toast.error("Failed to load payment requests");
    } finally {
      setIsLoadingRequests(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchPaymentRequests();
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    const subscription = supabase
      .channel("payment_flows_channel")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_flows",
        },
        (payload) => {
          console.log("Payment request change:", payload);
          fetchPaymentRequests();
        },
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [currentUser]);

  useEffect(() => {
    const fetchCompanyInfo = async () => {
      try {
        // name, logo and tagline from the company profile (FIG-825)
        const data = await loadCompanyIdentity();
        if (data) {
          setCompanyInfo(data);
        }
      } catch (err) {
        console.error("Error:", err);
      }
    };

    fetchCompanyInfo();
  }, []);

  // Check SMS balance on component mount
  useEffect(() => {
    const loadSMSBalance = async () => {
      const balance = await checkSMSBalance();
      setSmsBalance(balance);
    };
    loadSMSBalance();
  }, []);

  const createPaymentRequest = async (
    employee: any,
    type: any,
    justification: any,
    employees: any = null,
  ) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const requestData = {
      type: type,
      employee_data: type === "single" ? employee : null,
      employees_data: type === "bulk" ? employees : null,
      justification: justification,
      created_by: user?.id,
    };

    const { data, error } = await supabase
      .from("payment_flows")
      .insert([requestData])
      .select()
      .single();

    if (error) throw error;

    // Show success message
    toast.success(
      "Payment request submitted successfully! Please wait for approval.",
    );

    return { ...data, created_by_email: user?.email };
  };

  // UPDATED: Approve payment with comment
  const approvePayment = async (payment: any, comment = "") => {
    // approving sends the money, so with in-app paying off it is refused
    if (!IN_APP_PAYMENTS) {
      toast.error(IN_APP_PAYMENTS_OFF_MESSAGE);
      return;
    }
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        toast.error("User not authenticated");
        return;
      }

      setPaymentRequests((prev) =>
        prev.map((req) =>
          req.id === payment.id
            ? {
              ...req,
              status: "approved",
              approved_by: user.id,
              approved_at: new Date().toISOString(),
              approved_by_email: user.email,
              approval_comment: comment,
            }
            : req,
        ),
      );

      const updateData = {
        status: "approved",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      };

      // Add comment if provided
      if (comment) {
        (updateData as any).approval_comment = comment;
      }

      const { data: _data, error } = await supabase
        .from("payment_flows")
        .update(updateData)
        .eq("id", payment.id)
        .select("*")
        .single();

      if (error) {
        console.error("Error approving payment request:", error);
        toast.error("Failed to approve payment request");
        fetchPaymentRequests();
        return;
      }

      try {
        if (payment.type === "single") {
          await processSingleMpesaPayment(payment.employee_data);
        } else {
          await processBulkMpesaPayment(payment.employees_data);
        }

        await supabase
          .from("payment_flows")
          .update({
            status: "completed",
            processed_at: new Date().toISOString(),
          })
          .eq("id", payment.id);

        setPaymentRequests((prev) =>
          prev.map((req) =>
            req.id === payment.id ? { ...req, status: "completed" } : req,
          ),
        );

        toast.success("Payment approved and processed successfully!");
      } catch (error) {
        await supabase
          .from("payment_flows")
          .update({
            status: "failed",
            processed_at: new Date().toISOString(),
            metadata: { error: (error as any).message },
          })
          .eq("id", payment.id);

        setPaymentRequests((prev) =>
          prev.map((req) =>
            req.id === payment.id ? { ...req, status: "failed" } : req,
          ),
        );

        console.error("Payment processing error:", error);
        toast.error("Payment approved but failed to process");
      }
    } catch (error: any) {
      console.error("Payment approval error:", error);
      toast.error("Failed to approve payment request");
    }
  };

  // UPDATED: Single approval with comment prompt
  const handleSingleApprove = (payment: any) => {
    setCommentModalConfig({
      title: "Approve Payment Request",
      submitText: "Approve",
      onSubmit: (comment) => approvePayment(payment, comment),
    });
    setShowCommentModal(true);
  };

  // NEW: Bulk approve handler
  const handleBulkApprove = () => {
    if (selectedPayments.size === 0) {
      toast.error("Please select at least one payment to approve");
      return;
    }

    setCommentModalConfig({
      title: `Approve ${selectedPayments.size} Selected Payments`,
      submitText: "Approve All",
      onSubmit: (comment) => bulkApprovePayments(comment),
    });
    setShowCommentModal(true);
  };

  const rejectPayment = async (payment: any, reason: any) => {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        toast.error("User not authenticated");
        return;
      }

      setPaymentRequests((prev) =>
        prev.map((req) =>
          req.id === payment.id
            ? {
              ...req,
              status: "rejected",
              rejected_by: user.id,
              rejected_at: new Date().toISOString(),
              rejection_reason: reason,
              rejected_by_email: user.email,
            }
            : req,
        ),
      );

      const { data: _data2, error } = await supabase
        .from("payment_flows")
        .update({
          status: "rejected",
          rejected_by: user.id,
          rejected_at: new Date().toISOString(),
          rejection_reason: reason,
        })
        .eq("id", payment.id)
        .select("*")
        .single();

      if (error) {
        console.error("Error rejecting payment request:", error);
        toast.error("Failed to reject payment request");
        fetchPaymentRequests();
        return;
      }

      toast.success("Payment request rejected");
    } catch (error) {
      console.error("Payment rejection error:", error);
      toast.error("Failed to reject payment request");
    }
  };

  const processSingleMpesaPayment = async (employee: any) => {
    if (!IN_APP_PAYMENTS) throw new Error(IN_APP_PAYMENTS_OFF_MESSAGE);
    // M-Pesa Kenya pays KES payslips only (the server refuses any other currency too)
    if (!isKesPayslip(employee)) {
      const note = mpesaKenyaNote([employee]) as string;
      toast.error(note);
      throw new Error(note);
    }
    try {
      const phoneNumber = employee.employeeNu;
      if (!phoneNumber) {
        throw new Error(
          `Phone number not found for employee ${employee.employee_id}`,
        );
      }

      const formattedPhone = formatPhoneNumber(phoneNumber);

      const response = await fetch(
        "https://mpesa-22p0.onrender.com/api/mpesa/b2c",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phoneNumber: formattedPhone,
            amount: employee.net_pay,
            employeeNumber: employee.employee_id,
            fullName: employee.employee_name,
            currency: employee.currency || "KES",
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to process payment");
      }

      const result = await response.json();

      if (result.success) {
        await sendPaymentConfirmation(employee);
      }

      toast.success(`Payment sent to ${employee.employee_name}`);
      return result;
    } catch (error: any) {
      console.error("M-Pesa payment error:", error);
      toast.error(`Failed to pay ${employee.employee_name}: ${error.message}`);
      throw error;
    }
  };

  const processBulkMpesaPayment = async (requested: any) => {
    if (!IN_APP_PAYMENTS) throw new Error(IN_APP_PAYMENTS_OFF_MESSAGE);
    const results = [];
    // M-Pesa Kenya pays only staff paid by M-Pesa, and only their KES payslips
    const selectedEmployees = (requested ?? []).filter((employee: PayRecipient) => isPaidByMpesa(employee) && isKesPayslip(employee));
    const otherCurrency = mpesaKenyaNote((requested ?? []).filter(isPaidByMpesa));
    if (otherCurrency) toast.error(otherCurrency, { duration: 10000 });
    const skipped = (requested ?? []).filter((employee: PayRecipient) => !isPaidByMpesa(employee));
    if (skipped.length) {
      toast.error(
        `Not paid by M-Pesa, so skipped: ${skipped
          .map((employee: PayRecipient) => `${employee.employee_name} (${paymentMethodLabel(employee.payment_method)})`)
          .join(", ")}`,
        { duration: 10000 },
      );
    }

    for (const employee of selectedEmployees) {
      try {
        const result = await processSingleMpesaPayment(employee);
        results.push({ success: true, employee, result });

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        results.push({ success: false, employee, error });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const totalCount = selectedEmployees.length;

    if (successCount === totalCount) {
      toast.success(`All ${totalCount} payments processed successfully!`);
    } else if (successCount > 0) {
      toast.success(
        `${successCount} of ${totalCount} payments processed successfully`,
      );
    } else {
      toast.error("All payments failed. Please check your settings.");
    }

    return results;
  };

  const handleSingleMpesaPayment = (employee: any) => {
    // a TZS, UGX or USD payslip is never paid through M-Pesa Kenya
    const note = mpesaKenyaNote([employee]);
    if (note) {
      toast.error(note);
      return;
    }
    setSelectedEmployeeForMpesa(employee);
    setShowSingleMpesaModal(true);
  };

  const handleBulkMpesaPayment = () => {
    setShowBulkMpesaModal(true);
  };

  const handleConfirmSinglePayment = async (justification: any) => {
    if (userRole === "credit_analyst_officer") {
      try {
        await processSingleMpesaPayment(selectedEmployeeForMpesa);
        toast.success("Payment sent successfully!");
      } catch (error) {
        console.error("Payment error:", error);
      }
    } else {
      await createPaymentRequest(
        selectedEmployeeForMpesa,
        "single",
        justification,
      );
    }
  };

  const handleConfirmBulkPayment = async (selectedEmployees: any, justification: any) => {
    if (userRole === "credit_analyst_officer") {
      try {
        await processBulkMpesaPayment(selectedEmployees);
        toast.success("Bulk payment processed successfully!");
      } catch (error) {
        console.error("Bulk payment error:", error);
      }
    } else {
      await createPaymentRequest(
        null,
        "bulk",
        justification,
        selectedEmployees,
      );
    }
  };

  // UPDATED: Enhanced payroll calculation with salary advance deduction
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        setIsLoading(true);
        // every employee, a page at a time (one request returns at most 1000)
        // casual workers are paid by the day from their own page, never on the monthly payroll
        const { data, error } = await fetchAll((from, to) => supabase.from("employees").select("*").order('"Employee Number"').order("id").range(from, to)).then(
          (rows) => ({ data: withoutCasuals(rows), error: null }),
          (err) => ({ data: null, error: err }),
        );

        if (error) {
          console.error("Error fetching employees:", error);
          return;
        }

        // voluntary deductions (SACCO, welfare...) for this month; a failure stops the calculation rather than
        // showing (and letting someone save) payslips without them
        const deductionSetup = await loadDeductionSetup();
        const voluntaryByEmployee = deductionsForPeriod(deductionSetup.types, deductionSetup.deductions, actualPeriod);
        // disbursed staff loans and what each has repaid: this month's instalment (and any shortfall carried from
        // earlier months) comes off pay, never more than the pay left (src/lib/loans.ts)
        const payrollLoans = await loadPayrollLoans().catch((err) => {
          // a database without the loans tables yet (migration 20261016700000): no loans to take
          if (["42P01", "PGRST205"].includes(err?.code)) return [];
          throw err;
        });
        // bonuses, commissions and incentives for this month (lib/earnings), the same way
        const earningSetup = await loadEarningSetup();
        const earningsByEmployee = earningsForPeriod(earningSetup.types, earningSetup.earnings, actualPeriod);
        // unpaid and half-pay leave days this month, from approved leave (lib/leavePay), and how a day's pay is worked out
        const [leaveByEmployee, leaveBasis] = await Promise.all([loadLeavePay(actualPeriod), loadLeaveRateBasis()]);
        // days of unexcused absence this month (FIG-881, lib/absencePay): off pay like unpaid leave, unless turned off
        const absenceByEmployee = await loadAbsencePay(actualPeriod);
        // leave over the carry-forward cap that the company pays out (FIG-877): a taxable "Leave paid out" earning
        const leavePayouts = await loadLeavePayouts(actualPeriod);
        // approved overtime this month, by kind of day, and the company's overtime settings (lib/overtimePay)
        const overtimeMonth = await loadOvertimeMonth(actualPeriod);
        // the month's piece rate work and contract jobs, what payouts paid and held back, and arrears brought forward
        // (FIG-812, lib/workSettlement), and whether deductions are kept within two-thirds of wages
        const [workByEmployee, capOn] = await Promise.all([loadWorkSettlement(actualPeriod), loadDeductionCap()]);
        // Uganda (FIG-905): LST already paid this financial year, and whether it is taken in instalments or at once
        const [lstPaidThisYear, lstCollection] = await Promise.all([loadLstPaidThisYear(actualPeriod), loadLstCollection()]);
        setDeductionCap(capOn);
        // the company's standard deductions, allowances and benefits (lib/payItems), and its work week for the
        // ones paid per day worked; a failure stops the calculation, like the deductions above
        const [payItems, workWeek] = await Promise.all([loadPayItems(), loadCompanyWorkWeek().catch(() => MONDAY_TO_FRIDAY)]);

        if (data) {
          setEmployees(data);

          // Extract departments and branches
          const uniqueDepartments = [
            ...new Set(data.map((emp) => emp.Department || emp["Job Level"])),
          ].filter(Boolean);
          const uniqueBranches = [
            ...new Set(data.map((emp) => emp.branch || emp.Office)),
          ].filter(Boolean);

          setDepartments(["all", ...uniqueDepartments]);
          setBranches([
            { value: "all", label: "All Branches" },
            ...uniqueBranches.map((branch) => ({
              value: branch,
              label: branch,
            })),
          ]);

          // Each employee's payslip, worked out by their branch's country's engine with that country's rates, in its
          // currency (lib/payroll, FIG-905). Staff in a country with no engine yet are worked out by nobody (never on
          // another country's rules). Only employees whose onboarding HR has approved are paid (the database refuses
          // payslips for anyone else); "Not onboarded" lists the rest.
          // standard pay items, applied through the same deduction, earning and benefit inputs the engine already uses
          const monthWorkingDays = workingDaysInMonth(actualPeriod, workWeek);
          const catalogue = applyCatalogue({
            employees: data.filter(isPayrollReady),
            items: payItems,
            voluntaryByEmployee,
            earningsByEmployee,
            monthOf: (e: any) => {
              const number = e["Employee Number"];
              const leaveRow = leaveByEmployee.get(number);
              const absenceRow = absenceByEmployee.get(number);
              const workingDays = Number(leaveRow?.month_working_days) || Number(absenceRow?.month_working_days) || monthWorkingDays;
              const daysOff = (Number(leaveRow?.unpaid_days) || 0) + (Number(leaveRow?.half_pay_days) || 0) + (Number(absenceRow?.absence_days) || 0);
              return {
                country: payrollCountryOf(e, companyBranches).country,
                basic: Number(e["Basic Salary"]) || 0,
                daysWorked: daysWorkedInMonth(workingDays, daysOff),
                coverage: { branchId: employeeBranch(e, companyBranches)?.id ?? null },
              };
            },
          });
          setCatalogueEmployees(new Map(catalogue.employees.map((e: any) => [e["Employee Number"], e])));
          const month = {
            period: actualPeriod,
            overrideStatutoryChecks,
            voluntaryByEmployee: catalogue.voluntaryByEmployee,
            payrollLoans,
            earningsByEmployee: catalogue.earningsByEmployee,
            leaveByEmployee,
            leaveBasis,
            absenceByEmployee,
            leavePayouts,
            overtimeMonth,
            advanceFor: calculateAdvanceDeduction,
            workByEmployee,
            deductionCap: capOn,
            lstPaidThisYear,
            lstCollection,
          };
          const { records: payrollData, notCalculated: waiting, heldBack: held } = calculateRun(
            catalogue.employees,
            companyBranches,
            (country) => {
              const countryRates = ratesByCountry?.get(country);
              return countryRates ? { ...month, rates: countryRates } : null;
            },
            // a country paid in USD is worked out at this month's confirmed rate, and held back without one (FIG-906)
            { payCurrencies, fxRates },
          );

          setLiveRecords(payrollData);
          setNotCalculated(waiting);
          setHeldBack(held);
        }
      } catch (err) {
        console.error("Error:", err);
        toast.error(runErrorMessage(err, "Could not work out this month's payroll."));
      } finally {
        setIsLoading(false);
      }
    };

    // once every country's rates and the branches are loaded; a country missing a rate is held back (calculateRun)
    if (ratesByCountry && !branchesLoading && !payCurrenciesLoading && fxRates) {
      fetchEmployees();
    }
    // runVersion: worked out again after each start / recalculate / approve, so payouts or work approved meanwhile count
  }, [actualPeriod, ratesByCountry, companyBranches, branchesLoading, overrideStatutoryChecks, salaryAdvances, deductionsVersion, detailsVersion, runVersion, payCurrencies, payCurrenciesLoading, fxRates]);

  // this month's USD rates (and the last ones, as suggestions), reloaded after one is confirmed
  useEffect(() => {
    let cancelled = false;
    loadFxRates(actualPeriod)
      .then((r) => { if (!cancelled) setFx({ period: actualPeriod, ...r }); })
      .catch((err) => {
        if (cancelled) return;
        setFx({ period: actualPeriod, confirmed: new Map(), previous: new Map() });
        toast.error(runErrorMessage(err, "Could not load the USD rates."));
      });
    return () => {
      cancelled = true;
    };
  }, [actualPeriod, fxVersion]);

  // the month's payroll run, reloaded after each start/recalculate/approve/...
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await getPayrollRun(actualPeriod);
        const [payslips, countries, stale] = found
          ? await Promise.all([getRunPayslips(found.id), getRunCountries(found.id), getStaleCountries(found.id).catch(() => [] as string[])])
          : [[], [], [] as string[]];
        if (cancelled) return;
        setRun(found);
        setRunPayslips(payslips);
        setRunCountries(countries);
        setStaleCountries(stale);
        setRunPeriod(actualPeriod);
      } catch (err) {
        if (!cancelled) toast.error(runErrorMessage(err, "Could not load this month's payroll."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actualPeriod, runVersion]);

  const runLoading = runPeriod !== actualPeriod;
  const monthRun = runLoading ? null : run;

  // payslips edited by hand in the month's draft run (FIG-883, lib/payslipOverrides): applied on top of the
  // calculation whenever the run is saved, and marked "Edited"
  const payslipEdits = usePayslipOverrides(monthRun?.id, runVersion);
  // an edited payslip is worked out again on its employee's country's rules (FIG-905)
  const payslipContext = (employeeNumber: string) => {
    const employee = catalogueEmployees.get(employeeNumber) ?? employees.find((e) => e["Employee Number"] === employeeNumber);
    const country = employee ? payrollCountryOf(employee, companyBranches).country : "Kenya";
    if (country === "Tanzania") {
      const headcount = employees.filter((e) => isPayrollReady(e) && payrollCountryOf(e, companyBranches).country === "Tanzania").length;
      return tanzaniaEditContext(employee, ratesByCountry?.get("Tanzania") ?? null, headcount);
    }
    if (country === "Uganda") {
      const ugRates = ratesByCountry?.get("Uganda") ?? {};
      return { ...statutoryContextFor(employee, ugRates, overrideStatutoryChecks, deductionCap), recalculate: (p: any) => recalculateUgandaPayslip(p, ugRates, employee) };
    }
    return statutoryContextFor(employee, rates, overrideStatutoryChecks, deductionCap);
  };

  // once the month's run is started, everything here (table, totals, exports, payslips, bulk pay) uses its saved figures
  const payrollRecords = useMemo(() => {
    if (!monthRun) return liveRecords;
    const liveByEmployee = new Map(liveRecords.map((r) => [r.employee_id, r]));
    return markEditedPayslips(runPayslips.map((saved) => fromSalaryHistory(saved, liveByEmployee.get(saved.employee_id))), payslipEdits);
  }, [monthRun, runPayslips, liveRecords, payslipEdits]);

  const applyAdditionalFilters = (records: any[]) => {
    return records.filter((record: any) => {
      const searchLower = searchTerm.toLowerCase().trim();

      const matchesSearch =
        !searchTerm.trim() ||
        (record.employee_name || "").toLowerCase().includes(searchLower) ||
        (record.employee_id || "").toLowerCase().includes(searchLower) ||
        (record.department || "").toLowerCase().includes(searchLower) ||
        (record.position || "").toLowerCase().includes(searchLower) ||
        searchLower
          .split(" ")
          .every((term) =>
            (record.employee_name || "").toLowerCase().includes(term),
          );

      const matchesDepartment =
        selectedDepartment === "all" ||
        record.department === selectedDepartment;
      const matchesPaymentMethod =
        selectedPaymentMethod === "all" ||
        record.payment_method === selectedPaymentMethod;
      const matchesBranch =
        selectedBranch === "all" || record.branch === selectedBranch;
      const matchesCountry = selectedCountry === "all" || payslipCountry(record) === selectedCountry;

      return (
        matchesCountry &&
        matchesSearch &&
        matchesDepartment &&
        matchesPaymentMethod &&
        matchesBranch
      );
    });
  };

  const finalFilteredRecords = applyAdditionalFilters(payrollRecords);

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = finalFilteredRecords.slice(
    indexOfFirstItem,
    indexOfLastItem,
  );
  const totalPages = Math.ceil(finalFilteredRecords.length / itemsPerPage);

  const handleViewPayslip = (record: any, index: number) => {
    setSelectedRecord(record);
    setCurrentRecordIndex(indexOfFirstItem + index);
  };

  const handleNavigatePayslip = (direction: string) => {
    if (currentRecordIndex === null || !selectedRecord) return;

    const newIndex =
      direction === "prev" ? currentRecordIndex - 1 : currentRecordIndex + 1;

    if (newIndex >= 0 && newIndex < finalFilteredRecords.length) {
      setSelectedRecord(finalFilteredRecords[newIndex]);
      setCurrentRecordIndex(newIndex);

      const newPage = Math.floor(newIndex / itemsPerPage) + 1;
      if (newPage !== currentPage) {
        setCurrentPage(newPage);
      }
    }
  };

  const toggleRowExpand = (id: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedRows((prev) => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      return newExpanded;
    });
  };

  const totalGrossPay = finalFilteredRecords.reduce(
    (sum: number, record: any) => sum + record.gross_pay,
    0,
  );
  const totalDeductions = finalFilteredRecords.reduce(
    (sum: number, record: any) => sum + record.total_deductions,
    0,
  );
  const totalNetPay = finalFilteredRecords.reduce(
    (sum: number, record: any) => sum + record.net_pay,
    0,
  );
  const totalPAYE = finalFilteredRecords.reduce(
    (sum: number, record: any) => sum + record.paye_tax,
    0,
  );
  const totalNHIF = finalFilteredRecords.reduce(
    (sum: number, record: any) => sum + record.nhif_deduction,
    0,
  );
  const totalNSSF = finalFilteredRecords.reduce(
    (sum: number, record: any) => sum + record.nssf_deduction,
    0,
  );
  const totalHousingLevy = finalFilteredRecords.reduce(
    (sum: number, record: any) => sum + record.housing_levy,
    0,
  );

  const pendingCount = paymentRequests.filter(
    (p) => p.status === "pending",
  ).length;
  const pendingPayments = paymentRequests.filter((p) => p.status === "pending");

  const paymentMethods = [
    "all",
    "Bank Transfer",
    "M-Pesa",
    "Airtel Money",
    "Cash",
  ];

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // NEW: Toggle statutory override
  const toggleStatutoryOverride = () => {
    setOverrideStatutoryChecks(!overrideStatutoryChecks);
    toast.success(
      overrideStatutoryChecks
        ? "Statutory PIN checks enabled"
        : "Statutory override enabled - all deductions will be applied",
    );
  };

  const periodLabel = new Date(`${actualPeriod}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Start the month's run, or recalculate its draft: saves every employee's figures (whatever the filters show)
  const handleSaveRun = async () => {
    const unnumbered = liveRecords.filter((r) => !r.employee_id).length;
    setRunBusy(true);
    try {
      // with the payslips' hand edits applied again on top (FIG-883)
      // (USD payslips are never edited by hand: they are worked out again from the USD figures and the month's rate)
      const numbered = liveRecords.filter((r) => r.employee_id);
      const calculated = [
        ...(await withRunEdits(monthRun?.id, numbered.filter((r) => !isUsdPayslip(r)), (r) => payslipContext(r.employee_id))),
        ...numbered.filter((r) => isUsdPayslip(r)),
      ];
      const all = calculated.map((r) => toSalaryHistory({ ...r, pay_period: actualPeriod }));
      // a payslip never goes out in another currency than the one its country is paid in (the database refuses it too)
      const mismatch = all.map((r) => currencyMismatch(r, payCurrencies)).find(Boolean);
      if (mismatch) {
        toast.error(mismatch);
        return;
      }
      // countries already approved keep their payslips; the others are saved (started, or recalculated)
      const { save: records, lockedCountries } = savableRecords(all, runCountries);
      if (records.length === 0) {
        toast.error(lockedCountries.length ? `${lockedCountries.join(", ")} ${lockedCountries.length === 1 ? "is" : "are"} already approved: reopen to recalculate.` : `No one can be paid for ${periodLabel} yet.`);
        return;
      }
      await saveDraftRun(actualPeriod, records, lockedCountries, ratesByCountry);
      toast.success(
        monthRun
          ? `Recalculated ${records.length} payslips for ${periodLabel}.`
          : `Started payroll for ${periodLabel} with ${records.length} employees.`,
      );
      const waiting = notCalculated.filter((n) => n.employees.length > 0);
      if (waiting.length) {
        toast(waiting.map((n) => `${n.country}: ${n.employees.length} not worked out (${n.reason})`).join("\n"), { icon: "ℹ️", duration: 8000 });
      }
      if (unnumbered) {
        toast.error(`${unnumbered} employee(s) have no employee number, so they were left out. Add one and recalculate.`);
      }
      setRunVersion((v) => v + 1);
    } catch (err) {
      toast.error(runErrorMessage(err, "Could not save the payroll."));
    } finally {
      setRunBusy(false);
    }
  };

  /** Approves, reopens or marks paid some of the run's countries in one go (FIG-905). */
  const changeCountries = async (countries: string[], status: PayrollRunStatus, question: DialogOptions, done: string) => {
    if (!monthRun || countries.length === 0 || !(await confirmDialog(question))) return;
    setRunBusy(true);
    try {
      const changed = await setCountriesStatus(monthRun.id, countries, status);
      if (changed.length === 0) throw new Error("Nothing changed: reload and try again.");
      toast.success(done);
      setRunVersion((v) => v + 1);
      if (status === "approved") setPayslipEmailAutoStart((n) => n + 1);
    } catch (err) {
      toast.error(runErrorMessage(err, "Could not update the payroll."));
      // e.g. work or payouts changed since the payslips were worked out: work them out again for "Recalculate"
      setRunVersion((v) => v + 1);
    } finally {
      setRunBusy(false);
    }
  };


  const missingDetails = useMemo(() => employeesMissingDetails(employees), [employees]);

  // demo paying (PAYMENTS_DEMO): who would be paid how, and who was "paid" this month, in memory only (gone on reload)
  // (any approved country can be paid; a paid one can't be paid again)
  const demoPayEnabled = PAYMENTS_DEMO && runCountries.some((c) => c.status === "approved");
  // the Pay buttons always show in demo mode; before the month is approved they say why they can't pay yet
  const demoPayBlockedReason = demoPayEnabled
    ? null
    : monthRun?.status === "paid"
      ? `${periodLabel} is already marked paid`
      : monthRun
        ? `Approve ${periodLabel}'s payroll first, then pay`
        : `Start and approve ${periodLabel}'s payroll first, then pay`;
  // the payment details are read again whenever the pay window opens, so a bank name corrected on the employee's
  // record since this page loaded is the one checked
  useEffect(() => {
    if (!showDemoPayAll) return;
    let stale = false;
    fetchAll((from, to) => supabase.from("employees").select("*").order('"Employee Number"').order("id").range(from, to))
      .then((data) => { if (!stale && data) setEmployees(withoutCasuals(data)); })
      .catch((err) => console.error("Could not reload employees for paying:", err));
    return () => { stale = true; };
  }, [showDemoPayAll]);
  const approvedCountries = useMemo(() => new Set(runCountries.filter((c) => c.status !== "draft").map((c) => c.country)), [runCountries]);
  // payslips of approved (or paid) countries: what can be paid, emailed and filed
  const approvedRecords = useMemo(() => payrollRecords.filter((r: any) => monthRun && approvedCountries.has(payslipCountry(r))), [payrollRecords, approvedCountries, monthRun]);
  const demoLines = useMemo(
    () => demoPayLines(approvedRecords.filter((r: any) => runCountries.some((c) => c.country === payslipCountry(r) && c.status === "approved")), employees),
    [approvedRecords, runCountries, employees],
  );
  const demoLineByNumber = useMemo(() => new Map(demoLines.map((l) => [l.employeeNumber, l])), [demoLines]);
  const demoPaidNow = demoPaid.period === actualPeriod ? demoPaid.numbers : new Set<string>();
  const markDemoPaid = (numbers: string[]) =>
    setDemoPaid((prev) => ({
      period: actualPeriod,
      numbers: new Set([...(prev.period === actualPeriod ? prev.numbers : []), ...numbers]),
    }));

  // the tools used now and then, in the header's "More" menu
  const moreMenuItems: MoreMenuItem[] = [
    {
      label: "Statutory override",
      hint: overrideStatutoryChecks ? "On" : "Off",
      icon: <Settings className="w-3.5 h-3.5" />,
      onSelect: toggleStatutoryOverride,
    },
    { label: "P9 tax card", icon: <FileText className="w-3.5 h-3.5" />, onSelect: () => setShowP9Modal(true) },
    { label: "Export payroll table", icon: <Download className="w-3.5 h-3.5" />, onSelect: () => setShowExportModal(true) },
    { label: "Upload salary history", icon: <Upload className="w-3.5 h-3.5" />, onSelect: () => setShowBulkUploadModal(true) },
  ];
  const notOnboarded = useMemo(() => employees.filter((e) => !isPayrollReady(e)), [employees]);
  const onPayroll = useMemo(() => employees.filter(isPayrollReady), [employees]);
  // Kenya's returns (P10, SHA, NSSF) are for Kenya's staff only
  const kenyaOnPayroll = useMemo(() => onPayroll.filter((e) => payrollCountryOf(e, companyBranches).country === "Kenya"), [onPayroll, companyBranches]);
  const returnsGaps = useMemo(() => {
    const r = returnsReadiness(kenyaOnPayroll);
    return new Set([...r.p10, ...r.sha, ...r.nssf].map((p) => p.employeeNumber)).size;
  }, [kenyaOnPayroll]);

  // the month's people with details missing: only those on this payroll, not everyone in the company
  const runMissingDetails = useMemo(() => {
    const onRun = new Set(payrollRecords.map((r: any) => String(r.employee_id ?? "")));
    return missingDetails.filter((m) => onRun.has(m.employeeNumber)).length;
  }, [payrollRecords, missingDetails]);
  const people = (n: number) => `${n} ${n === 1 ? "employee" : "employees"}`;

  // each country's readiness for approval (FIG-905): one Approve approves every country that is ready
  const readiness: CountryReadiness[] = useMemo(
    () =>
      countryReadiness({
        employees: onPayroll,
        branches: companyBranches,
        payslips: payrollRecords,
        runCountries,
        runStarted: !!monthRun,
        ratesByCountry: ratesByCountry ?? new Map(),
        belowMinimum,
        payCurrencies,
        fxRates,
        heldBack,
        ratesChanged: staleCountries,
      }),
    [onPayroll, companyBranches, payrollRecords, runCountries, monthRun, ratesByCountry, belowMinimum, payCurrencies, fxRates, heldBack, staleCountries],
  );
  // the countries on this month's payroll paid in USD: each needs the month's rate (FIG-906)
  const usdCountries = useMemo(
    () => [...new Set(onPayroll.map((e) => payrollCountryOf(e, companyBranches).country))].filter((c) => paidInUsd(c, payCurrencies)).sort(),
    [onPayroll, companyBranches, payCurrencies],
  );
  const readyCountries = countriesToApprove(readiness);
  const countriesIn = (status: PayrollRunStatus) =>
    monthRun && runCountries.length === 0
      ? monthRun.status === status ? ["Kenya"] : []
      : runCountries.filter((c) => c.status === status).map((c) => c.country);
  const listOf = (cs: string[]) => cs.join(", ");
  const currencyTotals = useMemo(() => totalsByCurrency(finalFilteredRecords), [finalFilteredRecords]);

  const approveCountries = (countries: string[]) => {
    const ready = readiness.filter((r) => countries.includes(r.country));
    return changeCountries(
      countries,
      "approved",
      {
        title: countries.length === readiness.filter((r) => r.payslips > 0 || r.employees > 0).length ? `Approve payroll for ${periodLabel}?` : `Approve ${listOf(countries)} for ${periodLabel}?`,
        message: [
          approvalSummary(readiness),
          ...ready.map((r) => `${r.country}: ${people(r.payslips)}, net pay ${moneyRounded(r.totals.net, r.currency)}.`),
          ...ready.flatMap((r) => r.warnings.map((w) => `${r.country}: ${w}.`)),
          runMissingDetails
            ? `${people(runMissingDetails)} ${runMissingDetails === 1 ? "is" : "are"} missing a tax PIN, statutory number, or payment details (see "Employees' pay").`
            : "",
          returnsGaps
            ? `${people(returnsGaps)} ${returnsGaps === 1 ? "is" : "are"} missing details the P10, SHA or NSSF returns need (see the returns check).`
            : "",
          readiness.some((r) => r.state === "blocked" || r.state === "waiting")
            ? "Countries that aren't ready stay as they are and can be approved later."
            : "",
          "Payslips will be locked and staff will be able to see them.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        confirmLabel: "Approve payroll",
      },
      `Payroll for ${periodLabel} approved for ${listOf(countries)}. Staff there can now see their payslips.`,
    );
  };

  const handleApproveRun = () => {
    if (readyCountries.length === 0) {
      toast.error("No country is ready to approve yet: see By country.");
      return;
    }
    return approveCountries(readyCountries);
  };

  const reopenCountries = (countries: string[]) =>
    changeCountries(
      countries,
      "draft",
      {
        title: `Reopen payroll for ${periodLabel}${countries.length === 1 && runCountries.length > 1 ? ` in ${countries[0]}` : ""}?`,
        message: "Staff won't see these payslips until it is approved again.",
        confirmLabel: "Reopen",
      },
      `Payroll for ${periodLabel} reopened as a draft (${listOf(countries)}).`,
    );
  const handleReopenRun = () => reopenCountries(countriesIn("approved"));

  const markCountriesPaid = (countries: string[]) =>
    changeCountries(
      countries,
      "paid",
      {
        title: `Mark payroll for ${periodLabel}${countries.length === 1 && runCountries.length > 1 ? ` in ${countries[0]}` : ""} as paid?`,
        message: "This can't be undone: the payslips stay locked for good.",
        confirmLabel: "Mark as paid",
      },
      `Payroll for ${periodLabel} marked as paid (${listOf(countries)}).`,
    );
  const handleMarkRunPaid = () => markCountriesPaid(countriesIn("approved"));

  const handleDiscardRun = async () => {
    if (
      !monthRun ||
      !(await confirmDialog({
        title: `Discard the draft payroll for ${periodLabel}?`,
        message: "Its saved payslips are deleted.",
        confirmLabel: "Discard",
        tone: "danger",
      }))
    )
      return;
    setRunBusy(true);
    try {
      // only draft countries' payslips go; an approved country's stay (the run goes when nothing is left)
      const locked = runCountries.some((c) => c.status !== "draft");
      if (locked) await discardDraftCountries(monthRun.id, countriesIn("draft"));
      else await discardDraftRun(monthRun.id);
      toast.success(`Draft payroll for ${periodLabel} discarded.`);
      setRunVersion((v) => v + 1);
    } catch (err) {
      toast.error(runErrorMessage(err, "Could not discard the draft."));
    } finally {
      setRunBusy(false);
    }
  };

  const discardCountry = async (country: string) => {
    if (!monthRun || !(await confirmDialog({ title: `Discard ${country}'s draft payroll for ${periodLabel}?`, message: "Its saved payslips are deleted.", confirmLabel: "Discard", tone: "danger" }))) return;
    setRunBusy(true);
    try {
      await discardDraftCountries(monthRun.id, [country]);
      toast.success(`${country}'s draft for ${periodLabel} discarded.`);
      setRunVersion((v) => v + 1);
    } catch (err) {
      toast.error(runErrorMessage(err, "Could not discard the draft."));
    } finally {
      setRunBusy(false);
    }
  };

  // NEW: Refresh button handler
  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await fetchPaymentRequests();
      setRunVersion((v) => v + 1);

      // Refresh SMS balance
      const balance = await checkSMSBalance();
      setSmsBalance(balance);

      // Refresh employees and payroll data
      const data = await fetchAll((from, to) => supabase.from("employees").select("*").order('"Employee Number"').order("id").range(from, to));

      if (data) {
        setEmployees(withoutCasuals(data));
      }

      toast.success("Dashboard refreshed successfully!");
    } catch (error) {
      console.error("Error refreshing:", error);
      toast.error("Failed to refresh data");
    } finally {
      setIsLoading(false);
    }
  };

  // the spreadsheet page sends M-Pesa payments itself, so it is off with the other in-app paying
  if (IN_APP_PAYMENTS && currentView === "mpesa-spreadsheet") {
    return (
      <MPesaSpreadsheetFullPage
        onBack={() => setCurrentView("dashboard")}
        userRole={userRole}
      />
    );
  }

  // the Run and Employees' pay tabs wait for the month's figures; the others load their own
  const dataLoading = isLoading || settingsLoading;
  const loader = (
    <div className="py-16 flex items-center justify-center">
      <FigbloomLoader label={settingsLoading ? "Loading statutory rates" : "Loading employee data"} />
    </div>
  );

  return (
    <div className="p-4 space-y-4 bg-page min-h-screen max-w-screen-2xl mx-auto">
      <PageHeader
        title="Payroll"
        className="!mb-0"
        subtitle={<span>Pay, deductions, statutory rates and returns for {periodLabel}</span>}
        actions={
          // one row: the date picker wraps itself in a block, which would put "More" underneath
          <div className="flex items-center gap-2 flex-wrap">
          <DatePicker
            wrapperClassName="!w-auto"
            selected={selectedPeriod ?? null}
            onChange={(date) => setSelectedPeriod(date)}
            dateFormat="MMMM yyyy"
            showMonthYearPicker
            customInput={
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-2 rounded-tile border border-border bg-white text-xs font-semibold text-ink hover:bg-secondary transition-colors"
              >
                Pay Period &middot;{" "}
                {selectedPeriod
                  ? selectedPeriod.toLocaleDateString("en-US", { month: "long", year: "numeric" })
                  : "Select"}
                <ChevronDown className="w-3 h-3 text-subtle" strokeWidth={2} />
              </button>
            }
          />
          <PayrollMoreMenu items={moreMenuItems} />
          </div>
        }
      />

      <TabBar items={[...PAYROLL_TABS]} activeId={tab} onChange={setTab} className="border-b border-border" />

      {/* new platform statutory rates (FIG-813): "New Kenya rates from 1 July 2026", for the countries this company pays in */}
      <PlatformRatesBanner countries={[...new Set(["Kenya", ...companyBranches.map((b) => b.country)])]} onOpenRates={() => setTab("rates")} />

      {/* WALLET UI REMOVED - Commented out as requested */}

      {IN_APP_PAYMENTS && showApprovalQueue &&
        (userRole === "checker" || userRole === "credit_analyst_officer") && (
          <div className="bg-gradient-to-r from-blue-100 to-indigo-100 border border-indigo-200 rounded-[10px] p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-600" />
                Payment Approval Queue
                {isLoadingRequests && (
                  <Loader className="w-4 h-4 animate-spin text-gray-400" />
                )}
              </h2>
              <div className="flex gap-2">
                {/* NEW: Bulk Action Buttons */}
                {selectedPayments.size > 0 && (
                  <>
                    <button
                      onClick={handleBulkApprove}
                      className="px-4 py-1.5 text-xs font-medium text-white bg-primary rounded-[25px] hover:bg-primary/90 flex items-center gap-2 transition-colors"
                      disabled={isLoadingRequests}
                    >
                      <CheckCircle className="w-4 h-4" />
                      Approve Selected ({selectedPayments.size})
                    </button>
                    <button
                      onClick={() => setSelectedPayments(new Set())}
                      className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-white border border-indigo-100 rounded-[25px] hover:bg-violet-50 hover:text-violet-700 transition-colors"
                      disabled={isLoadingRequests}
                    >
                      Clear Selection
                    </button>
                  </>
                )}

                {/* NEW: Clear Queue Button */}
                <button
                  onClick={() => setShowClearQueueModal(true)}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-red-600 rounded-[25px] hover:bg-red-700 flex items-center gap-2 transition-colors"
                  disabled={isLoadingRequests || pendingCount === 0}
                >
                  <Trash2 className="w-4 h-4" />
                  Clear Queue ({pendingCount})
                </button>

                <button
                  onClick={() => setShowApprovalQueue(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* NEW: Bulk Selection Controls */}
            {pendingCount > 0 && (
              <div className="mb-6 p-3 bg-white border border-indigo-100 rounded-[10px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={
                        selectedPayments.size === pendingPayments.length &&
                        pendingPayments.length > 0
                      }
                      onChange={toggleSelectAllPayments}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-xs font-medium text-blue-800">
                      {selectedPayments.size} of {pendingPayments.length}{" "}
                      payments selected
                    </span>
                  </div>
                  <div className="text-xs text-blue-600">
                    Select payments for bulk approval
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
              {/* Employees */}
              <div className="bg-white p-4 rounded-[10px] border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-xs font-medium text-gray-500">Employees</span>
                </div>
                <p className="text-xl font-bold text-gray-900">{finalFilteredRecords.length}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">On payroll</p>
              </div>

              {/* Gross Pay */}
              <div className="bg-white p-4 rounded-[10px] border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-xs font-medium text-gray-500">Gross pay</span>
                </div>
                <p className="text-sm font-bold text-blue-700">KSh {totalGrossPay.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Before deductions</p>
              </div>

              {/* Net Pay */}
              <div className="bg-white p-4 rounded-[10px] border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-xs font-medium text-gray-500">Net pay</span>
                </div>
                <p className="text-sm font-bold text-green-700">KSh {totalNetPay.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Take-home</p>
              </div>

              {/* Total Deductions */}
              <div className="bg-white p-4 rounded-[10px] border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Calculator className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-xs font-medium text-gray-500">Deductions</span>
                </div>
                <p className="text-sm font-bold text-red-600">KSh {totalDeductions.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Statutory + others</p>
              </div>

              {/* PAYE */}
              <div className="bg-white p-4 rounded-[10px] border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-3.5 h-3.5 text-orange-400" />
                  <span className="text-xs font-medium text-gray-500">PAYE</span>
                </div>
                <p className="text-sm font-bold text-orange-600">KSh {totalPAYE.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Income tax</p>
              </div>

              {/* SHIF (NHIF) */}
              <div className="bg-white p-4 rounded-[10px] border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs font-medium text-gray-500">SHIF</span>
                </div>
                <p className="text-sm font-bold text-purple-600">KSh {totalNHIF.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Health fund</p>
              </div>

              {/* NSSF */}
              <div className="bg-white p-4 rounded-[10px] border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Calculator className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-xs font-medium text-gray-500">NSSF</span>
                </div>
                <p className="text-sm font-bold text-indigo-600">KSh {totalNSSF.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Social security</p>
              </div>

              {/* Housing Levy */}
              <div className="bg-white p-4 rounded-[10px] border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-3.5 h-3.5 text-yellow-500" />
                  <span className="text-xs font-medium text-gray-500">Housing levy</span>
                </div>
                <p className="text-sm font-bold text-yellow-600">KSh {totalHousingLevy.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">1.5% of gross</p>
              </div>
            </div>


            {paymentRequests.length > 0 ? (
              <div className="grid gap-4">
                {paymentRequests
                  .filter((payment) => payment.status !== "completed")
                  .map((payment) => (
                    <PendingPaymentCard
                      key={payment.id}
                      payment={payment}
                      userRole={userRole}
                      isSelected={selectedPayments.has(payment.id)}
                      onSelect={(paymentId, isSelected) =>
                        togglePaymentSelection(paymentId, isSelected)
                      }
                      onApprove={() => handleSingleApprove(payment)}
                      onReject={() => {
                        setPaymentToReject(payment);
                        setShowRejectionModal(true);
                      }}
                      onViewDetails={() => {
                        setSelectedPaymentForDetails(payment);
                        setShowPaymentDetails(true);
                      }}
                    />
                  ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No pending payments
                </h3>
                <p className="text-gray-600">
                  All payment requests have been processed.
                </p>
              </div>
            )}
          </div>
        )}



      {tab === "run" && !dataLoading && monthRun && (
        <RatesChangedNotice
          countries={staleCountries.filter((c) => runCountries.some((rc) => rc.country === c && rc.status === "draft"))}
          periodLabel={periodLabel}
          busy={runBusy}
          onRecalculate={() => void handleSaveRun()}
        />
      )}
      {tab === "run" && (dataLoading ? loader : (
        <PayrollRunTab
          periodLabel={periodLabel}
          payPeriod={actualPeriod}
          companyBranches={companyBranches}
          readiness={readiness}
          countryActions={{
            onApprove: (c) => void approveCountries([c]),
            onReopen: (c) => void reopenCountries([c]),
            onMarkPaid: (c) => void markCountriesPaid([c]),
            onDiscard: (c) => void discardCountry(c),
          }}
          runBarCountries={
            readiness.length > 1 || runCountries.length > 1 || notCalculated.length > 0
              ? {
                  ready: readyCountries.length,
                  draft: !!monthRun && (monthRun.status === "draft" || readiness.some((r) => r.state === "ready" || r.state === "blocked")),
                  approved: countriesIn("approved").length > 0,
                  summary: approvalSummary(readiness),
                }
              : undefined
          }
          currencyTotals={currencyTotals}
          countryOptions={[...new Set([...readiness.map((r) => r.country)])].sort(countryOrder)}
          selectedCountry={selectedCountry}
          setSelectedCountry={setSelectedCountry}
          payrollRecords={payrollRecords}
          returnsEmployees={kenyaOnPayroll}
          usdRates={
            <UsdRatePanel
              countries={usdCountries}
              periodLabel={periodLabel}
              confirmed={fx && fx.period === actualPeriod ? fx.confirmed : new Map()}
              previous={fx && fx.period === actualPeriod ? fx.previous : new Map()}
              locked={approvedCountries}
              canEdit={canEditRates}
              onConfirm={async (country, rate) => {
                await saveFxRate(actualPeriod, country, rate);
                setFxVersion((v) => v + 1);
              }}
            />
          }
          onBelowMinimum={setBelowMinimum}
          onDownloadPdf={() => {
            try {
              downloadPayrollRegisterPdf(finalFilteredRecords, { periodLabel, companyName: companyInfo?.company_name });
            } catch {
              toast.error("The PDF was not made. Try again.");
            }
          }}
          monthRun={monthRun}
          runLoading={runLoading}
          runBusy={runBusy}
          onStart={handleSaveRun}
          onApprove={handleApproveRun}
          onReopen={handleReopenRun}
          onMarkPaid={handleMarkRunPaid}
          onDiscard={handleDiscardRun}
          onPayroll={onPayroll}
          onOpenFiles={() => setTab("files")}
          userRole={userRole}
          handleBulkMpesaPayment={handleBulkMpesaPayment}
          onOpenSpreadsheet={() => setCurrentView("mpesa-spreadsheet")}
          onOpenApprovals={() => setShowApprovalQueue(true)}
          pendingCount={pendingCount}
          branches={branches}
          selectedBranch={selectedBranch}
          setSelectedBranch={setSelectedBranch}
          departments={departments}
          selectedDepartment={selectedDepartment}
          setSelectedDepartment={setSelectedDepartment}
          paymentMethods={paymentMethods}
          selectedPaymentMethod={selectedPaymentMethod}
          setSelectedPaymentMethod={setSelectedPaymentMethod}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          finalFilteredRecords={finalFilteredRecords}
          currentItems={currentItems}
          totals={{ totalGrossPay, totalDeductions, totalNetPay, totalPAYE, totalNHIF, totalNSSF, totalHousingLevy }}
          nitaLevy={nitaTotal(payrollRecords)}
          expandedRows={expandedRows}
          toggleRowExpand={toggleRowExpand}
          smsSendingStatus={smsSendingStatus}
          sendingSMS={sendingSMS}
          sendPayslipNotification={sendPayslipNotification}
          handleSingleMpesaPayment={handleSingleMpesaPayment}
          handleViewPayslip={handleViewPayslip}
          currentPage={currentPage}
          totalPages={totalPages}
          handlePageChange={handlePageChange}
          itemsPerPage={itemsPerPage}
          payslipEmails={
            <EmailPayslipsPanel
              // the payslips of approved countries are emailed (a draft country's wait for its approval)
              run={monthRun && approvedCountries.size > 0 ? { ...monthRun, status: monthRun.status === "paid" ? "paid" : "approved" } : monthRun}
              periodLabel={periodLabel}
              records={approvedRecords}
              companyInfo={companyInfo}
              idNumberFor={(number) => employees.find((e: any) => e["Employee Number"] === number)?.["ID Number"]}
              canEmail={canEditRates}
              autoStart={payslipEmailAutoStart}
            />
          }
          demoPay={{
            shown: PAYMENTS_DEMO,
            enabled: demoPayEnabled,
            blockedReason: demoPayBlockedReason,
            lineFor: (employeeNumber) => demoLineByNumber.get(String(employeeNumber ?? "")),
            isPaid: (employeeNumber) => demoPaidNow.has(employeeNumber),
            onPaid: (employeeNumber) => markDemoPaid([employeeNumber]),
            onPayAll: () => setShowDemoPayAll(true),
          }}
        />
      ))}

      {tab === "employees" && (dataLoading ? loader : (
        <PayrollEmployeesTab
          onPayroll={onPayroll}
          notOnboarded={notOnboarded}
          missingDetails={missingDetails}
          onFixMissing={() => setShowMissingDetails(true)}
          onGoToOnboarding={() => navigate("/onboarding")}
        />
      ))}

      {tab === "deductions" && (
        <PayrollDeductionsTab
          onChanged={() => setDeductionsVersion((v) => v + 1)}
          rates={rates}
          draftNotice={
            monthRun?.status === "draft"
              ? `Payroll for ${periodLabel} is a draft: press Recalculate to apply deduction changes to it.`
              : monthRun
                ? `Payroll for ${periodLabel} is ${monthRun.status}, so changes apply from the next month you run.`
                : null
          }
        />
      )}

      {tab === "earnings" && (
        <PayrollEarningsTab
          payPeriod={actualPeriod}
          periodLabel={periodLabel}
          onChanged={() => setDeductionsVersion((v) => v + 1)}
          draftNotice={
            monthRun?.status === "draft"
              ? `Payroll for ${periodLabel} is a draft: press Recalculate to apply earning changes to it.`
              : monthRun
                ? `Payroll for ${periodLabel} is ${monthRun.status}: its payslips keep the earnings they were approved with.`
                : null
          }
        />
      )}

      {tab === "pay-items" && (
        <PayrollPayItemsTab
          onChanged={() => setDeductionsVersion((v) => v + 1)}
          rates={rates}
          canEdit={canEditRates}
          overLimit={overTwoThirds(payrollRecords)}
          draftNotice={
            monthRun?.status === "draft"
              ? `Payroll for ${periodLabel} is a draft: press Recalculate to apply pay item changes to it.`
              : monthRun
                ? `Payroll for ${periodLabel} is ${monthRun.status}, so changes apply from the next month you run.`
                : null
          }
        />
      )}

      {tab === "rates" && (
        <div className="space-y-4">
          {payrollCountries.length > 1 && (
            <div className="flex gap-1" role="tablist" aria-label="Country">
              {payrollCountries.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={ratesCountry === c}
                  onClick={() => setRatesCountry(c)}
                  className={`px-3 py-1.5 rounded-tile border text-[11.5px] font-semibold ${ratesCountry === c ? "border-brand bg-brand/10 text-brand" : "border-border bg-white text-ink hover:bg-secondary"}`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <PlatformRatesLink onOpen={() => navigate("/platform/rates")} />
          <PayrollRatesTab
            payPeriod={actualPeriod}
            periodLabel={periodLabel}
            canEdit={canEditRates}
            onEdit={() => setShowStatutorySettings(ratesCountry)}
            version={ratesVersion}
            country={ratesCountry}
          />
          {ratesCountry === "Uganda" && (
            <UgandaLstSettings payPeriod={actualPeriod} canEdit={canEditRates} onChanged={() => setDeductionsVersion((v) => v + 1)} />
          )}
          <LeavePaySetting
            canEdit={canEditRates}
            onChanged={() => setDeductionsVersion((v) => v + 1)}
            draftNotice={
              monthRun?.status === "draft"
                ? `Payroll for ${periodLabel} is a draft: press Recalculate to apply the change to it.`
                : monthRun
                  ? `Payroll for ${periodLabel} is ${monthRun.status}: its payslips keep the deductions they were approved with.`
                  : null
            }
          />
          <OvertimeSettingsCard canEdit={canEditRates} onChanged={() => setDeductionsVersion((v) => v + 1)} />
          <PayCurrencySetting
            countries={[...new Set(companyBranches.filter((b) => b.active).map((b) => b.country))]}
            canEdit={canEditRates}
            onChanged={() => setFxVersion((v) => v + 1)}
          />
          <DeductionCapSetting canEdit={canEditRates} onChanged={() => setDeductionsVersion((v) => v + 1)} />
          <MinimumWageCard canEdit={canEditRates} />
          <PayslipEmailSetting canEdit={canEditRates} />
          {/* how payslips look (FIG-814), for people with Payslip design */}
          {!permissionsLoading && hasPermission("payslip-design") && (
            <button type="button" className="text-xs font-semibold text-brand underline" onClick={() => navigate("/settings/payslip-design")}>
              Payslip design: letterhead, contacts, footer and sections
            </button>
          )}
        </div>
      )}

      {tab === "files" && (
        <PayrollFilesTab
          periodLabel={periodLabel}
          run={monthRun}
          runCountries={runCountries}
          onOpenP9={() => setShowP9Modal(true)}
          onOpenExport={() => setShowExportModal(true)}
          onGoToRun={() => setTab("run")}
        />
      )}

      {tab === "history" && (
        <PayrollHistoryTab
          version={runVersion}
          onUploadHistory={() => setShowBulkUploadModal(true)}
          onOpen={(period) => {
            setSelectedPeriod(new Date(`${period}-01T00:00:00`));
            setTab("run");
          }}
        />
      )}

      {selectedRecord && (
        <PayslipModal
          record={
            // the same payslip as reloaded (e.g. after editing it)
            payrollRecords.find((r) => r.employee_id === selectedRecord.employee_id) ?? selectedRecord
          }
          edit={
            monthRun && canEditRates
              ? {
                  run: monthRun,
                  base: liveRecords.find((r) => r.employee_id === selectedRecord.employee_id) ?? null,
                  override: payslipEdits.get(selectedRecord.employee_id) ?? null,
                  context: payslipContext(selectedRecord.employee_id),
                  onSaved: () => setRunVersion((v) => v + 1),
                }
              : undefined
          }
          onClose={() => setSelectedRecord(null)}
          onPrevious={
            currentRecordIndex !== null && currentRecordIndex > 0
              ? () => handleNavigatePayslip("prev")
              : undefined
          }
          onNext={
            currentRecordIndex !== null &&
              currentRecordIndex < finalFilteredRecords.length - 1
              ? () => handleNavigatePayslip("next")
              : undefined
          }
          companyInfo={companyInfo}
        />
      )}

      {IN_APP_PAYMENTS && selectedEmployeeForMpesa && (
        <MpesaSinglePaymentModal
          isOpen={showSingleMpesaModal}
          onClose={() => setShowSingleMpesaModal(false)}
          employee={selectedEmployeeForMpesa}
          onConfirm={handleConfirmSinglePayment}
          userRole={userRole}
        />
      )}

      <MpesaBulkPaymentModal
        isOpen={IN_APP_PAYMENTS && showBulkMpesaModal}
        onClose={() => setShowBulkMpesaModal(false)}
        employees={finalFilteredRecords}
        onConfirm={handleConfirmBulkPayment}
        userRole={userRole}
      />

      <PaymentDetailsModal
        payment={selectedPaymentForDetails}
        isOpen={IN_APP_PAYMENTS && showPaymentDetails}
        onClose={() => setShowPaymentDetails(false)}
        onApprove={() => handleSingleApprove(selectedPaymentForDetails)}
        onReject={() => {
          setPaymentToReject(selectedPaymentForDetails);
          setShowRejectionModal(true);
          setShowPaymentDetails(false);
        }}
        userRole={userRole}
      />

      <RejectionModal
        isOpen={showRejectionModal}
        onClose={() => setShowRejectionModal(false)}
        onConfirm={(reason) => {
          rejectPayment(paymentToReject, reason);
          setPaymentToReject(null);
        }}
      />

      {/* NEW: Comment Modal */}
      <CommentModal
        isOpen={showCommentModal}
        onClose={() => setShowCommentModal(false)}
        title={commentModalConfig.title}
        submitText={commentModalConfig.submitText}
        onSubmit={commentModalConfig.onSubmit ?? (() => { })}
      />

      {/* NEW: Clear Queue Confirmation Modal */}
      {showClearQueueModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Clear Payment Queue
            </h3>

            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <div className="flex items-start gap-2 text-red-800">
                <AlertTriangle className="w-4 h-4 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">
                    Warning: This action cannot be undone
                  </p>
                  <p className="text-xs mt-1">
                    You are about to clear {pendingCount} pending payments from
                    the queue. This will permanently delete all pending payment
                    requests.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowClearQueueModal(false)}
                className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
                disabled={isLoadingRequests}
              >
                Cancel
              </button>
              <button
                onClick={clearPaymentQueue}
                className="px-4 py-2 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 flex items-center gap-2"
                disabled={isLoadingRequests}
              >
                <Trash2 className="w-4 h-4" />
                {isLoadingRequests ? "Clearing..." : "Clear Queue"}
              </button>
            </div>
          </div>
        </div>
      )}

      <P9FormGenerator
        isOpen={showP9Modal}
        onClose={() => setShowP9Modal(false)}
        // the P9 is Kenya's tax card
        records={payrollRecords.filter((r: any) => payslipCountry(r) === "Kenya").map((r: any) => localPayslip(r))}
        companyInfo={companyInfo}
      />

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        records={finalFilteredRecords}
        periodLabel={periodLabel}
        companyName={companyInfo?.company_name}
      />


      {demoPayEnabled && (
        <DemoPayAllDialog
          open={showDemoPayAll}
          onClose={() => setShowDemoPayAll(false)}
          periodLabel={periodLabel}
          lines={demoLines.filter((l) => !demoPaidNow.has(l.employeeNumber))}
          onPaid={markDemoPaid}
          onFixDetails={() => setShowMissingDetails(true)}
        />
      )}

      {showMissingDetails && (
        <MissingPayrollDetailsModal
          employees={employees}
          onClose={() => setShowMissingDetails(false)}
          onChanged={() => setDetailsVersion((v) => v + 1)}
          draftNotice={
            monthRun?.status === "draft"
              ? `Payroll for ${periodLabel} is a draft: press Recalculate to put the new details on its payslips.`
              : monthRun
                ? `Payroll for ${periodLabel} is ${monthRun.status}: its payslips keep the details they were approved with.`
                : null
          }
        />
      )}

      {showStatutorySettings && (
        <StatutoryRatesModal
          country={showStatutorySettings}
          payPeriod={actualPeriod}
          onClose={() => setShowStatutorySettings(null)}
          onChanged={() => {
            void reloadRates();
            setRatesVersion((v) => v + 1);
          }}
        />
      )}

      {/* NEW: Render Bulk Upload Modal */}
      {showBulkUploadModal && (
        <BulkSalaryHistoryUpload
          onClose={() => setShowBulkUploadModal(false)}
          onSuccess={() => {
            handleRefresh();
          }}
        />
      )}
    </div>
  );
}
