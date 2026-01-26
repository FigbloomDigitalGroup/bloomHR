import React, { useState, useEffect } from 'react';
import { 
  Filter, 
  Download, 
  Calendar, 
  Building, 
  User, 
  ChevronDown,
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
  Scale,
  CreditCard,
  CalendarClock
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
  loanType: string;
  status: string;
}

interface BaseReportProps extends TownProps {
  reportTitle: string;
  reportDescription: string;
  onGenerateReport: (filters: ReportFilters) => Promise<any[]>;
  renderReportData: (data: any[], filters: ReportFilters) => React.ReactNode;
}

interface StaffLoanData {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  town: string;
  branch: string;
  
  // Loan Application Details
  loan_type: 'Emergency' | 'Development' | 'School Fees' | 'Mortgage' | 'Vehicle' | 'Other';
  application_date?: string;
  application_time?: string;
  loan_amount?: number;
  approved_amount?: number;
  interest_rate?: number;
  repayment_period?: number; // in months
  purpose?: string;
  
  // Approval & Status
  status?: 'Pending' | 'Approved' | 'Rejected' | 'Disbursed' | 'Active' | 'Completed' | 'Written Off';
  approved_by?: string;
  approval_date?: string;
  approval_time?: string;
  
  // Disbursement Details
  disbursement_date?: string;
  disbursement_time?: string;
  disbursement_method?: 'Bank Transfer' | 'Cheque' | 'MPesa';
  bank_account?: string;
  bank_name?: string;
  cheque_number?: string;
  mpesa_code?: string;
  
  // Salary Deduction Details
  monthly_deduction?: number;
  total_repayable?: number;
  amount_deducted?: number;
  amount_remaining?: number;
  last_deduction_date?: string;
  next_deduction_date?: string;
  deduction_status?: 'Active' | 'Completed' | 'Suspended' | 'Written Off';
  
  // M-Pesa Transactions
  mpesa_transactions?: {
    id: string;
    transaction_date: string;
    transaction_time: string;
    amount: number;
    mpesa_code: string;
    phone_number: string;
    status: 'Completed' | 'Failed' | 'Pending';
    purpose: string;
  }[];
  
  // Security & Guarantors
  security_details?: string;
  guarantor1_name?: string;
  guarantor1_employee_number?: string;
  guarantor2_name?: string;
  guarantor2_employee_number?: string;
  
  // Additional Fields
  remarks?: string;
  created_at?: string;
  updated_at?: string;
}

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
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-700 ${
                    option.value === value ? 'bg-blue-50 text-blue-700' : 'text-gray-900'
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

// Accounting Status Badge Component for Loans
const LoanStatusBadge: React.FC<{ status?: string; type: 'loan' | 'deduction' }> = ({ status, type }) => {
  if (!status) {
    return (
      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-300">
        No Data
      </span>
    );
  }

  const getStatusConfig = () => {
    if (type === 'loan') {
      switch (status) {
        case 'Pending':
          return { color: 'bg-amber-50 text-amber-700 border-amber-200' };
        case 'Approved':
          return { color: 'bg-blue-50 text-blue-700 border-blue-200' };
        case 'Rejected':
          return { color: 'bg-red-50 text-red-700 border-red-200' };
        case 'Disbursed':
          return { color: 'bg-green-50 text-green-700 border-green-200' };
        case 'Active':
          return { color: 'bg-purple-50 text-purple-700 border-purple-200' };
        case 'Completed':
          return { color: 'bg-gray-50 text-gray-700 border-gray-300' };
        case 'Written Off':
          return { color: 'bg-red-50 text-red-700 border-red-200' };
        default:
          return { color: 'bg-gray-50 text-gray-600 border-gray-300' };
      }
    } else {
      switch (status) {
        case 'Active':
          return { color: 'bg-green-50 text-green-700 border-green-200' };
        case 'Completed':
          return { color: 'bg-gray-50 text-gray-700 border-gray-300' };
        case 'Suspended':
          return { color: 'bg-orange-50 text-orange-700 border-orange-200' };
        case 'Written Off':
          return { color: 'bg-red-50 text-red-700 border-red-200' };
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

// M-Pesa Transaction Badge
const MpesaStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'Completed':
        return { color: 'bg-green-50 text-green-700 border-green-200' };
      case 'Failed':
        return { color: 'bg-red-50 text-red-700 border-red-200' };
      case 'Pending':
        return { color: 'bg-amber-50 text-amber-700 border-amber-200' };
      default:
        return { color: 'bg-gray-50 text-gray-600 border-gray-300' };
    }
  };

  const config = getStatusConfig();

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${config.color}`}>
      {status}
    </span>
  );
};

// Format currency for accounting
const formatCurrency = (amount?: number) => {
  if (!amount) return 'KES 0.00';
  return `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Format date for accounting reports
const formatAccountingDate = (dateString?: string, timeString?: string) => {
  if (!dateString) return '-';
  
  const date = new Date(dateString);
  const time = timeString ? new Date(`1970-01-01T${timeString}`) : null;
  
  const formattedDate = date.toLocaleDateString('en-KE', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric' 
  });
  
  const formattedTime = time ? time.toLocaleTimeString('en-KE', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  }) : '';
  
  return timeString ? `${formattedDate} ${formattedTime}` : formattedDate;
};

// Calculate loan metrics for salary deduction
const calculateLoanMetrics = (loan: StaffLoanData) => {
  const deductionsMade = loan.amount_deducted && loan.monthly_deduction 
    ? Math.floor(loan.amount_deducted / loan.monthly_deduction)
    : 0;
  
  const deductionsRemaining = loan.monthly_deduction && loan.amount_remaining
    ? Math.ceil(loan.amount_remaining / loan.monthly_deduction)
    : 0;

  const progress = loan.amount_deducted && loan.total_repayable 
    ? (loan.amount_deducted / loan.total_repayable) * 100 
    : 0;

  return { deductionsMade, deductionsRemaining, progress };
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
            className={`min-w-[2rem] px-2 py-1 text-sm rounded border ${
              currentPage === page
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

const StaffLoansReport: React.FC<BaseReportProps> = ({
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
    employeeName: '',
    loanType: '',
    status: ''
  });
  
  const [towns, setTowns] = useState<string[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<any[]>([]);
  const [reportData, setReportData] = useState<StaffLoanData[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Calculate totals for accounting summary
  const totalLoanPortfolio = reportData.reduce((sum, loan) => sum + (loan.approved_amount || 0), 0);
  const totalAmountDeducted = reportData.reduce((sum, loan) => sum + (loan.amount_deducted || 0), 0);
  const totalMonthlyDeductions = reportData.reduce((sum, loan) => sum + (loan.monthly_deduction || 0), 0);
  const activeLoans = reportData.filter(loan => loan.status === 'Active' || loan.status === 'Disbursed').length;
  const completedLoans = reportData.filter(loan => loan.status === 'Completed').length;
  const pendingLoans = reportData.filter(loan => loan.status === 'Pending').length;

  // Calculate M-Pesa transaction totals
  const totalMpesaTransactions = reportData.reduce((sum, loan) => 
    sum + (loan.mpesa_transactions?.length || 0), 0
  );
  const totalMpesaAmount = reportData.reduce((sum, loan) => 
    sum + (loan.mpesa_transactions?.reduce((mpesaSum, transaction) => 
      mpesaSum + (transaction.amount || 0), 0) || 0), 0
  );

  // Group loans by employee
  const employeeLoans = reportData.reduce((acc, loan) => {
    const empId = loan.employee_number;
    if (!acc[empId]) {
      acc[empId] = {
        employee: loan,
        loans: [],
        totalLoanAmount: 0,
        totalApprovedAmount: 0,
        totalAmountDeducted: 0,
        totalMonthlyDeductions: 0,
        loanCount: 0
      };
    }
    acc[empId].loans.push(loan);
    acc[empId].totalLoanAmount += loan.loan_amount || 0;
    acc[empId].totalApprovedAmount += loan.approved_amount || 0;
    acc[empId].totalAmountDeducted += loan.amount_deducted || 0;
    acc[empId].totalMonthlyDeductions += loan.monthly_deduction || 0;
    acc[empId].loanCount += 1;
    return acc;
  }, {} as Record<string, any>);

  const employeeLoanArray = Object.values(employeeLoans);
  const totalEmployees = employeeLoanArray.length;
  const totalLoans = reportData.length;

  // Calculate paginated data for employee groups
  const totalItems = employeeLoanArray.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedEmployeeData = employeeLoanArray.slice(startIndex, endIndex);

  // Reset to first page when filters change or data updates
  useEffect(() => {
    setCurrentPage(1);
  }, [filters.town, filters.employeeNumber, reportData]);

  // Fetch initial employee data and their loans
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

        // Fetch staff loans
        const { data: loansData } = await supabase
          .from('staff_loans')
          .select('*')
          .order('application_date', { ascending: false });

        // Fetch M-Pesa transactions
        const { data: mpesaData } = await supabase
          .from('mpesa_transactions')
          .select('*')
          .order('transaction_date', { ascending: false });

        if (employeesData) {
          // Combine employee data with their loans and M-Pesa transactions
          const loanTableData: StaffLoanData[] = [];
          
          employeesData.forEach(emp => {
            const employeeLoans = loansData?.filter(
              loan => loan.employee_number === emp['Employee Number']
            ) || [];

            if (employeeLoans.length > 0) {
              // Create an entry for each loan
              employeeLoans.forEach(loan => {
                const loanMpesaTransactions = mpesaData?.filter(
                  transaction => transaction.loan_id === loan.id
                ) || [];

                loanTableData.push({
                  id: `${emp['Employee Number']}-${loan.id}`,
                  employee_number: emp['Employee Number'],
                  first_name: emp['First Name'] || '',
                  last_name: emp['Last Name'] || '',
                  town: emp.Town || '',
                  branch: emp.Branch || '',
                  phone_number: emp['Mobile Number'] || '',
                  loan_type: loan.loan_type,
                  application_date: loan.application_date,
                  application_time: loan.application_time,
                  loan_amount: loan.loan_amount,
                  approved_amount: loan.approved_amount,
                  interest_rate: loan.interest_rate,
                  repayment_period: loan.repayment_period,
                  purpose: loan.purpose,
                  status: loan.status,
                  approved_by: loan.approved_by,
                  approval_date: loan.approval_date,
                  approval_time: loan.approval_time,
                  disbursement_date: loan.disbursement_date,
                  disbursement_time: loan.disbursement_time,
                  disbursement_method: loan.disbursement_method,
                  bank_account: loan.bank_account,
                  bank_name: loan.bank_name,
                  cheque_number: loan.cheque_number,
                  mpesa_code: loan.mpesa_code,
                  monthly_deduction: loan.monthly_deduction,
                  total_repayable: loan.total_repayable,
                  amount_deducted: loan.amount_deducted,
                  amount_remaining: loan.amount_remaining,
                  last_deduction_date: loan.last_deduction_date,
                  next_deduction_date: loan.next_deduction_date,
                  deduction_status: loan.deduction_status,
                  mpesa_transactions: loanMpesaTransactions,
                  security_details: loan.security_details,
                  guarantor1_name: loan.guarantor1_name,
                  guarantor1_employee_number: loan.guarantor1_employee_number,
                  guarantor2_name: loan.guarantor2_name,
                  guarantor2_employee_number: loan.guarantor2_employee_number,
                  remarks: loan.remarks,
                  created_at: loan.created_at,
                  updated_at: loan.updated_at
                });
              });
            } else {
              // Employee with no loans - show basic info
              loanTableData.push({
                id: emp['Employee Number'],
                employee_number: emp['Employee Number'],
                first_name: emp['First Name'] || '',
                last_name: emp['Last Name'] || '',
                town: emp.Town || '',
                branch: emp.Branch || '',
                phone_number: emp['Mobile Number'] || '',
                loan_type: 'Other',
                application_date: undefined,
                application_time: undefined,
                loan_amount: undefined,
                approved_amount: undefined,
                interest_rate: undefined,
                repayment_period: undefined,
                purpose: undefined,
                status: undefined,
                approved_by: undefined,
                approval_date: undefined,
                approval_time: undefined,
                disbursement_date: undefined,
                disbursement_time: undefined,
                disbursement_method: undefined,
                bank_account: undefined,
                bank_name: undefined,
                cheque_number: undefined,
                mpesa_code: undefined,
                monthly_deduction: undefined,
                total_repayable: undefined,
                amount_deducted: undefined,
                amount_remaining: undefined,
                last_deduction_date: undefined,
                next_deduction_date: undefined,
                deduction_status: undefined,
                mpesa_transactions: undefined,
                security_details: undefined,
                guarantor1_name: undefined,
                guarantor1_employee_number: undefined,
                guarantor2_name: undefined,
                guarantor2_employee_number: undefined,
                remarks: undefined,
                created_at: undefined,
                updated_at: undefined
              });
            }
          });

          setEmployees(employeesData);
          setFilteredEmployees(employeesData);
          setReportData(loanTableData);
        }
      } catch (error) {
        console.error('Error fetching employee data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchEmployeeData();
  }, []);

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
      'Loan Type',
      'Application Date',
      'Loan Amount',
      'Approved Amount',
      'Interest Rate',
      'Repayment Period',
      'Monthly Deduction',
      'Total Repayable',
      'Amount Deducted',
      'Amount Remaining',
      'Last Deduction Date',
      'Next Deduction Date',
      'Loan Status',
      'Deduction Status',
      'Disbursement Method',
      'M-Pesa Code',
      'Approved By'
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
          row.loan_type || '',
          row.application_date || '',
          row.loan_amount || '',
          row.approved_amount || '',
          row.interest_rate || '',
          row.repayment_period || '',
          row.monthly_deduction || '',
          row.total_repayable || '',
          row.amount_deducted || '',
          row.amount_remaining || '',
          row.last_deduction_date || '',
          row.next_deduction_date || '',
          row.status || '',
          row.deduction_status || '',
          row.disbursement_method || '',
          `"${row.mpesa_code}"` || '',
          `"${row.approved_by}"` || ''
        ].join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff-loans-deduction-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    const resetFilters = {
      startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      town: selectedTown || '',
      employeeNumber: '',
      employeeName: '',
      loanType: '',
      status: ''
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

  // Accounting-style render function for staff loans with salary deduction
  const renderLoansReportData = (employeeData: any[]) => (
    <>
      {/* Traditional Accounting Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 bg-gray-50 border-b border-gray-300">
        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Loan Portfolio</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalLoanPortfolio)}</p>
          <p className="text-xs text-gray-500 mt-1">Approved amount</p>
        </div>

        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Active Salary Deductions</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{activeLoans}</p>
          <p className="text-xs text-gray-500 mt-1">{totalLoans} total loans</p>
        </div>

        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Amount Deducted</p>
          <p className="text-xl font-bold text-green-700 mt-1">{formatCurrency(totalAmountDeducted)}</p>
          <p className="text-xs text-gray-500 mt-1">Via salary deductions</p>
        </div>

        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">M-Pesa Transactions</p>
          <p className="text-xl font-bold text-blue-700 mt-1">{totalMpesaTransactions}</p>
          <p className="text-xs text-gray-500 mt-1">{formatCurrency(totalMpesaAmount)} total</p>
        </div>
      </div>

      {/* Loans Accounting Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-75 border-b border-gray-300">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                Employee & Loan Details
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                Salary Deduction Schedule
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                Deduction Progress
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                M-Pesa & Disbursement
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-300">
            {employeeData.map((employeeGroup: any) => {
              const { employee, loans, totalApprovedAmount, totalAmountDeducted, totalMonthlyDeductions, loanCount } = employeeGroup;
              const recentLoan = loans[0]; // Most recent loan

              return (
                <tr key={employee.employee_number} className="hover:bg-gray-50 border-b border-gray-200">
                  {/* Employee & Loan Details */}
                  <td className="px-4 py-3 border-r border-gray-300">
                    <div className="text-sm font-semibold text-gray-900">
                      {employee.first_name} {employee.last_name}
                    </div>
                    <div className="text-xs text-gray-600 font-mono">{employee.employee_number}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {employee.town || 'N/A'} • {employee.branch || 'N/A'}
                    </div>
                    
                    {recentLoan && (
                      <>
                        <div className="mt-2">
                          <span className="text-xs font-medium text-gray-600">Latest Loan:</span>
                          <div className="text-sm text-gray-900">{recentLoan.loan_type}</div>
                          <div className="text-xs text-gray-500">
                            {formatAccountingDate(recentLoan.application_date)}
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {loanCount} {loanCount === 1 ? 'loan' : 'loans'} total
                        </div>
                      </>
                    )}
                  </td>

                  {/* Salary Deduction Schedule */}
                  <td className="px-4 py-3 border-r border-gray-300">
                    {recentLoan ? (
                      <div className="space-y-2">
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">Monthly Deduction</div>
                          <div className="font-semibold text-gray-900">
                            {formatCurrency(recentLoan.monthly_deduction)}
                          </div>
                        </div>
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">Next Deduction</div>
                          <div className="font-semibold text-blue-700">
                            {formatAccountingDate(recentLoan.next_deduction_date)}
                          </div>
                        </div>
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">Last Deduction</div>
                          <div className="font-semibold text-gray-700">
                            {formatAccountingDate(recentLoan.last_deduction_date) || 'Not started'}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Deduction Status</div>
                          <LoanStatusBadge status={recentLoan.deduction_status} type="deduction" />
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 italic">No deduction data</div>
                    )}
                  </td>

                  {/* Deduction Progress */}
                  <td className="px-4 py-3 border-r border-gray-300">
                    {recentLoan ? (
                      <div className="space-y-2">
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Loan Status</div>
                          <LoanStatusBadge status={recentLoan.status} type="loan" />
                        </div>
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">Approved Amount</div>
                          <div className="font-semibold text-gray-900">
                            {formatCurrency(recentLoan.approved_amount)}
                          </div>
                        </div>
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">Deducted/Total</div>
                          <div className="font-semibold text-green-700">
                            {formatCurrency(recentLoan.amount_deducted)} / {formatCurrency(recentLoan.total_repayable)}
                          </div>
                        </div>
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">Remaining Balance</div>
                          <div className="font-semibold text-orange-700">
                            {formatCurrency(recentLoan.amount_remaining)}
                          </div>
                        </div>
                        {recentLoan.interest_rate && (
                          <div className="text-xs text-gray-600">
                            {recentLoan.interest_rate}% over {recentLoan.repayment_period} months
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 italic">No progress data</div>
                    )}
                  </td>

                  {/* M-Pesa & Disbursement */}
                  <td className="px-4 py-3">
                    {recentLoan ? (
                      <div className="space-y-2">
                        <div className="text-xs text-gray-600">
                          <div>Disbursed via: {recentLoan.disbursement_method || 'N/A'}</div>
                          <div className="text-gray-400">
                            {formatAccountingDate(recentLoan.disbursement_date)}
                          </div>
                        </div>
                        
                        {recentLoan.mpesa_code && (
                          <div className="text-xs font-mono text-blue-700 bg-blue-50 px-2 py-1 rounded border border-blue-200">
                            Ref: {recentLoan.mpesa_code}
                          </div>
                        )}

                        {recentLoan.mpesa_transactions && recentLoan.mpesa_transactions.length > 0 && (
                          <div className="mt-2">
                            <div className="text-xs font-medium text-gray-600 mb-1">
                              M-Pesa Transactions ({recentLoan.mpesa_transactions.length})
                            </div>
                            <div className="space-y-1 max-h-20 overflow-y-auto">
                              {recentLoan.mpesa_transactions.slice(0, 3).map((transaction, index) => (
                                <div key={index} className="text-xs border border-gray-200 rounded p-1 bg-gray-50">
                                  <div className="flex justify-between">
                                    <span className="font-mono">{transaction.mpesa_code}</span>
                                    <MpesaStatusBadge status={transaction.status} />
                                  </div>
                                  <div className="flex justify-between text-gray-600">
                                    <span>{formatCurrency(transaction.amount)}</span>
                                    <span>{formatAccountingDate(transaction.transaction_date)}</span>
                                  </div>
                                </div>
                              ))}
                              {recentLoan.mpesa_transactions.length > 3 && (
                                <div className="text-xs text-gray-500 text-center">
                                  +{recentLoan.mpesa_transactions.length - 3} more transactions
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="text-xs text-gray-600">
                          <div>Approved by: {recentLoan.approved_by || 'Pending'}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 italic">No disbursement data</div>
                    )}
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

  const loanTypeOptions = [
    { value: '', label: 'All Types' },
    { value: 'Emergency', label: 'Emergency Loan' },
    { value: 'Development', label: 'Development Loan' },
    { value: 'School Fees', label: 'School Fees Loan' },
    { value: 'Mortgage', label: 'Mortgage Loan' },
    { value: 'Vehicle', label: 'Vehicle Loan' },
    { value: 'Other', label: 'Other' }
  ];

  const statusOptions = [
    { value: '', label: 'All Statuses' },
    { value: 'Pending', label: 'Pending' },
    { value: 'Approved', label: 'Approved' },
    { value: 'Rejected', label: 'Rejected' },
    { value: 'Disbursed', label: 'Disbursed' },
    { value: 'Active', label: 'Active' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Written Off', label: 'Written Off' }
  ];

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Accounting Report Header */}
        <div className="mb-6 bg-white rounded-lg border border-gray-300 p-6 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Staff Loans - Salary Deduction Report
              </h1>
              <p className="text-gray-600">Comprehensive overview of staff loan portfolio with automatic salary deductions</p>
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
                <button
                  onClick={handleExport}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium shadow-sm transition-colors"
                >
                  <Download className="w-3 h-3" />
                  Export to Excel
                </button>
              )}
            </div>

            <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded border border-gray-300">
              <span>Total Records: {employeeLoanArray.length} • Page {currentPage} of {totalPages}</span>
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

                {/* Loan Type Filter */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Loan Type
                  </label>
                  <SearchableDropdown
                    options={loanTypeOptions}
                    value={filters.loanType}
                    onChange={(value) => handleFilterChange('loanType', value)}
                    placeholder="Select Loan Type"
                  />
                </div>

                {/* Status Filter */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Status
                  </label>
                  <SearchableDropdown
                    options={statusOptions}
                    value={filters.status}
                    onChange={(value) => handleFilterChange('status', value)}
                    placeholder="Select Status"
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
            renderLoansReportData(paginatedEmployeeData)
          )}
        </div>
      </div>
    </div>
  );
};

export default StaffLoansReport;