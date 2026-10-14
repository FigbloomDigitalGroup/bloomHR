import { useState, useEffect, useMemo } from "react";
import { Search, Smartphone, Send, Loader, CheckCircle, XCircle, X, Clock, Users, Eye, AlertTriangle, MessageSquare } from "lucide-react";
import toast from "react-hot-toast";
import { TableScroll } from "../UI";
import { isPaidByMpesa, paymentMethodLabel } from "../../lib/paymentMethods";

// The in-app payment requests (maker-checker approval, M-Pesa single and bulk pay), moved from PayrollDashboard.
// Only reachable while in-app paying is on (lib/inAppPayments).

// Comment Modal Component
export const CommentModal = ({
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
export const StatusBadge = ({ status }: { status: string }) => {
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
export const PendingPaymentCard = ({
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
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
export const PaymentDetailsModal = ({
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
                <TableScroll>
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
                </TableScroll>
              </div>
            ) : (
              payment.employee_data && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
export const RejectionModal = ({
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
export const MpesaSinglePaymentModal = ({
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
export type PayRecipient = { employee_name?: string; payment_method?: unknown };

export const MpesaBulkPaymentModal = ({
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
