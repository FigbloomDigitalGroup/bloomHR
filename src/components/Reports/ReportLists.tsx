import React, { useState } from 'react';
import { 
  FileText, 
  DollarSign, 
  TrendingUp, 
  MessageSquare, 
  CreditCard, 
  Scale,
  PieChart,
  ArrowRight,
  Building,
  ChevronLeft,
  ChevronRight,
  UserX,
  CalendarDays,
  Search
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../UI';

interface ReportItem {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  category: string;
  path: string;
}

const CATEGORY_TINTS: Record<string, string> = {
  Payroll: 'bg-status-info-tint text-status-info',
  Operations: 'bg-green-tint text-brand-dark',
  Communication: 'bg-status-purple-tint text-status-purple',
  Finance: 'bg-orange-tint text-orange-text',
  HR: 'bg-orange-tint-alt text-orange-text-alt',
};

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
    <div className="p-6 bg-background min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-[18px]">
          <h1 className="text-[21px] font-bold text-ink">Reports</h1>
          <p className="text-[12.5px] text-muted-foreground mt-1">Access and generate various organizational reports</p>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col md:flex-row gap-3 mb-5 max-w-[640px]">
          <div className="relative flex-1 max-w-[420px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle w-3.5 h-3.5" />
            <input
              type="text"
              placeholder="Search reports..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full box-border pl-8 pr-3 py-2.5 border border-border rounded-tile text-xs focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
            />
          </div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2.5 border border-border rounded-tile text-xs bg-white focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
          >
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </div>

        {/* Results Count */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11.5px] text-muted-foreground">
            Showing {paginatedReports.length} of {filteredReports.length} reports
          </p>
          {totalPages > 1 && (
            <p className="text-[11.5px] text-muted-foreground">
              Page {currentPage} of {totalPages}
            </p>
          )}
        </div>

        {/* Reports Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {paginatedReports.map((report) => {
            const Icon = report.icon;
            const tint = CATEGORY_TINTS[report.category] || 'bg-secondary text-muted-foreground';
            return (
              <div
                key={report.id}
                onClick={() => handleReportClick(report)}
                className="bg-white rounded-card border border-border p-[18px] hover:border-brand/30 transition-colors cursor-pointer group"
              >
                <div className="flex items-center justify-between mb-3.5">
                  <div className={`w-9 h-9 rounded-tile flex items-center justify-center ${tint}`}>
                    <Icon className="w-4 h-4" strokeWidth={1.8} />
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-subtle group-hover:text-brand transition-colors" />
                </div>

                <h3 className="text-[14px] font-bold text-ink mb-1">
                  {report.title}
                </h3>

                <p className="text-[11.5px] text-muted-foreground leading-relaxed line-clamp-2">
                  {report.description}
                </p>

                <div className="flex items-center justify-between mt-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-pill text-[10px] font-bold bg-secondary text-muted-foreground`}>
                    {report.category}
                  </span>
                  <span className="text-[11px] font-bold text-brand">View Report</span>
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
                        ? 'bg-brand text-white'
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
          <EmptyState
            icon={<FileText className="w-[18px] h-[18px]" strokeWidth={2} />}
            title="No reports found"
            description="Try adjusting your search or filter criteria"
          />
        )}
      </div>
    </div>
  );
};

export default ReportsList;