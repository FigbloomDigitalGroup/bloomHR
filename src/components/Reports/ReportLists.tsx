import React, { useState } from 'react';
import { 
  FileText, 
  DollarSign, 
  TrendingUp, 
  MessageSquare, 
  CreditCard, 
  Scale, 
  Users,
  PieChart,
  ArrowRight,
  Building,
  Calendar,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
  UserX,
  CalendarDays
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ReportItem {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  category: string;
  path: string;
}

const REPORTS_LIST: ReportItem[] = [
  {
    id: 'salary-advance',
    title: 'Staff Salary Advance',
    description: 'View and manage employee salary advance requests and records',
    icon: DollarSign,
    category: 'Payroll',
    path: '/reports/base'
  },
  {
    id: 'staff-loans',
    title: 'Staff Loans',
    description: 'Track employee loan applications, approvals, and repayment schedules',
    icon: CreditCard,
    category: 'Payroll',
    path: '/reports/staffloan'
  },
  {
    id: 'statutory-deductions',
    title: 'Staff Statutory Deductions',
    description: 'Reports on PAYE, NSSF, NHIF, and other statutory deductions',
    icon: Scale,
    category: 'Payroll',
    path: '/reports/statutory'
  },
  {
    id: 'staff-salary',
    title: 'Staff Salary',
    description: 'Comprehensive salary reports and payslips for all employees',
    icon: FileText,
    category: 'Payroll',
    path: '/reports/staff-salary'
  },
  {
    id: 'other-deductions',
    title: 'Staff Other Deductions',
    description: 'Reports on non-statutory deductions like welfare, loans, etc.',
    icon: PieChart,
    category: 'Payroll',
    path: '/reports/statutory'
  },
  {
    id: 'branch-performance',
    title: 'Branch Performance',
    description: 'Performance metrics and analytics across all branches',
    icon: Building,
    category: 'Operations',
    path: '/reports/branch-performance'
  },
  {
    id: 'sms-reports',
    title: 'SMS Reports',
    description: 'SMS delivery reports and communication analytics',
    icon: MessageSquare,
    category: 'Communication',
    path: '/reports/sms-reports'
  },
  {
    id: 'expense-report',
    title: 'Expense Report',
    description: 'Track and analyze company expenses across departments',
    icon: TrendingUp,
    category: 'Finance',
    path: '/reports/expense-report'
  },
  {
    id: 'termination-report',
    title: 'Termination Report',
    description: 'Employee termination records, exit interviews, and turnover analytics',
    icon: UserX,
    category: 'HR',
    path: '/reports/termination-report'
  },
  {
    id: 'leave-management',
    title: 'Leave Management Report',
    description: 'Employee leave requests, approvals, balances, and attendance tracking',
    icon: CalendarDays,
    category: 'HR',
    path: '/reports/leave-management'
  }
];

const ITEMS_PER_PAGE = 6;

const ReportsList: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);

  const categories = ['All', ...new Set(REPORTS_LIST.map(report => report.category))];

  const filteredReports = REPORTS_LIST.filter(report => {
    const matchesSearch = report.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         report.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || report.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Pagination calculations
  const totalPages = Math.ceil(filteredReports.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedReports = filteredReports.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handleReportClick = (report: ReportItem) => {
    navigate(report.path);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Scroll to top when page changes
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory]);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Reports</h1>
          <p className="text-gray-600">Access and generate various organizational reports</p>
        </div>

        {/* Search and Filter */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <FileText className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search reports..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="w-full md:w-64">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                {categories.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Results Count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-600">
            Showing {paginatedReports.length} of {filteredReports.length} reports
          </p>
          {totalPages > 1 && (
            <p className="text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </p>
          )}
        </div>

        {/* Reports Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {paginatedReports.map((report) => {
            const Icon = report.icon;
            return (
              <div
                key={report.id}
                onClick={() => handleReportClick(report)}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow duration-200 cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
                    <Icon className="w-4 h-4" />
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors" />
                </div>
                
                <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
                  {report.title}
                </h3>
                
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                  {report.description}
                </p>
                
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    {report.category}
                  </span>
                  <span className="text-xs text-gray-500">View Report</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 pt-6">
            <div className="flex justify-between sm:justify-start sm:flex-1">
              <button
                onClick={handlePreviousPage}
                disabled={currentPage === 1}
                className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  currentPage === 1
                    ? 'text-gray-400 cursor-not-allowed'
                    : 'text-gray-700 hover:text-gray-500'
                }`}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Previous
              </button>
              
              <div className="hidden sm:flex sm:space-x-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                      currentPage === page
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-700 hover:text-gray-500'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>

              <button
                onClick={handleNextPage}
                disabled={currentPage === totalPages}
                className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  currentPage === totalPages
                    ? 'text-gray-400 cursor-not-allowed'
                    : 'text-gray-700 hover:text-gray-500'
                }`}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {filteredReports.length === 0 && (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No reports found</h3>
            <p className="text-gray-600">Try adjusting your search or filter criteria</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportsList;