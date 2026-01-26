import React, { useState, useEffect } from 'react';
import {
  Filter,
  Download,
  Calendar,
  Building,
  User,
  ChevronDown,
  X,
  Loader2,
  Search,
  DollarSign,
  Phone,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  Receipt,
  UserCheck,
  CreditCard,
  FileDown,
  Printer,
  Share2,
  Copy,
  ExternalLink,
  MoreVertical,
  Archive,
  AlertCircle
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { TownProps } from '../../types/supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

interface ReportFilters {
  startDate: string;
  endDate: string;
  town: string;
  employeeNumber: string;
  employeeName: string;
}

interface BaseReportProps extends TownProps {
  reportTitle: string;
  reportDescription: string;
  onGenerateReport: (filters: ReportFilters) => Promise<any[]>;
  renderReportData: (data: any[], filters: ReportFilters) => React.ReactNode;
}

interface SalaryAdvanceData {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  town: string;
  branch: string;
  application_date?: string;
  application_time?: string;
  amount_requested?: number;
  status?: 'Pending' | 'Approved' | 'Rejected' | 'Disbursed' | 'Deducted' | 'paid';
  mpesa_code?: string;
  disbursement_date?: string;
  disbursement_time?: string;
  repayment_date?: string;
  repayment_time?: string;
  repayment_status?: 'Pending' | 'Partial' | 'Completed';
  approved_by?: string;
  approval_date?: string;
  approval_time?: string;
  reason?: string;
  phone_number?: string;
  bank_account?: string;
  bank_name?: string;
  deduction_month?: string;
  remarks?: string;
  created_at?: string;
  updated_at?: string;
  // Additional fields from your table
  basic_salary?: string;
  net_salary?: string;
  region?: string;
  office_branch?: string;
  reason_for_advance?: string;
  admin_notes?: string;
  mpesa_conversation_id?: string;
  mpesa_transaction_id?: string;
  mpesa_result_desc?: string;
}

// Transaction Details Modal Component
interface TransactionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: SalaryAdvanceData[];
  employeeName: string;
  employeeNumber: string;
}

const TransactionDetailsModal: React.FC<TransactionDetailsModalProps> = ({
  isOpen,
  onClose,
  transactions,
  employeeName,
  employeeNumber
}) => {
  if (!isOpen) return null;

  const totalAmount = transactions.reduce((sum, t) => sum + (t.amount_requested || 0), 0);
  const totalTransactions = transactions.length;

  const handleDownloadReport = () => {
    const headers = [
      'Transaction ID',
      'Application Date',
      'Application Time',
      'Amount Requested',
      'Status',
      'M-Pesa Code',
      'Disbursement Date',
      'Disbursement Time',
      'Approved By',
      'Approval Date',
      'Reason',
      'Remarks'
    ];

    const csvContent = [
      headers.join(','),
      ...transactions.map(t =>
        [
          t.id,
          t.application_date || '',
          t.application_time || '',
          t.amount_requested || '',
          t.status || '',
          t.mpesa_code || '',
          t.disbursement_date || '',
          t.disbursement_time || '',
          t.approved_by || '',
          t.approval_date || '',
          t.reason ? `"${t.reason}"` : '',
          t.remarks ? `"${t.remarks}"` : ''
        ].join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${employeeNumber}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Transaction Report - ${employeeName}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .header { text-align: center; margin-bottom: 30px; }
            .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            th { background-color: #4f46e5; color: white; }
            .total { font-weight: bold; color: #059669; }
            @media print {
              body { margin: 0; padding: 10px; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>Transaction Report</h2>
            <p><strong>Employee:</strong> ${employeeName} (${employeeNumber})</p>
            <p><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>
          </div>
          
          <div class="summary">
            <p><strong>Total Transactions:</strong> ${totalTransactions}</p>
            <p><strong>Total Amount:</strong> KES ${totalAmount.toLocaleString()}</p>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>M-Pesa Code</th>
                <th>Approved By</th>
              </tr>
            </thead>
            <tbody>
              ${transactions.map(t => `
                <tr>
                  <td>${t.application_date || 'N/A'}</td>
                  <td>KES ${t.amount_requested?.toLocaleString() || '0'}</td>
                  <td>${t.status || 'N/A'}</td>
                  <td>${t.mpesa_code || 'N/A'}</td>
                  <td>${t.approved_by || 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 500);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden transform transition-all duration-300 scale-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
                <img src='/public/mobile-transfer.png' className='w-9' />
                Transaction Details
              </h2>
              <div className="flex items-center gap-4 text-blue-100">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4" />
                  <span className="font-medium">{employeeName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  <span className="font-mono">{employeeNumber}</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 transition-colors p-2 hover:bg-white/10 rounded-full"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="p-6 bg-gradient-to-b from-gray-50 to-white">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Receipt className="w-5 h-5 text-blue-600" />
                </div>
                <span className="text-xs font-medium text-gray-500">Transactions</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{totalTransactions}</p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 bg-green-50 rounded-lg">
                  <DollarSign className="w-5 h-5 text-green-600" />
                </div>
                <span className="text-xs font-medium text-gray-500">Total Amount</span>
              </div>
              <p className="text-2xl font-bold text-green-600">
                KES {totalAmount.toLocaleString()}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 bg-purple-50 rounded-lg">
                  <Clock className="w-5 h-5 text-purple-600" />
                </div>
                <span className="text-xs font-medium text-gray-500">Last Transaction</span>
              </div>
              <p className="text-sm font-medium text-gray-900">
                {transactions[0]?.application_date ?
                  new Date(transactions[0].application_date).toLocaleDateString() :
                  'N/A'
                }
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 mb-6">
            <button
              onClick={handleDownloadReport}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-all hover:scale-105 active:scale-95 shadow-sm"
            >
              <FileDown className="w-4 h-4" />
              Download Report
            </button>
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all hover:scale-105 active:scale-95 shadow-sm"
            >
              <Printer className="w-4 h-4" />
              Print Report
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  transactions.map(t =>
                    `${t.application_date}: KES ${t.amount_requested} - ${t.status}`
                  ).join('\n')
                );
                alert('Transaction details copied to clipboard!');
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-all hover:scale-105 active:scale-95 shadow-sm"
            >
              <Copy className="w-4 h-4" />
              Copy Summary
            </button>
          </div>
        </div>

        {/* Transaction Table */}
        <div className="px-6 pb-6 overflow-auto max-h-[50vh]">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <h3 className="font-medium text-gray-900 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                All Transactions
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Date & Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Reference
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {transactions.map((transaction, index) => (
                    <tr key={transaction.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">
                          {transaction.application_date || 'N/A'}
                        </div>
                        <div className="text-xs text-gray-500">
                          {transaction.application_time || ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-bold text-gray-900">
                          KES {transaction.amount_requested?.toLocaleString() || '0'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${transaction.status === 'Approved' || transaction.status === 'Disbursed' || transaction.status === 'paid'
                            ? 'bg-green-100 text-green-800'
                            : transaction.status === 'Pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : transaction.status === 'Rejected'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-100 text-gray-800'
                          }`}>
                          {transaction.status || 'Unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-mono text-blue-600">
                          {transaction.mpesa_code || 'N/A'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const details = `
                                Employee: ${employeeName}
                                Amount: KES ${transaction.amount_requested}
                                Date: ${transaction.application_date}
                                Status: ${transaction.status}
                                Reference: ${transaction.mpesa_code}
                                Reason: ${transaction.reason || 'N/A'}
                              `;
                              alert(details);
                            }}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(transaction.id);
                              alert('Transaction ID copied!');
                            }}
                            className="p-1.5 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                            title="Copy ID"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {transactions.length === 0 && (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Transactions Found</h3>
              <p className="text-gray-600">This employee has no salary advance transactions.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-600">
              Showing {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleDownloadReport}
                className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-green-600 to-emerald-600 rounded-lg hover:from-green-700 hover:to-emerald-700 transition-all flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export All
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Bulk Download Modal Component
interface BulkDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownload: (format: 'csv' | 'excel' | 'pdf', includeAll: boolean) => void;
  selectedCount: number;
  totalCount: number;
}

const BulkDownloadModal: React.FC<BulkDownloadModalProps> = ({
  isOpen,
  onClose,
  onDownload,
  selectedCount,
  totalCount
}) => {
  const [includeAll, setIncludeAll] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async (format: 'csv' | 'excel' | 'pdf') => {
    setIsDownloading(true);
    try {
      await onDownload(format, includeAll);
    } finally {
      setIsDownloading(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md transform transition-all duration-300 scale-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 rounded-t-2xl">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                <Download className="w-5 h-5" />
                Download Reports
              </h2>
              <p className="text-purple-100 text-sm">Export transaction data in multiple formats</p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div>
                <p className="text-sm font-medium text-blue-900">Download Scope</p>
                <p className="text-xs text-blue-700">
                  {selectedCount} employee{selectedCount !== 1 ? 's' : ''} selected
                </p>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeAll}
                  onChange={(e) => setIncludeAll(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Include all {totalCount} employees</span>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => handleDownload('excel')}
                disabled={isDownloading}
                className="flex items-center justify-between p-4 bg-green-50 hover:bg-green-100 border border-green-200 rounded-xl transition-all hover:scale-[1.02] disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <FileDown className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-gray-900">Excel Format (.xlsx)</p>
                    <p className="text-xs text-gray-600">Best for data analysis</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>

              <button
                onClick={() => handleDownload('csv')}
                disabled={isDownloading}
                className="flex items-center justify-between p-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-all hover:scale-[1.02] disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-gray-900">CSV Format (.csv)</p>
                    <p className="text-xs text-gray-600">Universal data format</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>

              <button
                onClick={() => handleDownload('pdf')}
                disabled={isDownloading}
                className="flex items-center justify-between p-4 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-all hover:scale-[1.02] disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 rounded-lg">
                    <Printer className="w-5 h-5 text-red-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-gray-900">PDF Report (.pdf)</p>
                    <p className="text-xs text-gray-600">Print-ready format</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>

          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-gray-500 mt-0.5" />
              <p className="text-xs text-gray-600">
                Files will be downloaded in ZIP format containing individual reports for each employee.
                Each report includes complete transaction history and summary.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-2xl">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">
              {includeAll ? totalCount : selectedCount} report{includeAll || selectedCount !== 1 ? 's' : ''} to generate
            </span>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Searchable Dropdown Component
interface SearchableDropdownProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 bg-white text-left flex items-center justify-between disabled:bg-gray-100 disabled:cursor-not-allowed"
      >
        <span className={value ? 'text-gray-900' : 'text-gray-500'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-60 overflow-auto">
          <div className="sticky top-0 bg-white p-2 border-b border-gray-200">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
                autoFocus
              />
            </div>
          </div>

          <div className="py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">No options found</div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                    setSearchTerm('');
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-700 ${option.value === value ? 'bg-blue-50 text-blue-700' : 'text-gray-900'
                    }`}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Accounting Status Badge Component
const AccountingStatusBadge: React.FC<{ status?: string; type: 'status' | 'repayment' }> = ({ status, type }) => {
  if (!status) {
    return (
      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-300">
        No Data
      </span>
    );
  }

  const getStatusConfig = () => {
    if (type === 'status') {
      switch (status) {
        case 'Pending':
          return { color: 'bg-amber-50 text-amber-700 border-amber-200' };
        case 'Approved':
          return { color: 'bg-blue-50 text-blue-700 border-blue-200' };
        case 'Rejected':
          return { color: 'bg-red-50 text-red-700 border-red-200' };
        case 'Disbursed':
          return { color: 'bg-green-50 text-green-700 border-green-200' };
        case 'Deducted':
        case 'paid':
          return { color: 'bg-purple-50 text-purple-700 border-purple-200' };
        default:
          return { color: 'bg-gray-50 text-gray-600 border-gray-300' };
      }
    } else {
      switch (status) {
        case 'Pending':
          return { color: 'bg-amber-50 text-amber-700 border-amber-200' };
        case 'Partial':
          return { color: 'bg-orange-50 text-orange-700 border-orange-200' };
        case 'Completed':
          return { color: 'bg-green-50 text-green-700 border-green-200' };
        default:
          return { color: 'bg-gray-50 text-gray-600 border-gray-300' };
      }
    }
  };

  const config = getStatusConfig();

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${config.color}`}>
      {status}
    </span>
  );
};

// Format currency
const formatCurrency = (amount?: number) => {
  if (!amount) return 'KES 0.00';
  return `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Format date
const formatAccountingDate = (dateString?: string, timeString?: string) => {
  if (!dateString) return '-';

  let date = new Date(dateString);
  // Robust check: if date is invalid or 1970 (Unix epoch), try to return a sensible fallback or now
  if (isNaN(date.getTime()) || date.getFullYear() < 2000) {
    // If it's a valid string but old, it might be the 1970 issue the user reported
    if (dateString.includes('-') || dateString.includes('/')) return dateString;
    return '-';
  }

  const time = timeString ? new Date(`1970-01-01T${timeString}`) : null;

  const formattedDate = date.toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  const formattedTime = (time && !isNaN(time.getTime())) ? time.toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }) : '';

  return timeString ? `${formattedDate} ${formattedTime}` : formattedDate;
};

// Pagination Component
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemsPerPageChange: (itemsPerPage: number) => void;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange
}) => {
  const getVisiblePages = () => {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];

    for (
      let i = Math.max(2, currentPage - delta);
      i <= Math.min(totalPages - 1, currentPage + delta);
      i++
    ) {
      range.push(i);
    }

    if (currentPage - delta > 2) {
      rangeWithDots.push(1, '...');
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (currentPage + delta < totalPages - 1) {
      rangeWithDots.push('...', totalPages);
    } else {
      rangeWithDots.push(totalPages);
    }

    return rangeWithDots;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-3 border-t border-gray-300 bg-gray-50">
      <div className="flex items-center space-x-2 mb-4 sm:mb-0">
        <span className="text-sm text-gray-700">Show</span>
        <select
          value={itemsPerPage}
          onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
          className="border border-gray-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
        >
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
        <span className="text-sm text-gray-700">entries</span>
      </div>

      <div className="flex items-center space-x-1">
        <span className="text-sm text-gray-700 mr-4">
          Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} entries
        </span>

        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="p-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>

        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="p-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {getVisiblePages().map((page, index) => (
          <button
            key={index}
            onClick={() => typeof page === 'number' && onPageChange(page)}
            disabled={page === '...'}
            className={`min-w-[2rem] px-2 py-1 text-sm rounded border ${currentPage === page
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-300 text-gray-700 hover:bg-gray-100'
              } disabled:bg-transparent disabled:cursor-default`}
          >
            {page}
          </button>
        ))}

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="p-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="p-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

const BaseReport: React.FC<BaseReportProps> = ({
  reportTitle,
  reportDescription,
  onGenerateReport,
  renderReportData,
  selectedTown,
  onTownChange
}) => {
  const [filters, setFilters] = useState<ReportFilters>({
    startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    town: selectedTown || '',
    employeeNumber: '',
    employeeName: ''
  });

  const [towns, setTowns] = useState<string[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<any[]>([]);
  const [reportData, setReportData] = useState<SalaryAdvanceData[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Modal states
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [selectedEmployeeTransactions, setSelectedEmployeeTransactions] = useState<SalaryAdvanceData[]>([]);
  const [selectedEmployeeDetails, setSelectedEmployeeDetails] = useState<{ name: string, number: string }>({ name: '', number: '' });
  const [showBulkDownloadModal, setShowBulkDownloadModal] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());

  // Calculate totals for accounting summary
  const employeeAdvances = reportData.reduce((acc, advance) => {
    const empId = advance.employee_number;
    if (!acc[empId]) {
      acc[empId] = {
        employee: advance,
        advances: [],
        totalApplied: 0,
        totalDisbursed: 0,
        advanceCount: 0
      };
    }
    acc[empId].advances.push(advance);

    const amount = advance.amount_requested || 0;
    acc[empId].totalApplied += amount;
    acc[empId].totalDisbursed += amount;
    acc[empId].advanceCount += 1;
    return acc;
  }, {} as Record<string, any>);

  const employeeAdvanceArray = Object.values(employeeAdvances);
  const totalApplied = employeeAdvanceArray.reduce((sum: number, emp: any) => sum + emp.totalApplied, 0);
  const totalDisbursed = employeeAdvanceArray.reduce((sum: number, emp: any) => sum + emp.totalDisbursed, 0);
  const totalEmployees = employeeAdvanceArray.length;
  const totalAdvances = reportData.length;

  // Calculate paginated data
  const totalItems = employeeAdvanceArray.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedEmployeeData = employeeAdvanceArray.slice(startIndex, endIndex);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters.town, filters.employeeNumber, reportData]);

  // Fetch initial employee data and their advances
  useEffect(() => {
    const fetchEmployeeData = async () => {
      try {
        setLoading(true);

        // Fetch towns from employees
        const { data: townsData } = await supabase
          .from('employees')
          .select('Town')
          .not('Town', 'is', null);

        if (townsData) {
          const uniqueTowns = [...new Set(townsData.map(t => t.Town))].filter(Boolean);
          setTowns(uniqueTowns as string[]);
        }

        // Fetch all employees
        const { data: employeesData } = await supabase
          .from('employees')
          .select(`
            "Employee Number",
            "First Name",
            "Last Name",
            Town,
            Branch,
            "Mobile Number",
            "Work Email",
            "Job Title"
          `)
          .order('"First Name"');

        // Fetch salary advances
        const { data: advancesData, error: advancesError } = await supabase
          .from('salary_advance')
          .select('*')
          .order('time_added', { ascending: false });

        console.log('Advances fetch error:', advancesError);
        console.log('Advances data sample:', advancesData?.[0]);

        if (employeesData) {
          const employeeTableData: SalaryAdvanceData[] = [];

          employeesData.forEach(emp => {
            const employeeAdvances = advancesData?.filter(
              advance => advance["Employee Number"] === emp['Employee Number']
            ) || [];

            if (employeeAdvances.length > 0) {
              // Create an entry for each advance
              employeeAdvances.forEach(advance => {
                const advanceAmount = advance["Amount Requested"] ? parseFloat(advance["Amount Requested"]) : 0;

                employeeTableData.push({
                  id: `${emp['Employee Number']}-${advance.id}`,
                  employee_number: advance["Employee Number"] || emp['Employee Number'],
                  first_name: emp['First Name'] || '',
                  last_name: emp['Last Name'] || '',
                  town: advance["Town"] || emp.Town || '',
                  branch: advance["Office Branch"] || emp.Branch || '',
                  phone_number: emp['Mobile Number'] || '',
                  application_date: advance.time_added?.split('T')[0],
                  application_time: advance.time_added?.split('T')[1]?.substring(0, 8),
                  amount_requested: advanceAmount,
                  status: advance.status || 'Pending',
                  mpesa_code: advance.mpesa_transaction_id,
                  disbursement_date: advance.payment_date?.split('T')[0],
                  disbursement_time: advance.payment_date?.split('T')[1]?.substring(0, 8),
                  repayment_date: null,
                  repayment_time: null,
                  repayment_status: null,
                  approved_by: advance.approved_by,
                  approval_date: advance.admin_approval_date?.split('T')[0],
                  approval_time: advance.admin_approval_date?.split('T')[1]?.substring(0, 8),
                  reason: advance["Reason for Advance"],
                  bank_account: null,
                  bank_name: null,
                  deduction_month: null,
                  remarks: advance.admin_notes,
                  created_at: advance.time_added,
                  updated_at: advance.last_updated,
                  basic_salary: advance["Basic Salary"],
                  net_salary: advance["Net Salary"],
                  region: advance["Region"],
                  office_branch: advance["Office Branch"],
                  reason_for_advance: advance["Reason for Advance"],
                  admin_notes: advance.admin_notes,
                  mpesa_conversation_id: advance.mpesa_conversation_id,
                  mpesa_result_desc: advance.mpesa_result_desc
                });
              });
            } else {
              // Employee with no advances
              employeeTableData.push({
                id: emp['Employee Number'],
                employee_number: emp['Employee Number'],
                first_name: emp['First Name'] || '',
                last_name: emp['Last Name'] || '',
                town: emp.Town || '',
                branch: emp.Branch || '',
                phone_number: emp['Mobile Number'] || '',
                application_date: undefined,
                application_time: undefined,
                amount_requested: 0,
                status: undefined,
                mpesa_code: undefined,
                disbursement_date: undefined,
                disbursement_time: undefined,
                repayment_date: undefined,
                repayment_time: undefined,
                repayment_status: undefined,
                approved_by: undefined,
                approval_date: undefined,
                approval_time: undefined,
                reason: undefined,
                bank_account: undefined,
                bank_name: undefined,
                deduction_month: undefined,
                remarks: undefined,
                created_at: undefined,
                updated_at: undefined
              });
            }
          });

          console.log('Final report data:', employeeTableData.slice(0, 3));
          setEmployees(employeesData);
          setFilteredEmployees(employeesData);
          setReportData(employeeTableData);
        }
      } catch (error) {
        console.error('Error fetching employee data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchEmployeeData();
  }, []);

  // Filter employees based on town selection
  useEffect(() => {
    let filtered = employees;

    if (filters.town) {
      filtered = filtered.filter(emp => emp.Town === filters.town);
    }

    if (filters.employeeNumber) {
      filtered = filtered.filter(emp => emp['Employee Number'] === filters.employeeNumber);
    }

    setFilteredEmployees(filtered);

    // Update report data with filtered employees and their advances
    const fetchFilteredData = async () => {
      const { data: advancesData } = await supabase
        .from('salary_advance')
        .select('*')
        .order('time_added', { ascending: false });

      const filteredReportData: SalaryAdvanceData[] = [];

      filtered.forEach(emp => {
        const employeeAdvances = advancesData?.filter(
          advance => advance["Employee Number"] === emp['Employee Number']
        ) || [];

        if (employeeAdvances.length > 0) {
          employeeAdvances.forEach(advance => {
            const advanceAmount = advance["Amount Requested"] ? parseFloat(advance["Amount Requested"]) : 0;

            filteredReportData.push({
              id: `${emp['Employee Number']}-${advance.id}`,
              employee_number: advance["Employee Number"] || emp['Employee Number'],
              first_name: emp['First Name'] || '',
              last_name: emp['Last Name'] || '',
              town: advance["Town"] || emp.Town || '',
              branch: advance["Office Branch"] || emp.Branch || '',
              phone_number: emp['Mobile Number'] || '',
              application_date: advance.time_added?.split('T')[0],
              application_time: advance.time_added?.split('T')[1]?.substring(0, 8),
              amount_requested: advanceAmount,
              status: advance.status || 'Pending',
              mpesa_code: advance.mpesa_transaction_id,
              disbursement_date: advance.payment_date?.split('T')[0],
              disbursement_time: advance.payment_date?.split('T')[1]?.substring(0, 8),
              repayment_date: null,
              repayment_time: null,
              repayment_status: null,
              approved_by: advance.approved_by,
              approval_date: advance.admin_approval_date?.split('T')[0],
              approval_time: advance.admin_approval_date?.split('T')[1]?.substring(0, 8),
              reason: advance["Reason for Advance"],
              bank_account: null,
              bank_name: null,
              deduction_month: null,
              remarks: advance.admin_notes,
              created_at: advance.time_added,
              updated_at: advance.last_updated
            });
          });
        } else {
          filteredReportData.push({
            id: emp['Employee Number'],
            employee_number: emp['Employee Number'],
            first_name: emp['First Name'] || '',
            last_name: emp['Last Name'] || '',
            town: emp.Town || '',
            branch: emp.Branch || '',
            phone_number: emp['Mobile Number'] || '',
            application_date: undefined,
            application_time: undefined,
            amount_requested: 0,
            status: undefined,
            mpesa_code: undefined,
            disbursement_date: undefined,
            disbursement_time: undefined,
            repayment_date: undefined,
            repayment_time: undefined,
            repayment_status: undefined,
            approved_by: undefined,
            approval_date: undefined,
            approval_time: undefined,
            reason: undefined,
            bank_account: undefined,
            bank_name: undefined,
            deduction_month: undefined,
            remarks: undefined,
            created_at: undefined,
            updated_at: undefined
          });
        }
      });

      setReportData(filteredReportData);
    };

    fetchFilteredData();
  }, [filters.town, filters.employeeNumber, employees]);

  const handleFilterChange = (key: keyof ReportFilters, value: string) => {
    const newFilters = { ...filters, [key]: value };

    if (key === 'employeeNumber' && value) {
      const employee = employees.find(emp => emp['Employee Number'] === value);
      if (employee) {
        newFilters.employeeName = `${employee['First Name']} ${employee['Last Name']}`;
      }
    }

    if (key === 'town' && value !== filters.town) {
      newFilters.employeeNumber = '';
      newFilters.employeeName = '';
    }

    setFilters(newFilters);

    if (key === 'town' && onTownChange) {
      onTownChange(value);
    }
  };

  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      if (onGenerateReport) {
        const data = await onGenerateReport(filters);
        setReportData(data);
      }
      setShowFilters(false);
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setGenerating(false);
    }
  };

  const handleExport = () => {
    if (reportData.length === 0) return;

    const headers = [
      'Employee Number',
      'First Name',
      'Last Name',
      'Town',
      'Branch',
      'Phone Number',
      'Application Date',
      'Application Time',
      'Amount Requested',
      'Status',
      'M-Pesa Code',
      'Disbursement Date',
      'Disbursement Time',
      'Repayment Date',
      'Repayment Time',
      'Repayment Status',
      'Approved By',
      'Approval Date',
      'Approval Time',
      'Reason',
      'Bank Account',
      'Bank Name',
      'Deduction Month',
      'Remarks',
      'Created At',
      'Updated At'
    ];

    const csvContent = [
      headers.join(','),
      ...reportData.map(row =>
        [
          `"${row.employee_number}"`,
          `"${row.first_name}"`,
          `"${row.last_name}"`,
          `"${row.town}"`,
          `"${row.branch}"`,
          `"${row.phone_number}"`,
          row.application_date || '',
          row.application_time || '',
          row.amount_requested || '',
          row.status || '',
          `"${row.mpesa_code}"` || '',
          row.disbursement_date || '',
          row.disbursement_time || '',
          row.repayment_date || '',
          row.repayment_time || '',
          row.repayment_status || '',
          `"${row.approved_by}"` || '',
          row.approval_date || '',
          row.approval_time || '',
          `"${row.reason}"` || '',
          `"${row.bank_account}"` || '',
          `"${row.bank_name}"` || '',
          row.deduction_month || '',
          `"${row.remarks}"` || '',
          row.created_at || '',
          row.updated_at || ''
        ].join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `salary-advance-accounting-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    const resetFilters = {
      startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      town: selectedTown || '',
      employeeNumber: '',
      employeeName: ''
    };

    setFilters(resetFilters);
    if (onTownChange) {
      onTownChange(resetFilters.town);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (newItemsPerPage: number) => {
    setItemsPerPage(newItemsPerPage);
    setCurrentPage(1);
  };

  // Handle view transaction details
  const handleViewTransactions = (employeeGroup: any) => {
    const { employee, advances } = employeeGroup;
    setSelectedEmployeeTransactions(advances);
    setSelectedEmployeeDetails({
      name: `${employee.first_name} ${employee.last_name}`,
      number: employee.employee_number
    });
    setShowTransactionModal(true);
  };

  // Handle bulk download
  const handleBulkDownload = async (format: 'csv' | 'excel' | 'pdf', includeAll: boolean) => {
    const employeesToDownload = includeAll
      ? employeeAdvanceArray
      : employeeAdvanceArray.filter(emp => selectedEmployees.has(emp.employee.employee_number));

    alert(`Downloading ${employeesToDownload.length} reports in ${format.toUpperCase()} format...`);
    // Implement actual download logic here
  };

  // Toggle employee selection
  const toggleEmployeeSelection = (employeeNumber: string) => {
    const newSelected = new Set(selectedEmployees);
    if (newSelected.has(employeeNumber)) {
      newSelected.delete(employeeNumber);
    } else {
      newSelected.add(employeeNumber);
    }
    setSelectedEmployees(newSelected);
  };

  // Accounting-style render function
  const renderAccountingReportData = (employeeData: any[]) => (
    <>
      {/* Accounting Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 bg-gray-50 border-b border-gray-300">
        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Employees</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{totalEmployees}</p>
          <p className="text-xs text-gray-500 mt-1">Across all locations</p>
        </div>

        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Advances</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{totalAdvances}</p>
          <p className="text-xs text-gray-500 mt-1">All applications</p>
        </div>

        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Requested</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalApplied)}</p>
          <p className="text-xs text-gray-500 mt-1">Amount requested</p>
        </div>

        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Disbursed</p>
          <p className="text-xl font-bold text-green-700 mt-1">{formatCurrency(totalDisbursed)}</p>
          <p className="text-xs text-gray-500 mt-1">Amount paid out</p>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedEmployees.size > 0 && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-blue-100 rounded-lg">
              <Download className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-sm font-medium text-blue-800">
              {selectedEmployees.size} employee{selectedEmployees.size !== 1 ? 's' : ''} selected
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedEmployees(new Set())}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Clear Selection
            </button>
            <button
              onClick={() => setShowBulkDownloadModal(true)}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              <Download className="w-3 h-3" />
              Download Selected
            </button>
          </div>
        </div>
      )}

      {/* Accounting Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-75 border-b border-gray-300">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                <input
                  type="checkbox"
                  checked={selectedEmployees.size === employeeData.length && employeeData.length > 0}
                  onChange={() => {
                    if (selectedEmployees.size === employeeData.length) {
                      setSelectedEmployees(new Set());
                    } else {
                      const allIds = employeeData.map(emp => emp.employee.employee_number);
                      setSelectedEmployees(new Set(allIds));
                    }
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                Employee Details
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                Advance Summary
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                Recent Application
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                Financial Overview
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-300">
            {employeeData.map((employeeGroup: any) => {
              const { employee, advances, totalApplied, totalDisbursed, advanceCount } = employeeGroup;
              const recentAdvance = advances[0];
              const isSelected = selectedEmployees.has(employee.employee_number);

              return (
                <tr key={employee.employee_number} className="hover:bg-gray-50 border-b border-gray-200">
                  {/* Selection Checkbox */}
                  <td className="px-4 py-3 border-r border-gray-300">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleEmployeeSelection(employee.employee_number)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>

                  {/* Employee Details with clickable link */}
                  <td className="px-4 py-3 border-r border-gray-300">
                    <div className="text-sm font-semibold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() => handleViewTransactions(employeeGroup)}>
                      {employee.first_name} {employee.last_name}
                    </div>
                    <div className="text-xs text-gray-600 font-mono">{employee.employee_number}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {employee.town || 'N/A'} • {employee.branch || 'N/A'}
                    </div>
                    {employee.phone_number && (
                      <div className="text-xs text-gray-600 mt-1">
                        {employee.phone_number}
                      </div>
                    )}
                  </td>

                  {/* Advance Summary */}
                  <td className="px-4 py-3 border-r border-gray-300">
                    <div className="text-sm font-semibold text-gray-900">
                      {advanceCount} {advanceCount === 1 ? 'Advance' : 'Advances'}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      First: {advances[advances.length - 1]?.application_date ?
                        formatAccountingDate(advances[advances.length - 1].application_date) : 'N/A'
                      }
                    </div>
                    <div className="text-xs text-gray-600">
                      Latest: {recentAdvance?.application_date ?
                        formatAccountingDate(recentAdvance.application_date) : 'N/A'
                      }
                    </div>
                  </td>

                  {/* Recent Application Details */}
                  <td className="px-4 py-3 border-r border-gray-300">
                    {recentAdvance ? (
                      <div className="space-y-1">
                        <div className="text-sm text-gray-900">
                          {formatAccountingDate(recentAdvance.application_date, recentAdvance.application_time)}
                        </div>
                        <div className="text-xs text-gray-600 max-w-xs">
                          {recentAdvance.reason || 'No reason provided'}
                        </div>
                        <AccountingStatusBadge status={recentAdvance.status} type="status" />
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 italic">No advances</div>
                    )}
                  </td>

                  {/* Financial Overview */}
                  <td className="px-4 py-3 border-r border-gray-300">
                    {advanceCount > 0 ? (
                      <div className="space-y-2">
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">Total Requested</div>
                          <div className="font-semibold text-gray-900">
                            {formatCurrency(totalApplied)}
                          </div>
                        </div>
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">Total Disbursed</div>
                          <div className="font-semibold text-green-700">
                            {formatCurrency(totalDisbursed)}
                          </div>
                        </div>
                        {recentAdvance?.amount_requested && (
                          <div className="text-sm">
                            <div className="text-gray-600 text-xs">Latest Amount</div>
                            <div className="font-semibold text-blue-700">
                              {formatCurrency(recentAdvance.amount_requested)}
                            </div>
                          </div>
                        )}
                        {recentAdvance?.mpesa_code && (
                          <div className="text-xs font-mono text-blue-700 bg-blue-50 px-2 py-1 rounded border border-blue-200">
                            Ref: {recentAdvance.mpesa_code}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 italic">No financial data</div>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => handleViewTransactions(employeeGroup)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors"
                      >
                        <Eye className="w-3 h-3" />
                        View Transactions
                      </button>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            // Download individual report
                            const employeeTransactions = reportData.filter(
                              t => t.employee_number === employee.employee_number
                            );
                            const csvContent = [
                              ['Transaction ID', 'Date', 'Amount', 'Status', 'Reference'].join(','),
                              ...employeeTransactions.map(t =>
                                [
                                  t.id,
                                  t.application_date || '',
                                  t.amount_requested || '',
                                  t.status || '',
                                  t.mpesa_code || ''
                                ].join(',')
                              )
                            ].join('\n');

                            const blob = new Blob([csvContent], { type: 'text/csv' });
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `transactions-${employee.employee_number}.csv`;
                            a.click();
                            window.URL.revokeObjectURL(url);
                          }}
                          className="flex-1 px-2 py-1 text-xs font-medium text-green-600 bg-green-50 hover:bg-green-100 rounded border border-green-200 transition-colors"
                        >
                          Download
                        </button>
                        <button
                          onClick={() => {
                            alert(`Printing report for ${employee.first_name} ${employee.last_name}`);
                            // Add print logic here
                          }}
                          className="flex-1 px-2 py-1 text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded border border-purple-200 transition-colors"
                        >
                          Print
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalItems > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          itemsPerPage={itemsPerPage}
          onPageChange={handlePageChange}
          onItemsPerPageChange={handleItemsPerPageChange}
        />
      )}
    </>
  );

  // Prepare dropdown options
  const townOptions = [
    { value: '', label: 'All Towns' },
    ...towns.map(town => ({ value: town, label: town }))
  ];

  const employeeOptions = [
    { value: '', label: 'All Employees' },
    ...filteredEmployees.map(employee => ({
      value: employee['Employee Number'],
      label: `${employee['First Name']} ${employee['Last Name']} (${employee['Employee Number']})`
    }))
  ];

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Accounting Report Header */}
        <div className="mb-6 bg-white rounded-lg border border-gray-300 p-6 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Salary Advance Accounting Report
              </h1>
              <p className="text-gray-600">Comprehensive financial overview of employee salary advances</p>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  Period: {formatAccountingDate(filters.startDate)} - {formatAccountingDate(filters.endDate)}
                </div>
                {filters.town && (
                  <div className="flex items-center gap-1">
                    <Building className="w-4 h-4" />
                    Location: {filters.town}
                  </div>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-500">Report Generated</div>
              <div className="text-lg font-semibold text-gray-900">
                {new Date().toLocaleDateString('en-KE', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric'
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-4 mb-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium shadow-sm transition-colors"
              >
                <Filter className="w-3 h-3" />
                {showFilters ? 'Hide Filters' : 'Show Filters'}
              </button>

              {reportData.length > 0 && (
                <>
                  <button
                    onClick={handleExport}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium shadow-sm transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    Export All Data
                  </button>

                  <button
                    onClick={() => setShowBulkDownloadModal(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-medium shadow-sm transition-colors"
                    disabled={selectedEmployees.size === 0}
                  >
                    <Download className="w-3 h-3" />
                    Bulk Download ({selectedEmployees.size})
                  </button>
                </>
              )}
            </div>

            <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded border border-gray-300">
              <span>Total Records: {employeeAdvanceArray.length} • Page {currentPage} of {totalPages}</span>
            </div>
          </div>

          {/* Filters Panel */}
          {showFilters && (
            <div className="mt-6 p-4 bg-gray-50 rounded border border-gray-300">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                {/* Date Range */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => handleFilterChange('startDate', e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => handleFilterChange('endDate', e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>

                {/* Town Filter */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Town
                  </label>
                  <SearchableDropdown
                    options={townOptions}
                    value={filters.town}
                    onChange={(value) => handleFilterChange('town', value)}
                    placeholder="Select Town"
                  />
                </div>

                {/* Employee Filter */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Employee
                  </label>
                  <SearchableDropdown
                    options={employeeOptions}
                    value={filters.employeeNumber}
                    onChange={(value) => handleFilterChange('employeeNumber', value)}
                    placeholder="Select Employee"
                  />
                </div>
              </div>

              <div className="flex justify-between items-center border-t border-gray-300 pt-4">
                <button
                  onClick={resetFilters}
                  className="text-sm text-gray-600 hover:text-gray-800 font-medium"
                >
                  Reset All Filters
                </button>

                <button
                  onClick={handleGenerateReport}
                  disabled={generating}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium shadow-sm disabled:opacity-50 transition-colors"
                >
                  {generating ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Filter className="w-3 h-3" />
                  )}
                  {generating ? 'Generating Report...' : 'Generate Report'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Report Data */}
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : (
            renderAccountingReportData(paginatedEmployeeData)
          )}
        </div>
      </div>

      {/* Transaction Details Modal */}
      <TransactionDetailsModal
        isOpen={showTransactionModal}
        onClose={() => setShowTransactionModal(false)}
        transactions={selectedEmployeeTransactions}
        employeeName={selectedEmployeeDetails.name}
        employeeNumber={selectedEmployeeDetails.number}
      />

      {/* Bulk Download Modal */}
      <BulkDownloadModal
        isOpen={showBulkDownloadModal}
        onClose={() => setShowBulkDownloadModal(false)}
        onDownload={handleBulkDownload}
        selectedCount={selectedEmployees.size}
        totalCount={employeeAdvanceArray.length}
      />
    </div>
  );
};

export default BaseReport;