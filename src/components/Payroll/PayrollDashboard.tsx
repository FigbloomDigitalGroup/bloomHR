import React, { useState, useEffect } from 'react';
import { DollarSign, Calculator, FileText, Download, Calendar, TrendingUp, Plus, Edit, Trash2, Users, Upload, X, ChevronDown, ChevronUp, Printer, Share2, ArrowLeft, ArrowRight, Search, Filter, Smartphone, TabletSmartphone, Send, FileSpreadsheet, FileImage, Loader, Box, CircleDot, Tally1, Clock, CheckCircle, XCircle, Eye, AlertTriangle, Settings, RefreshCw, Info, ToggleLeft, ToggleRight, MessageSquare, MapPin, Briefcase, CreditCard } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import html2pdf from 'html2pdf.js';
import GlowButton from '../UI/GlowButton';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import RoleButtonWrapper from '../ProtectedRoutes/RoleButton';
import SearchableDropdown from '../UI/SearchableDropdown';
import MPesaSpreadsheetFullPage from './MpesaSpreadSheet';
import useStatutorySettings from '../../hooks/useStatutorySettings';
import StatutorySettingsModal from './statutorySettingsModule';

// SMS Service Configuration for SMS Leopard
const SMS_LEOPARD_CONFIG = {
  baseUrl: 'https://api.smsleopard.com/v1',
  username: 'yxFXqkhbsdbm2cCeXOju',
  password: '***REMOVED***',
  source: 'sms_Leopard'
};

// Utility function to add query parameters
const addQueryParams = (url, params) => {
  const queryString = Object.entries(params)
    .flatMap(([key, value]) =>
      Array.isArray(value)
        ? value.map(val => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
        : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&');

  return `${url}?${queryString}`;
};

// SMS Service Functions for SMS Leopard
const sendSMSLeopard = async (phoneNumber, message) => {
  try {
    const formattedPhone = formatPhoneNumber(phoneNumber);

    if (!formattedPhone || !message) {
      throw new Error('Phone number and message are required');
    }

    const endpoint = addQueryParams(`${SMS_LEOPARD_CONFIG.baseUrl}/sms/send`, {
      username: SMS_LEOPARD_CONFIG.username,
      password: SMS_LEOPARD_CONFIG.password,
      message: message,
      destination: formattedPhone,
      source: SMS_LEOPARD_CONFIG.source
    });

    const credentials = btoa(`${SMS_LEOPARD_CONFIG.username}:${SMS_LEOPARD_CONFIG.password}`);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SMS service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (result.status === 'success' || response.ok) {
      return {
        success: true,
        message: 'SMS sent successfully',
        timestamp: new Date().toISOString(),
        rawResponse: result
      };
    } else {
      throw new Error(result.message || 'Failed to send SMS');
    }

  } catch (error) {
    console.error('SMS sending error:', error);

    console.log('SMS would have been sent:', {
      to: formatPhoneNumber(phoneNumber),
      message: message,
      provider: 'SMS Leopard'
    });

    return {
      success: false,
      error: error.message,
      fallback: true,
      message: 'SMS queued for retry'
    };
  }
};

const checkSMSBalance = async () => {
  try {
    const endpoint = `${SMS_LEOPARD_CONFIG.baseUrl}/balance`;
    const credentials = btoa(`${SMS_LEOPARD_CONFIG.username}:${SMS_LEOPARD_CONFIG.password}`);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
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
      return 'Balance information not available';
    }

  } catch (error) {
    console.error('SMS balance check error:', error);
    return 'Service unavailable';
  }
};

// Enhanced phone number formatting for SMS Leopard
const formatPhoneNumber = (phone) => {
  if (!phone) return '';

  let cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('7')) {
    cleaned = '254' + cleaned;
  } else if (cleaned.startsWith('+254')) {
    cleaned = cleaned.substring(1);
  }

  if (cleaned.length === 12 && cleaned.startsWith('254')) {
    return cleaned;
  }

  console.warn('Invalid phone number format:', phone, 'cleaned:', cleaned);
  return cleaned;
};

// Enhanced SMS sending with retry logic
const sendSMSWithRetry = async (phoneNumber, message, maxRetries = 3) => {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`SMS attempt ${attempt} for ${phoneNumber}`);
      const result = await sendSMSLeopard(phoneNumber, message);

      if (result.success) {
        console.log(`SMS sent successfully on attempt ${attempt}`);
        return result;
      }

      lastError = new Error(result.message || 'SMS sending failed');
    } catch (error) {
      lastError = error;
      console.warn(`SMS attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        const delay = 1000 * attempt;
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`All ${maxRetries} SMS attempts failed for ${phoneNumber}`);
  throw lastError;
};

// SMS Templates
const smsTemplates = {
  payslipNotification: (employeeName, netPay, payPeriod) =>
    `Dear ${employeeName}, your payslip for ${payPeriod} is ready. Net Pay: KSh ${netPay.toLocaleString()}. Login to view details.`,

  paymentConfirmation: (employeeName, amount) =>
    `Dear ${employeeName}, payment of KSh ${amount.toLocaleString()} has been processed successfully via M-PESA. Thank you.`,

  paymentFailed: (employeeName) =>
    `Dear ${employeeName}, we encountered an issue processing your payment. Please contact HR for assistance.`,

  mpesaSuccess: (employeeName, amount, reference) =>
    `Dear ${employeeName}, KSh ${amount.toLocaleString()} has been sent to your M-PESA account. Reference: ${reference}.`,

  mpesaFailed: (employeeName, reference) =>
    `Dear ${employeeName}, M-PESA payment failed for reference ${reference}. Please contact HR.`
};

// Comment Modal Component
const CommentModal = ({
  isOpen,
  onClose,
  onSubmit,
  title = "Add Comment",
  submitText = "Submit"
}) => {
  const [comment, setComment] = useState('');

  const handleSubmit = () => {
    if (comment.trim()) {
      onSubmit(comment);
      setComment('');
      onClose();
    } else {
      toast.error('Please enter a comment');
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
          <p className="text-xs text-gray-500 mt-1">This comment will be recorded in the audit trail.</p>
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
const StatusBadge = ({ status }) => {
  const statusConfig = {
    pending: {
      bg: 'bg-yellow-100',
      text: 'text-yellow-800',
      icon: Clock,
      label: 'Pending Approval'
    },
    approved: {
      bg: 'bg-green-100',
      text: 'text-green-800',
      icon: CheckCircle,
      label: 'Approved'
    },
    rejected: {
      bg: 'bg-red-100',
      text: 'text-red-800',
      icon: XCircle,
      label: 'Rejected'
    },
    processing: {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      icon: Loader,
      label: 'Processing'
    },
    completed: {
      bg: 'bg-emerald-100',
      text: 'text-emerald-800',
      icon: CheckCircle,
      label: 'Completed'
    },
    failed: {
      bg: 'bg-red-100',
      text: 'text-red-800',
      icon: XCircle,
      label: 'Failed'
    }
  };

  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${config.bg} ${config.text}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
};

// Pending Payment Card Component
const PendingPaymentCard = ({ payment, onApprove, onReject, onViewDetails, userRole, isSelected, onSelect }) => {
  const isChecker = userRole === 'checker' || userRole === 'credit_analyst_officer';
  const totalAmount = payment.type === 'bulk'
    ? payment.employees_data?.reduce((sum, emp) => sum + (emp.net_pay || 0), 0) || 0
    : payment.employee_data?.net_pay || 0;

  return (
    <div className={`bg-white rounded-lg border ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'} p-4 hover:shadow-md transition-shadow`}>
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
            {payment.type === 'bulk' ? (
              <Users className="w-5 h-5 text-orange-600" />
            ) : (
              <Smartphone className="w-5 h-5 text-orange-600" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">
              {payment.type === 'bulk'
                ? `Bulk Payment (${payment.employees_data?.length || 0} employees)`
                : `Payment to ${payment.employee_data?.employee_name || 'Unknown'}`
              }
            </h3>
            <p className="text-xs text-gray-600">
              Initiated by {payment.created_by_email} • {new Date(payment.created_at).toLocaleString()}
            </p>
          </div>
        </div>
        <StatusBadge status={payment.status} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-600">Total Amount</p>
          <p className="font-bold text-lg text-green-600">KSh {totalAmount.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Payment Method</p>
          <p className="font-medium">M-Pesa B2C</p>
        </div>
      </div>

      {payment.type === 'bulk' && payment.employees_data && (
        <div className="mb-4">
          <p className="text-xs text-gray-600 mb-2">Employees:</p>
          <div className="max-h-20 overflow-y-auto text-xs">
            {payment.employees_data.slice(0, 3).map((emp, index) => (
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

        {isChecker && payment.status === 'pending' && (
          <>
            <button
              onClick={() => onApprove(payment)}
              className="flex-1 px-3 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 flex items-center justify-center gap-2"
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
const PaymentDetailsModal = ({ payment, isOpen, onClose, onApprove, onReject, userRole }) => {
  if (!isOpen || !payment) return null;

  const isChecker = userRole === 'checker' || userRole === 'credit_analyst_officer';
  const totalAmount = payment.type === 'bulk'
    ? payment.employees_data?.reduce((sum, emp) => sum + (emp.net_pay || 0), 0) || 0
    : payment.employee_data?.net_pay || 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">Payment Request Details</h2>
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
                <p className="font-semibold">{payment.type === 'bulk' ? 'Bulk Payment' : 'Single Payment'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Total Amount</p>
                <p className="font-semibold text-green-600">KSh {totalAmount.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Status</p>
                <StatusBadge status={payment.status} />
              </div>
              <div>
                <p className="text-xs text-gray-600">Created</p>
                <p className="font-semibold">{new Date(payment.created_at).toLocaleString()}</p>
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
                <span>Payment request created by {payment.created_by_email}</span>
                <span className="text-gray-500">{new Date(payment.created_at).toLocaleString()}</span>
              </div>
              {payment.approved_by_email && (
                <div className="flex items-center gap-3 text-xs">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span>Approved by {payment.approved_by_email}</span>
                  <span className="text-gray-500">{new Date(payment.approved_at).toLocaleString()}</span>
                  {payment.approval_comment && (
                    <span className="text-green-600">- {payment.approval_comment}</span>
                  )}
                </div>
              )}
              {payment.rejected_by_email && (
                <div className="flex items-center gap-3 text-xs">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span>Rejected by {payment.rejected_by_email}</span>
                  <span className="text-gray-500">{new Date(payment.rejected_at).toLocaleString()}</span>
                  {payment.rejection_reason && (
                    <span className="text-red-600">- {payment.rejection_reason}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-3">
              {payment.type === 'bulk' ? 'Employees to be Paid' : 'Employee Details'}
            </h3>

            {payment.type === 'bulk' && payment.employees_data ? (
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
                    {payment.employees_data.map((emp, index) => (
                      <tr key={index} className="border-t">
                        <td className="px-3 py-2">
                          <div>
                            <p className="font-medium">{emp.employee_name}</p>
                            <p className="text-gray-500 text-xs">{emp.employee_id}</p>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">{emp.employeeNu}</td>
                        <td className="px-3 py-2 text-right font-medium">KSh {emp.net_pay?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : payment.employee_data && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-600">Employee Name</p>
                    <p className="font-medium">{payment.employee_data.employee_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Employee ID</p>
                    <p className="font-medium">{payment.employee_data.employee_id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Phone Number</p>
                    <p className="font-medium">{payment.employee_data.employeeNu}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Department</p>
                    <p className="font-medium">{payment.employee_data.department}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {isChecker && payment.status === 'pending' && (
            <div className="flex gap-3 pt-4 border-t border-gray-200">
              <button
                onClick={() => onApprove(payment)}
                className="flex-1 px-4 py-3 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center justify-center gap-2"
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
const RejectionModal = ({ isOpen, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');

  const handleConfirm = () => {
    if (reason.trim()) {
      onConfirm(reason);
      setReason('');
      onClose();
    } else {
      toast.error('Please enter a reason for rejection');
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
  userRole = 'maker'
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [justification, setJustification] = useState('');

  const handlePayment = async () => {
    if (userRole === 'maker' && !justification.trim()) {
      toast.error('Please provide a justification for this payment request');
      return;
    }

    setIsProcessing(true);
    try {
      await onConfirm(justification);
      onClose();
    } catch (error) {
      console.error('Payment error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-green-600" />
          {userRole === 'maker' ? 'Create Payment Request' : 'Confirm M-PESA Payment'}
        </h3>

        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <p className="text-xs text-gray-600 mb-2">
            {userRole === 'maker'
              ? 'You are creating a payment request for:'
              : 'You are about to send an M-PESA payment to:'
            }
          </p>
          <div className="space-y-1">
            <p className="font-medium">{employee.employee_name}</p>
            <p className="text-xs text-gray-600">ID: {employee.employee_id}</p>
            <p className="text-xs text-gray-600">
              Phone: {employee.employeeNu || 'No phone number available'}
            </p>
            <p className="text-xs text-gray-600">
              Amount: KSh {employee.net_pay?.toLocaleString()}
            </p>
          </div>
        </div>

        {userRole === 'maker' && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Justification <span className="text-red-500">*</span>
            </label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Please provide a justification for this payment request..."
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
            />
          </div>
        )}

        {userRole === 'maker' && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
              <div className="text-xs text-yellow-800">
                <p className="font-medium">Maker-Checker Process</p>
                <p>This payment will be submitted for approval before processing.</p>
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
            className="px-4 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 flex items-center gap-2"
            disabled={isProcessing || (userRole === 'maker' && !justification.trim())}
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Processing...
              </>
            ) : (
              <>
                <Send size={16} />
                {userRole === 'maker' ? 'Submit Request' : 'Confirm Payment'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// M-PESA Bulk Payment Modal
const MpesaBulkPaymentModal = ({
  isOpen,
  onClose,
  employees,
  onConfirm,
  userRole = 'maker'
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [justification, setJustification] = useState('');

  useEffect(() => {
    const initialSelected = {};
    employees.forEach(emp => {
      initialSelected[emp.employee_id] = true;
    });
    setSelectedStaff(initialSelected);
  }, [employees]);

  const filteredEmployees = employees.filter(emp =>
    emp.employee_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.employee_id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const calculateTotalAmount = () => {
    return employees.reduce((total, emp) => {
      if (selectedStaff[emp.employee_id]) {
        return total + (emp.net_pay || 0);
      }
      return total;
    }, 0);
  };

  const getSelectedStaffCount = () => {
    return Object.values(selectedStaff).filter(selected => selected).length;
  };

  const toggleStaffSelection = (id) => {
    setSelectedStaff(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const selectAllStaff = () => {
    const newSelection = {};
    employees.forEach(emp => {
      newSelection[emp.employee_id] = true;
    });
    setSelectedStaff(newSelection);
  };

  const deselectAllStaff = () => {
    setSelectedStaff({});
  };

  const handleBulkPayment = async () => {
    if (userRole === 'maker' && !justification.trim()) {
      toast.error('Please provide a justification for this bulk payment request');
      return;
    }

    setIsProcessing(true);
    try {
      const selectedEmployees = employees.filter(emp => selectedStaff[emp.employee_id]);
      await onConfirm(selectedEmployees, justification);
      onClose();
    } catch (error) {
      console.error('Bulk payment error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-green-600" />
          {userRole === 'maker' ? 'Create Bulk Payment Request' : 'Confirm M-PESA Bulk Payment'}
        </h3>

        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <p className="text-xs text-gray-600">
            {userRole === 'maker'
              ? `You are creating a bulk payment request for ${getSelectedStaffCount()} selected staff members.`
              : `You are about to process M-PESA B2C payments for ${getSelectedStaffCount()} selected staff members.`
            }
          </p>

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
              <span className="font-bold text-green-700">
                KSh {calculateTotalAmount().toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {userRole === 'maker' && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Justification <span className="text-red-500">*</span>
            </label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Please provide a justification for this bulk payment request..."
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
            />
          </div>
        )}

        {userRole === 'maker' && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
              <div className="text-xs text-yellow-800">
                <p className="font-medium">Maker-Checker Process</p>
                <p>This bulk payment will be submitted for approval before processing.</p>
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
            className="pl-10 pr-4 py-2 border border-gray-300 rounded-md text-xs w-full focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
          />
        </div>

        <div className="mb-4 max-h-60 overflow-y-auto">
          <p className="text-xs font-medium mb-2">Staff to be paid:</p>
          <ul className="text-xs divide-y divide-gray-200">
            {filteredEmployees.map(emp => (
              <li key={emp.employee_id} className="py-2 flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedStaff[emp.employee_id] || false}
                    onChange={() => toggleStaffSelection(emp.employee_id)}
                    className="mr-2 h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                  />
                  <div>
                    <div className={selectedStaff[emp.employee_id] ? "font-medium" : "text-gray-500"}>
                      {emp.employee_name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {emp.employeeNu || 'No phone number'} • {emp.employee_id}
                    </div>
                  </div>
                </div>
                <span className={selectedStaff[emp.employee_id] ? "font-medium" : "text-gray-500"}>
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
            className="px-4 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 flex items-center gap-2"
            disabled={isProcessing || getSelectedStaffCount() === 0 || (userRole === 'maker' && !justification.trim())}
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Processing...
              </>
            ) : (
              <>
                <Send size={16} />
                {userRole === 'maker'
                  ? `Submit Request (${getSelectedStaffCount()})`
                  : `Confirm M-Pesa Payment (${getSelectedStaffCount()})`
                }
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// P9 Form Generator Component
const P9FormGenerator = ({ isOpen, onClose, records, companyInfo }) => {
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [taxYear, setTaxYear] = useState(new Date().getFullYear().toString());
  const [isGenerating, setIsGenerating] = useState(false);

  const generateP9Form = async (employeeData) => {
    setIsGenerating(true);
    try {
      const employeeRecords = records.filter(r => r.employee_id === employeeData.employee_id);

      const annualTotals = {
        basicSalary: employeeRecords.reduce((sum, r) => sum + r.basic_salary, 0) * 12,
        benefits: employeeRecords.reduce((sum, r) => sum + r.house_allowance + r.transport_allowance + r.medical_allowance + r.other_allowances, 0) * 12,
        grossPay: employeeRecords.reduce((sum, r) => sum + r.gross_pay, 0) * 12,
        paye: employeeRecords.reduce((sum, r) => sum + r.paye_tax, 0) * 12,
        nhif: employeeRecords.reduce((sum, r) => sum + r.nhif_deduction, 0) * 12,
        nssf: employeeRecords.reduce((sum, r) => sum + r.nssf_deduction, 0) * 12,
        housingLevy: employeeRecords.reduce((sum, r) => sum + r.housing_levy, 0) * 12,
        netPay: employeeRecords.reduce((sum, r) => sum + r.net_pay, 0) * 12
      };

      const p9Content = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>P9 Form - ${employeeData.employee_name} - ${taxYear}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; font-size: 12px; }
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
            ${companyInfo?.image_url ? `<img src="${companyInfo.image_url}" alt="Company Logo" class="company-logo">` : ''}
            <h1>${companyInfo?.company_name || 'Company Name'}</h1>
            <p>${companyInfo?.company_tagline || ''}</p>
            <div class="form-title">INCOME TAX DEDUCTION CARD - P9A</div>
            <div>Year: ${taxYear}</div>
          </div>

          <div class="form-info">
            <div class="info-box">
              Employer Details:<br>
              Name: ${companyInfo?.company_name || 'Company Name'}<br>
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
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'];
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
      }).join('')}
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
            Generated on ${new Date().toLocaleDateString()} by ${companyInfo?.company_name || 'Payroll System'}
          </div>
        </body>
        </html>
      `;

      const opt = {
        margin: 0.5,
        filename: `P9_${employeeData.employee_id}_${taxYear}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
      };

      html2pdf().from(p9Content).set(opt).save();
      toast.success('P9 Form generated successfully!');
    } catch (error) {
      console.error('Error generating P9 form:', error);
      toast.error('Failed to generate P9 form');
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
            <label className="block text-xs font-medium text-gray-700 mb-1">Tax Year</label>
            <SearchableDropdown
              options={['2024', '2023', '2022']}
              value={taxYear}
              onChange={setTaxYear}
              placeholder="Select Year"
              icon={Calendar}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Select Employee</label>
            <SearchableDropdown
              options={records.map(r => ({
                label: `${r.employee_name} (${r.employee_id})`,
                value: r.employee_id
              }))}
              value={selectedEmployee}
              onChange={setSelectedEmployee}
              placeholder="Select Employee"
              icon={Users}
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
              const employee = records.find(r => r.employee_id === selectedEmployee);
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
const ExportModal = ({ isOpen, onClose, records }) => {
  const [exportFormat, setExportFormat] = useState('excel');
  const [isExporting, setIsExporting] = useState(false);

  const exportToExcel = () => {
    setIsExporting(true);
    try {
      const ws = XLSX.utils.json_to_sheet(records.map(record => ({
        'Employee ID': record.employee_id,
        'Employee Name': record.employee_name,
        'Department': record.department,
        'Position': record.position,
        'Basic Salary': record.basic_salary,
        'House Allowance': record.house_allowance,
        'Transport Allowance': record.transport_allowance,
        'Medical Allowance': record.medical_allowance,
        'Overtime Hours': record.overtime_hours,
        'Overtime Pay': record.overtime_hours * record.overtime_rate,
        'Gross Pay': record.gross_pay,
        'PAYE Tax': Math.round(record.paye_tax),
        'NHIF': record.nhif_deduction,
        'NSSF': record.nssf_deduction,
        'Housing Levy': record.housing_levy,
        'Total Deductions': record.total_deductions,
        'Net Pay': Math.round(record.net_pay),
        'Pay Period': record.pay_period
      })));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Payroll');

      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const data = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(data, `payroll_${new Date().toISOString().slice(0, 10)}.xlsx`);

      toast.success('Excel file exported successfully!');
    } catch (error) {
      toast.error('Failed to export Excel file');
    } finally {
      setIsExporting(false);
    }
  };

  const exportToCSV = () => {
    setIsExporting(true);
    try {
      const ws = XLSX.utils.json_to_sheet(records.map(record => ({
        'Employee ID': record.employee_id,
        'Employee Name': record.employee_name,
        'Department': record.department,
        'Position': record.position,
        'Basic Salary': record.basic_salary,
        'House Allowance': record.house_allowance,
        'Transport Allowance': record.transport_allowance,
        'Medical Allowance': record.medical_allowance,
        'Overtime Hours': record.overtime_hours,
        'Overtime Pay': record.overtime_hours * record.overtime_rate,
        'Gross Pay': record.gross_pay,
        'PAYE Tax': Math.round(record.paye_tax),
        'NHIF': record.nhif_deduction,
        'NSSF': record.nssf_deduction,
        'Housing Levy': record.housing_levy,
        'Total Deductions': record.total_deductions,
        'Net Pay': Math.round(record.net_pay),
        'Pay Period': record.pay_period
      })));

      const csv = XLSX.utils.sheet_to_csv(ws);
      const data = new Blob([csv], { type: 'text/csv' });
      saveAs(data, `payroll_${new Date().toISOString().slice(0, 10)}.csv`);

      toast.success('CSV file exported successfully!');
    } catch (error) {
      toast.error('Failed to export CSV file');
    } finally {
      setIsExporting(false);
    }
  };

  const exportToPDF = () => {
    setIsExporting(true);
    try {
      const doc = new jsPDF();

      doc.setFontSize(16);
      doc.text('Payroll Report', 14, 22);
      doc.setFontSize(12);
      doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 32);

      const tableData = records.map(record => [
        record.employee_id,
        record.employee_name,
        record.department,
        `KSh ${record.gross_pay.toLocaleString()}`,
        `KSh ${Math.round(record.paye_tax).toLocaleString()}`,
        `KSh ${record.total_deductions.toLocaleString()}`,
        `KSh ${Math.round(record.net_pay).toLocaleString()}`
      ]);

      doc.autoTable({
        head: [['ID', 'Name', 'Department', 'Gross Pay', 'PAYE', 'Total Deductions', 'Net Pay']],
        body: tableData,
        startY: 40,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [34, 197, 94] }
      });

      doc.save(`payroll_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success('PDF file exported successfully!');
    } catch (error) {
      toast.error('Failed to export PDF file');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = () => {
    switch (exportFormat) {
      case 'excel':
        exportToExcel();
        break;
      case 'csv':
        exportToCSV();
        break;
      case 'pdf':
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
          <Download className="h-5 w-5 text-green-600" />
          Export Payroll Data
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Export Format</label>
            <div className="grid grid-cols-3 gap-3">
              <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  value="excel"
                  checked={exportFormat === 'excel'}
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
                  checked={exportFormat === 'csv'}
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
                  checked={exportFormat === 'pdf'}
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
            className="px-4 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 flex items-center gap-2"
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
  variant = 'primary',
  icon: Icon,
  size = 'md',
  onClick,
  disabled = false
}) => {
  const baseClasses = "inline-flex items-center gap-2 rounded-lg font-medium transition-all duration-300 border";
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-xs",
    lg: "px-6 py-3 text-base"
  };
  const variantClasses = {
    primary: "bg-green-50 border-green-500 text-green-600 hover:bg-green-100 hover:border-green-600 hover:text-green-700 hover:shadow-[0_0_20px_rgba(34,197,94,0.5)] focus:shadow-[0_0_25px_rgba(34,197,94,0.6)]",
    secondary: "bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-300 hover:border-gray-400",
    danger: "bg-red-50 border-red-500 text-red-600 hover:bg-red-100 hover:border-red-600 hover:text-red-700 hover:shadow-[0_0_20px_rgba(239,68,68,0.5)]"
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
};

const SummaryCard = ({
  label,
  value,
  icon: Icon,
  color,
  isCount = false,
}) => {
  const colorClasses = {
    emerald: 'bg-emerald-100 text-xs text-emerald-600',
    red: 'bg-red-100 text-xs text-red-600',
    blue: 'bg-blue-100 text-xs text-blue-600',
    purple: 'bg-purple-100 text-xs text-purple-600',
    yellow: 'bg-yellow-100 text-xs text-yellow-600'
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-3 h-3" />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-gray-600 text-xs font-semibold uppercase tracking-wide">{label}</p>
        <p className="text-gray-900 text-lg font-normal">
          {isCount ? value : (typeof value === 'number' ? `KSh ${value.toLocaleString()}` : value)}
        </p>
      </div>
    </div>
  );
};

const StatutoryCard = ({
  label,
  value,
  icon: Icon,
  color,
  rate
}) => {
  const colorClasses = {
    red: 'bg-red-100 text-red-600',
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    purple: 'bg-purple-100 text-purple-600'
  };

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-md ${colorClasses[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-xs font-medium text-gray-500 bg-white px-2 py-1 rounded-full">
          {rate}
        </span>
      </div>
      <div className="space-y-1">
        <p className="text-gray-900 text-lg font-bold">
          {typeof value === 'number' ? `KSh ${Math.round(value).toLocaleString()}` : value}
        </p>
      </div>
    </div>
  );
};

const PayslipModal = ({
  record,
  onClose,
  onPrevious,
  onNext,
  companyInfo
}) => {
  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Payslip - ${record.employee_name}</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { 
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                line-height: 1.6; 
                color: #1f2937; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
              }
              .payslip-container { 
                max-width: 900px; 
                margin: 0 auto; 
                background: white;
                border-radius: 20px;
                box-shadow: 0 25px 50px rgba(0, 0, 0, 0.15);
                overflow: hidden;
                position: relative;
              }
              .header-bg {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                height: 120px;
                position: relative;
              }
              .header-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 255, 255, 0.1);
              }
              .header-content {
                position: relative;
                z-index: 2;
                padding: 30px 40px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                color: white;
              }
              .company-info {
                display: flex;
                align-items: center;
                gap: 20px;
              }
              .company-logo { 
                width: 60px; 
                height: 60px; 
                border-radius: 12px; 
                background: rgba(255, 255, 255, 0.2);
                padding: 8px;
                backdrop-filter: blur(10px);
              }
              .company-details h1 { 
                font-size: 28px; 
                font-weight: 800; 
                margin-bottom: 4px;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
              }
              .company-tagline { 
                font-size: 14px; 
                opacity: 0.9;
                font-weight: 500;
              }
              .payslip-title {
                text-align: right;
              }
              .payslip-title h2 { 
                font-size: 24px; 
                font-weight: 700; 
                margin-bottom: 8px;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
              }
              .pay-period { 
                font-size: 14px; 
                opacity: 0.9;
                background: rgba(255, 255, 255, 0.2);
                padding: 8px 16px;
                border-radius: 20px;
                backdrop-filter: blur(10px);
              }
              .content {
                padding: 40px;
              }
              .employee-section {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 30px;
                margin-bottom: 40px;
                padding-bottom: 30px;
                border-bottom: 2px solid #f3f4f6;
              }
              .info-card {
                background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
                padding: 25px;
                border-radius: 16px;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
                border: 1px solid #e2e8f0;
              }
              .info-card h3 {
                font-size: 14px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #6366f1;
                margin-bottom: 15px;
              }
              .info-item {
                display: flex;
                justify-content: space-between;
                margin-bottom: 8px;
                font-size: 14px;
              }
              .info-label {
                color: #6b7280;
                font-weight: 500;
              }
              .info-value {
                font-weight: 600;
                color: #1f2937;
              }
              .section {
                margin-bottom: 35px;
              }
              .section-header {
                background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
                color: white;
                padding: 15px 25px;
                border-radius: 12px;
                margin-bottom: 20px;
                font-weight: 700;
                font-size: 16px;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
              }
              .earnings-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin-bottom: 25px;
              }
              .earning-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 20px;
                background: #f8fafc;
                border-radius: 10px;
                border-left: 4px solid #10b981;
                transition: all 0.3s ease;
              }
              .earning-item:hover {
                background: #ecfdf5;
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.08);
              }
              .earning-label {
                font-weight: 500;
                color: #374151;
              }
              .earning-amount {
                font-weight: 700;
                color: #059669;
                font-size: 16px;
              }
              .deduction-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 20px;
                background: #fef2f2;
                border-radius: 10px;
                border-left: 4px solid #ef4444;
                margin-bottom: 12px;
                transition: all 0.3s ease;
              }
              .deduction-item:hover {
                background: #fee2e2;
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.08);
              }
              .deduction-label {
                font-weight: 500;
                color: #374151;
              }
              .deduction-amount {
                font-weight: 700;
                color: #dc2626;
                font-size: 16px;
              }
              .summary-section {
                background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
                color: white;
                padding: 30px;
                border-radius: 16px;
                margin-bottom: 30px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
              }
              .summary-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
              }
              .summary-row:last-child {
                border-bottom: none;
                border-top: 2px solid rgba(255, 255, 255, 0.2);
                margin-top: 15px;
                font-size: 20px;
                font-weight: 800;
              }
              .net-pay {
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                font-size: 24px;
              }
              .signature-section {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 40px;
                margin-top: 50px;
                padding-top: 30px;
                border-top: 2px solid #f3f4f6;
              }
              .signature-box {
                text-align: center;
              }
              .signature-line {
                border-top: 2px solid #374151;
                margin-bottom: 10px;
                width: 200px;
                margin: 40px auto 10px;
              }
              .signature-label {
                font-weight: 600;
                color: #6b7280;
                margin-bottom: 5px;
              }
              .footer {
                text-align: center;
                margin-top: 40px;
                padding: 25px;
                background: #f8fafc;
                border-radius: 12px;
                color: #6b7280;
                font-size: 12px;
                border: 1px solid #e5e7eb;
              }
              .footer-line {
                margin-bottom: 5px;
              }
              @media print {
                body { 
                  background: white;
                  padding: 0;
                }
                .no-print { display: none !important; }
                .payslip-container { 
                  box-shadow: none;
                  border-radius: 0;
                }
              }
            </style>
          </head>
          <body>
            ${document.getElementById('payslip-content')?.innerHTML}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
    }
  };

  const handleDownloadPDF = () => {
    const element = document.getElementById('payslip-content');
    const opt = {
      margin: 0.5,
      filename: `payslip_${record.employee_id}_${record.pay_period}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().from(element).set(opt).save();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-6xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white p-4 border-b border-gray-200 flex justify-between items-center z-10">
          <h2 className="text-xl font-semibold text-gray-900">Modern Payslip</h2>
          <div className="flex gap-2">
            <GlowButtonss
              variant="secondary"
              icon={Download}
              size="sm"
              onClick={handleDownloadPDF}
            >
              Download PDF
            </GlowButtonss>
            <GlowButtonss
              variant="danger"
              icon={X}
              size="sm"
              onClick={onClose}
            >
              Close
            </GlowButtonss>
          </div>
        </div>

        <div className="p-2 bg-gray-50 payslip-container print:p-0 print:w-[210mm] print:h-[297mm]">
          <div id="payslip-content" className="bg-white rounded-lg shadow-lg overflow-hidden text-xs leading-tight">
            <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
              <div className="flex items-center">
                {companyInfo?.image_url && (
                  <img src={companyInfo.image_url} alt="Company Logo" className="h-12 w-12 mr-3 bg-white p-1 rounded" />
                )}
                <div>
                  <h1 className="text-lg font-bold">{companyInfo?.company_name || 'Your Company Name'}</h1>
                  <div className="text-gray-300 text-xs">{companyInfo?.company_tagline || 'Excellence in Service'}</div>
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-xl font-bold">PAYSLIP</h2>
                <div className="text-gray-300 text-xs">
                  {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}

                </div>
              </div>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="border p-3 rounded">
                  <h3 className="font-semibold border-b mb-2">EMPLOYEE INFORMATION</h3>
                  <div className="space-y-1">
                    <div className="flex justify-between"><span>Full Name:</span><span>{record.employee_name}</span></div>
                    <div className="flex justify-between"><span>Employee No:</span><span>{record.employee_id}</span></div>
                    <div className="flex justify-between"><span>Position:</span><span>{record.department}</span></div>
                    <div className="flex justify-between"><span>Dept:</span><span>Operations</span></div>
                    <div className="flex justify-between"><span>Region:</span><span>{record.branch}</span></div>
                  </div>
                </div>

                <div className="border p-3 rounded">
                  <h3 className="font-semibold border-b mb-2">PAYMENT DETAILS</h3>
                  <div className="space-y-1">
                    <div className="flex justify-between"><span>Method:</span><span>{record.payment_method}</span></div>
                    {record.payment_method === 'Bank Transfer' && (
                      <>
                        <div className="flex justify-between"><span>Bank:</span><span>{record.bank_name}</span></div>
                        <div className="flex justify-between"><span>Account:</span><span>{record.account_number}</span></div>
                      </>
                    )}
                    {record.payment_method === 'M-Pesa' && (
                      <div className="flex justify-between"><span>M-Pesa No:</span><span>{record.employeeNu}</span></div>
                    )}
                    <div className="flex justify-between"><span>Job Group:</span><span>{record.jobGroup}</span></div>

                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="border rounded">
                  <div className="bg-gray-200 font-semibold p-2">EARNINGS</div>
                  <div className="p-2 space-y-1">
                    <div className="flex justify-between"><span>Basic</span><span>KSh {record.basic_salary.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>House</span><span>KSh {record.house_allowance.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Transport</span><span>KSh {record.transport_allowance.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Medical</span><span>KSh {record.medical_allowance.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Other</span><span>KSh {record.other_allowances.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Overtime</span><span>KSh {(record.overtime_hours * record.overtime_rate).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Commission</span><span>KSh {record.commission.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Bonus</span><span>KSh {record.bonus.toLocaleString()}</span></div>
                    <div className="flex justify-between bg-yellow-50 p-1"><span>Per Diem</span><span>KSh {record.per_diem?.toLocaleString() || '0'}</span></div>
                  </div>
                </div>

                <div className="border rounded">
                  <div className="bg-gray-200 font-semibold p-2">DEDUCTIONS</div>
                  <div className="p-2 space-y-1">
                    <div className="flex justify-between"><span>PAYE</span><span>KSh {Math.round(record.paye_tax).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>SHA</span><span>KSh {record.nhif_deduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>NSSF</span><span>KSh {record.nssf_deduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>AHL</span><span>KSh {record.housing_levy.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Loan</span><span>KSh {record.loan_deduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Advance</span><span>KSh {record.advance_deduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Welfare</span><span>KSh {record.welfare_deduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Other</span><span>KSh {record.other_deductions.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Tax Relief:</span><span>KSh -2400</span></div>
                  </div>
                </div>
              </div>

              <div className="border p-3 rounded mb-4">
                <div className="flex justify-between border-b pb-1"><span>Gross Pay</span><span>KSh {record.gross_pay.toLocaleString()}</span></div>
                <div className="flex justify-between border-b pb-1"><span>Total Deductions</span><span className="text-red-600">KSh {record.total_deductions.toLocaleString()}</span></div>

                <div className="flex justify-between font-bold text-green-700"><span>NET PAY</span><span>KSh {Math.round(record.net_pay).toLocaleString()}</span></div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4 text-center text-xs">
                <div className="border border-dashed p-2">Employee Signature<br />Date: __________</div>
                <div className="border border-dashed p-2">Authorized Signatory<br />Date: __________</div>
              </div>

              <div className="text-center text-gray-500 text-xs">
                Generated on {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()} • {companyInfo?.company_name || 'Company'} • Confidential
              </div>
            </div>
          </div>
        </div>

        {(onPrevious || onNext) && (
          <div className="sticky bottom-0 bg-white p-4 border-t border-gray-200 flex justify-between">
            {onPrevious && (
              <GlowButtonss icon={ArrowLeft} onClick={onPrevious}>
                Previous
              </GlowButtonss>
            )}
            {onNext && (
              <GlowButtonss icon={ArrowRight} onClick={onNext} className="ml-auto">
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
const Pagination = ({ currentPage, totalPages, onPageChange, totalItems, itemsPerPage, currentItemsCount }) => {
  const pages = [];
  const maxVisiblePages = 5;

  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

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
            Showing <span className="font-medium">{startItem}</span> to{' '}
            <span className="font-medium">{endItem}</span> of{' '}
            <span className="font-medium">{totalItems}</span> results
          </p>
        </div>
        <div>
          <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
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
                  ? 'z-10 bg-green-600 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600'
                  : 'text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-offset-0'
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
const P10FormGenerator = ({ isOpen, onClose, calculatePAYE, calculateNSSF, calculateNHIF, calculateHousingLevy }) => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [isLoading, setIsLoading] = useState(false);

  const generateP10Form = async () => {
    setIsLoading(true);
    try {
      const { data: employees, error } = await supabase
        .from('employees')
        .select('*');

      if (error) {
        console.error('Supabase error:', error);
        toast.error('Error fetching employee data: ' + error.message);
        return;
      }

      if (!employees || employees.length === 0) {
        toast.error('No employee data found in the system');
        return;
      }

      console.log('Fetched employees:', employees.length);

      const p10Data = employees.map(employee => {
        const taxPin = employee['Tax PIN'] || employee.tax_pin || 'PENDING';
        const employeeName = `${employee['First Name'] || ''} ${employee['Middle Name'] || ''} ${employee['Last Name'] || ''}`.trim() || employee.employee_name || 'N/A';
        const basicSalary = parseFloat(employee['Basic Salary'] || employee.basic_salary || 0);

        const houseAllowance = parseFloat(employee.house_allowance || 0);
        const transportAllowance = parseFloat(employee.travel_allowance || 0);
        const medicalAllowance = parseFloat(employee.medical_allowance || 0);
        const otherAllowances = parseFloat(employee.other_allowances || 0);

        const totalGrossPay = basicSalary + houseAllowance + transportAllowance + medicalAllowance + otherAllowances;

        const nhifNumber = employee['NHIF Number'] || employee['SHIF Number'] || '';
        const nssfNumber = employee['NSSF Number'] || '';

        const nhifDeduction = nhifNumber ? calculateNHIF(totalGrossPay) : 0;
        const nssfDeduction = nssfNumber ? calculateNSSF(totalGrossPay) : 0;
        const housingLevy = taxPin !== 'PENDING' ? calculateHousingLevy(totalGrossPay, true) : 0;

        const taxablePay = totalGrossPay - nssfDeduction - housingLevy;

        const payeAmount = calculatePAYE(taxablePay);

        return [
          'A00000000001',
          employeeName,
          'Resident',
          'Primary Employee',
          'No',
          '',
          basicSalary,
          0,
          0,
          houseAllowance + transportAllowance + medicalAllowance + otherAllowances,
          'Benefit not given',
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
          '',
          payeAmount
        ];
      });

      console.log('P10 data prepared for', p10Data.length, 'employees');

      const headers = [
        'Employer Pin',
        'Employee Name',
        'Resident Status',
        'Service Status',
        'Disability Status',
        'Exemption Certificate Number',
        'Total Emoluments - Cash Pay',
        'Value of Car Benefit',
        'Value of Meals',
        'Non Cash Benefits',
        'Type of Housing',
        'Housing Benefit',
        'Other Benefits',
        'Total Gross Pay',
        'SHIF',
        'NSSF Contribution',
        'Other Pension Contribution',
        'Post Retirement Medical Fund',
        'Mortgage Interest',
        'Affordable Housing Levy',
        'Taxable Pay',
        'Monthly Personal Relief',
        'Amount of Insurance Relief',
        'PAYE Tax',
        'Self Assessed PAYE Tax'
      ];

      const ws = XLSX.utils.aoa_to_sheet([headers, ...p10Data]);

      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let R = 0; R <= range.e.r; ++R) {
        for (let C = 0; C <= range.e.c; ++C) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[cellAddress]) continue;

          if (R === 0) {
            ws[cellAddress].s = {
              font: { bold: true },
              fill: { fgColor: { rgb: "CCCCCC" } }
            };
          }

          if (R > 0 && C >= 6 && C !== 10) {
            if (typeof ws[cellAddress].v === 'number') {
              ws[cellAddress].t = 'n';
              ws[cellAddress].z = '#,##0.00';
            }
          }
        }
      }

      ws['!cols'] = [
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
        { wch: 15 }
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'P10 EMPLOYER RETURN');

      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const data = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      saveAs(data, `P10_Employer_Return_${selectedYear}.xlsx`);

      toast.success(`P10 Form generated successfully for ${p10Data.length} employees!`);
      onClose();
    } catch (error) {
      console.error('Error generating P10 form:', error);
      toast.error('Failed to generate P10 form: ' + error.message);
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
            <img src='kra.png' className='w-5'></img>
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
              This will generate the P10 form with all employee tax information for KRA submission.
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

// Statutory Override Toggle Component
const StatutoryOverrideToggle = ({ isEnabled, onToggle }) => {
  return (
    <div className="flex items-center gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isEnabled ? 'bg-green-500' : 'bg-gray-300'
            }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
          />
        </button>
        {isEnabled ? (
          <ToggleRight className="w-5 h-5 text-green-600" />
        ) : (
          <ToggleLeft className="w-5 h-5 text-gray-500" />
        )}
        <span className={`text-sm font-medium ${isEnabled ? 'text-green-700' : 'text-gray-700'}`}> Statutory Override
        </span>
      </div>
      <div className="text-xs text-yellow-700">
        {isEnabled
          ? 'All statutory deductions will be applied regardless of PIN status'
          : 'Statutory deductions require valid PIN numbers'
        }
      </div>
    </div>
  );
};

export default function PayrollDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('all');
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSendingPayslips, setIsSendingPayslips] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [currentRecordIndex, setCurrentRecordIndex] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [departments, setDepartments] = useState(['all']);
  const [branches, setBranches] = useState([{ value: 'all', label: 'All Branches' }]);
  const [payrollRecords, setPayrollRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [showSummary, setShowSummary] = useState(false);
  const [companyInfo, setCompanyInfo] = useState(null);

  const [showSingleMpesaModal, setShowSingleMpesaModal] = useState(false);
  const [showBulkMpesaModal, setShowBulkMpesaModal] = useState(false);
  const [selectedEmployeeForMpesa, setSelectedEmployeeForMpesa] = useState(null);

  const [showP9Modal, setShowP9Modal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showP10Modal, setShowP10Modal] = useState(false);
  const [showStatutorySettings, setShowStatutorySettings] = useState(false);

  const [paymentRequests, setPaymentRequests] = useState([]);
  const [userRole, setUserRole] = useState('maker');
  const isAdmin = userRole && (userRole.toLowerCase() === 'admin' || userRole.toLowerCase() === 'credit_analyst_officer');
  const [currentUser, setCurrentUser] = useState(null);
  const [showApprovalQueue, setShowApprovalQueue] = useState(false);
  const [selectedPaymentForDetails, setSelectedPaymentForDetails] = useState(null);
  const [showPaymentDetails, setShowPaymentDetails] = useState(false);
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [paymentToReject, setPaymentToReject] = useState(null);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  // NEW: Bulk approval states
  const [selectedPayments, setSelectedPayments] = useState(new Set());
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [commentModalConfig, setCommentModalConfig] = useState({
    title: '',
    submitText: '',
    onSubmit: null
  });
  const [showClearQueueModal, setShowClearQueueModal] = useState(false);

  // SMS balance state
  const [smsBalance, setSmsBalance] = useState(null);
  const [sendingSMS, setSendingSMS] = useState(false);
  const [smsSendingStatus, setSmsSendingStatus] = useState({});
  // Add this with your other state declarations
  const [salaryAdvances, setSalaryAdvances] = useState([]);
  const [currentView, setCurrentView] = useState('dashboard');

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
    reloadSettings
  } = useStatutorySettings();

  // Add this useEffect - fetches salary advances once when component loads
  useEffect(() => {
    const fetchAllSalaryAdvances = async () => {
      try {
        console.log('Fetching ALL salary advances...');

        const { data, error } = await supabase
          .from('salary_advance')
          .select('"Employee Number", "Amount Requested", payment_processed, status, time_added')
          .eq('payment_processed', 'true')
          .eq('status', 'paid')
          .order('time_added', { ascending: false });

        if (error) {
          console.warn('Salary advances fetch error:', error.message);
          setSalaryAdvances([]);
          return;
        }

        console.log(`Loaded ${data?.length || 0} salary advances for payroll`);
        setSalaryAdvances(data || []);

      } catch (error) {
        console.warn('Failed to load salary advances:', error.message);
        setSalaryAdvances([]);
      }
    };

    fetchAllSalaryAdvances();
  }, []); // Empty dependency array = runs once when component mounts

  // Updated: Just searches in already-loaded data (NO database call)
  const calculateAdvanceDeduction = (employeeNumber, period) => {
    // console.log('=== DEBUG: Looking for advance for employee:', employeeNumber, 'Period:', period);

    if (!employeeNumber) {
      return 0;
    }

    // Find ALL advances for this employee matching the period
    const employeeAdvances = salaryAdvances.filter(adv => {
      const advanceEmpNumber = adv["Employee Number"];
      const advanceDate = adv.time_added; // Assuming ISO string like 2024-01-26T...

      // Match Employee
      // Use loose equality to handle string/number differences
      if (advanceEmpNumber != employeeNumber) return false;

      // Match Period (YYYY-MM)
      if (period) {
        if (!advanceDate) return false; // Strict: must have a date to match period

        // Handle various date formats safely
        let advancePeriod = '';
        try {
          // Try substring first for ISO strings
          if (typeof advanceDate === 'string' && advanceDate.length >= 7) {
            advancePeriod = advanceDate.substring(0, 7);
          } else {
            // Fallback for Date objects or other formats
            const d = new Date(advanceDate);
            if (!isNaN(d.getTime())) {
              advancePeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            }
          }
        } catch (e) {
          console.warn('Error parsing advance date:', advanceDate);
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
  const sendPayslipNotification = async (employee) => {
    if (!employee.employeeNu) {
      console.warn(`No phone number for employee ${employee.employee_name}`);
      return { success: false, error: 'No phone number available' };
    }

    const message = smsTemplates.payslipNotification(
      employee.employee_name,
      employee.net_pay,
      employee.pay_period
    );

    try {
      const result = await sendSMSWithRetry(employee.employeeNu, message);
      return result;
    } catch (error) {
      console.error(`Failed to send payslip SMS to ${employee.employee_name}:`, error);
      return { success: false, error: error.message };
    }
  };

  const sendPaymentConfirmation = async (employee) => {
    if (!employee.employeeNu) {
      console.warn(`No phone number for employee ${employee.employee_name}`);
      return { success: false, error: 'No phone number available' };
    }

    const message = smsTemplates.paymentConfirmation(
      employee.employee_name,
      employee.net_pay
    );

    try {
      const result = await sendSMSWithRetry(employee.employeeNu, message);
      return result;
    } catch (error) {
      console.error(`Failed to send payment confirmation to ${employee.employee_name}:`, error);
      return { success: false, error: error.message };
    }
  };

  const sendBulkPayslipNotifications = async () => {
    setIsSendingPayslips(true);
    const results = [];
    const employeesWithPhones = finalFilteredRecords.filter(emp => emp.employeeNu);

    if (employeesWithPhones.length === 0) {
      toast.error('No employees with phone numbers found');
      setIsSendingPayslips(false);
      return [];
    }

    toast.info(`Sending ${employeesWithPhones.length} SMS notifications...`);

    for (const [index, employee] of employeesWithPhones.entries()) {
      if (employee.employeeNu) {
        setSmsSendingStatus(prev => ({ ...prev, [employee.employee_id]: 'sending' }));

        const result = await sendPayslipNotification(employee);
        results.push({
          employee: employee.employee_id,
          employeeName: employee.employee_name,
          success: result.success,
          error: result.error
        });

        setSmsSendingStatus(prev => ({
          ...prev,
          [employee.employee_id]: result.success ? 'success' : 'failed'
        }));

        if (index < employeesWithPhones.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    if (successCount === totalCount) {
      toast.success(`All ${totalCount} payslip notifications sent successfully!`);
    } else if (successCount > 0) {
      toast.success(`${successCount} of ${totalCount} payslip notifications sent successfully`);

      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        console.log('Failed SMS deliveries:', failed);
        toast.error(`${failed.length} messages failed. Check console for details.`);
      }
    } else {
      toast.error('All SMS notifications failed. Please check your SMS configuration.');
    }

    setIsSendingPayslips(false);

    setTimeout(() => {
      setSmsSendingStatus({});
    }, 5000);

    return results;
  };

  // NEW: Clear payment queue function
  const clearPaymentQueue = async () => {
    try {
      setIsLoadingRequests(true);

      // Filter only pending payments that can be cleared
      const pendingPayments = paymentRequests.filter(p => p.status === 'pending');

      if (pendingPayments.length === 0) {
        toast.info('No pending payments to clear');
        return;
      }

      // Delete pending payments from the database
      const paymentIds = pendingPayments.map(p => p.id);

      const { error } = await supabase
        .from('payment_flows')
        .delete()
        .in('id', paymentIds);

      if (error) {
        throw error;
      }

      // Update local state
      setPaymentRequests(prev => prev.filter(p => p.status !== 'pending'));
      setSelectedPayments(new Set());

      toast.success(`Successfully cleared ${pendingPayments.length} pending payments from the queue`);
      setShowClearQueueModal(false);
    } catch (error) {
      console.error('Error clearing payment queue:', error);
      toast.error('Failed to clear payment queue');
    } finally {
      setIsLoadingRequests(false);
    }
  };

  // NEW: Bulk approve payments function
  const bulkApprovePayments = async (comment) => {
    if (selectedPayments.size === 0) {
      toast.error('No payments selected for approval');
      return;
    }

    setIsLoadingRequests(true);
    const results = [];
    const selectedPaymentIds = Array.from(selectedPayments);

    for (const paymentId of selectedPaymentIds) {
      const payment = paymentRequests.find(p => p.id === paymentId);
      if (payment && payment.status === 'pending') {
        try {
          // Approve with comment
          await approvePayment(payment, comment);
          results.push({ paymentId, success: true });
        } catch (error) {
          results.push({ paymentId, success: false, error: error.message });
        }
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    if (successCount === totalCount) {
      toast.success(`All ${totalCount} payments approved successfully!`);
    } else if (successCount > 0) {
      toast.success(`${successCount} of ${totalCount} payments approved successfully`);

      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        console.log('Failed approvals:', failed);
        toast.error(`${failed.length} approvals failed. Check console for details.`);
      }
    } else {
      toast.error('All approvals failed');
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
        .filter(p => p.status === 'pending')
        .map(p => p.id);
      setSelectedPayments(new Set(allPendingIds));
    }
  };

  // NEW: Toggle selection for a single payment
  const togglePaymentSelection = (paymentId, isSelected) => {
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
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  const getPeriodString = (period) => {
    if (!period || period === 'current') {
      return getCurrentPeriod();
    }
    if (period instanceof Date) {
      return `${period.getFullYear()}-${String(period.getMonth() + 1).padStart(2, '0')}`;
    }
    return period;
  };

  const actualPeriod = getPeriodString(selectedPeriod);

  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
          console.warn('User not authenticated');
          return;
        }

        setCurrentUser(user);

        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('user_id', user.id)
          .single();

        if (profileError) {
          console.warn('No user profile found, defaulting to maker role');
          setUserRole('maker');
        } else {
          setUserRole(profile.role || 'maker');
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
        setUserRole('maker');
      }
    };

    fetchUserProfile();
  }, []);

  const fetchPaymentRequests = async () => {
    try {
      setIsLoadingRequests(true);
      const { data, error } = await supabase
        .from('payment_flows')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching payment requests:', error);
        toast.error('Failed to load payment requests');
        return;
      }

      setPaymentRequests(data || []);
    } catch (error) {
      console.error('Error fetching payment requests:', error);
      toast.error('Failed to load payment requests');
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
      .channel('payment_flows_channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payment_flows'
        },
        (payload) => {
          console.log('Payment request change:', payload);
          fetchPaymentRequests();
        }
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
          .from('company_logo')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error fetching company info:', error);
          return;
        }

        if (data) {
          setCompanyInfo(data);
        }
      } catch (err) {
        console.error('Error:', err);
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

  const createPaymentRequest = async (employee, type, justification, employees = null) => {
    const { data: { user } } = await supabase.auth.getUser();

    const requestData = {
      type: type,
      employee_data: type === 'single' ? employee : null,
      employees_data: type === 'bulk' ? employees : null,
      justification: justification,
      created_by: user.id
    };

    const { data, error } = await supabase
      .from('payment_flows')
      .insert([requestData])
      .select()
      .single();

    if (error) throw error;

    // Show success message
    toast.success('Payment request submitted successfully! Please wait for approval.');

    return { ...data, created_by_email: user.email };
  };

  // UPDATED: Approve payment with comment
  const approvePayment = async (payment, comment = '') => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        toast.error('User not authenticated');
        return;
      }

      setPaymentRequests(prev =>
        prev.map(req =>
          req.id === payment.id
            ? {
              ...req,
              status: 'approved',
              approved_by: user.id,
              approved_at: new Date().toISOString(),
              approved_by_email: user.email,
              approval_comment: comment
            }
            : req
        )
      );

      const updateData = {
        status: 'approved',
        approved_by: user.id,
        approved_at: new Date().toISOString()
      };

      // Add comment if provided
      if (comment) {
        updateData.approval_comment = comment;
      }

      const { data, error } = await supabase
        .from('payment_flows')
        .update(updateData)
        .eq('id', payment.id)
        .select('*')
        .single();

      if (error) {
        console.error('Error approving payment request:', error);
        toast.error('Failed to approve payment request');
        fetchPaymentRequests();
        return;
      }

      try {
        if (payment.type === 'single') {
          await processSingleMpesaPayment(payment.employee_data);
        } else {
          await processBulkMpesaPayment(payment.employees_data);
        }

        await supabase
          .from('payment_flows')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString()
          })
          .eq('id', payment.id);

        setPaymentRequests(prev =>
          prev.map(req => req.id === payment.id ? { ...req, status: 'completed' } : req)
        );

        toast.success('Payment approved and processed successfully!');
      } catch (error) {
        await supabase
          .from('payment_flows')
          .update({
            status: 'failed',
            processed_at: new Date().toISOString(),
            metadata: { error: error.message }
          })
          .eq('id', payment.id);

        setPaymentRequests(prev =>
          prev.map(req => req.id === payment.id ? { ...req, status: 'failed' } : req)
        );

        console.error('Payment processing error:', error);
        toast.error('Payment approved but failed to process');
      }
    } catch (error) {
      console.error('Payment approval error:', error);
      toast.error('Failed to approve payment request');
    }
  };

  // UPDATED: Single approval with comment prompt
  const handleSingleApprove = (payment) => {
    setCommentModalConfig({
      title: 'Approve Payment Request',
      submitText: 'Approve',
      onSubmit: (comment) => approvePayment(payment, comment)
    });
    setShowCommentModal(true);
  };

  // NEW: Bulk approve handler
  const handleBulkApprove = () => {
    if (selectedPayments.size === 0) {
      toast.error('Please select at least one payment to approve');
      return;
    }

    setCommentModalConfig({
      title: `Approve ${selectedPayments.size} Selected Payments`,
      submitText: 'Approve All',
      onSubmit: (comment) => bulkApprovePayments(comment)
    });
    setShowCommentModal(true);
  };

  const rejectPayment = async (payment, reason) => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        toast.error('User not authenticated');
        return;
      }

      setPaymentRequests(prev =>
        prev.map(req =>
          req.id === payment.id
            ? {
              ...req,
              status: 'rejected',
              rejected_by: user.id,
              rejected_at: new Date().toISOString(),
              rejection_reason: reason,
              rejected_by_email: user.email
            }
            : req
        )
      );

      const { data, error } = await supabase
        .from('payment_flows')
        .update({
          status: 'rejected',
          rejected_by: user.id,
          rejected_at: new Date().toISOString(),
          rejection_reason: reason
        })
        .eq('id', payment.id)
        .select('*')
        .single();

      if (error) {
        console.error('Error rejecting payment request:', error);
        toast.error('Failed to reject payment request');
        fetchPaymentRequests();
        return;
      }

      toast.success('Payment request rejected');
    } catch (error) {
      console.error('Payment rejection error:', error);
      toast.error('Failed to reject payment request');
    }
  };

  const processSingleMpesaPayment = async (employee) => {
    try {
      const phoneNumber = employee.employeeNu;
      if (!phoneNumber) {
        throw new Error(`Phone number not found for employee ${employee.employee_id}`);
      }

      const formattedPhone = formatPhoneNumber(phoneNumber);

      const response = await fetch('https://mpesa-22p0.onrender.com/api/mpesa/b2c', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: formattedPhone,
          amount: employee.net_pay,
          employeeNumber: employee.employee_id,
          fullName: employee.employee_name
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to process payment');
      }

      const result = await response.json();

      if (result.success) {
        await sendPaymentConfirmation(employee);
      }

      toast.success(`Payment sent to ${employee.employee_name}`);
      return result;
    } catch (error) {
      console.error('M-Pesa payment error:', error);
      toast.error(`Failed to pay ${employee.employee_name}: ${error.message}`);
      throw error;
    }
  };

  const processBulkMpesaPayment = async (selectedEmployees) => {
    const results = [];

    for (const employee of selectedEmployees) {
      try {
        const result = await processSingleMpesaPayment(employee);
        results.push({ success: true, employee, result });

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        results.push({ success: false, employee, error });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalCount = selectedEmployees.length;

    if (successCount === totalCount) {
      toast.success(`All ${totalCount} payments processed successfully!`);
    } else if (successCount > 0) {
      toast.success(`${successCount} of ${totalCount} payments processed successfully`);
    } else {
      toast.error('All payments failed. Please check your settings.');
    }

    return results;
  };

  const handleSingleMpesaPayment = (employee) => {
    setSelectedEmployeeForMpesa(employee);
    setShowSingleMpesaModal(true);
  };

  const handleBulkMpesaPayment = () => {
    setShowBulkMpesaModal(true);
  };

  const handleConfirmSinglePayment = async (justification) => {
    if (userRole === 'credit_analyst_officer') {
      try {
        await processSingleMpesaPayment(selectedEmployeeForMpesa);
        toast.success('Payment sent successfully!');
      } catch (error) {
        console.error('Payment error:', error);
      }
    } else {
      await createPaymentRequest(selectedEmployeeForMpesa, 'single', justification);
    }
  };

  const handleConfirmBulkPayment = async (selectedEmployees, justification) => {
    if (userRole === 'credit_analyst_officer') {
      try {
        await processBulkMpesaPayment(selectedEmployees);
        toast.success('Bulk payment processed successfully!');
      } catch (error) {
        console.error('Bulk payment error:', error);
      }
    } else {
      await createPaymentRequest(null, 'bulk', justification, selectedEmployees);
    }
  };

  // UPDATED: Enhanced payroll calculation with salary advance deduction
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from('employees')
          .select('*');

        if (error) {
          console.error('Error fetching employees:', error);
          return;
        }

        if (data) {
          setEmployees(data);

          // Extract departments and branches
          const uniqueDepartments = [...new Set(data.map(emp => emp.Department || emp['Job Level']))].filter(Boolean);
          const uniqueBranches = [...new Set(data.map(emp => emp.branch || emp.Office))].filter(Boolean);

          setDepartments(['all', ...uniqueDepartments]);
          setBranches([
            { value: 'all', label: 'All Branches' },
            ...uniqueBranches.map(branch => ({ value: branch, label: branch }))
          ]);

          // Process each employee with salary advance deduction
          const payrollData = await Promise.all(data.map(async (employee) => {
            const basicSalary = employee['Basic Salary'] || 0;
            const employeeId = employee['Employee Number'] || '';
            const jobGroup = employee['Job Group'] || '';
            const employeeNat = employee['ID Number'] || '';
            const employeeNu = employee['Mobile Number'] || '';
            const firstName = employee['First Name'] || '';
            const middleName = employee['Middle Name'] || '';
            const branch = employee.Office || employee.branch || '';
            const lastName = employee['Last Name'] || '';
            const department = employee.Department || employee['Job Level'] || '';
            const position = employee['Job Title'] || '';

            const houseAllowance = employee.house_allowance || 0;
            const transportAllowance = employee.travel_allowance || 0;
            const overtimeHours = employee.overtime || 0;
            const overtimeRate = employee['Overtime Rate'] || 0;

            const nhifNumber = employee['NHIF Number'] || employee['SHIF Number'] || '';
            const nssfNumber = employee['NSSF Number'] || '';
            const taxPin = employee['Tax PIN'] || '';


            const medicalAllowance = employee.medical_allowance || 0;
            const otherAllowances = 0;
            const commission = 0;
            const bonus = 0;

            // Per diem is PART of basic salary (33%), not extra payment
            const perDiem = basicSalary * 0.33;

            const overtimePay = overtimeHours * overtimeRate;

            // Gross pay (basic salary already includes per diem)
            const grossPay = basicSalary + houseAllowance + transportAllowance +
              medicalAllowance + otherAllowances + overtimePay +
              commission + bonus;

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
            const taxableIncomeForPAYE = taxableGross - nhifDeduction - nssfDeduction - housingLevy;

            let payeTax = 0;
            let taxRelief = 0;

            if (overrideStatutoryChecks || taxPin) {
              payeTax = calculatePAYE(taxableIncomeForPAYE);
              taxRelief = Math.min(payeTax, 2400);
            }

            // Calculate salary advance deduction
            // Calculate salary advance deduction
            const advanceDeduction = calculateAdvanceDeduction(employeeId, actualPeriod);

            // REMOVED VOLUNTARY DEDUCTIONS - set all to 0 except advance
            const loanDeduction = 0;
            const welfareDeduction = 300;
            const otherDeductions = 0;

            // Total deductions include statutory and advance deduction
            const totalDeductions = payeTax +
              nhifDeduction +
              nssfDeduction +
              housingLevy +
              loanDeduction +
              advanceDeduction +
              welfareDeduction +
              otherDeductions;

            const netPay = grossPay - totalDeductions;

            return {
              id: employee.id || '',
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
              welfare_deduction: 300,
              other_deductions: otherDeductions,
              total_deductions: totalDeductions,
              net_pay: netPay,
              pay_period: actualPeriod,
              payment_method: 'MPESA',
              bank_name: '',
              account_number: ''
            };
          }));

          setPayrollRecords(payrollData);
          setFilteredRecords(payrollData);
        }
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    if (settings) { // Only fetch when settings are loaded
      fetchEmployees();
    }
  }, [actualPeriod, settings, overrideStatutoryChecks, salaryAdvances]);

  const applyAdditionalFilters = (records) => {
    return records.filter(record => {
      const searchLower = searchTerm.toLowerCase().trim();

      const matchesSearch = !searchTerm.trim() ||
        (record.employee_name || '').toLowerCase().includes(searchLower) ||
        (record.employee_id || '').toLowerCase().includes(searchLower) ||
        (record.department || '').toLowerCase().includes(searchLower) ||
        (record.position || '').toLowerCase().includes(searchLower) ||
        searchLower.split(' ').every(term =>
          (record.employee_name || '').toLowerCase().includes(term)
        );

      const matchesDepartment = selectedDepartment === 'all' || record.department === selectedDepartment;
      const matchesPaymentMethod = selectedPaymentMethod === 'all' || record.payment_method === selectedPaymentMethod;
      const matchesBranch = selectedBranch === 'all' || record.branch === selectedBranch;

      return matchesSearch && matchesDepartment && matchesPaymentMethod && matchesBranch;
    });
  };

  const finalFilteredRecords = applyAdditionalFilters(filteredRecords);

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = finalFilteredRecords.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(finalFilteredRecords.length / itemsPerPage);

  const handleViewPayslip = (record, index) => {
    setSelectedRecord(record);
    setCurrentRecordIndex(indexOfFirstItem + index);
  };

  const handleNavigatePayslip = (direction) => {
    if (currentRecordIndex === null || !selectedRecord) return;

    const newIndex = direction === 'prev' ? currentRecordIndex - 1 : currentRecordIndex + 1;

    if (newIndex >= 0 && newIndex < finalFilteredRecords.length) {
      setSelectedRecord(finalFilteredRecords[newIndex]);
      setCurrentRecordIndex(newIndex);

      const newPage = Math.floor(newIndex / itemsPerPage) + 1;
      if (newPage !== currentPage) {
        setCurrentPage(newPage);
      }
    }
  };

  const toggleRowExpand = (id, e) => {
    e.stopPropagation();
    setExpandedRows(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      return newExpanded;
    });
  };

  const totalGrossPay = finalFilteredRecords.reduce((sum, record) => sum + record.gross_pay, 0);
  const totalDeductions = finalFilteredRecords.reduce((sum, record) => sum + record.total_deductions, 0);
  const totalNetPay = finalFilteredRecords.reduce((sum, record) => sum + record.net_pay, 0);
  const totalPAYE = finalFilteredRecords.reduce((sum, record) => sum + record.paye_tax, 0);
  const totalNHIF = finalFilteredRecords.reduce((sum, record) => sum + record.nhif_deduction, 0);
  const totalNSSF = finalFilteredRecords.reduce((sum, record) => sum + record.nssf_deduction, 0);
  const totalHousingLevy = finalFilteredRecords.reduce((sum, record) => sum + record.housing_levy, 0);
  const totalPerDiem = finalFilteredRecords.reduce((sum, record) => sum + (record.per_diem || 0), 0);
  const totalAdvanceDeductions = finalFilteredRecords.reduce((sum, record) => sum + (record.advance_deduction || 0), 0);

  const pendingCount = paymentRequests.filter(p => p.status === 'pending').length;
  const approvedCount = paymentRequests.filter(p => p.status === 'approved').length;
  const rejectedCount = paymentRequests.filter(p => p.status === 'rejected').length;
  const pendingPayments = paymentRequests.filter(p => p.status === 'pending');

  const paymentMethods = ['all', 'Bank Transfer', 'M-Pesa', 'Airtel Money', 'Cash'];
  const payPeriods = [
    { value: 'current', label: 'Current Month' },
    { value: '2024-12', label: 'December 2024' },
    { value: '2024-11', label: 'November 2024' },
    { value: '2024-10', label: 'October 2024' },
    { value: '2024-09', label: 'September 2024' }
  ];

  const formatPeriodDisplay = (period) => {
    if (period === 'current') {
      const currentDate = new Date();
      return `${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    }
    return new Date(period + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const handleSendPayslips = async (method) => {
    if (method === 'sms') {
      await sendBulkPayslipNotifications();
    } else {
      setIsSendingPayslips(true);
      try {
        await new Promise(resolve => setTimeout(resolve, 1500));
        toast.success(`Payslips sent successfully via ${method}`);
      } catch (error) {
        console.error('Error sending payslips:', error);
        toast.error('Failed to send payslips');
      } finally {
        setIsSendingPayslips(false);
      }
    }
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // NEW: Toggle statutory override
  const toggleStatutoryOverride = () => {
    setOverrideStatutoryChecks(!overrideStatutoryChecks);
    toast.success(
      overrideStatutoryChecks
        ? 'Statutory PIN checks enabled'
        : 'Statutory override enabled - all deductions will be applied'
    );
  };

  // NEW: Refresh button handler
  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await fetchPaymentRequests();

      // Refresh SMS balance
      const balance = await checkSMSBalance();
      setSmsBalance(balance);

      // Refresh employees and payroll data
      const { data } = await supabase
        .from('employees')
        .select('*');

      if (data) {
        setEmployees(data);
      }

      toast.success('Dashboard refreshed successfully!');
    } catch (error) {
      console.error('Error refreshing:', error);
      toast.error('Failed to refresh data');
    } finally {
      setIsLoading(false);
    }
  };

  if (currentView === 'mpesa-spreadsheet') {
    return (
      <MPesaSpreadsheetFullPage
        onBack={() => setCurrentView('dashboard')}
        userRole={userRole}
      />
    );
  }

  if (isLoading || settingsLoading) {
    return (
      <div className="p-4 bg-gray-50 min-h-screen max-w-screen-2xl mx-auto flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">
            {settingsLoading ? 'Loading statutory settings...' : 'Loading employee data...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 bg-gray-50 min-h-screen max-w-screen-2xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Payroll Management</h1>
            <p className="text-gray-600 text-xs">Complete payroll processing with Maker-Checker M-Pesa payment workflow</p>
          </div>
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            {smsBalance !== null && (
              <div className="flex items-center gap-2 px-3 py-1 bg-green-50 border border-green-200 rounded-lg">
                <DollarSign className="w-4 h-4 text-green-600" />
                <span className="text-xs font-medium text-green-700">
                  SMS Balance: {smsBalance}
                </span>
                <button
                  onClick={async () => {
                    const balance = await checkSMSBalance();
                    setSmsBalance(balance);
                  }}
                  className="p-1 hover:bg-green-100 rounded"
                  title="Refresh balance"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <span className="text-xs font-medium text-blue-700 capitalize">
                {userRole} Role
              </span>
            </div>

            {(userRole === 'checker' || userRole === 'credit_analyst_officer') && pendingCount > 0 && (
              <button
                onClick={() => setShowApprovalQueue(true)}
                className="flex items-center gap-2 px-3 py-1 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100"
              >
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <span className="text-xs font-medium text-orange-700">
                  {pendingCount} Pending Approvals
                </span>
              </button>
            )}

            <div className="relative group">
              {!isSendingPayslips && (
                <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10 hidden group-hover:block">
                  <div className="py-1">
                    <button
                      onClick={() => handleSendPayslips('whatsapp')}
                      className="flex items-center px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 w-full text-left"
                    >
                      <svg className="w-5 h-5 mr-2 text-green-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.150-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.040 1.016-1.040 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0.16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                      WhatsApp
                    </button>
                    <button
                      onClick={() => handleSendPayslips('email')}
                      className="flex items-center px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 w-full text-left"
                    >
                      <svg className="w-5 h-5 mr-2 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
                      </svg>
                      Email
                    </button>
                    <button
                      onClick={() => handleSendPayslips('sms')}
                      className="flex items-center px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 w-full text-left"
                    >
                      <Send className="w-5 h-5 mr-2 text-green-500" />
                      SMS
                    </button>
                  </div>
                </div>
              )}
            </div>
            <GlowButtonss
              icon={Plus}
              size="sm"
              onClick={() => setShowQuickActions(true)}
            >
              Quick Actions
            </GlowButtonss>

            {/* NEW: Refresh Button */}
            <GlowButtonss
              icon={RefreshCw}
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              Refresh
            </GlowButtonss>

            <RoleButtonWrapper allowedRoles={['CHECKER']}>
              <div className="w-32">
                <SearchableDropdown
                  options={[
                    { label: 'Maker', value: 'maker' },
                    { label: 'Checker', value: 'checker' },
                    { label: 'Admin', value: 'credit_analyst_officer' }
                  ]}
                  value={userRole}
                  onChange={setUserRole}
                  placeholder="Select Role"
                />
              </div>
            </RoleButtonWrapper>
          </div>
        </div>
      </div>

      {/* Statutory Override Toggle */}
      <StatutoryOverrideToggle
        isEnabled={overrideStatutoryChecks}
        onToggle={toggleStatutoryOverride}
      />

      {/* WALLET UI REMOVED - Commented out as requested */}

      {showApprovalQueue && (userRole === 'checker' || userRole === 'credit_analyst_officer') && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
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
                    className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 flex items-center gap-2"
                    disabled={isLoadingRequests}
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve Selected ({selectedPayments.size})
                  </button>
                  <button
                    onClick={() => setSelectedPayments(new Set())}
                    className="px-3 py-1 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
                    disabled={isLoadingRequests}
                  >
                    Clear Selection
                  </button>
                </>
              )}

              {/* NEW: Clear Queue Button */}
              <button
                onClick={() => setShowClearQueueModal(true)}
                className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 flex items-center gap-2"
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
            <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedPayments.size === pendingPayments.length && pendingPayments.length > 0}
                    onChange={toggleSelectAllPayments}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="text-xs font-medium text-blue-800">
                    {selectedPayments.size} of {pendingPayments.length} payments selected
                  </span>
                </div>
                <div className="text-xs text-blue-600">
                  Select payments for bulk approval
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-orange-600" />
                <span className="text-xs font-medium text-orange-800">Pending</span>
              </div>
              <p className="text-2xl font-bold text-orange-700">{pendingCount}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-4 border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-xs font-medium text-green-800">Approved</span>
              </div>
              <p className="text-2xl font-bold text-green-700">{approvedCount}</p>
            </div>
            <div className="bg-red-50 rounded-lg p-4 border border-red-200">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-4 h-4 text-red-600" />
                <span className="text-xs font-medium text-red-800">Rejected</span>
              </div>
              <p className="text-2xl font-bold text-red-700">{rejectedCount}</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-medium text-blue-800">Total Value</span>
              </div>
              <p className="text-lg font-bold text-blue-700">
                KSh {paymentRequests
                  .filter(p => p.status === 'pending')
                  .reduce((sum, p) => sum + (p.total_amount || 0), 0)
                  .toLocaleString()}
              </p>
            </div>
          </div>

          {paymentRequests.length > 0 ? (
            <div className="grid gap-4">
              {paymentRequests
                .filter(payment => payment.status !== 'completed')
                .map((payment) => (
                  <PendingPaymentCard
                    key={payment.id}
                    payment={payment}
                    userRole={userRole}
                    isSelected={selectedPayments.has(payment.id)}
                    onSelect={(paymentId, isSelected) => togglePaymentSelection(paymentId, isSelected)}
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
              <h3 className="text-lg font-medium text-gray-900 mb-2">No pending payments</h3>
              <p className="text-gray-600">All payment requests have been processed.</p>
            </div>
          )}
        </div>
      )}

      {showQuickActions && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
              <button
                onClick={() => setShowQuickActions(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <GlowButtonss icon={Calculator} size="sm" onClick={() => {
                alert("Bulk Calculate initiated");
                setShowQuickActions(false);
              }}>
                Bulk Calculate
              </GlowButtonss>
              <GlowButtonss variant="secondary" icon={FileText} size="sm" onClick={() => {
                setShowP9Modal(true);
                setShowQuickActions(false);
              }}>
                Generate P9A Forms
              </GlowButtonss>
              <GlowButtonss variant="secondary" icon={Download} size="sm" onClick={() => {
                setShowExportModal(true);
                setShowQuickActions(false);
              }}>
                Export Data
              </GlowButtonss>
              <GlowButtonss variant="secondary" icon={FileText} size="sm" onClick={() => {
                alert("Batch payslip generation started");
                setShowQuickActions(false);
              }}>
                Payslip Batch
              </GlowButtonss>
              <GlowButtonss variant="secondary" icon={TrendingUp} size="sm" onClick={() => {
                alert("Tax certificates being prepared");
                setShowQuickActions(false);
              }}>
                Tax Certificates
              </GlowButtonss>
              <GlowButtonss variant="secondary" icon={Calendar} size="sm" onClick={() => {
                alert("Payment scheduling opened");
                setShowQuickActions(false);
              }}>
                Schedule Payments
              </GlowButtonss>
              <GlowButtonss variant="secondary" icon={Settings} size="sm" onClick={() => {
                setShowStatutorySettings(true);
                setShowQuickActions(false);
              }}>
                Statutory Settings
              </GlowButtonss>
              {(userRole === 'checker' || userRole === 'credit_analyst_officer') && (
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
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Payroll Controls</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">
              Pay Period
            </label>
            <DatePicker
              selected={selectedPeriod ?? null}
              onChange={(date) => setSelectedPeriod(date)}
              dateFormat="MMMM yyyy"
              showMonthYearPicker
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500"
              placeholderText="Select Month"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Region (Branch)</label>
            <SearchableDropdown
              options={branches}
              value={selectedBranch}
              onChange={setSelectedBranch}
              placeholder="Select Branch"
              icon={MapPin}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Department</label>
            <SearchableDropdown
              options={departments.map(dept => ({
                label: dept === 'all' ? 'All Departments' : dept,
                value: dept
              }))}
              value={selectedDepartment}
              onChange={setSelectedDepartment}
              placeholder="Select Department"
              icon={Briefcase}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Payment Method</label>
            <SearchableDropdown
              options={paymentMethods.map(method => ({
                label: method === 'all' ? 'All Methods' : method,
                value: method
              }))}
              value={selectedPaymentMethod}
              onChange={setSelectedPaymentMethod}
              placeholder="Select Method"
              icon={CreditCard}
            />
          </div>

          <div className="flex gap-2">
            <GlowButton
              icon={TabletSmartphone}
              size="md"
              onClick={handleBulkMpesaPayment}
              disabled={finalFilteredRecords.length === 0}
            >
              {userRole === 'credit_analyst_officer' ? 'M-PESA Bulk Pay' : 'Make Bulk Pay'}
            </GlowButton>
          </div>
        </div>
      </div>

      <div className="flex justify-center space-x-4">
        <GlowButtonss
          icon={showSummary ? ChevronUp : ChevronDown}
          size="sm"
          onClick={() => setShowSummary(!showSummary)}
        >
          {showSummary ? 'Hide Summary' : 'Show Summary'}
        </GlowButtonss>

        <div className="space-y-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="name or employee ID"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-xs placeholder-gray-500 focus:ring-2 focus:ring-green-100 focus:border-green-500"
            />
          </div>
        </div>
      </div>

      {showSummary && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Statutory Deductions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatutoryCard label="Total PAYE Tax" value={totalPAYE} icon={FileText} color="red" rate="Progressive rates" />
            <StatutoryCard label="Total NSSF" value={totalNSSF} icon={Calculator} color="blue" rate="6% (Tiered)" />
            <StatutoryCard label="Total SHIF" value={totalNHIF} icon={TrendingUp} color="purple" rate="Tiered" />
            <StatutoryCard label="Housing Levy" value={totalHousingLevy} icon={DollarSign} color="yellow" rate="1.5%" />
          </div>
        </div>
      )}


      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 md:p-6 border-b border-gray-200">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Payroll Report</h2>
              <p className="text-gray-600 text-xs">{finalFilteredRecords.length} records found</p>
              {/* NEW: Show total advance deductions */}
              {totalAdvanceDeductions > 0 && (
                <p className="text-xs text-orange-600">
                  Total Salary Advance Deductions: KSh {totalAdvanceDeductions.toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <GlowButtonss
                variant="secondary"
                icon={FileSpreadsheet}
                size="sm"
                onClick={() => setCurrentView('mpesa-spreadsheet')}
              >
                M-PESA Spreadsheet
              </GlowButtonss>
              <GlowButtonss variant="secondary" icon={FileText} size="sm" onClick={() => setShowP9Modal(true)}>
                P9 Forms
              </GlowButtonss>
              <GlowButtonss
                variant="secondary"
                icon={FileSpreadsheet}
                size="sm"
                onClick={() => setShowP10Modal(true)}
              >
                P10 Form
              </GlowButtonss>
              <GlowButtonss variant="secondary" icon={Download} size="sm" onClick={() => setShowExportModal(true)}>
                Export
              </GlowButtonss>
              <GlowButtonss variant="secondary" icon={Settings} size="sm" onClick={() => setShowStatutorySettings(true)}>
                Statutory Settings
              </GlowButtonss>

              {(userRole === 'checker' || userRole === 'credit_analyst_officer') && (
                <GlowButtonss
                  variant="secondary"
                  icon={Clock}
                  size="sm"
                  onClick={() => setShowApprovalQueue(true)}
                >
                  Approvals ({pendingCount})
                </GlowButtonss>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-gray-700 font-semibold">Employee</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">Region</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">Gross Pay</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">Per Diem</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">PAYE</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">SHIF</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">NSSF</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">AHL</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">Advance</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">Total Deductions</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">Net Pay</th>
                <th className="sticky right-0 z-10 bg-gray-50 px-4 py-3 text-center text-gray-700 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentItems.map((record, index) => {
                const isExpanded = expandedRows.has(record.id);
                const voluntaryDeductions = record.loan_deduction + record.advance_deduction + record.welfare_deduction;
                const smsStatus = smsSendingStatus[record.employee_id];

                return (
                  <React.Fragment key={record.id}>
                    <tr className="border-b border-gray-300 hover:bg-gray-50">
                      <td className="sticky left-0 z-10 bg-white px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <button
                            onClick={(e) => toggleRowExpand(record.id, e)}
                            className="mr-2 text-gray-500 hover:text-gray-700"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                          <div>
                            <p className="font-semibold text-gray-900">{record.employee_name}</p>
                            <p className="text-gray-500 text-xs">{record.employee_id}</p>
                            <p className="text-gray-500 text-xs">{record.employeeNu}</p>
                            <p className="text-gray-500 text-xs">{record.department} • {record.position}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right text-gray-600">
                        {record.branch}
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-green-600">
                        KSh {record.gross_pay.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-yellow-600">
                        KSh {record.per_diem?.toLocaleString() || '0'}
                      </td>
                      <td className="px-4 py-4 text-right text-red-600">
                        KSh {Math.round(record.paye_tax).toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right text-purple-600">
                        KSh {record.nhif_deduction.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right text-blue-600">
                        KSh {record.nssf_deduction.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right text-yellow-600">
                        KSh {record.housing_levy.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right text-orange-600">
                        KSh {record.advance_deduction?.toLocaleString() || '0'}
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-red-600">
                        KSh {record.total_deductions.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-green-700">
                        KSh {Math.round(record.net_pay).toLocaleString()}
                      </td>
                      <td className="sticky right-0 z-10 bg-white px-4 py-4">
                        <div className="flex justify-center gap-1">
                          <GlowButton
                            variant="primary"
                            icon={Smartphone}
                            size="sm"
                            onClick={() => handleSingleMpesaPayment(record)}
                          >
                            {userRole === 'credit_analyst_officer' ? 'M-Pesa' : 'pay'}
                          </GlowButton>
                          <GlowButtonss
                            variant="secondary"
                            icon={FileText}
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewPayslip(record, index);
                            }}
                          >
                            Payslip
                          </GlowButtonss>
                          {record.employeeNu && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                sendPayslipNotification(record);
                              }}
                              disabled={sendingSMS || smsStatus === 'sending'}
                              className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${smsStatus === 'success'
                                ? 'bg-green-50 text-green-600'
                                : smsStatus === 'failed'
                                  ? 'bg-red-50 text-red-600'
                                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                                } disabled:opacity-50`}
                            >
                              {smsStatus === 'sending' ? (
                                <Loader className="w-3 h-3 animate-spin" />
                              ) : smsStatus === 'success' ? (
                                <CheckCircle className="w-3 h-3" />
                              ) : smsStatus === 'failed' ? (
                                <XCircle className="w-3 h-3" />
                              ) : (
                                <Send className="w-3 h-3" />
                              )}
                              {smsStatus === 'sending' ? 'Sending' :
                                smsStatus === 'success' ? 'Sent' :
                                  smsStatus === 'failed' ? 'Failed' : 'SMS'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-gray-50">
                        <td colSpan={12} className="px-4 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900">Earnings</h4>
                              <div className="flex justify-between">
                                <span>Total Basic Salary:</span>
                                <span>KSh {record.basic_salary.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>House Allowance:</span>
                                <span>KSh {record.house_allowance.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Transport Allowance:</span>
                                <span>KSh {record.transport_allowance.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Overtime:</span>
                                <span>KSh {(record.overtime_hours * record.overtime_rate).toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between font-bold bg-yellow-50 p-1">
                                <span>Per Diem:</span>
                                <span>KSh {record.per_diem?.toLocaleString() || '0'}</span>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900">Statutory Deductions</h4>
                              <div className="flex justify-between">
                                <span>PAYE:</span>
                                <span className="text-red-600">KSh {record.paye_tax.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>SHIF:</span>
                                <span className="text-red-600">KSh {record.nhif_deduction.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>NSSF:</span>
                                <span className="text-red-600">KSh {record.nssf_deduction.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Housing Levy:</span>
                                <span className="text-red-600">KSh {record.housing_levy.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between text-green-600">
                                <span>Tax Relief:</span>
                                <span>KSh {record.tax_relief?.toLocaleString() || '0'}</span>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900">Other Deductions</h4>
                              <div className="flex justify-between">
                                <span>Loans:</span>
                                <span className="text-red-600">KSh {record.loan_deduction.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Advances:</span>
                                <span className="text-red-600">KSh {record.advance_deduction.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Welfare:</span>
                                <span className="text-red-600">KSh {record.welfare_deduction.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between font-medium">
                                <span>Total Deductions:</span>
                                <span className="text-red-600">KSh {record.total_deductions.toLocaleString()}</span>
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
          onPrevious={currentRecordIndex !== null && currentRecordIndex > 0 ?
            () => handleNavigatePayslip('prev') : undefined}
          onNext={currentRecordIndex !== null && currentRecordIndex < finalFilteredRecords.length - 1 ?
            () => handleNavigatePayslip('next') : undefined}
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
        onSubmit={commentModalConfig.onSubmit}
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
                  <p className="font-medium text-sm">Warning: This action cannot be undone</p>
                  <p className="text-xs mt-1">
                    You are about to clear {pendingCount} pending payments from the queue.
                    This will permanently delete all pending payment requests.
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
                {isLoadingRequests ? 'Clearing...' : 'Clear Queue'}
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

      <StatutorySettingsModal
        isOpen={showStatutorySettings}
        onClose={() => setShowStatutorySettings(false)}
        reloadSettings={reloadSettings}
      />
    </div>
  );
}