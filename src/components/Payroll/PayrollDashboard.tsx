import React, { useState, useEffect, useMemo } from "react";
import EmployeePicker from '../UI/EmployeePicker';
import {
  DollarSign,
  Calculator,
  FileText,
  Download,
  Calendar,
  TrendingUp,
  Trash2,
  Upload,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowRight,
  Search,
  Smartphone,
  TabletSmartphone,
  Send,
  FileSpreadsheet,
  Loader,
  CheckCircle,
  XCircle,
  X,
  Clock,
  Users,
  Eye,
  Settings,
  AlertTriangle,
  MessageSquare,
  MapPin,
  Briefcase,
  CreditCard,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import "jspdf-autotable";
import html2pdf from "html2pdf.js";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import SearchableDropdown from "../UI/SearchableDropdown";
import { Card, SearchInput } from "../UI";
import MPesaSpreadsheetFullPage from "./MpesaSpreadSheet";
import useStatutorySettings from "../../hooks/useStatutorySettings";
import StatutorySettingsModal from "./statutorySettingsModule";
import type { SalaryHistoryRecord } from "../../lib/salaryHistory";
import {
  type PayrollRun,
  type PayrollRunStatus,
  discardDraftRun,
  getPayrollRun,
  getRunPayslips,
  runErrorMessage,
  saveDraftRun,
  setRunStatus,
} from "../../lib/payrollRuns";
import PayrollRunBar from "./PayrollRunBar";
import VoluntaryDeductionsModal from "./VoluntaryDeductionsModal";
import MissingPayrollDetailsModal from "./MissingPayrollDetailsModal";
import RunPaymentsPanel from "./RunPaymentsPanel";
import { employeesMissingDetails } from "../../lib/missingPayrollDetails";
import { isPaidByMpesa, paymentMethodLabel } from "../../lib/paymentMethods";
import { fetchAll } from "../../lib/fetchAll";
import { deductionsForPeriod, loadDeductionSetup, payslipDeductionLines, totalOf } from "../../lib/voluntaryDeductions";
import BulkSalaryHistoryUpload from "./BulkSalaryHistoryUpload";

// SMS Service Configuration for SMS Leopard
const SMS_LEOPARD_CONFIG = {
  baseUrl: "https://api.smsleopard.com/v1",
  username: import.meta.env.VITE_SMS_LEOPARD_USERNAME || '',
  password: import.meta.env.VITE_SMS_LEOPARD_PASSWORD || '',
  source: "sms_Leopard",
};

// Utility function to add query parameters
const addQueryParams = (url: string, params: Record<string, string | number | boolean | (string | number | boolean)[]>) => {
  const queryString = Object.entries(params)
    .flatMap(([key, value]) =>
      Array.isArray(value)
        ? value.map(
          (val) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`,
        )
        : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");

  return `${url}?${queryString}`;
};

// SMS Service Functions for SMS Leopard
const sendSMSLeopard = async (phoneNumber: string, message: string) => {
  try {
    const formattedPhone = formatPhoneNumber(phoneNumber);

    if (!formattedPhone || !message) {
      throw new Error("Phone number and message are required");
    }

    const endpoint = addQueryParams(`${SMS_LEOPARD_CONFIG.baseUrl}/sms/send`, {
      username: SMS_LEOPARD_CONFIG.username,
      password: SMS_LEOPARD_CONFIG.password,
      message: message,
      destination: formattedPhone,
      source: SMS_LEOPARD_CONFIG.source,
    });

    const credentials = btoa(
      `${SMS_LEOPARD_CONFIG.username}:${SMS_LEOPARD_CONFIG.password}`,
    );

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SMS service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (result.status === "success" || response.ok) {
      return {
        success: true,
        message: "SMS sent successfully",
        timestamp: new Date().toISOString(),
        rawResponse: result,
      };
    } else {
      throw new Error(result.message || "Failed to send SMS");
    }
  } catch (error) {
    console.error("SMS sending error:", error);

    console.log("SMS would have been sent:", {
      to: formatPhoneNumber(phoneNumber),
      message: message,
      provider: "SMS Leopard",
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      fallback: true,
      message: "SMS queued for retry",
    };
  }
};

const checkSMSBalance = async () => {
  try {
    const endpoint = `${SMS_LEOPARD_CONFIG.baseUrl}/balance`;
    const credentials = btoa(
      `${SMS_LEOPARD_CONFIG.username}:${SMS_LEOPARD_CONFIG.password}`,
    );

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to check balance: ${response.status}`);
    }

    const result = await response.json();

    if (result.balance !== undefined) {
      return `KSh ${result.balance}`;
    } else if (result.data && result.data.balance !== undefined) {
      return `KSh ${result.data.balance}`;
    } else {
      return "Balance information not available";
    }
  } catch (error) {
    console.error("SMS balance check error:", error);
    return "Service unavailable";
  }
};

// Enhanced phone number formatting for SMS Leopard
const formatPhoneNumber = (phone: string | number | null | undefined): string => {
  if (!phone) return "";

  let cleaned = String(phone).replace(/\D/g, "");

  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.substring(1);
  } else if (cleaned.startsWith("7")) {
    cleaned = "254" + cleaned;
  } else if (cleaned.startsWith("+254")) {
    cleaned = cleaned.substring(1);
  }

  if (cleaned.length === 12 && cleaned.startsWith("254")) {
    return cleaned;
  }

  console.warn("Invalid phone number format:", phone, "cleaned:", cleaned);
  return cleaned;
};

// Enhanced SMS sending with retry logic
const sendSMSWithRetry = async (phoneNumber: string, message: string, maxRetries = 3) => {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`SMS attempt ${attempt} for ${phoneNumber}`);
      const result = await sendSMSLeopard(phoneNumber, message);

      if (result.success) {
        console.log(`SMS sent successfully on attempt ${attempt}`);
        return result;
      }

      lastError = new Error(result.message || "SMS sending failed");
    } catch (error) {
      lastError = error;
      console.warn(`SMS attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        const delay = 1000 * attempt;
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`All ${maxRetries} SMS attempts failed for ${phoneNumber}`);
  throw lastError;
};

// SMS Templates
const smsTemplates = {
  payslipNotification: (employeeName: string, netPay: number, payPeriod: string) =>
    `Dear ${employeeName}, your payslip for ${payPeriod} is ready. Net Pay: KSh ${netPay.toLocaleString()}. Login to view details.`,

  paymentConfirmation: (employeeName: string, amount: number) =>
    `Dear ${employeeName}, payment of KSh ${amount.toLocaleString()} has been processed successfully via M-PESA. Thank you.`,

  paymentFailed: (employeeName: string) =>
    `Dear ${employeeName}, we encountered an issue processing your payment. Please contact HR for assistance.`,

  mpesaSuccess: (employeeName: string, amount: number, reference: string) =>
    `Dear ${employeeName}, KSh ${amount.toLocaleString()} has been sent to your M-PESA account. Reference: ${reference}.`,

  mpesaFailed: (employeeName: string, reference: string) =>
    `Dear ${employeeName}, M-PESA payment failed for reference ${reference}. Please contact HR.`,
};

// Comment Modal Component
const CommentModal = ({
  isOpen,
  onClose,
  onSubmit,
  title = "Add Comment",
  submitText = "Submit",
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (comment: string) => void;
  title?: string;
  submitText?: string;
}) => {
  const [comment, setComment] = useState("");

  const handleSubmit = () => {
    if (comment.trim()) {
      onSubmit(comment);
      setComment("");
      onClose();
    } else {
      toast.error("Please enter a comment");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-blue-600" />
          {title}
        </h3>

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-700 mb-2">
            Comment <span className="text-red-500">*</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Enter your comment here..."
            rows={4}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            This comment will be recorded in the audit trail.
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            {submitText}
          </button>
        </div>
      </div>
    </div>
  );
};

// Maker-Checker Status Badge Component
const StatusBadge = ({ status }: { status: string }) => {
  const statusConfig = {
    pending: {
      bg: "bg-yellow-100",
      text: "text-yellow-800",
      icon: Clock,
      label: "Pending Approval",
    },
    approved: {
      bg: "bg-green-100",
      text: "text-green-800",
      icon: CheckCircle,
      label: "Approved",
    },
    rejected: {
      bg: "bg-red-100",
      text: "text-red-800",
      icon: XCircle,
      label: "Rejected",
    },
    processing: {
      bg: "bg-blue-100",
      text: "text-blue-800",
      icon: Loader,
      label: "Processing",
    },
    completed: {
      bg: "bg-emerald-100",
      text: "text-emerald-800",
      icon: CheckCircle,
      label: "Completed",
    },
    failed: {
      bg: "bg-red-100",
      text: "text-red-800",
      icon: XCircle,
      label: "Failed",
    },
  };

  const config =
    statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${config.bg} ${config.text}`}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
};

// Pending Payment Card Component
const PendingPaymentCard = ({
  payment,
  onApprove,
  onReject,
  onViewDetails,
  userRole,
  isSelected,
  onSelect,
}: {
  payment: any;
  onApprove: (payment: any) => void;
  onReject: (payment: any) => void;
  onViewDetails: (payment: any) => void;
  userRole: string;
  isSelected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
}) => {
  const isChecker =
    userRole === "checker" || userRole === "credit_analyst_officer";
  const totalAmount =
    payment.type === "bulk"
      ? payment.employees_data?.reduce(
        (sum: number, emp: any) => sum + (emp.net_pay || 0),
        0,
      ) || 0
      : payment.employee_data?.net_pay || 0;

  return (
    <div
      className={`bg-white rounded-lg border ${isSelected ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-200"} p-4 hover:shadow-md transition-shadow`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {onSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                onSelect(payment.id, e.target.checked);
              }}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
          )}
          <div className="p-2 bg-orange-100 rounded-lg">
            {payment.type === "bulk" ? (
              <Users className="w-5 h-5 text-orange-600" />
            ) : (
              <Smartphone className="w-5 h-5 text-orange-600" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">
              {payment.type === "bulk"
                ? `Bulk Payment (${payment.employees_data?.length || 0} employees)`
                : `Payment to ${payment.employee_data?.employee_name || "Unknown"}`}
            </h3>
            <p className="text-xs text-gray-600">
              Initiated by {payment.created_by_email} •{" "}
              {new Date(payment.created_at).toLocaleString()}
            </p>
          </div>
        </div>
        <StatusBadge status={payment.status} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-600">Total Amount</p>
          <p className="font-bold text-lg text-primary">
            KSh {totalAmount.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Payment Method</p>
          <p className="font-medium">M-Pesa B2C</p>
        </div>
      </div>

      {payment.type === "bulk" && payment.employees_data && (
        <div className="mb-4">
          <p className="text-xs text-gray-600 mb-2">Employees:</p>
          <div className="max-h-20 overflow-y-auto text-xs">
            {payment.employees_data.slice(0, 3).map((emp: any, index: number) => (
              <div key={index} className="flex justify-between py-1">
                <span>{emp.employee_name}</span>
                <span>KSh {emp.net_pay?.toLocaleString()}</span>
              </div>
            ))}
            {payment.employees_data.length > 3 && (
              <p className="text-gray-500 text-xs mt-1">
                +{payment.employees_data.length - 3} more employees
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onViewDetails(payment)}
          className="flex-1 px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 flex items-center justify-center gap-2"
        >
          <Eye className="w-4 h-4" />
          View Details
        </button>

        {isChecker && payment.status === "pending" && (
          <>
            <button
              onClick={() => onApprove(payment)}
              className="flex-1 px-3 py-2 text-xs font-medium text-white bg-primary rounded-md hover:bg-primary/90 flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              Approve
            </button>
            <button
              onClick={() => onReject(payment)}
              className="flex-1 px-3 py-2 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 flex items-center justify-center gap-2"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// Payment Details Modal Component
const PaymentDetailsModal = ({
  payment,
  isOpen,
  onClose,
  onApprove,
  onReject,
  userRole,
}: {
  payment: any;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (payment: any) => void;
  onReject: (payment: any) => void;
  userRole: string;
}) => {
  if (!isOpen || !payment) return null;

  const isChecker =
    userRole === "checker" || userRole === "credit_analyst_officer";
  const totalAmount =
    payment.type === "bulk"
      ? payment.employees_data?.reduce(
        (sum: number, emp: any) => sum + (emp.net_pay || 0),
        0,
      ) || 0
      : payment.employee_data?.net_pay || 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">
            Payment Request Details
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6">
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-600">Payment Type</p>
                <p className="font-semibold">
                  {payment.type === "bulk" ? "Bulk Payment" : "Single Payment"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Total Amount</p>
                <p className="font-semibold text-primary">
                  KSh {totalAmount.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Status</p>
                <StatusBadge status={payment.status} />
              </div>
              <div>
                <p className="text-xs text-gray-600">Created</p>
                <p className="font-semibold">
                  {new Date(payment.created_at).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-2">Justification</h3>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-gray-700">{payment.justification}</p>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-3">Audit Trail</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span>
                  Payment request created by {payment.created_by_email}
                </span>
                <span className="text-gray-500">
                  {new Date(payment.created_at).toLocaleString()}
                </span>
              </div>
              {payment.approved_by_email && (
                <div className="flex items-center gap-3 text-xs">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span>Approved by {payment.approved_by_email}</span>
                  <span className="text-gray-500">
                    {new Date(payment.approved_at).toLocaleString()}
                  </span>
                  {payment.approval_comment && (
                    <span className="text-green-600">
                      - {payment.approval_comment}
                    </span>
                  )}
                </div>
              )}
              {payment.rejected_by_email && (
                <div className="flex items-center gap-3 text-xs">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span>Rejected by {payment.rejected_by_email}</span>
                  <span className="text-gray-500">
                    {new Date(payment.rejected_at).toLocaleString()}
                  </span>
                  {payment.rejection_reason && (
                    <span className="text-red-600">
                      - {payment.rejection_reason}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-3">
              {payment.type === "bulk"
                ? "Employees to be Paid"
                : "Employee Details"}
            </h3>

            {payment.type === "bulk" && payment.employees_data ? (
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">Employee</th>
                      <th className="px-3 py-2 text-right">Phone Number</th>
                      <th className="px-3 py-2 text-right">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payment.employees_data.map((emp: any, index: number) => (
                      <tr key={index} className="border-t">
                        <td className="px-3 py-2">
                          <div>
                            <p className="font-medium">{emp.employee_name}</p>
                            <p className="text-gray-500 text-xs">
                              {emp.employee_id}
                            </p>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {emp.employeeNu}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          KSh {emp.net_pay?.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              payment.employee_data && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-600">Employee Name</p>
                      <p className="font-medium">
                        {payment.employee_data.employee_name}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Employee ID</p>
                      <p className="font-medium">
                        {payment.employee_data.employee_id}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Phone Number</p>
                      <p className="font-medium">
                        {payment.employee_data.employeeNu}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Department</p>
                      <p className="font-medium">
                        {payment.employee_data.department}
                      </p>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>

          {isChecker && payment.status === "pending" && (
            <div className="flex gap-3 pt-4 border-t border-gray-200">
              <button
                onClick={() => onApprove(payment)}
                className="flex-1 px-4 py-3 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary/90 flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Approve Payment
              </button>
              <button
                onClick={() => onReject(payment)}
                className="flex-1 px-4 py-3 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 flex items-center justify-center gap-2"
              >
                <XCircle className="w-4 h-4" />
                Reject Payment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Rejection Modal Component
const RejectionModal = ({
  isOpen,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) => {
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    if (reason.trim()) {
      onConfirm(reason);
      setReason("");
      onClose();
    } else {
      toast.error("Please enter a reason for rejection");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <XCircle className="h-5 w-5 text-red-600" />
          Reject Payment Request
        </h3>

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-700 mb-2">
            Reason for rejection <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Please provide a reason for rejecting this payment request..."
            rows={4}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!reason.trim()}
            className="px-4 py-2 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm Rejection
          </button>
        </div>
      </div>
    </div>
  );
};

// M-PESA Single Payment Modal
const MpesaSinglePaymentModal = ({
  isOpen,
  onClose,
  employee,
  onConfirm,
  userRole = "maker",
}: {
  isOpen: boolean;
  onClose: () => void;
  employee: any;
  onConfirm: (justification: string) => Promise<void>;
  userRole?: string;
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [justification, setJustification] = useState("");

  const handlePayment = async () => {
    if (userRole === "maker" && !justification.trim()) {
      toast.error("Please provide a justification for this payment request");
      return;
    }

    setIsProcessing(true);
    try {
      await onConfirm(justification);
      onClose();
    } catch (error) {
      console.error("Payment error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-primary" />
          {userRole === "maker"
            ? "Create Payment Request"
            : "Confirm M-PESA Payment"}
        </h3>

        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <p className="text-xs text-gray-600 mb-2">
            {userRole === "maker"
              ? "You are creating a payment request for:"
              : "You are about to send an M-PESA payment to:"}
          </p>
          <div className="space-y-1">
            <p className="font-medium">{employee.employee_name}</p>
            <p className="text-xs text-gray-600">ID: {employee.employee_id}</p>
            <p className="text-xs text-gray-600">
              Phone: {employee.employeeNu || "No phone number available"}
            </p>
            <p className="text-xs text-gray-600">
              Amount: KSh {employee.net_pay?.toLocaleString()}
            </p>
          </div>
        </div>

        {userRole === "maker" && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Justification <span className="text-red-500">*</span>
            </label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Please provide a justification for this payment request..."
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </div>
        )}

        {userRole === "maker" && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
              <div className="text-xs text-yellow-800">
                <p className="font-medium">Maker-Checker Process</p>
                <p>
                  This payment will be submitted for approval before processing.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            onClick={handlePayment}
            className="px-4 py-2 text-xs font-medium text-white bg-primary rounded-md hover:bg-primary/90 flex items-center gap-2"
            disabled={
              isProcessing || (userRole === "maker" && !justification.trim())
            }
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Processing...
              </>
            ) : (
              <>
                <Send size={16} />
                {userRole === "maker" ? "Submit Request" : "Confirm Payment"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// M-PESA Bulk Payment Modal
/** The parts of a payroll record that decide whether M-Pesa may pay it. */
type PayRecipient = { employee_name?: string; payment_method?: unknown };

const MpesaBulkPaymentModal = ({
  isOpen,
  onClose,
  employees: allEmployees,
  onConfirm,
  userRole = "maker",
}: {
  isOpen: boolean;
  onClose: () => void;
  employees: any[];
  onConfirm: (selectedEmployees: any[], justification: string) => Promise<void>;
  userRole?: string;
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [justification, setJustification] = useState("");

  // M-Pesa can only pay staff paid by M-Pesa: bank, cash and Airtel staff are left out of the list
  const payable = useMemo(() => allEmployees.filter(isPaidByMpesa), [allEmployees]);
  const notPayable = useMemo(() => {
    const counts = new Map<string, number>();
    allEmployees
      .filter((emp) => !isPaidByMpesa(emp))
      .forEach((emp) => {
        const method = paymentMethodLabel(emp.payment_method);
        counts.set(method, (counts.get(method) ?? 0) + 1);
      });
    return [...counts.entries()];
  }, [allEmployees]);
  const employees = payable;

  useEffect(() => {
    const initialSelected = {};
    employees.forEach((emp) => {
      (initialSelected as Record<string, boolean>)[emp.employee_id] = true;
    });
    setSelectedStaff(initialSelected);
  }, [employees]);

  const filteredEmployees = employees.filter(
    (emp) =>
      emp.employee_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.employee_id.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const calculateTotalAmount = () => {
    return employees.reduce((total: number, emp: any) => {
      if (selectedStaff[emp.employee_id]) {
        return total + (emp.net_pay || 0);
      }
      return total;
    }, 0);
  };

  const getSelectedStaffCount = () => {
    return Object.values(selectedStaff).filter((selected) => selected).length;
  };

  const toggleStaffSelection = (id: string) => {
    setSelectedStaff((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const selectAllStaff = () => {
    const newSelection: Record<string, boolean> = {};
    employees.forEach((emp: any) => {
      newSelection[emp.employee_id] = true;
    });
    setSelectedStaff(newSelection);
  };

  const deselectAllStaff = () => {
    setSelectedStaff({});
  };

  const handleBulkPayment = async () => {
    if (userRole === "maker" && !justification.trim()) {
      toast.error(
        "Please provide a justification for this bulk payment request",
      );
      return;
    }

    setIsProcessing(true);
    try {
      const selectedEmployees = employees.filter(
        (emp) => selectedStaff[emp.employee_id],
      );
      await onConfirm(selectedEmployees, justification);
      onClose();
    } catch (error) {
      console.error("Bulk payment error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          {userRole === "maker"
            ? "Create Bulk Payment Request"
            : "Confirm M-PESA Bulk Payment"}
        </h3>

        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <p className="text-xs text-gray-600">
            {userRole === "maker"
              ? `You are creating a bulk payment request for ${getSelectedStaffCount()} selected staff members.`
              : `You are about to process M-PESA B2C payments for ${getSelectedStaffCount()} selected staff members.`}
          </p>

          {notPayable.length > 0 && (
            <p className="mt-2 text-xs text-gray-600">
              Not included (not paid by M-Pesa):{" "}
              {notPayable.map(([method, count]) => `${count} ${method}`).join(", ")}.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={selectAllStaff}
              className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
            >
              Select All
            </button>
            <button
              onClick={deselectAllStaff}
              className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
            >
              Deselect All
            </button>
          </div>

          <div className="mt-3 border-t pt-3">
            <div className="flex justify-between text-xs">
              <span className="font-medium">Total Amount:</span>
              <span className="font-bold text-primary">
                KSh {calculateTotalAmount().toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {userRole === "maker" && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Justification <span className="text-red-500">*</span>
            </label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Please provide a justification for this bulk payment request..."
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </div>
        )}

        {userRole === "maker" && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
              <div className="text-xs text-yellow-800">
                <p className="font-medium">Maker-Checker Process</p>
                <p>
                  This bulk payment will be submitted for approval before
                  processing.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mb-4 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search employees..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-300 rounded-md text-xs w-full focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>

        <div className="mb-4 max-h-60 overflow-y-auto">
          <p className="text-xs font-medium mb-2">Staff to be paid:</p>
          <ul className="text-xs divide-y divide-gray-200">
            {filteredEmployees.map((emp: any) => (
              <li
                key={emp.employee_id}
                className="py-2 flex items-center justify-between"
              >
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedStaff[emp.employee_id] || false}
                    onChange={() => toggleStaffSelection(emp.employee_id)}
                    className="mr-2 h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded"
                  />
                  <div>
                    <div
                      className={
                        selectedStaff[emp.employee_id]
                          ? "font-medium"
                          : "text-gray-500"
                      }
                    >
                      {emp.employee_name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {emp.employeeNu || "No phone number"} • {emp.employee_id}
                    </div>
                  </div>
                </div>
                <span
                  className={
                    selectedStaff[emp.employee_id]
                      ? "font-medium"
                      : "text-gray-500"
                  }
                >
                  KSh {emp.net_pay?.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            onClick={handleBulkPayment}
            className="px-4 py-2 text-xs font-medium text-white bg-primary rounded-md hover:bg-primary/90 flex items-center gap-2"
            disabled={
              isProcessing ||
              getSelectedStaffCount() === 0 ||
              (userRole === "maker" && !justification.trim())
            }
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Processing...
              </>
            ) : (
              <>
                <Send size={16} />
                {userRole === "maker"
                  ? `Submit Request (${getSelectedStaffCount()})`
                  : `Confirm M-Pesa Payment (${getSelectedStaffCount()})`}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// P9 Form Generator Component
const P9FormGenerator = ({
  isOpen,
  onClose,
  records,
  companyInfo,
}: {
  isOpen: boolean;
  onClose: () => void;
  records: any[];
  companyInfo: any;
}) => {
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [taxYear, setTaxYear] = useState(new Date().getFullYear().toString());
  const [isGenerating, setIsGenerating] = useState(false);

  const generateP9Form = async (employeeData: any) => {
    setIsGenerating(true);
    try {
      const employeeRecords = records.filter(
        (r: any) => r.employee_id === employeeData.employee_id,
      );

      const annualTotals = {
        basicSalary:
          employeeRecords.reduce((sum: number, r: any) => sum + r.basic_salary, 0) * 12,
        benefits:
          employeeRecords.reduce(
            (sum: number, r: any) =>
              sum +
              r.house_allowance +
              r.transport_allowance +
              r.medical_allowance +
              r.other_allowances,
            0,
          ) * 12,
        grossPay: employeeRecords.reduce((sum: number, r: any) => sum + r.gross_pay, 0) * 12,
        paye: employeeRecords.reduce((sum: number, r: any) => sum + r.paye_tax, 0) * 12,
        nhif:
          employeeRecords.reduce((sum: number, r: any) => sum + r.nhif_deduction, 0) * 12,
        nssf:
          employeeRecords.reduce((sum: number, r: any) => sum + r.nssf_deduction, 0) * 12,
        housingLevy:
          employeeRecords.reduce((sum: number, r: any) => sum + r.housing_levy, 0) * 12,
        netPay: employeeRecords.reduce((sum: number, r: any) => sum + r.net_pay, 0) * 12,
      };

      const p9Content = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>P9 Form - ${employeeData.employee_name} - ${taxYear}</title>
          <style>
            body { font-family: 'Avenir Next', sans-serif; margin: 20px; font-size: 12px; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 20px; }
            .company-logo { max-height: 60px; margin-bottom: 10px; }
            .form-title { font-size: 18px; font-weight: bold; margin: 20px 0; }
            .section { margin-bottom: 25px; }
            .section-title { background-color: #f0f0f0; padding: 8px; font-weight: bold; border: 1px solid #000; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { border: 1px solid #000; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; font-weight: bold; }
            .number { text-align: right; }
            .total-row { background-color: #e8f4f8; font-weight: bold; }
            .signature-section { margin-top: 50px; display: flex; justify-content: space-between; }
            .signature-box { width: 200px; text-align: center; }
            .signature-line { border-top: 2px solid #000; margin-top: 40px; padding-top: 5px; }
            .form-info { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
            .info-box { padding: 10px; border: 1px solid #ccc; background-color: #f9f9f9; }
          </style>
        </head>
        <body>
          <div class="header">
            ${companyInfo?.image_url ? `<img src="${companyInfo.image_url}" alt="Company Logo" class="company-logo">` : ""}
            <h1>${companyInfo?.company_name || "Company Name"}</h1>
            <p>${companyInfo?.company_tagline || ""}</p>
            <div class="form-title">INCOME TAX DEDUCTION CARD - P9A</div>
            <div>Year: ${taxYear}</div>
          </div>

          <div class="form-info">
            <div class="info-box">
              Employer Details:<br>
              Name: ${companyInfo?.company_name || "Company Name"}<br>
              PIN: _________________<br>
              Employer Code: _________
            </div>
            <div class="info-box">
              Employee Details:<br>
              Name: ${employeeData.employee_name}<br>
              PIN: _________________<br>
              Employee No: ${employeeData.employee_id}<br>
              Department: ${employeeData.department}
            </div>
          </div>

          <div class="section">
            <div class="section-title">MONTHLY BREAKDOWN</div>
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Basic Salary</th>
                  <th>Benefits</th>
                  <th>Gross Pay</th>
                  <th>PAYE</th>
                  <th>SHIF</th>
                  <th>NSSF</th>
                  <th>Housing Levy</th>
                  <th>Net Pay</th>
                </tr>
              </thead>
              <tbody>
                ${Array.from({ length: 12 }, (_, i) => {
        const monthNames = [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ];
        const monthData = employeeRecords[0] || employeeData;
        return `
                    <tr>
                      <td>${monthNames[i]}</td>
                      <td class="number">${monthData.basic_salary.toLocaleString()}</td>
                      <td class="number">${(monthData.house_allowance + monthData.transport_allowance + monthData.medical_allowance).toLocaleString()}</td>
                      <td class="number">${monthData.gross_pay.toLocaleString()}</td>
                      <td class="number">${Math.round(monthData.paye_tax).toLocaleString()}</td>
                      <td class="number">${monthData.nhif_deduction.toLocaleString()}</td>
                      <td class="number">${monthData.nssf_deduction.toLocaleString()}</td>
                      <td class="number">${monthData.housing_levy.toLocaleString()}</td>
                      <td class="number">${Math.round(monthData.net_pay).toLocaleString()}</td>
                    </tr>
                  `;
      }).join("")}
                <tr class="total-row">
                  <td>TOTAL</td>
                  <td class="number">${annualTotals.basicSalary.toLocaleString()}</td>
                  <td class="number">${annualTotals.benefits.toLocaleString()}</td>
                  <td class="number">${annualTotals.grossPay.toLocaleString()}</td>
                  <td class="number">${Math.round(annualTotals.paye).toLocaleString()}</td>
                  <td class="number">${annualTotals.nhif.toLocaleString()}</td>
                  <td class="number">${annualTotals.nssf.toLocaleString()}</td>
                  <td class="number">${annualTotals.housingLevy.toLocaleString()}</td>
                  <td class="number">${Math.round(annualTotals.netPay).toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="section">
            <div class="section-title">ANNUAL SUMMARY</div>
            <table style="width: 60%;">
              <tr>
                <td>Total Gross Pay</td>
                <td class="number" style="font-weight:500;">KSh ${annualTotals.grossPay.toLocaleString()}</td>
              </tr>
              <tr>
                <td>Total PAYE Tax</td>
                <td class="number">KSh ${Math.round(annualTotals.paye).toLocaleString()}</td>
              </tr>
              <tr>
                <td>Total SHIF</td>
                <td class="number">KSh ${annualTotals.nhif.toLocaleString()}</td>
              </tr>
              <tr>
                <td>Total NSSF</td>
                <td class="number">KSh ${annualTotals.nssf.toLocaleString()}</td>
              </tr>
              <tr>
                <td>Total Housing Levy</td>
                <td class="number">KSh ${annualTotals.housingLevy.toLocaleString()}</td>
              </tr>
            </table>
          </div>

          <div class="signature-section">
            <div class="signature-box">
              <div class="signature-line">Employee Signature</div>
              <div>Date: _______________</div>
            </div>
            <div class="signature-box">
              <div class="signature-line">Employer Signature</div>
              <div>Date: _______________</div>
            </div>
          </div>

          <div style="text-align: center; margin-top: 30px; font-size: 10px; color: #666;">
            Generated on ${new Date().toLocaleDateString()} by ${companyInfo?.company_name || "Payroll System"}
          </div>
        </body>
        </html>
      `;

      const opt = {
        margin: 0.5,
        filename: `P9_${employeeData.employee_id}_${taxYear}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
      };

      html2pdf().from(p9Content).set(opt).save();
      toast.success("P9 Form generated successfully!");
    } catch (error: any) {
      toast.error(`P10 form generation failed: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-600" />
          Generate P9 Forms
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Tax Year
            </label>
            <SearchableDropdown
              options={["2024", "2023", "2022"]}
              value={taxYear}
              onChange={setTaxYear}
              placeholder="Select Year"
              icon={Calendar}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Select Employee
            </label>
            <EmployeePicker
              value={selectedEmployee}
              allowedNumbers={records.map((r) => r.employee_id)}
              placeholder="Select Employee"
              onChange={(emp) => setSelectedEmployee(emp?.employeeNumber ?? "")}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isGenerating}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const employee = records.find(
                (r: any) => r.employee_id === selectedEmployee,
              );
              if (employee) generateP9Form(employee);
            }}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 flex items-center gap-2"
            disabled={!selectedEmployee || isGenerating}
          >
            {isGenerating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Generating...
              </>
            ) : (
              <>
                <FileText size={16} />
                Generate P9
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Export Modal Component
const ExportModal = ({
  isOpen,
  onClose,
  records,
}: {
  isOpen: boolean;
  onClose: () => void;
  records: any[];
}) => {
  const [exportFormat, setExportFormat] = useState("excel");
  const [isExporting, setIsExporting] = useState(false);

  const exportToExcel = () => {
    setIsExporting(true);
    try {
      const ws = XLSX.utils.json_to_sheet(
        records.map((record: any) => ({
          "Employee ID": record.employee_id,
          "Employee Name": record.employee_name,
          Department: record.department,
          Position: record.position,
          "Basic Salary": record.basic_salary,
          "House Allowance": record.house_allowance,
          "Transport Allowance": record.transport_allowance,
          "Medical Allowance": record.medical_allowance,
          "Overtime Hours": record.overtime_hours,
          "Overtime Pay": record.overtime_hours * record.overtime_rate,
          "Gross Pay": record.gross_pay,
          "PAYE Tax": Math.round(record.paye_tax),
          NHIF: record.nhif_deduction,
          NSSF: record.nssf_deduction,
          "Housing Levy": record.housing_levy,
          "Total Deductions": record.total_deductions,
          "Net Pay": Math.round(record.net_pay),
          "Pay Period": record.pay_period,
        })),
      );

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Payroll");

      const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const data = new Blob([excelBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      saveAs(data, `payroll_${new Date().toISOString().slice(0, 10)}.xlsx`);

      toast.success("Excel file exported successfully!");
    } catch {
      toast.error("Failed to export Excel file");
    } finally {
      setIsExporting(false);
    }
  };

  const exportToCSV = () => {
    setIsExporting(true);
    try {
      const ws = XLSX.utils.json_to_sheet(
        records.map((record: any) => ({
          "Employee ID": record.employee_id,
          "Employee Name": record.employee_name,
          Department: record.department,
          Position: record.position,
          "Basic Salary": record.basic_salary,
          "House Allowance": record.house_allowance,
          "Transport Allowance": record.transport_allowance,
          "Medical Allowance": record.medical_allowance,
          "Overtime Hours": record.overtime_hours,
          "Overtime Pay": record.overtime_hours * record.overtime_rate,
          "Gross Pay": record.gross_pay,
          "PAYE Tax": Math.round(record.paye_tax),
          NHIF: record.nhif_deduction,
          NSSF: record.nssf_deduction,
          "Housing Levy": record.housing_levy,
          "Total Deductions": record.total_deductions,
          "Net Pay": Math.round(record.net_pay),
          "Pay Period": record.pay_period,
        })),
      );

      const csv = XLSX.utils.sheet_to_csv(ws);
      const data = new Blob([csv], { type: "text/csv" });
      saveAs(data, `payroll_${new Date().toISOString().slice(0, 10)}.csv`);

      toast.success("CSV file exported successfully!");
    } catch {
      toast.error("Failed to export CSV file");
    } finally {
      setIsExporting(false);
    }
  };

  const exportToPDF = () => {
    setIsExporting(true);
    try {
      const doc = new jsPDF();

      doc.setFontSize(16);
      doc.text("Payroll Report", 14, 22);
      doc.setFontSize(12);
      doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 32);

      const tableData = records.map((record: any) => [
        record.employee_id,
        record.employee_name,
        record.department,
        `KSh ${record.gross_pay.toLocaleString()}`,
        `KSh ${Math.round(record.paye_tax).toLocaleString()}`,
        `KSh ${record.total_deductions.toLocaleString()}`,
        `KSh ${Math.round(record.net_pay).toLocaleString()}`,
      ]);

      (doc as any).autoTable({
        head: [
          [
            "ID",
            "Name",
            "Department",
            "Gross Pay",
            "PAYE",
            "Total Deductions",
            "Net Pay",
          ],
        ],
        body: tableData,
        startY: 40,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [34, 197, 94] },
      });

      doc.save(`payroll_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success("PDF file exported successfully!");
    } catch {
      toast.error("Failed to export PDF file");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = () => {
    switch (exportFormat) {
      case "excel":
        exportToExcel();
        break;
      case "csv":
        exportToCSV();
        break;
      case "pdf":
        exportToPDF();
        break;
      default:
        break;
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          Export Payroll Data
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Export Format
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  value="excel"
                  checked={exportFormat === "excel"}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="mr-2"
                />
                <FileSpreadsheet className="w-5 h-5 mr-2 text-green-600" />
                Excel
              </label>
              <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  value="csv"
                  checked={exportFormat === "csv"}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="mr-2"
                />
                <FileText className="w-5 h-5 mr-2 text-blue-600" />
                CSV
              </label>
              <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  value="pdf"
                  checked={exportFormat === "pdf"}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="mr-2"
                />
                <FileText className="w-5 h-5 mr-2 text-red-600" />
                PDF
              </label>
            </div>
          </div>

          <div className="text-xs text-gray-600">
            <p>Exporting {records.length} payroll records</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isExporting}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 text-xs font-medium text-white bg-primary rounded-md hover:bg-primary/90 flex items-center gap-2"
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Exporting...
              </>
            ) : (
              <>
                <Download size={16} />
                Export {exportFormat.toUpperCase()}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const GlowButtonss = ({
  children,
  variant = "primary",
  icon: Icon,
  size = "md",
  onClick,
  disabled = false,
  className,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  icon?: any;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) => {
  const baseClasses =
    "inline-flex items-center gap-2 rounded-lg font-medium transition-all duration-300 border";
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-xs",
    lg: "px-6 py-3 text-base",
  };
  const variantClasses = {
    primary:
      "bg-primary/10 border-primary text-primary hover:bg-primary/20 hover:border-primary hover:text-primary transition-all duration-300",
    secondary:
      "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all duration-300",
    danger:
      "bg-red-50 border-red-500 text-red-600 hover:bg-red-100 hover:border-red-600 hover:text-red-700 transition-all duration-300",
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className || ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
};

const PayslipModal = ({
  record,
  onClose,
  onPrevious,
  onNext,
  companyInfo,
}: {
  record: any;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  companyInfo: any;
}) => {

  const handleDownloadPDF = () => {
    const element = document.getElementById("payslip-content");
    const opt = {
      margin: 0.5,
      filename: `payslip_${record.employee_id}_${record.pay_period}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
    };

    html2pdf().from(element!).set(opt).save();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-6xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white p-4 border-b border-gray-200 flex justify-between items-center z-10">
          <h2 className="text-xl font-semibold text-gray-900">
            Modern Payslip
          </h2>
          <div className="flex gap-2">
            <GlowButtonss
              variant="secondary"
              icon={Download}
              size="sm"
              onClick={handleDownloadPDF}
            >
              Download PDF
            </GlowButtonss>
            <GlowButtonss variant="danger" icon={X} size="sm" onClick={onClose}>
              Close
            </GlowButtonss>
          </div>
        </div>

        <div className="p-2 bg-gray-50 payslip-container print:p-0 print:w-[210mm] print:h-[297mm]">
          <div
            id="payslip-content"
            className="bg-white border text-black border-gray-300 text-xs leading-tight mx-auto"
            style={{ maxWidth: '800px', boxShadow: '0 4px 15px rgba(0, 0, 0, 0.05)', fontFamily: 'Calibri, Helvetica, sans-serif' }}
          >
            <div className="bg-white text-black p-6 flex justify-between items-end border-b-[3px] border-double border-gray-300">
              <div className="flex items-center">
                {companyInfo?.image_url && (
                  <img
                    src={companyInfo.image_url}
                    alt="Company Logo"
                    className="h-16 w-16 mr-4 object-contain"
                  />
                )}
                <div>
                  <h1 className="text-2xl font-bold uppercase text-gray-900">
                    {companyInfo?.company_name || "Your Company Name"}
                  </h1>
                  <div className="text-gray-600 text-sm font-semibold mt-1">
                    {companyInfo?.company_tagline || "Excellence in service"}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-3xl font-bold uppercase text-gray-900 mb-1">PAYSLIP</h2>
                <div className="text-gray-600 font-semibold text-sm">
                  {(() => {
                    const now = new Date();
                    const fallbackPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
                    const periodToUse = record.pay_period || record["Pay Period"] || fallbackPeriod;
                    const [year, month] = String(periodToUse).split('-').map(Number);
                    let prevMonth = month - 1;
                    let prevYear = year;
                    if (prevMonth === 0) { prevMonth = 12; prevYear = year - 1; }
                    return new Date(prevYear, prevMonth - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
                  })()}
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div className="border border-gray-300 p-4">
                  <h3 className="font-bold border-b border-gray-300 pb-2 mb-3 text-gray-900 text-sm">
                    Employee information
                  </h3>
                  <div className="space-y-1.5 text-black">
                    <div className="flex justify-between">
                      <span className="font-semibold text-gray-600">Full name:</span>
                      <span className="font-bold text-right">{record.employee_name || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold text-gray-600">Employee no:</span>
                      <span className="font-bold text-right">{record.employee_id || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold text-gray-600">Position:</span>
                      <span className="font-bold text-right">{record.department || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold text-gray-600">Dept:</span>
                      <span className="font-bold text-right">Operations</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold text-gray-600">Region:</span>
                      <span className="font-bold text-right">{record.branch || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="border border-gray-300 p-4">
                  <h3 className="font-bold border-b border-gray-300 pb-2 mb-3 text-gray-900 text-sm">
                    Payment details
                  </h3>
                  <div className="space-y-1.5 text-black">
                    <div className="flex justify-between">
                      <span className="font-semibold text-gray-600">Method:</span>
                      <span className="font-bold text-right">{record.payment_method || 'M-Pesa'}</span>
                    </div>
                    {record.payment_method === "Bank Transfer" && (
                      <>
                        <div className="flex justify-between">
                          <span className="font-semibold text-gray-600">Bank:</span>
                          <span className="font-bold text-right">{record.bank_name || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold text-gray-600">Account:</span>
                          <span className="font-bold text-right">{record.account_number || 'N/A'}</span>
                        </div>
                      </>
                    )}
                    {record.payment_method === "M-Pesa" && (
                      <div className="flex justify-between">
                        <span className="font-semibold text-gray-600">M-Pesa no:</span>
                        <span className="font-bold text-right">{record.employeeNu || 'N/A'}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="font-semibold text-gray-600">Job group:</span>
                      <span className="font-bold text-right">{record.jobGroup || 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-6">
                <div className="border border-gray-300">
                  <div className="bg-gray-100 border-b border-gray-300 font-bold p-3 text-gray-900">Earnings</div>
                  <div className="p-3 space-y-2 text-black">
                    <div className="flex justify-between">
                      <span>Basic</span>
                      <span className="font-semibold">KSh {(record.basic_salary || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>House</span>
                      <span className="font-semibold">KSh {(record.house_allowance || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Transport</span>
                      <span className="font-semibold">KSh {(record.transport_allowance || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Medical</span>
                      <span className="font-semibold">KSh {(record.medical_allowance || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Other</span>
                      <span className="font-semibold">KSh {(record.other_allowances || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Overtime</span>
                      <span className="font-semibold">
                        KSh {((record.overtime_hours || 0) * (record.overtime_rate || 0)).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Commission</span>
                      <span className="font-semibold">KSh {(record.commission || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Bonus</span>
                      <span className="font-semibold">KSh {(record.bonus || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between bg-gray-50 p-1 border border-gray-200 mt-2">
                      <span>Per diem</span>
                      <span className="font-bold">KSh {(record.per_diem || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="border border-gray-300">
                  <div className="bg-gray-100 border-b border-gray-300 font-bold p-3 text-gray-900">Deductions</div>
                  <div className="p-3 space-y-2 text-black">
                    <div className="flex justify-between">
                      <span>PAYE</span>
                      <span className="font-semibold">KSh {Math.round(record.paye_tax || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>SHIF / NHIF</span>
                      <span className="font-semibold">KSh {(record.nhif_deduction || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>NSSF</span>
                      <span className="font-semibold">KSh {(record.nssf_deduction || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>AHL</span>
                      <span className="font-semibold">KSh {(record.housing_levy || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Advance</span>
                      <span className="font-semibold">KSh {(record.advance_deduction || 0).toLocaleString()}</span>
                    </div>
                    {payslipDeductionLines(record).map((line, i) => (
                      <div key={`${line.name}-${i}`} className="flex justify-between">
                        <span>{line.name}</span>
                        <span className="font-semibold">KSh {line.amount.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-gray-600 mt-2 border-t border-gray-200 pt-1">
                      <span>Tax relief:</span>
                      <span className="font-semibold">KSh -2400</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border border-gray-300 p-4 mb-8 bg-gray-50">
                <div className="flex justify-between border-b border-gray-300 pb-2 mb-2 text-sm text-black">
                  <span className="font-bold">Gross pay</span>
                  <span className="font-bold">KSh {(record.gross_pay || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-b border-gray-300 pb-2 mb-3 text-sm text-black">
                  <span className="font-bold">Total deductions</span>
                  <span className="font-bold">KSh {(record.total_deductions || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-lg text-black mt-2">
                  <span className="font-bold">Net pay</span>
                  <span className="font-bold border-b-[3px] border-gray-400 border-double pb-0.5">KSh {Math.round(record.net_pay || 0).toLocaleString()}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8 mb-4 text-center text-xs">
                <div className="p-2 pt-8">
                  <div className="border-t border-gray-300 pt-2 font-bold text-gray-800">
                    Employee signature
                  </div>
                  <div className="text-gray-500 mt-1">Date: ________________________</div>
                </div>
                <div className="p-2 pt-8">
                  <div className="border-t border-gray-300 pt-2 font-bold text-gray-800">
                    Authorized signatory
                  </div>
                  <div className="text-gray-500 mt-1">Date: ________________________</div>
                </div>
              </div>

              <div className="text-center text-gray-500 text-xs border-t border-gray-300 pt-4 mt-6">
                Generated on {new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date().toLocaleTimeString()} &bull; {companyInfo?.company_name || 'Company'} &bull; Strictly confidential
              </div>
            </div>
          </div>
        </div>

        {(!!onPrevious || !!onNext) && (
          <div className="sticky bottom-0 bg-white p-4 border-t border-gray-200 flex justify-between">
            {onPrevious && (
              <GlowButtonss icon={ArrowLeft} onClick={onPrevious}>
                Previous
              </GlowButtonss>
            )}
            {onNext && (
              <GlowButtonss
                icon={ArrowRight}
                onClick={onNext}
                className="ml-auto"
              >
                Next
              </GlowButtonss>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Pagination Component
const Pagination = ({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  itemsPerPage,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems: number;
  itemsPerPage: number;
  currentItemsCount: number;
}) => {
  const pages = [];
  const maxVisiblePages = 5;

  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-white sm:px-6">
      <div className="flex justify-between sm:hidden">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="relative inline-flex items-center px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="relative inline-flex items-center px-4 py-2 ml-3 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-gray-700">
            Showing <span className="font-medium">{startItem}</span> to{" "}
            <span className="font-medium">{endItem}</span> of{" "}
            <span className="font-medium">{totalItems}</span> results
          </p>
        </div>
        <div>
          <nav
            className="isolate inline-flex -space-x-px rounded-md shadow-sm"
            aria-label="Pagination"
          >
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="relative inline-flex items-center px-2 py-2 text-gray-400 rounded-l-md ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Previous</span>
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </button>

            {pages.map((page) => (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={`relative inline-flex items-center px-4 py-2 text-xs font-semibold ${currentPage === page
                  ? "z-10 bg-primary text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  : "text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-offset-0"
                  }`}
              >
                {page}
              </button>
            ))}

            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="relative inline-flex items-center px-2 py-2 text-gray-400 rounded-r-md ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Next</span>
              <ArrowRight className="w-5 h-5" aria-hidden="true" />
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
};

// P10 Form Generator Component
const P10FormGenerator = ({
  isOpen,
  onClose,
  calculatePAYE,
  calculateNSSF,
  calculateNHIF,
  calculateHousingLevy,
}: {
  isOpen: boolean;
  onClose: () => void;
  calculatePAYE: (grossSalary: number, hasTaxPIN: boolean) => number;
  calculateNSSF: (grossSalary: number) => number;
  calculateNHIF: (grossSalary: number) => number;
  calculateHousingLevy: (grossSalary: number, hasTaxPIN: boolean) => number;
}) => {
  const [selectedYear] = useState(
    new Date().getFullYear().toString(),
  );
  const [isLoading, setIsLoading] = useState(false);

  const generateP10Form = async () => {
    setIsLoading(true);
    try {
      // every employee, a page at a time (one request returns at most 1000)
      const { data: employees, error } = await fetchAll((from, to) => supabase.from("employees").select("*").order('"Employee Number"').order("id").range(from, to)).then(
        (data) => ({ data, error: null }),
        (error) => ({ data: null, error }),
      );

      if (error) {
        console.error("Supabase error:", error);
        toast.error("Error fetching employee data: " + error.message);
        return;
      }

      if (!employees || employees.length === 0) {
        toast.error("No employee data found in the system");
        return;
      }

      console.log("Fetched employees:", employees.length);

      const p10Data = employees.map((employee) => {
        const taxPin = employee["Tax PIN"] || employee.tax_pin || "PENDING";
        const employeeName =
          `${employee["First Name"] || ""} ${employee["Middle Name"] || ""} ${employee["Last Name"] || ""}`.trim() ||
          employee.employee_name ||
          "N/A";
        const basicSalary = parseFloat(
          employee["Basic Salary"] || employee.basic_salary || 0,
        );

        const houseAllowance = parseFloat(employee.house_allowance || 0);
        const transportAllowance = parseFloat(employee.travel_allowance || 0);
        const medicalAllowance = parseFloat(employee.medical_allowance || 0);
        const otherAllowances = parseFloat(employee.other_allowances || 0);

        const totalGrossPay =
          basicSalary +
          houseAllowance +
          transportAllowance +
          medicalAllowance +
          otherAllowances;

        const nhifNumber =
          employee["NHIF Number"] || employee["SHIF Number"] || "";
        const nssfNumber = employee["NSSF Number"] || "";

        const nhifDeduction = nhifNumber ? calculateNHIF(totalGrossPay) : 0;
        const nssfDeduction = nssfNumber ? calculateNSSF(totalGrossPay) : 0;
        const housingLevy =
          taxPin !== "PENDING" ? calculateHousingLevy(totalGrossPay, true) : 0;

        const taxablePay = totalGrossPay - nssfDeduction - housingLevy;

        const payeAmount = calculatePAYE(taxablePay, true);

        return [
          "A00000000001",
          employeeName,
          "Resident",
          "Primary Employee",
          "No",
          "",
          basicSalary,
          0,
          0,
          houseAllowance +
          transportAllowance +
          medicalAllowance +
          otherAllowances,
          "Benefit not given",
          houseAllowance,
          transportAllowance + medicalAllowance + otherAllowances,
          totalGrossPay,
          nhifDeduction,
          nssfDeduction,
          0,
          0,
          0,
          housingLevy,
          taxablePay,
          2400,
          0,
          "",
          payeAmount,
        ];
      });

      console.log("P10 data prepared for", p10Data.length, "employees");

      const headers = [
        "Employer Pin",
        "Employee Name",
        "Resident Status",
        "Service Status",
        "Disability Status",
        "Exemption Certificate Number",
        "Total Emoluments - Cash Pay",
        "Value of Car Benefit",
        "Value of Meals",
        "Non Cash Benefits",
        "Type of Housing",
        "Housing Benefit",
        "Other Benefits",
        "Total Gross Pay",
        "SHIF",
        "NSSF Contribution",
        "Other Pension Contribution",
        "Post Retirement Medical Fund",
        "Mortgage Interest",
        "Affordable Housing Levy",
        "Taxable Pay",
        "Monthly Personal Relief",
        "Amount of Insurance Relief",
        "PAYE Tax",
        "Self Assessed PAYE Tax",
      ];

      const ws = XLSX.utils.aoa_to_sheet([headers, ...p10Data]);

      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      for (let R = 0; R <= range.e.r; ++R) {
        for (let C = 0; C <= range.e.c; ++C) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[cellAddress]) continue;

          if (R === 0) {
            ws[cellAddress].s = {
              font: { bold: true },
              fill: { fgColor: { rgb: "CCCCCC" } },
            };
          }

          if (R > 0 && C >= 6 && C !== 10) {
            if (typeof ws[cellAddress].v === "number") {
              ws[cellAddress].t = "n";
              ws[cellAddress].z = "#,##0.00";
            }
          }
        }
      }

      ws["!cols"] = [
        { wch: 12 },
        { wch: 25 },
        { wch: 10 },
        { wch: 15 },
        { wch: 12 },
        { wch: 12 },
        { wch: 15 },
        { wch: 12 },
        { wch: 12 },
        { wch: 15 },
        { wch: 20 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 12 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 12 },
        { wch: 15 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "P10 EMPLOYER RETURN");

      const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const data = new Blob([excelBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      saveAs(data, `P10_Employer_Return_${selectedYear}.xlsx`);

      toast.success(
        `P10 Form generated successfully for ${p10Data.length} employees!`,
      );
      onClose();
    } catch (error) {
      console.error("Error generating P10 form:", error);
      toast.error("Failed to generate P10 form: " + (error as any).message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <img src="kra.png" className="w-5"></img>
            Generate P10 Form (Employer Return)
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={isLoading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-blue-50 p-3 rounded-md border border-blue-100">
            <div className="flex items-center gap-2 text-blue-800 mb-2">
              <Users className="w-4 h-4" />
              <span className="text-xs font-medium">
                P10 Employer Return Form
              </span>
            </div>
            <p className="text-xs text-blue-700">
              This will generate the P10 form with all employee tax information
              for KRA submission.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={generateP10Form}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 flex items-center gap-2"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download size={16} />
                Generate P10 Excel
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const PAYSLIP_AMOUNTS = [
  "basic_salary", "gross_pay", "net_pay", "total_deductions", "nssf_deduction", "nhif_deduction", "paye_tax",
  "housing_levy", "house_allowance", "transport_allowance", "medical_allowance", "other_allowances", "overtime_hours",
  "overtime_rate", "commission", "bonus", "per_diem", "tax_relief", "loan_deduction", "advance_deduction",
  "welfare_deduction", "other_deductions",
] as const;

/** A calculated payroll row as the salary_history row saved for it */
const toSalaryHistory = (record: any): SalaryHistoryRecord => ({
  ...(Object.fromEntries(PAYSLIP_AMOUNTS.map((k) => [k, Number(record[k]) || 0])) as Record<(typeof PAYSLIP_AMOUNTS)[number], number>),
  employee_id: record.employee_id,
  employee_name: record.employee_name,
  pay_period: record.pay_period,
  deduction_items: record.deduction_items ?? [],
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
  payment_method: paymentMethodLabel(saved.payment_method),
  bank_name: saved.bank_name || "",
  account_number: saved.account_number || "",
});

export default function PayrollDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState<Date | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("all");
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [currentRecordIndex, setCurrentRecordIndex] = useState<number | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [departments, setDepartments] = useState(["all"]);
  const [branches, setBranches] = useState([
    { value: "all", label: "All Branches" },
  ]);
  // this month's figures worked out from current employee details; shown until the month's payroll run is started
  const [liveRecords, setLiveRecords] = useState<any[]>([]);
  // the month's payroll run and its saved payslips (runPeriod says which month they were loaded for)
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [runPayslips, setRunPayslips] = useState<any[]>([]);
  const [runPeriod, setRunPeriod] = useState<string | null>(null);
  const [runVersion, setRunVersion] = useState(0);
  const [runBusy, setRunBusy] = useState(false);
  const [showDeductions, setShowDeductions] = useState(false);
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
  const [showP10Modal, setShowP10Modal] = useState(false);
  const [showStatutorySettings, setShowStatutorySettings] = useState(false);
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
  const [currentView, setCurrentView] = useState("dashboard");

  // Statutory override state
  const [overrideStatutoryChecks, setOverrideStatutoryChecks] = useState(true);

  const itemsPerPage = 5;

  const {
    settings,
    isLoading: settingsLoading,
    calculatePAYE,
    calculateNSSF,
    calculateNHIF,
    calculateHousingLevy,
    reloadSettings,
  } = useStatutorySettings();

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
              '"Employee Number", "Amount Requested", payment_processed, status, time_added',
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
      } catch (error: any) {
        console.warn("Failed to load salary advances:", error.message);
        setSalaryAdvances([]);
      }
    };

    fetchAllSalaryAdvances();
  }, []); // Empty dependency array = runs once when component mounts

  // Updated: Just searches in already-loaded data (NO database call)
  const calculateAdvanceDeduction = (employeeNumber: any, period: any) => {
    // console.log('=== DEBUG: Looking for advance for employee:', employeeNumber, 'Period:', period);

    if (!employeeNumber) {
      return 0;
    }

    // Find ALL advances for this employee matching the period
    const employeeAdvances = salaryAdvances.filter((adv) => {
      const advanceEmpNumber = adv["Employee Number"];
      const advanceDate = adv.time_added; // Assuming ISO string like 2024-01-26T...

      // Match Employee
      // Use loose equality to handle string/number differences
      if (advanceEmpNumber != employeeNumber) return false;

      // Match Period (YYYY-MM)
      if (period) {
        if (!advanceDate) return false; // Strict: must have a date to match period

        // Handle various date formats safely
        let advancePeriod = "";
        try {
          // Try substring first for ISO strings
          if (typeof advanceDate === "string" && advanceDate.length >= 7) {
            advancePeriod = advanceDate.substring(0, 7);
          } else {
            // Fallback for Date objects or other formats
            const d = new Date(advanceDate);
            if (!isNaN(d.getTime())) {
              advancePeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            }
          }
        } catch {
          console.warn("Error parsing advance date:", advanceDate);
          return false;
        }

        if (advancePeriod !== period) return false;
      }

      return true;
    });

    if (employeeAdvances.length === 0) {
      return 0;
    }

    // Sum matching advances
    const totalAmount = employeeAdvances.reduce((sum, adv) => {
      const amount = parseFloat(adv["Amount Requested"]) || 0;
      return sum + amount;
    }, 0);

    return totalAmount;
  };
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
        const { data, error } = await supabase
          .from("company_logo")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (error && error.code !== "PGRST116") {
          console.error("Error fetching company info:", error);
          return;
        }

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
    const results = [];
    const selectedEmployees = (requested ?? []).filter(isPaidByMpesa);
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
        const { data, error } = await fetchAll((from, to) => supabase.from("employees").select("*").order('"Employee Number"').order("id").range(from, to)).then(
          (rows) => ({ data: rows, error: null }),
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

          // Process each employee with salary advance deduction
          const payrollData = await Promise.all(
            data.map(async (employee) => {
              const basicSalary = employee["Basic Salary"] || 0;
              const employeeId = employee["Employee Number"] || "";
              const jobGroup = employee["Job Group"] || "";
              const employeeNat = employee["ID Number"] || "";
              const employeeNu = employee["Mobile Number"] || "";
              const firstName = employee["First Name"] || "";
              const middleName = employee["Middle Name"] || "";
              const branch = employee.Office || employee.branch || "";
              const lastName = employee["Last Name"] || "";
              const department =
                employee.Department || employee["Job Level"] || "";
              const position = employee["Job Title"] || "";

              const houseAllowance = employee.house_allowance || 0;
              const transportAllowance = employee.travel_allowance || 0;
              const overtimeHours = employee.overtime || 0;
              const overtimeRate = employee["Overtime Rate"] || 0;

              const nhifNumber =
                employee["NHIF Number"] || employee["SHIF Number"] || "";
              const nssfNumber = employee["NSSF Number"] || "";
              const taxPin = employee["Tax PIN"] || "";

              const medicalAllowance = employee.medical_allowance || 0;
              const otherAllowances = 0;
              const commission = 0;
              const bonus = 0;

              // Per diem is PART of basic salary (33%), not extra payment
              const perDiem = basicSalary * 0.33;

              const overtimePay = overtimeHours * overtimeRate;

              // Gross pay (basic salary already includes per diem)
              const grossPay =
                basicSalary +
                houseAllowance +
                transportAllowance +
                medicalAllowance +
                otherAllowances +
                overtimePay +
                commission +
                bonus;

              // Taxable amount EXCLUDES the per diem portion
              const taxableGross = grossPay - perDiem;

              let nhifDeduction = 0;
              let nssfDeduction = 0;
              let housingLevy = 0;

              // Apply statutory deductions based on override setting
              if (overrideStatutoryChecks || nhifNumber) {
                nhifDeduction = calculateNHIF(taxableGross);
              }

              if (overrideStatutoryChecks || nssfNumber) {
                nssfDeduction = calculateNSSF(taxableGross);
              }

              if (overrideStatutoryChecks || taxPin) {
                housingLevy = calculateHousingLevy(taxableGross, true);
              }

              // Calculate taxable income for PAYE AFTER deducting NSSF and Housing Levy
              const taxableIncomeForPAYE =
                taxableGross - nhifDeduction - nssfDeduction - housingLevy;

              let payeTax = 0;
              let taxRelief = 0;

              if (overrideStatutoryChecks || taxPin) {
                payeTax = calculatePAYE(taxableIncomeForPAYE);
                taxRelief = Math.min(payeTax, 2400);
              }

              // Calculate salary advance deduction
              // Calculate salary advance deduction
              const advanceDeduction = calculateAdvanceDeduction(
                employeeId,
                actualPeriod,
              );

              // voluntary deductions are itemised (deduction_items); loan and welfare are kept for older payslips
              const deductionItems = voluntaryByEmployee.get(employeeId) ?? [];
              const loanDeduction = 0;
              const welfareDeduction = 0;
              const otherDeductions = totalOf(deductionItems);

              // Total deductions include statutory and advance deduction
              const totalDeductions =
                payeTax +
                nhifDeduction +
                nssfDeduction +
                housingLevy +
                loanDeduction +
                advanceDeduction +
                welfareDeduction +
                otherDeductions;

              const netPay = grossPay - totalDeductions;

              return {
                id: employee.id || "",
                employee_id: employeeId,
                employeeNat: employeeNat,
                employeeNu: employeeNu,
                jobGroup: jobGroup,
                employee_name: `${firstName} ${middleName} ${lastName}`.trim(),
                branch: branch,
                department: department,
                position: position,
                basic_salary: basicSalary,
                house_allowance: houseAllowance,
                transport_allowance: transportAllowance,
                medical_allowance: medicalAllowance,
                other_allowances: otherAllowances,
                overtime_hours: overtimeHours,
                overtime_rate: overtimeRate,
                commission: commission,
                bonus: bonus,
                per_diem: perDiem,
                gross_pay: grossPay,
                paye_tax: payeTax,
                nhif_deduction: nhifDeduction,
                nssf_deduction: nssfDeduction,
                housing_levy: housingLevy,
                tax_relief: taxRelief,
                loan_deduction: loanDeduction,
                advance_deduction: advanceDeduction,
                welfare_deduction: welfareDeduction,
                other_deductions: otherDeductions,
                deduction_items: deductionItems,
                total_deductions: totalDeductions,
                net_pay: netPay,
                pay_period: actualPeriod,
                payment_method: paymentMethodLabel(employee.payment_method),
                bank_name: employee.Bank || "",
                account_number: employee["Account Number"] || "",
              };
            }),
          );

          setLiveRecords(payrollData);
        }
      } catch (err) {
        console.error("Error:", err);
        toast.error(runErrorMessage(err, "Could not work out this month's payroll."));
      } finally {
        setIsLoading(false);
      }
    };

    if (settings) {
      // Only fetch when settings are loaded
      fetchEmployees();
    }
  }, [actualPeriod, settings, overrideStatutoryChecks, salaryAdvances, deductionsVersion, detailsVersion]);

  // the month's payroll run, reloaded after each start/recalculate/approve/...
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await getPayrollRun(actualPeriod);
        const payslips = found ? await getRunPayslips(found.id) : [];
        if (cancelled) return;
        setRun(found);
        setRunPayslips(payslips);
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

  // once the month's run is started, everything here (table, totals, exports, payslips, bulk pay) uses its saved figures
  const payrollRecords = useMemo(() => {
    if (!monthRun) return liveRecords;
    const liveByEmployee = new Map(liveRecords.map((r) => [r.employee_id, r]));
    return runPayslips.map((saved) => fromSalaryHistory(saved, liveByEmployee.get(saved.employee_id)));
  }, [monthRun, runPayslips, liveRecords]);

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

      return (
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
    const records = liveRecords.filter((r) => r.employee_id).map((r) => toSalaryHistory({ ...r, pay_period: actualPeriod }));
    setRunBusy(true);
    try {
      await saveDraftRun(actualPeriod, records);
      toast.success(
        monthRun
          ? `Recalculated ${records.length} payslips for ${periodLabel}.`
          : `Started payroll for ${periodLabel} with ${records.length} employees.`,
      );
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

  const changeRunStatus = async (status: PayrollRunStatus, question: string, done: string) => {
    if (!monthRun || !window.confirm(question)) return;
    setRunBusy(true);
    try {
      await setRunStatus(monthRun.id, status);
      toast.success(done);
      setRunVersion((v) => v + 1);
    } catch (err) {
      toast.error(runErrorMessage(err, "Could not update the payroll."));
    } finally {
      setRunBusy(false);
    }
  };

  const runNetPay = payrollRecords.reduce((sum: number, r: any) => sum + (r.net_pay || 0), 0);

  const missingDetails = useMemo(() => employeesMissingDetails(employees), [employees]);

  const handleApproveRun = () =>
    changeRunStatus(
      "approved",
      `Approve payroll for ${periodLabel}?

${payrollRecords.length} employees, net pay KSh ${Math.round(runNetPay).toLocaleString()}.
${missingDetails.length ? `
${missingDetails.length} employee(s) are missing a KRA PIN, NSSF or SHA number, or payment details (see "Missing details").
` : ""}
Payslips will be locked and staff will be able to see them.`,
      `Payroll for ${periodLabel} approved. Staff can now see their payslips.`,
    );

  const handleReopenRun = () =>
    changeRunStatus(
      "draft",
      `Reopen payroll for ${periodLabel}?

Staff won't see these payslips until it is approved again.`,
      `Payroll for ${periodLabel} reopened as a draft.`,
    );

  const handleMarkRunPaid = () =>
    changeRunStatus(
      "paid",
      `Mark payroll for ${periodLabel} as paid?

This can't be undone: the payslips stay locked for good.`,
      `Payroll for ${periodLabel} marked as paid.`,
    );

  const handleDiscardRun = async () => {
    if (!monthRun || !window.confirm(`Discard the draft payroll for ${periodLabel}? Its saved payslips are deleted.`)) return;
    setRunBusy(true);
    try {
      await discardDraftRun(monthRun.id);
      toast.success(`Draft payroll for ${periodLabel} discarded.`);
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
        setEmployees(data);
      }

      toast.success("Dashboard refreshed successfully!");
    } catch (error) {
      console.error("Error refreshing:", error);
      toast.error("Failed to refresh data");
    } finally {
      setIsLoading(false);
    }
  };

  if (currentView === "mpesa-spreadsheet") {
    return (
      <MPesaSpreadsheetFullPage
        onBack={() => setCurrentView("dashboard")}
        userRole={userRole}
      />
    );
  }

  if (isLoading || settingsLoading) {
    return (
      <div className="p-4 bg-gray-50 min-h-screen max-w-screen-2xl mx-auto flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">
            {settingsLoading
              ? "Loading statutory settings..."
              : "Loading employee data..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 bg-gray-100 min-h-screen max-w-screen-2xl mx-auto">




      {/* WALLET UI REMOVED - Commented out as requested */}

      {showApprovalQueue &&
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

      {showQuickActions && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Quick Actions
              </h3>
              <button
                onClick={() => setShowQuickActions(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <GlowButtonss
                icon={Calculator}
                size="sm"
                onClick={() => {
                  alert("Bulk Calculate initiated");
                  setShowQuickActions(false);
                }}
              >
                Bulk Calculate
              </GlowButtonss>
              <GlowButtonss
                variant="secondary"
                icon={FileText}
                size="sm"
                onClick={() => {
                  setShowP9Modal(true);
                  setShowQuickActions(false);
                }}
              >
                Generate P9A Forms
              </GlowButtonss>
              <GlowButtonss
                variant="secondary"
                icon={Download}
                size="sm"
                onClick={() => {
                  setShowExportModal(true);
                  setShowQuickActions(false);
                }}
              >
                Export Data
              </GlowButtonss>
              <GlowButtonss
                variant="secondary"
                icon={FileText}
                size="sm"
                onClick={() => {
                  alert("Batch payslip generation started");
                  setShowQuickActions(false);
                }}
              >
                Payslip Batch
              </GlowButtonss>
              <GlowButtonss
                variant="secondary"
                icon={TrendingUp}
                size="sm"
                onClick={() => {
                  alert("Tax certificates being prepared");
                  setShowQuickActions(false);
                }}
              >
                Tax Certificates
              </GlowButtonss>
              <GlowButtonss
                variant="secondary"
                icon={Calendar}
                size="sm"
                onClick={() => {
                  alert("Payment scheduling opened");
                  setShowQuickActions(false);
                }}
              >
                Schedule Payments
              </GlowButtonss>
              <GlowButtonss
                variant="secondary"
                icon={Settings}
                size="sm"
                onClick={() => {
                  setShowStatutorySettings(true);
                  setShowQuickActions(false);
                }}
              >
                Statutory Settings
              </GlowButtonss>
              {(userRole === "checker" ||
                userRole === "credit_analyst_officer") && (
                  <GlowButtonss
                    variant="secondary"
                    icon={Clock}
                    size="sm"
                    onClick={() => {
                      setShowApprovalQueue(true);
                      setShowQuickActions(false);
                    }}
                  >
                    Approval Queue ({pendingCount})
                  </GlowButtonss>
                )}
              {/* NEW: Bulk Upload History Button */}
              <GlowButtonss
                variant="secondary"
                icon={Upload}
                size="sm"
                onClick={() => {
                  setShowBulkUploadModal(true);
                  setShowQuickActions(false);
                }}
              >
                Upload History
              </GlowButtonss>
            </div>
          </div>
        </div>
      )}

      {/* ── TOOLBAR (FIG-544): pay period, statutory override, reports, bulk pay ── */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <DatePicker
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

        <button
          type="button"
          role="switch"
          aria-checked={overrideStatutoryChecks}
          onClick={toggleStatutoryOverride}
          className={`flex items-center gap-2 px-3 py-2 rounded-tile text-[11.5px] font-bold border transition-colors ${
            overrideStatutoryChecks
              ? "bg-brand text-white border-brand"
              : "bg-white text-ink border-border hover:bg-secondary"
          }`}
        >
          Statutory Override
          <span className="text-[10px] font-semibold opacity-80">{overrideStatutoryChecks ? "On" : "Off"}</span>
        </button>

        <button
          type="button"
          onClick={() => setShowP9Modal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-tile border border-border bg-white text-[11.5px] font-semibold text-ink hover:bg-secondary transition-colors"
        >
          <FileText className="w-3 h-3" strokeWidth={2} />
          P9
        </button>
        <button
          type="button"
          onClick={() => setShowP10Modal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-tile border border-border bg-white text-[11.5px] font-semibold text-ink hover:bg-secondary transition-colors"
        >
          <FileText className="w-3 h-3" strokeWidth={2} />
          P10
        </button>
        <button
          type="button"
          onClick={() => setShowExportModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-tile border border-border bg-white text-[11.5px] font-semibold text-ink hover:bg-secondary transition-colors"
        >
          <Download className="w-3 h-3" strokeWidth={2} />
          Export
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleBulkMpesaPayment}
          // an approved month is paid with "Pay staff" below, which records every payment; never both
          disabled={finalFilteredRecords.length === 0 || monthRun?.status === "approved" || monthRun?.status === "paid"}
          title={
            monthRun?.status === "approved" || monthRun?.status === "paid"
              ? `Pay ${periodLabel}'s approved payroll with "Pay staff" below: it records every payment`
              : undefined
          }
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-tile bg-brand text-white text-xs font-bold hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <TabletSmartphone className="w-3.5 h-3.5" />
          {userRole === "credit_analyst_officer" ? "M-PESA Bulk Pay" : "Make Bulk Pay"}
        </button>
      </div>

      <PayrollRunBar
        periodLabel={periodLabel}
        run={monthRun}
        loading={runLoading}
        busy={runBusy}
        onStart={handleSaveRun}
        onRecalculate={handleSaveRun}
        onApprove={handleApproveRun}
        onReopen={handleReopenRun}
        onMarkPaid={handleMarkRunPaid}
        onDiscard={handleDiscardRun}
      />

      {monthRun && (monthRun.status === "approved" || monthRun.status === "paid") && <RunPaymentsPanel run={monthRun} />}

      {/* Filters, search and the less-used payroll tools */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-36">
          <SearchableDropdown
            options={branches}
            value={selectedBranch}
            onChange={setSelectedBranch}
            placeholder="Select Branch"
            icon={MapPin}
          />
        </div>
        <div className="w-40">
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
        <div className="w-36">
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
        <div className="w-64">
          <SearchInput
            placeholder="Search by name or employee ID"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="!bg-white !border-border"
          />
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setCurrentView("mpesa-spreadsheet")}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-tile border border-border bg-white text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-ink transition-colors"
        >
          <FileSpreadsheet className="w-3 h-3" />
          M-PESA Spreadsheet
        </button>
        <button
          type="button"
          onClick={() => setShowDeductions(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-tile border border-border bg-white text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-ink transition-colors"
        >
          <Users className="w-3 h-3" />
          Deductions
        </button>
        <button
          type="button"
          onClick={() => setShowMissingDetails(true)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-tile border text-[11px] font-semibold transition-colors ${
            missingDetails.length
              ? "border-orange-text-alt/40 bg-orange-tint-alt text-orange-text-alt hover:brightness-95"
              : "border-border bg-white text-muted-foreground hover:bg-secondary hover:text-ink"
          }`}
        >
          <AlertTriangle className="w-3 h-3" />
          Missing details{missingDetails.length ? ` (${missingDetails.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setShowStatutorySettings(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-tile border border-border bg-white text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-ink transition-colors"
        >
          <Settings className="w-3 h-3" />
          Statutory Settings
        </button>
        <button
          type="button"
          onClick={() => setShowBulkUploadModal(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-tile border border-border bg-white text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-ink transition-colors"
        >
          <Upload className="w-3 h-3" />
          Upload History
        </button>
        {(userRole === "checker" || userRole === "credit_analyst_officer") && (
          <button
            type="button"
            onClick={() => setShowApprovalQueue(true)}
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
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 mb-4">
          {[
            { label: "Employees", value: String(finalFilteredRecords.length), color: "text-ink" },
            { label: "Gross pay", value: `KSh ${totalGrossPay.toLocaleString()}`, color: "text-ink" },
            { label: "Net pay", value: `KSh ${totalNetPay.toLocaleString()}`, color: "text-brand-dark" },
            { label: "Deductions", value: `KSh ${totalDeductions.toLocaleString()}`, color: "text-status-danger" },
            { label: "PAYE", value: `KSh ${totalPAYE.toLocaleString()}`, color: "text-orange-text" },
            { label: "SHIF", value: `KSh ${totalNHIF.toLocaleString()}`, color: "text-status-purple" },
            { label: "NSSF", value: `KSh ${totalNSSF.toLocaleString()}`, color: "text-status-info" },
            { label: "Housing levy", value: `KSh ${totalHousingLevy.toLocaleString()}`, color: "text-orange-text-alt" },
          ].map((tile) => (
            <Card key={tile.label} padding="sm" className="!rounded-xl">
              <div className="text-[9.5px] font-bold uppercase text-subtle">{tile.label}</div>
              <div className={`text-[14.5px] font-bold mt-0.5 truncate ${tile.color}`}>{tile.value}</div>
            </Card>
          ))}
        </div>

        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
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
                            <button
                              type="button"
                              onClick={() => handleSingleMpesaPayment(record)}
                              className="px-2.5 py-1 rounded-[7px] bg-green-tint text-brand-dark text-[10.5px] font-bold hover:bg-[#d3e6d9] transition-colors"
                            >
                              {userRole === "credit_analyst_officer" ? "M-Pesa" : "Pay"}
                            </button>
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
          </div>
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

      {selectedRecord && (
        <PayslipModal
          record={selectedRecord}
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

      {selectedEmployeeForMpesa && (
        <MpesaSinglePaymentModal
          isOpen={showSingleMpesaModal}
          onClose={() => setShowSingleMpesaModal(false)}
          employee={selectedEmployeeForMpesa}
          onConfirm={handleConfirmSinglePayment}
          userRole={userRole}
        />
      )}

      <MpesaBulkPaymentModal
        isOpen={showBulkMpesaModal}
        onClose={() => setShowBulkMpesaModal(false)}
        employees={finalFilteredRecords}
        onConfirm={handleConfirmBulkPayment}
        userRole={userRole}
      />

      <PaymentDetailsModal
        payment={selectedPaymentForDetails}
        isOpen={showPaymentDetails}
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
        records={payrollRecords}
        companyInfo={companyInfo}
      />

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        records={finalFilteredRecords}
      />

      {showP10Modal && (
        <P10FormGenerator
          isOpen={showP10Modal}
          onClose={() => setShowP10Modal(false)}
          calculatePAYE={calculatePAYE}
          calculateNSSF={calculateNSSF}
          calculateNHIF={calculateNHIF}
          calculateHousingLevy={calculateHousingLevy}
        />
      )}

      {showDeductions && (
        <VoluntaryDeductionsModal
          onClose={() => setShowDeductions(false)}
          onChanged={() => setDeductionsVersion((v) => v + 1)}
          draftNotice={
            monthRun?.status === "draft"
              ? `Payroll for ${periodLabel} is a draft: press Recalculate to apply deduction changes to it.`
              : monthRun
                ? `Payroll for ${periodLabel} is ${monthRun.status}, so changes apply from the next month you run.`
                : null
          }
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

      <StatutorySettingsModal
        isOpen={showStatutorySettings}
        onClose={() => setShowStatutorySettings(false)}
        reloadSettings={reloadSettings}
      />

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
