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
  Shield,
  FileText,
  CheckCircle,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Landmark,
  Calculator,
  Receipt
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

interface StatutoryDeductionData {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  town: string;
  branch: string;
  department: string;
  job_title: string;
  phone_number?: string;
  
  // Statutory Deduction Types - Kenya Specific
  deduction_type: 'NHIF' | 'PAYE' | 'AHL' | 'NSSF' | 'NITA';
  deduction_period: string;
  
  // NSSF Deductions
  nssf_number?: string;
  nssf_tier?: 'I' | 'II';
  nssf_employee_contribution?: number;
  nssf_employer_contribution?: number;
  nssf_total_contribution?: number;
  
  // NHIF Deductions
  nhif_number?: string;
  nhif_amount?: number;
  nhif_dependents?: number;
  nhif_tier?: string;
  
  // PAYE Deductions
  paye_amount?: number;
  personal_relief?: number;
  insurance_relief?: number;
  taxable_income?: number;
  tax_band?: string;
  
  // AHL Deductions
  ahl_employee_contribution?: number;
  ahl_employer_contribution?: number;
  ahl_total_contribution?: number;
  ahl_number?: string;
  
  // NITA Deductions
  nita_amount?: number;
  nita_training_levy?: number;
  nita_number?: string;
  
  // Totals & Status
  total_statutory_deductions?: number;
  status?: 'Processed' | 'Pending' | 'Submitted' | 'Verified' | 'Paid' | 'Overdue';
  processed_date?: string;
  submitted_date?: string;
  
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

// Compliance Status Badge Component
const ComplianceStatusBadge: React.FC<{ status?: string; type: 'deduction' | 'filing' }> = ({ status, type }) => {
  if (!status) {
    return (
      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-300">
        No Data
      </span>
    );
  }

  const getStatusConfig = () => {
    if (type === 'deduction') {
      switch (status) {
        case 'Processed':
          return { color: 'bg-green-50 text-green-700 border-green-200' };
        case 'Pending':
          return { color: 'bg-amber-50 text-amber-700 border-amber-200' };
        case 'Submitted':
          return { color: 'bg-blue-50 text-blue-700 border-blue-200' };
        case 'Verified':
          return { color: 'bg-purple-50 text-purple-700 border-purple-200' };
        case 'Paid':
          return { color: 'bg-gray-50 text-gray-700 border-gray-300' };
        case 'Overdue':
          return { color: 'bg-red-50 text-red-700 border-red-200' };
        default:
          return { color: 'bg-gray-50 text-gray-600 border-gray-300' };
      }
    } else {
      switch (status) {
        case 'On Time':
          return { color: 'bg-green-50 text-green-700 border-green-200' };
        case 'Late':
          return { color: 'bg-red-50 text-red-700 border-red-200' };
        case 'Upcoming':
          return { color: 'bg-blue-50 text-blue-700 border-blue-200' };
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

// Format currency for accounting
const formatCurrency = (amount?: number) => {
  if (!amount) return 'KES 0.00';
  return `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Format date for accounting reports
const formatAccountingDate = (dateString?: string) => {
  if (!dateString) return '-';
  
  const date = new Date(dateString);
  
  return date.toLocaleDateString('en-KE', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric' 
  });
};

// Format period for display
const formatPeriod = (period: string) => {
  if (!period) return '-';
  const [year, month] = period.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
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

const StatutoryDeductionsReport: React.FC<BaseReportProps> = ({
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
  const [reportData, setReportData] = useState<StatutoryDeductionData[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Calculate totals for accounting summary - grouped by employee
  const employeeDeductions = reportData.reduce((acc, deduction) => {
    const empId = deduction.employee_number;
    if (!acc[empId]) {
      acc[empId] = {
        employee: deduction,
        deductions: [],
        totalNSSF: 0,
        totalNHIF: 0,
        totalPAYE: 0,
        totalAHL: 0,
        totalNITA: 0,
        deductionCount: 0
      };
    }
    acc[empId].deductions.push(deduction);
    acc[empId].totalNSSF += deduction.nssf_total_contribution || 0;
    acc[empId].totalNHIF += deduction.nhif_amount || 0;
    acc[empId].totalPAYE += deduction.paye_amount || 0;
    acc[empId].totalAHL += deduction.ahl_total_contribution || 0;
    acc[empId].totalNITA += deduction.nita_amount || 0;
    acc[empId].deductionCount += 1;
    return acc;
  }, {} as Record<string, any>);

  const employeeDeductionArray = Object.values(employeeDeductions);
  const totalNSSF = employeeDeductionArray.reduce((sum: number, emp: any) => sum + emp.totalNSSF, 0);
  const totalNHIF = employeeDeductionArray.reduce((sum: number, emp: any) => sum + emp.totalNHIF, 0);
  const totalPAYE = employeeDeductionArray.reduce((sum: number, emp: any) => sum + emp.totalPAYE, 0);
  const totalAHL = employeeDeductionArray.reduce((sum: number, emp: any) => sum + emp.totalAHL, 0);
  const totalNITA = employeeDeductionArray.reduce((sum: number, emp: any) => sum + emp.totalNITA, 0);
  const totalEmployees = employeeDeductionArray.length;
  const totalDeductions = reportData.length;

  // Calculate paginated data for employee groups
  const totalItems = employeeDeductionArray.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedEmployeeData = employeeDeductionArray.slice(startIndex, endIndex);

  // Reset to first page when filters change or data updates
  useEffect(() => {
    setCurrentPage(1);
  }, [filters.town, filters.employeeNumber, reportData]);

  // Fetch initial employee data and their statutory deductions
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
            Department,
            "Job Title",
            "Mobile Number"
          `)
          .order('"First Name"');

        // Fetch statutory deductions
        const { data: deductionsData } = await supabase
          .from('statutory_deductions')
          .select('*')
          .order('deduction_period', { ascending: false });

        if (employeesData) {
          // Combine employee data with their statutory deductions
          const deductionTableData: StatutoryDeductionData[] = [];
          
          employeesData.forEach(emp => {
            const employeeDeductions = deductionsData?.filter(
              deduction => deduction.employee_number === emp['Employee Number']
            ) || [];

            if (employeeDeductions.length > 0) {
              // Create an entry for each deduction
              employeeDeductions.forEach(deduction => {
                deductionTableData.push({
                  id: `${emp['Employee Number']}-${deduction.id}`,
                  employee_number: emp['Employee Number'],
                  first_name: emp['First Name'] || '',
                  last_name: emp['Last Name'] || '',
                  town: emp.Town || '',
                  branch: emp.Branch || '',
                  department: emp.Department || '',
                  job_title: emp['Job Title'] || '',
                  phone_number: emp['Mobile Number'] || '',
                  deduction_type: deduction.deduction_type,
                  deduction_period: deduction.deduction_period,
                  nssf_number: deduction.nssf_number,
                  nssf_tier: deduction.nssf_tier,
                  nssf_employee_contribution: deduction.nssf_employee_contribution,
                  nssf_employer_contribution: deduction.nssf_employer_contribution,
                  nssf_total_contribution: deduction.nssf_total_contribution,
                  nhif_number: deduction.nhif_number,
                  nhif_amount: deduction.nhif_amount,
                  nhif_dependents: deduction.nhif_dependents,
                  nhif_tier: deduction.nhif_tier,
                  paye_amount: deduction.paye_amount,
                  personal_relief: deduction.personal_relief,
                  insurance_relief: deduction.insurance_relief,
                  taxable_income: deduction.taxable_income,
                  tax_band: deduction.tax_band,
                  ahl_employee_contribution: deduction.ahl_employee_contribution,
                  ahl_employer_contribution: deduction.ahl_employer_contribution,
                  ahl_total_contribution: deduction.ahl_total_contribution,
                  ahl_number: deduction.ahl_number,
                  nita_amount: deduction.nita_amount,
                  nita_training_levy: deduction.nita_training_levy,
                  nita_number: deduction.nita_number,
                  total_statutory_deductions: deduction.total_statutory_deductions,
                  status: deduction.status,
                  processed_date: deduction.processed_date,
                  submitted_date: deduction.submitted_date,
                  remarks: deduction.remarks,
                  created_at: deduction.created_at,
                  updated_at: deduction.updated_at
                });
              });
            } else {
              // Employee with no deductions - show basic info
              deductionTableData.push({
                id: emp['Employee Number'],
                employee_number: emp['Employee Number'],
                first_name: emp['First Name'] || '',
                last_name: emp['Last Name'] || '',
                town: emp.Town || '',
                branch: emp.Branch || '',
                department: emp.Department || '',
                job_title: emp['Job Title'] || '',
                phone_number: emp['Mobile Number'] || '',
                deduction_type: 'NSSF',
                deduction_period: new Date().toISOString().slice(0, 7),
                status: 'Pending',
                nssf_employee_contribution: 0,
                nssf_employer_contribution: 0,
                nssf_total_contribution: 0,
                nhif_amount: 0,
                paye_amount: 0,
                ahl_employee_contribution: 0,
                ahl_employer_contribution: 0,
                ahl_total_contribution: 0,
                nita_amount: 0,
                total_statutory_deductions: 0
              });
            }
          });

          setEmployees(employeesData);
          setFilteredEmployees(employeesData);
          setReportData(deductionTableData);
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

    // Update report data with filtered employees and their deductions
    const fetchFilteredData = async () => {
      const { data: deductionsData } = await supabase
        .from('statutory_deductions')
        .select('*')
        .order('deduction_period', { ascending: false });

      const filteredReportData: StatutoryDeductionData[] = [];
      
      filtered.forEach(emp => {
        const employeeDeductions = deductionsData?.filter(
          deduction => deduction.employee_number === emp['Employee Number']
        ) || [];

        if (employeeDeductions.length > 0) {
          employeeDeductions.forEach(deduction => {
            filteredReportData.push({
              id: `${emp['Employee Number']}-${deduction.id}`,
              employee_number: emp['Employee Number'],
              first_name: emp['First Name'] || '',
              last_name: emp['Last Name'] || '',
              town: emp.Town || '',
              branch: emp.Branch || '',
              department: emp.Department || '',
              job_title: emp['Job Title'] || '',
              phone_number: emp['Mobile Number'] || '',
              deduction_type: deduction.deduction_type,
              deduction_period: deduction.deduction_period,
              nssf_number: deduction.nssf_number,
              nssf_tier: deduction.nssf_tier,
              nssf_employee_contribution: deduction.nssf_employee_contribution,
              nssf_employer_contribution: deduction.nssf_employer_contribution,
              nssf_total_contribution: deduction.nssf_total_contribution,
              nhif_number: deduction.nhif_number,
              nhif_amount: deduction.nhif_amount,
              nhif_dependents: deduction.nhif_dependents,
              nhif_tier: deduction.nhif_tier,
              paye_amount: deduction.paye_amount,
              personal_relief: deduction.personal_relief,
              insurance_relief: deduction.insurance_relief,
              taxable_income: deduction.taxable_income,
              tax_band: deduction.tax_band,
              ahl_employee_contribution: deduction.ahl_employee_contribution,
              ahl_employer_contribution: deduction.ahl_employer_contribution,
              ahl_total_contribution: deduction.ahl_total_contribution,
              ahl_number: deduction.ahl_number,
              nita_amount: deduction.nita_amount,
              nita_training_levy: deduction.nita_training_levy,
              nita_number: deduction.nita_number,
              total_statutory_deductions: deduction.total_statutory_deductions,
              status: deduction.status,
              processed_date: deduction.processed_date,
              submitted_date: deduction.submitted_date,
              remarks: deduction.remarks,
              created_at: deduction.created_at,
              updated_at: deduction.updated_at
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
            department: emp.Department || '',
            job_title: emp['Job Title'] || '',
            phone_number: emp['Mobile Number'] || '',
            deduction_type: 'NSSF',
            deduction_period: new Date().toISOString().slice(0, 7),
            status: 'Pending',
            nssf_employee_contribution: 0,
            nssf_employer_contribution: 0,
            nssf_total_contribution: 0,
            nhif_amount: 0,
            paye_amount: 0,
            ahl_employee_contribution: 0,
            ahl_employer_contribution: 0,
            ahl_total_contribution: 0,
            nita_amount: 0,
            total_statutory_deductions: 0
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
      'Department',
      'Deduction Type',
      'Period',
      'NSSF Employee',
      'NSSF Employer',
      'NSSF Total',
      'NHIF Amount',
      'PAYE Amount',
      'AHL Employee',
      'AHL Employer',
      'AHL Total',
      'NITA Amount',
      'Total Deductions',
      'Status'
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
          `"${row.department}"`,
          row.deduction_type || '',
          row.deduction_period || '',
          row.nssf_employee_contribution || '',
          row.nssf_employer_contribution || '',
          row.nssf_total_contribution || '',
          row.nhif_amount || '',
          row.paye_amount || '',
          row.ahl_employee_contribution || '',
          row.ahl_employer_contribution || '',
          row.ahl_total_contribution || '',
          row.nita_amount || '',
          row.total_statutory_deductions || '',
          row.status || ''
        ].join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statutory-deductions-report-${new Date().toISOString().split('T')[0]}.csv`;
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

  // Accounting-style render function for statutory deductions
  const renderDeductionsReportData = (employeeData: any[]) => (
    <>
      {/* Traditional Accounting Summary Cards - No Icons */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 bg-gray-50 border-b border-gray-300">
        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total NSSF</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalNSSF)}</p>
          <p className="text-xs text-gray-500 mt-1">Social Security Fund</p>
        </div>

        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total NHIF</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalNHIF)}</p>
          <p className="text-xs text-gray-500 mt-1">Health Insurance</p>
        </div>

        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total PAYE</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalPAYE)}</p>
          <p className="text-xs text-gray-500 mt-1">Income Tax</p>
        </div>

        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total AHL</p>
          <p className="text-xl font-bold text-green-700 mt-1">{formatCurrency(totalAHL)}</p>
          <p className="text-xs text-gray-500 mt-1">Housing Levy</p>
        </div>
      </div>

      {/* Additional Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 bg-gray-50 border-b border-gray-300">
        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total NITA</p>
          <p className="text-xl font-bold text-purple-700 mt-1">{formatCurrency(totalNITA)}</p>
          <p className="text-xs text-gray-500 mt-1">Training Levy</p>
        </div>

        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Employees</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{totalEmployees}</p>
          <p className="text-xs text-gray-500 mt-1">Across all locations</p>
        </div>

        <div className="bg-white p-3 rounded border border-gray-300 shadow-sm">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Deductions</p>
          <p className="text-xl font-bold text-blue-700 mt-1">{totalDeductions}</p>
          <p className="text-xs text-gray-500 mt-1">All deduction records</p>
        </div>
      </div>

      {/* Statutory Deductions Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-75 border-b border-gray-300">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                Employee Details
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                NSSF & NHIF
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                PAYE & AHL
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                NITA & Status
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-300">
            {employeeData.map((employeeGroup: any) => {
              const { employee, deductions, totalNSSF, totalNHIF, totalPAYE, totalAHL, totalNITA, deductionCount } = employeeGroup;
              const recentDeduction = deductions[0];

              return (
                <tr key={employee.employee_number} className="hover:bg-gray-50 border-b border-gray-200">
                  {/* Employee Details */}
                  <td className="px-4 py-3 border-r border-gray-300">
                    <div className="text-sm font-semibold text-gray-900">
                      {employee.first_name} {employee.last_name}
                    </div>
                    <div className="text-xs text-gray-600 font-mono">{employee.employee_number}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {employee.town || 'N/A'} • {employee.branch || 'N/A'}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {employee.department || 'No Department'}
                    </div>
                    {employee.phone_number && (
                      <div className="text-xs text-gray-600 mt-1">
                        {employee.phone_number}
                      </div>
                    )}
                  </td>

                  {/* NSSF & NHIF */}
                  <td className="px-4 py-3 border-r border-gray-300">
                    {deductionCount > 0 ? (
                      <div className="space-y-2">
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">NSSF Contributions</div>
                          <div className="font-semibold text-gray-900">
                            {formatCurrency(totalNSSF)}
                          </div>
                          {recentDeduction.nssf_tier && (
                            <div className="text-xs text-gray-500">
                              Tier {recentDeduction.nssf_tier}
                              {recentDeduction.nssf_number && ` • ${recentDeduction.nssf_number}`}
                            </div>
                          )}
                        </div>
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">NHIF Contributions</div>
                          <div className="font-semibold text-blue-700">
                            {formatCurrency(totalNHIF)}
                          </div>
                          {recentDeduction.nhif_tier && (
                            <div className="text-xs text-gray-500">
                              {recentDeduction.nhif_tier}
                              {recentDeduction.nhif_dependents && ` • ${recentDeduction.nhif_dependents} dependents`}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 italic">No deduction data</div>
                    )}
                  </td>

                  {/* PAYE & AHL */}
                  <td className="px-4 py-3 border-r border-gray-300">
                    {deductionCount > 0 ? (
                      <div className="space-y-2">
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">PAYE Tax</div>
                          <div className="font-semibold text-red-700">
                            {formatCurrency(totalPAYE)}
                          </div>
                          {recentDeduction.tax_band && (
                            <div className="text-xs text-gray-500">
                              {recentDeduction.tax_band}
                            </div>
                          )}
                        </div>
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">Housing Levy (AHL)</div>
                          <div className="font-semibold text-green-700">
                            {formatCurrency(totalAHL)}
                          </div>
                          <div className="text-xs text-gray-500">
                            1.5% Employee + 1.5% Employer
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 italic">No tax data</div>
                    )}
                  </td>

                  {/* NITA & Status */}
                  <td className="px-4 py-3">
                    {recentDeduction ? (
                      <div className="space-y-2">
                        <div className="text-sm">
                          <div className="text-gray-600 text-xs">NITA Levy</div>
                          <div className="font-semibold text-purple-700">
                            {formatCurrency(totalNITA)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Deduction Status</div>
                          <ComplianceStatusBadge status={recentDeduction.status} type="deduction" />
                        </div>
                        <div className="text-xs text-gray-600">
                          <div>Period: {formatPeriod(recentDeduction.deduction_period)}</div>
                          {recentDeduction.processed_date && (
                            <div>Processed: {formatAccountingDate(recentDeduction.processed_date)}</div>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          {deductionCount} deduction periods
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 italic">No compliance data</div>
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

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Accounting Report Header */}
        <div className="mb-6 bg-white rounded-lg border border-gray-300 p-6 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Statutory Deductions Report
              </h1>
              <p className="text-gray-600">Comprehensive overview of NSSF, NHIF, PAYE, AHL, and NITA statutory deductions</p>
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
              <span>Total Records: {employeeDeductionArray.length} • Page {currentPage} of {totalPages}</span>
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
            renderDeductionsReportData(paginatedEmployeeData)
          )}
        </div>
      </div>
    </div>
  );
};

export default StatutoryDeductionsReport;