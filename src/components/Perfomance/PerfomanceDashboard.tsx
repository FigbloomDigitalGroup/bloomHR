import React, { useState, useEffect } from 'react';
import {
  Users, Search, Briefcase, Building, Clock, AlertCircle, Plus,
  Edit, Trash2, Filter, X, Check, BarChart2, Target, Calendar,
  CheckCircle, Clock as ClockIcon, Download, PieChart, UserCheck,
  UserX, ArrowUpRight, ArrowDownRight, Wallet, CreditCard, Coins,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Mail, Send,
  MapPin
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { sendEmail } from '../../services/email';
//import { TownProps } from '../../lib/supabase';
// Import table components
import {
  EmployeePerformanceTable,
  BranchPerformanceTable,
} from './components/Table';
import Select from 'react-select';
import ChatFloater from '../AI/AIFloatingWidget';

type EmployeePerformance = {
  id: string;
  employee_id: string;
  full_name: string;
  branch: string;
  month: string;
  total_clients: number;
  retained_clients: number;
  new_clients_active: number;
  new_clients_inactive: number;
  retained_active: number;
  retained_inactive: number;
  total_active: number;
  total_inactive: number;
  no_of_disb: number;
  disb_amount: number;
  targeted_disb_no: number;
  targeted_disb_amount: number;
  targeted_olb: number;
  actual_olb: number;
  collected_loan_amount: number;
  overdue_loans: number;
};
type BranchPerformance = {
  id: string;
  branch: string;
  month: string;
  total_clients: number;
  retained_clients: number;
  new_clients_active: number;
  new_clients_inactive: number;
  retained_active: number;
  retained_inactive: number;
  total_active: number;
  total_inactive: number;
  no_of_disb: number;
  disb_amount: number;
  targeted_disb_no: number;
  targeted_disb_amount: number;
  targeted_olb: number;
  actual_olb: number;
  collected_loan_amount: number;
  overdue_loan_amount: number;
};
interface Employee {
  id: string;
  office: string;
  job_level: string;
}
interface Branch {
  id: string;
  "Branch Office": string;
  "Area": string;
  "Town": string;
}
interface Client {
  client_id: string;
  first_name: string;
  last_name: string;
  status: string;
  loan_officer: string;
}
interface Loan {
  loan_id: string;
  client_id: string;
  loan_officer: string;
  amount_disbursed: number;
  outstanding_balance: number;
  status: string;
  disbursement_date: string;
  par_days: number;
}
interface LoanPayment {
  payment_id: number;
  loan_id: string;
  payment_date: string;
}
interface PerformanceTarget {
  id: number;
  employee_id: string;
  target_type: string;
  target_value: number;
  period: string;
  is_active: boolean;
}
interface ClientVisit {
  visit_id: number;
  employee_id: string;
}
interface AreaTownMapping {
  [area: string]: string[];
}
interface BranchAreaMapping {
  [branch: string]: string;
}
interface TownAreaMapping {
  [town: string]: string;
}
interface TownBranchMapping {
  [town: string]: string[];
}
interface BranchTownMapping {
  [branch: string]: string[];
}
const GlowButton: React.FC<{
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: React.ComponentType<{ className?: string }>;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  disabled?: boolean;
}> = ({
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
      primary: "bg-green-100 border-green-300 text-green-600 hover:bg-green-200 hover:border-green-600 hover:text-green-700 hover:shadow-[0_0_20px_rgba(34,197,94,0.5)] focus:shadow-[0_0_25px_rgba(34,197,94,0.6)]",
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
const StatusBadge: React.FC<{ status: string; value?: number }> = ({ status, value }) => {
  const statusClasses = {
    'Excellent': 'bg-green-100 text-green-800',
    'Good': 'bg-green-100 text-green-800',
    'Fair': 'bg-yellow-100 text-yellow-800',
    'Poor': 'bg-red-100 text-red-800',
  };
  let performanceStatus = 'Excellent';
  if (status === 'PAR') {
    performanceStatus = value! < 2 ? 'Excellent' : value! < 5 ? 'Good' : value! < 8 ? 'Fair' : 'Poor';
  } else if (status === 'Collection') {
    performanceStatus = value! > 97 ? 'Excellent' : value! > 95 ? 'Good' : value! > 90 ? 'Fair' : 'Poor';
  } else if (status === 'Attendance') {
    performanceStatus = value! > 95 ? 'Excellent' : value! > 90 ? 'Good' : value! > 85 ? 'Fair' : 'Poor';
  }
  return (
    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${statusClasses[performanceStatus as keyof typeof statusClasses]}`}>
      {value ? `${value}%` : performanceStatus}
    </span>
  );
};
const SummaryCard: React.FC<{
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  isPercentage?: boolean;
  unit?: string;
}> = ({
  label,
  value,
  icon: Icon,
  color,
  isPercentage = false,
  unit = ''
}) => {
    const colorClasses = {
      red: 'bg-red-100 text-red-600',
      orange: 'bg-orange-100 text-orange-600',
      green: 'bg-green-100 text-green-600',
      purple: 'bg-purple-100 text-purple-600'
    };
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className={`p-2 rounded-lg ${colorClasses[color as keyof typeof colorClasses]}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-gray-600 text-xs font-semibold uppercase tracking-wide">{label}</p>
          <p className="text-gray-900 text-xl font-bold">
            {Math.round(value)}{isPercentage ? '%' : ''}{unit ? ` ${unit}` : ''}
          </p>
        </div>
      </div>
    );
  };
const Pagination: React.FC<{
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}> = ({ currentPage, totalPages, onPageChange, className = '' }) => {
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }
  const pages = [];
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {startPage > 1 && (
          <span className="px-2 py-1">...</span>
        )}

        {pages.map(page => (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`w-10 h-10 rounded-lg border ${currentPage === page ? 'bg-green-100 border-green-500 text-green-600' : 'border-gray-200'}`}
          >
            {page}
          </button>
        ))}

        {endPage < totalPages && (
          <span className="px-2 py-1">...</span>
        )}

        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>
      <div className="text-xs text-gray-600">
        Page {currentPage} of {totalPages}
      </div>
    </div>
  );
};
const PerformanceDashboard: React.FC<TownProps> = ({ selectedTown, onTownChange, selectedRegion }) => {
  const [selectedTab, setSelectedTab] = useState<'individual' | 'branch' | 'targets' | 'clients' | 'loans' | 'payments' | 'employeePerformance' | 'branchPerformance' | 'clientVisit'>('individual');
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [selectedRole, setSelectedRole] = useState('All Roles');
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'summary' | 'detailed'>('summary');

  // Pagination states
  const [employeePage, setEmployeePage] = useState(1);
  const [branchPage, setBranchPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(9);

  // Data states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loanPayments, setLoanPayments] = useState<LoanPayment[]>([]);
  const [employeePerformance, setEmployeePerformance] = useState<EmployeePerformance[]>([]);
  const [branchPerformance, setBranchPerformance] = useState<BranchPerformance[]>([]);
  const [performanceTargets, setPerformanceTargets] = useState<PerformanceTarget[]>([]);
  const [clientVisits, setClientVisits] = useState<ClientVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);
  // Town filtering state
  const [currentTown, setCurrentTown] = useState<string>('');
  const [areaTownMapping, setAreaTownMapping] = useState<AreaTownMapping>({});
  const [branchAreaMapping, setBranchAreaMapping] = useState<BranchAreaMapping>({});
  const [townAreaMapping, setTownAreaMapping] = useState<TownAreaMapping>({});
  const [townBranchMapping, setTownBranchMapping] = useState<TownBranchMapping>({});
  const [branchTownMapping, setBranchTownMapping] = useState<BranchTownMapping>({});
  const [isArea, setIsArea] = useState<boolean>(false);
  const [townsInArea, setTownsInArea] = useState<string[]>([]);
  const [selectedTowns, setSelectedTowns] = useState<string[]>([]);
  const [eligibleBranches, setEligibleBranches] = useState<string[]>([]);
  const [debugInfo, setDebugInfo] = useState<string>("Initializing...");
  // Email state
  const [emailSending, setEmailSending] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailType, setEmailType] = useState<'individual' | 'branch'>('individual');
  const [emailRecipientType, setEmailRecipientType] = useState<'all' | 'specific'>('all');
  const [selectedEmailRecipient, setSelectedEmailRecipient] = useState<string>('');
  const [emailFrequency, setEmailFrequency] = useState<'once' | 'daily' | 'weekly' | 'monthly'>('once');
  const [emailOptions, setEmailOptions] = useState<{ individual: any[], branch: any[] }>({
    individual: [],
    branch: []
  });

  // Modal states
  const [showEmployeePerfModal, setShowEmployeePerfModal] = useState(false);
  const [showBranchPerfModal, setShowBranchPerfModal] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<any>(null);
  // Helper function to normalize strings for matching
  const normalizeString = (str: string): string => {
    return str.toLowerCase().trim().replace(/\s+/g, ' ');
  };
  // Enhanced string matching function with stricter matching
  const isStringMatch = (str1: string, str2: string): boolean => {
    if (!str1 || !str2) return false;

    const normalized1 = normalizeString(str1);
    const normalized2 = normalizeString(str2);

    // Direct match
    if (normalized1 === normalized2) return true;

    // Check without common suffixes/prefixes
    const cleanStr1 = normalized1.replace(/(branch|office|hq|headquarters)$/, '').trim();
    const cleanStr2 = normalized2.replace(/(branch|office|hq|headquarters)$/, '').trim();

    if (cleanStr1 === cleanStr2) return true;

    // More specific contains check - only if one string is significantly longer
    if (normalized1.length > normalized2.length + 3 && normalized1.includes(normalized2)) return true;
    if (normalized2.length > normalized1.length + 3 && normalized2.includes(normalized1)) return true;

    return false;
  };
  // Load comprehensive area-town and branch mappings
  useEffect(() => {
    const loadMappings = async () => {
      try {
        setDebugInfo("Loading mappings...");
        // Load employees data for town-branch relationships
        const { data: employeesData, error: employeesError } = await supabase
          .from('employees')
          .select('Branch, Town, Office');

        if (employeesError) {
          console.error("Error loading employees data:", employeesError);
          setDebugInfo(`Error loading employee data: ${employeesError.message}`);
        }

        // Load kenya_branches data for official branch-area mapping
        const { data: branchesData, error: branchesError } = await supabase
          .from('kenya_branches')
          .select('"Branch Office", "Area", "Town"');

        if (branchesError) {
          console.error("Error loading kenya_branches data:", branchesError);
          setDebugInfo(`Error loading branch data: ${branchesError.message}`);
        }
        // Build comprehensive mappings
        const areaToTowns: AreaTownMapping = {};
        const townToArea: TownAreaMapping = {};
        const townToBranches: TownBranchMapping = {};
        const branchToTowns: BranchTownMapping = {};
        const branchToArea: BranchAreaMapping = {};
        // Process employees data
        if (employeesData) {
          employeesData.forEach(item => {
            if (item.Branch && item.Town) {
              // Area (Branch) -> Towns mapping
              if (!areaToTowns[item.Branch]) {
                areaToTowns[item.Branch] = [];
              }
              if (!areaToTowns[item.Branch].includes(item.Town)) {
                areaToTowns[item.Branch].push(item.Town);
              }

              // Town -> Area mapping
              townToArea[item.Town] = item.Branch;

              // Town -> Branches mapping (including Office if different)
              if (!townToBranches[item.Town]) {
                townToBranches[item.Town] = [];
              }
              if (!townToBranches[item.Town].includes(item.Branch)) {
                townToBranches[item.Town].push(item.Branch);
              }
              if (item.Office && item.Office !== item.Branch && !townToBranches[item.Town].includes(item.Office)) {
                townToBranches[item.Town].push(item.Office);
              }

              // Branch -> Towns mapping
              if (!branchToTowns[item.Branch]) {
                branchToTowns[item.Branch] = [];
              }
              if (!branchToTowns[item.Branch].includes(item.Town)) {
                branchToTowns[item.Branch].push(item.Town);
              }

              if (item.Office && item.Office !== item.Branch) {
                if (!branchToTowns[item.Office]) {
                  branchToTowns[item.Office] = [];
                }
                if (!branchToTowns[item.Office].includes(item.Town)) {
                  branchToTowns[item.Office].push(item.Town);
                }
              }
            }
          });
        }
        // Process kenya_branches data for additional mapping
        if (branchesData) {
          branchesData.forEach(item => {
            const branchOffice = item['Branch Office'];
            const area = item['Area'];
            const town = item['Town'];

            if (branchOffice && area) {
              branchToArea[branchOffice] = area;

              // Cross-reference with existing data
              if (town) {
                if (!areaToTowns[area]) {
                  areaToTowns[area] = [];
                }
                if (!areaToTowns[area].includes(town)) {
                  areaToTowns[area].push(town);
                }

                townToArea[town] = area;

                if (!townToBranches[town]) {
                  townToBranches[town] = [];
                }
                if (!townToBranches[town].includes(branchOffice)) {
                  townToBranches[town].push(branchOffice);
                }

                if (!branchToTowns[branchOffice]) {
                  branchToTowns[branchOffice] = [];
                }
                if (!branchToTowns[branchOffice].includes(town)) {
                  branchToTowns[branchOffice].push(town);
                }
              }
            }
          });
        }
        // Set all mappings
        setAreaTownMapping(areaToTowns);
        setTownAreaMapping(townToArea);
        setTownBranchMapping(townToBranches);
        setBranchTownMapping(branchToTowns);
        setBranchAreaMapping(branchToArea);

        setDebugInfo(`Mappings loaded: ${Object.keys(areaToTowns).length} areas, ${Object.keys(townToArea).length} towns, ${Object.keys(branchToArea).length} branches`);

        console.log('Area to Towns mapping:', areaToTowns);
        console.log('Town to Area mapping:', townToArea);
        console.log('Town to Branches mapping:', townToBranches);
        console.log('Branch to Towns mapping:', branchToTowns);
        console.log('Branch to Area mapping:', branchToArea);

      } catch (error) {
        console.error("Error in loadMappings:", error);
        setDebugInfo(`Error loading mappings: ${error.message}`);
      }
    };
    loadMappings();
  }, []);
  // Fix currentTown initialization
  useEffect(() => {
    if (selectedTown && selectedTown !== 'ADMIN_ALL') {
      setCurrentTown(selectedTown);
      setDebugInfo(`Town set from props: "${selectedTown}"`);
      console.log('Setting currentTown from props:', selectedTown);
    } else {
      const savedTown = localStorage.getItem('selectedTown');
      if (savedTown && savedTown !== 'ADMIN_ALL') {
        setCurrentTown(savedTown);
        if (onTownChange) {
          onTownChange(savedTown);
        }
        setDebugInfo(`Town loaded from storage: "${savedTown}"`);
        console.log('Setting currentTown from storage:', savedTown);
      } else {
        // Only set to empty string if we really have no town selection
        setCurrentTown('');
        setDebugInfo("No town selected - will show all performance data");
        console.log('No town selected, currentTown set to empty string');
      }
    }
  }, [selectedTown, onTownChange]);
  // FIXED: Enhanced town selection logic - now properly handles specific town filtering
  useEffect(() => {
    console.log('=== TOWN SELECTION DEBUG ===');
    console.log('currentTown:', currentTown);
    console.log('areaTownMapping keys:', Object.keys(areaTownMapping));
    console.log('townAreaMapping keys:', Object.keys(townAreaMapping));
    console.log('townBranchMapping keys:', Object.keys(townBranchMapping));
    if (!currentTown || currentTown === 'ADMIN_ALL' || currentTown === '') {
      setIsArea(false);
      setTownsInArea([]);
      setSelectedTowns([]);
      setEligibleBranches([]);
      setDebugInfo("No town filter - showing all performance data");
      console.log('No town filter applied');
      return;
    }
    const selectedTownsList: string[] = [];
    const eligibleBranchesList: string[] = [];
    let debugMessage = '';
    // Check if current selection is directly an area
    if (areaTownMapping[currentTown]) {
      setIsArea(true);
      const townsInCurrentArea = areaTownMapping[currentTown];
      selectedTownsList.push(...townsInCurrentArea);

      // Get all branches that serve towns in this area
      townsInCurrentArea.forEach(town => {
        const branchesForTown = townBranchMapping[town] || [];
        branchesForTown.forEach(branch => {
          if (!eligibleBranchesList.includes(branch)) {
            eligibleBranchesList.push(branch);
          }
        });
      });

      // Also add the area itself as a potential branch
      if (!eligibleBranchesList.includes(currentTown)) {
        eligibleBranchesList.push(currentTown);
      }

      debugMessage = `"${currentTown}" is an area containing towns: ${townsInCurrentArea.join(', ')}. Eligible branches: ${eligibleBranchesList.join(', ')}`;
    }
    // FIXED: Handle specific town selection - only include the selected town, not siblings
    else {
      setIsArea(false);

      // Add ONLY the selected town (not sibling towns)
      selectedTownsList.push(currentTown);

      // Get branches that serve this specific town
      const branchesForTown = townBranchMapping[currentTown] || [];
      eligibleBranchesList.push(...branchesForTown);

      // Also add the town itself as a potential branch (direct match)
      if (!eligibleBranchesList.includes(currentTown)) {
        eligibleBranchesList.push(currentTown);
      }

      // If the town belongs to an area, also include the area as a potential branch
      // But DO NOT include sibling towns - that was the bug!
      if (townAreaMapping[currentTown]) {
        const parentArea = townAreaMapping[currentTown];
        if (!eligibleBranchesList.includes(parentArea)) {
          eligibleBranchesList.push(parentArea);
        }
        debugMessage = `"${currentTown}" is a specific town in ${parentArea} area. Showing data for this town only. Eligible branches: ${eligibleBranchesList.join(', ')}`;
      } else {
        debugMessage = `"${currentTown}" is a standalone town. Eligible branches: ${eligibleBranchesList.join(', ')}`;
      }
    }
    setTownsInArea(selectedTownsList);
    setSelectedTowns(selectedTownsList);
    setEligibleBranches(eligibleBranchesList);
    setDebugInfo(debugMessage);

    console.log('Selected towns:', selectedTownsList);
    console.log('Eligible branches:', eligibleBranchesList);
    console.log('=== END TOWN SELECTION DEBUG ===');

  }, [currentTown, areaTownMapping, townAreaMapping, townBranchMapping]);
  // Enhanced display name function
  const getDisplayName = () => {
    if (!currentTown || currentTown === '' || currentTown === 'ADMIN_ALL') return "All Towns";

    if (isArea) {
      return `${currentTown} Region (${selectedTowns.length} towns)`;
    } else {
      // Show just the town name for specific town selection
      return `${currentTown}`;
    }
  };
  const handleCloseModal = () => {
    setShowEmployeePerfModal(false);
    setShowBranchPerfModal(false);
    setShowTargetModal(false);
    setShowVisitModal(false);
    setCurrentRecord(null);
  };
  const handleSaveRecord = async (type: string, record: any) => {
    try {
      console.log(`Saved ${type}:`, record);
    } catch (error) {
      console.error(`Error saving ${type}:`, error);
    }
  };
  useEffect(() => {
    setEmailOptions({
      individual: employeePerformance.map(perf => {
        const emp = employees.find(e => e["Employee Number"] === perf.employee_id);
        const name = emp ? `${emp["First Name"]} ${emp["Last Name"]}` : perf.full_name || 'Unknown';
        return {
          value: perf.employee_id,
          label: `${name} (${perf.employee_id})`
        };
      }),
      branch: Array.from(new Set(branchPerformance.map(perf => perf.branch))).map(branch => ({
        value: branch,
        label: branch
      }))
    });
  }, [employeePerformance, branchPerformance, employees]);
  // Fetch all data from Supabase
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        const [
          { data: employeesData },
          { data: branchesData },
          { data: clientsData },
          { data: loansData },
          { data: loanPaymentsData },
          { data: employeePerformanceData },
          { data: branchPerformanceData },
          { data: performanceTargetsData },
          { data: clientVisitsData }
        ] = await Promise.all([
          supabase.from('employees').select('*'),
          supabase.from('kenya_branches').select('*'),
          supabase.from('clients').select('*'),
          supabase.from('loans').select('*'),
          supabase.from('loan_payments').select('*'),
          supabase.from('employee_performance').select('*'),
          supabase.from('branch_performance').select('*'),
          supabase.from('performance_targets').select('*'),
          supabase.from('client_visits').select('*')
        ]);
        if (employeesData) setEmployees(employeesData);
        if (branchesData) setBranches(branchesData);
        if (clientsData) setClients(clientsData);
        if (loansData) setLoans(loansData);
        if (loanPaymentsData) setLoanPayments(loanPaymentsData);
        if (employeePerformanceData) setEmployeePerformance(employeePerformanceData);
        if (branchPerformanceData) setBranchPerformance(branchPerformanceData);
        if (performanceTargetsData) setPerformanceTargets(performanceTargetsData);
        if (clientVisitsData) setClientVisits(clientVisitsData);
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to fetch performance data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);
  const refreshData = async () => {
    try {
      setLoading(true);

      const [
        { data: clientsData },
        { data: loansData },
        { data: loanPaymentsData },
        { data: employeePerformanceData },
        { data: branchPerformanceData },
        { data: performanceTargetsData },
        { data: clientVisitsData }
      ] = await Promise.all([
        supabase.from('clients').select('*'),
        supabase.from('loans').select('*'),
        supabase.from('loan_payments').select('*'),
        supabase.from('employee_performance').select('*'),
        supabase.from('branch_performance').select('*'),
        supabase.from('performance_targets').select('*'),
        supabase.from('client_visits').select('*')
      ]);
      if (clientsData) setClients(clientsData);
      if (loansData) setLoans(loansData);
      if (loanPaymentsData) setLoanPayments(loanPaymentsData);
      if (employeePerformanceData) setEmployeePerformance(employeePerformanceData);
      if (branchPerformanceData) setBranchPerformance(branchPerformanceData);
      if (performanceTargetsData) setPerformanceTargets(performanceTargetsData);
      if (clientVisitsData) setClientVisits(clientVisitsData);
    } catch (error) {
      console.error('Error refreshing data:', error);
      toast.error('Failed to refresh data');
    } finally {
      setLoading(false);
    }
  };
  // Email sending function using Supabase edge function (same as admin)
  const sendPerformanceEmail = async (email: string, subject: string, htmlContent: string) => {
    try {
      await sendEmail({
        to: email,
        subject: subject,
        html: htmlContent
      });
      return { success: true };
    } catch (error) {
      console.error('Email sending error:', error);
      throw error;
    }
  };
  // Generate HTML email template
  const generateEmailTemplate = (type: 'individual' | 'branch', data: any) => {
    const colors = {
      primary: '#2563eb',
      primaryLight: '#dbeafe',
      secondary: '#4f46e5',
      success: '#059669',
      successLight: '#d1fae5',
      warning: '#d97706',
      warningLight: '#fef3c7',
      info: '#0891b2',
      infoLight: '#cffafe',
      dark: '#1f2937',
      light: '#f9fafb',
      gray: '#6b7280',
      white: '#ffffff'
    };

    const cardStyle = `
    background: ${colors.white};
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.1);
    margin-bottom: 24px;
  `;

    const metricRow = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid #f3f4f6;
  `;

    const headerStyle = `
    font-size: 28px;
    font-weight: 700;
    color: ${colors.dark};
    margin: 0 0 8px 0;
    letter-spacing: -0.025em;
  `;

    const subheaderStyle = `
    font-size: 18px;
    font-weight: 500;
    color: ${colors.gray};
    margin: 0 0 24px 0;
  `;

    if (type === 'individual') {
      return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Performance Report</title>
      </head>
      <body style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; background-color: #f3f4f6; margin: 0; padding: 20px;">
        <div style="max-width: 680px; margin: 0 auto;">
          <!-- Header -->
          <div style="${cardStyle} text-align: center; background: linear-gradient(120deg, ${colors.primary}, ${colors.secondary}); color: ${colors.white};">
            <h1 style="${headerStyle} color: ${colors.white};">Performance Report</h1>
            <p style="${subheaderStyle} color: #e5e7eb;">for ${data.full_name}</p>
          </div>
          
          <!-- Employee Details -->
          <div style="${cardStyle}">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px;">
              <div>
                <p style="font-size: 14px; color: ${colors.gray}; margin-bottom: 4px;">Employee ID</p>
                <p style="font-size: 16px; font-weight: 600; color: ${colors.dark}; margin: 0;">${data.employee_id}</p>
              </div>
              <div>
                <p style="font-size: 14px; color: ${colors.gray}; margin-bottom: 4px;">Branch</p>
                <p style="font-size: 16px; font-weight: 600; color: ${colors.dark}; margin: 0;">${data.branch}</p>
              </div>
              <div>
                <p style="font-size: 14px; color: ${colors.gray}; margin-bottom: 4px;">Month</p>
                <p style="font-size: 16px; font-weight: 600; color: ${colors.dark}; margin: 0;">${data.month}</p>
              </div>
            </div>
          </div>
          
          <!-- Client Metrics -->
          <div style="${cardStyle}">
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
              <div style="width: 4px; height: 24px; background: ${colors.info}; border-radius: 4px; margin-right: 12px;"></div>
              <h2 style="font-size: 20px; font-weight: 600; color: ${colors.dark}; margin: 0;">Client Metrics</h2>
            </div>
            
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Total Clients</span>
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 600;">${data.total_clients}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Retained Clients</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">${data.retained_clients}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">New Active Clients</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">${data.new_clients_active}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">New Inactive Clients</span>
              <span style="font-size: 15px; color: ${colors.warning}; font-weight: 600;">${data.new_clients_inactive}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Retained Active</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">${data.retained_active}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Retained Inactive</span>
              <span style="font-size: 15px; color: ${colors.warning}; font-weight: 600;">${data.retained_inactive}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Total Active</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">${data.total_active}</span>
            </div>
            <div style="${metricRow} border-bottom: none;">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Total Inactive</span>
              <span style="font-size: 15px; color: ${colors.warning}; font-weight: 600;">${data.total_inactive}</span>
            </div>
          </div>
          
          <!-- Disbursement Metrics -->
          <div style="${cardStyle}">
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
              <div style="width: 4px; height: 24px; background: ${colors.success}; border-radius: 4px; margin-right: 12px;"></div>
              <h2 style="font-size: 20px; font-weight: 600; color: ${colors.dark}; margin: 0;">Disbursement Metrics</h2>
            </div>
            
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Number of Disbursements</span>
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 600;">${data.no_of_disb}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Disbursement Amount</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">KSh ${data.disb_amount?.toLocaleString() || '0'}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Targeted Disbursements</span>
              <span style="font-size: 15px; color: ${data.no_of_disb >= data.targeted_disb_no ? colors.success : colors.warning}; font-weight: 600;">${data.targeted_disb_no}</span>
            </div>
            <div style="${metricRow} border-bottom: none;">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Targeted Disbursement Amount</span>
              <span style="font-size: 15px; color: ${data.disb_amount >= data.targeted_disb_amount ? colors.success : colors.warning}; font-weight: 600;">KSh ${data.targeted_disb_amount?.toLocaleString() || '0'}</span>
            </div>
          </div>
          
          <!-- Portfolio Metrics -->
          <div style="${cardStyle}">
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
              <div style="width: 4px; height: 24px; background: ${colors.warning}; border-radius: 4px; margin-right: 12px;"></div>
              <h2 style="font-size: 20px; font-weight: 600; color: ${colors.dark}; margin: 0;">Portfolio Metrics</h2>
            </div>
            
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Targeted OLB</span>
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 600;">KSh ${data.targeted_olb?.toLocaleString() || '0'}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Actual OLB</span>
              <span style="font-size: 15px; color: ${data.actual_olb >= data.targeted_olb ? colors.success : colors.warning}; font-weight: 600;">KSh ${data.actual_olb?.toLocaleString() || '0'}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Collected Loan Amount</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">KSh ${data.collected_loan_amount?.toLocaleString() || '0'}</span>
            </div>
            <div style="${metricRow} border-bottom: none;">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Overdue Loans</span>
              <span style="font-size: 15px; color: ${data.overdue_loans > 0 ? colors.warning : colors.success}; font-weight: 600;">${data.overdue_loans}</span>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; padding: 24px 0; color: ${colors.gray}; font-size: 14px;">
            <p>Generated on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <p></p>
          </div>
        </div>
      </body>
      </html>
    `;
    } else {
      return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Branch Performance Report</title>
      </head>
      <body style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; background-color: #f3f4f6; margin: 0; padding: 20px;">
        <div style="max-width: 680px; margin: 0 auto;">
          <!-- Header -->
          <div style="${cardStyle} text-align: center; background: linear-gradient(120deg, ${colors.primary}, ${colors.secondary}); color: ${colors.white};">
            <h1 style="${headerStyle} color: ${colors.white};">Branch Performance Report</h1>
            <p style="${subheaderStyle} color: #e5e7eb;">for ${data.branch}</p>
          </div>
          
          <!-- Branch Details -->
          <div style="${cardStyle}">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px;">
              <div>
                <p style="font-size: 14px; color: ${colors.gray}; margin-bottom: 4px;">Month</p>
                <p style="font-size: 16px; font-weight: 600; color: ${colors.dark}; margin: 0;">${data.month}</p>
              </div>
            </div>
          </div>
          
          <!-- Client Metrics -->
          <div style="${cardStyle}">
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
              <div style="width: 4px; height: 24px; background: ${colors.info}; border-radius: 4px; margin-right: 12px;"></div>
              <h2 style="font-size: 20px; font-weight: 600; color: ${colors.dark}; margin: 0;">Client Metrics</h2>
            </div>
            
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Total Clients</span>
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 600;">${data.total_clients}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Retained Clients</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">${data.retained_clients}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">New Active Clients</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">${data.new_clients_active}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">New Inactive Clients</span>
              <span style="font-size: 15px; color: ${colors.warning}; font-weight: 600;">${data.new_clients_inactive}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Retained Active</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">${data.retained_active}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Retained Inactive</span>
              <span style="font-size: 15px; color: ${colors.warning}; font-weight: 600;">${data.retained_inactive}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Total Active</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">${data.total_active}</span>
            </div>
            <div style="${metricRow} border-bottom: none;">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Total Inactive</span>
              <span style="font-size: 15px; color: ${colors.warning}; font-weight: 600;">${data.total_inactive}</span>
            </div>
          </div>
          
          <!-- Disbursement Metrics -->
          <div style="${cardStyle}">
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
              <div style="width: 4px; height: 24px; background: ${colors.success}; border-radius: 4px; margin-right: 12px;"></div>
              <h2 style="font-size: 20px; font-weight: 600; color: ${colors.dark}; margin: 0;">Disbursement Metrics</h2>
            </div>
            
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Number of Disbursements</span>
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 600;">${data.no_of_disb}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Disbursement Amount</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">KSh ${data.disb_amount?.toLocaleString() || '0'}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Targeted Disbursements</span>
              <span style="font-size: 15px; color: ${data.no_of_disb >= data.targeted_disb_no ? colors.success : colors.warning}; font-weight: 600;">${data.targeted_disb_no}</span>
            </div>
            <div style="${metricRow} border-bottom: none;">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Targeted Disbursement Amount</span>
              <span style="font-size: 15px; color: ${data.disb_amount >= data.targeted_disb_amount ? colors.success : colors.warning}; font-weight: 600;">KSh ${data.targeted_disb_amount?.toLocaleString() || '0'}</span>
            </div>
          </div>
          
          <!-- Portfolio Metrics -->
          <div style="${cardStyle}">
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
              <div style="width: 4px; height: 24px; background: ${colors.warning}; border-radius: 4px; margin-right: 12px;"></div>
              <h2 style="font-size: 20px; font-weight: 600; color: ${colors.dark}; margin: 0;">Portfolio Metrics</h2>
            </div>
            
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Targeted OLB</span>
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 600;">KSh ${data.targeted_olb?.toLocaleString() || '0'}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Actual OLB</span>
              <span style="font-size: 15px; color: ${data.actual_olb >= data.targeted_olb ? colors.success : colors.warning}; font-weight: 600;">KSh ${data.actual_olb?.toLocaleString() || '0'}</span>
            </div>
            <div style="${metricRow}">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Collected Loan Amount</span>
              <span style="font-size: 15px; color: ${colors.success}; font-weight: 600;">KSh ${data.collected_loan_amount?.toLocaleString() || '0'}</span>
            </div>
            <div style="${metricRow} border-bottom: none;">
              <span style="font-size: 15px; color: ${colors.dark}; font-weight: 500;">Overdue Loan Amount</span>
              <span style="font-size: 15px; color: ${data.overdue_loan_amount > 0 ? colors.warning : colors.success}; font-weight: 600;">KSh ${data.overdue_loan_amount?.toLocaleString() || '0'}</span>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; padding: 24px 0; color: ${colors.gray}; font-size: 14px;">
            <p>Generated on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <p></p>
          </div>
        </div>
      </body>
      </html>
    `;
    }
  };
  // Updated email sending function using the same approach as admin
  const handleSendEmails = async () => {
    setEmailSending(true);
    try {
      if (emailType === 'individual') {
        if (emailRecipientType === 'all') {
          // Send to all employees with performance data
          for (const perf of employeePerformance) {
            const employee = employees.find(e => e["Employee Number"] === perf.employee_id);
            if (employee && employee["Work Email"]) {
              const htmlContent = generateEmailTemplate('individual', perf);
              await sendPerformanceEmail(
                employee["Work Email"],
                `Your Performance Report - ${perf.month}`,
                htmlContent
              );
            }
          }
        } else if (selectedEmailRecipient) {
          // Send to specific employee
          const perf = employeePerformance.find(p => p.employee_id === selectedEmailRecipient);
          const employee = employees.find(e => e["Employee Number"] === selectedEmailRecipient);
          if (perf && employee && employee["Work Email"]) {
            const htmlContent = generateEmailTemplate('individual', perf);
            await sendPerformanceEmail(
              employee["Work Email"],
              `Your Performance Report - ${perf.month}`,
              htmlContent
            );
          }
        }
      } else {
        // Branch performance email
        if (emailRecipientType === 'all') {
          // Send to all branch managers
          for (const perf of branchPerformance) {
            const branchManagers = employees.filter(e =>
              e.Branch === perf.branch && e["Job Title"] === "Branch Manager" && e["Work Email"]
            );

            for (const manager of branchManagers) {
              const htmlContent = generateEmailTemplate('branch', perf);
              await sendPerformanceEmail(
                manager["Work Email"],
                `Branch Performance Report - ${perf.branch} - ${perf.month}`,
                htmlContent
              );
            }
          }
        } else if (selectedEmailRecipient) {
          // Send specific branch report to its manager
          const perf = branchPerformance.find(p => p.branch === selectedEmailRecipient);
          const branchManager = employees.find(e =>
            e.Branch === selectedEmailRecipient && e["Job Title"] === "Branch Manager" && e["Work Email"]
          );

          if (perf && branchManager) {
            const htmlContent = generateEmailTemplate('branch', perf);
            await sendPerformanceEmail(
              branchManager["Work Email"],
              `Branch Performance Report - ${perf.branch} - ${perf.month}`,
              htmlContent
            );
          }
        }
      }

      toast.success('Performance reports sent successfully!');
      setShowEmailModal(false);
    } catch (error) {
      console.error('Error sending emails:', error);
      toast.error(`Failed to send emails: ${error.message}`);
    } finally {
      setEmailSending(false);
    }
  };
  // Enhanced filtering for employees based on town selection
  // Enhanced filtering for employees based on town selection
  const filteredEmployeesByTown = React.useMemo(() => {
    console.log('=== EMPLOYEE FILTERING DEBUG ===');
    console.log('currentTown:', currentTown);
    console.log('Total employees before filter:', employees.length);
    // If no town is selected or ADMIN_ALL is selected, show all employees
    if (!currentTown || currentTown === 'ADMIN_ALL' || currentTown === '') {
      console.log('Showing all employees (no town filter)');
      return employees;
    }
    // SIMPLIFIED: Direct filtering by employee's Branch or Town
    const filtered = employees.filter(employee => {
      // Check if employee's branch or town matches the selected town
      const branchMatch = employee.Branch &&
        normalizeString(employee.Branch) === normalizeString(currentTown);
      const townMatch = employee.Town &&
        normalizeString(employee.Town) === normalizeString(currentTown);

      return branchMatch || townMatch;
    });

    console.log(`Filtered ${employees.length} employees down to ${filtered.length} for town "${currentTown}"`);
    console.log('=== END EMPLOYEE FILTERING DEBUG ===');

    return filtered;
  }, [employees, currentTown]);
  // Enhanced filtering for branches based on town selection
  const filteredBranchesByTown = React.useMemo(() => {
    console.log('=== BRANCH FILTERING DEBUG ===');
    console.log('currentTown:', currentTown);
    console.log('Total branches before filter:', branches.length);
    console.log('Eligible branches:', eligibleBranches);
    console.log('Selected towns:', selectedTowns);
    // If no town is selected or ADMIN_ALL is selected, show all branches
    if (!currentTown || currentTown === 'ADMIN_ALL' || currentTown === '') {
      console.log('Showing all branches (no town filter)');
      return branches;
    }

    if (eligibleBranches.length === 0 && selectedTowns.length === 0) {
      console.log('No eligible branches or towns found, returning empty result');
      return [];
    }
    const filtered = branches.filter(branch => {
      let shouldInclude = false;
      let matchReason = '';
      // Skip branches with no branch office information
      if (!branch["Branch Office"] && !branch["Town"]) {
        console.log('Branch has no office or town:', branch.id);
        return false;
      }

      // Check if branch office matches any eligible branch
      if (branch["Branch Office"] && eligibleBranches.length > 0) {
        const branchMatches = eligibleBranches.some(eligibleBranch => {
          const matches = isStringMatch(branch["Branch Office"], eligibleBranch);
          if (matches) {
            console.log(`✓ Branch office match: "${branch["Branch Office"]}" matches "${eligibleBranch}"`);
            matchReason = `branch office matches ${eligibleBranch}`;
          }
          return matches;
        });
        if (branchMatches) shouldInclude = true;
      }

      // Check if branch town matches any selected town
      if (branch["Town"] && selectedTowns.length > 0) {
        const townMatches = selectedTowns.some(town => {
          const matches = isStringMatch(branch["Town"] || '', town);
          if (matches) {
            console.log(`✓ Branch town match: "${branch["Town"]}" matches "${town}"`);
            matchReason = `town matches ${town}`;
          }
          return matches;
        });
        if (townMatches) shouldInclude = true;
      }

      if (shouldInclude) {
        console.log(`✓ Including branch: ${branch.id} - ${branch["Branch Office"]} (Reason: ${matchReason})`);
      } else {
        console.log(`✗ Excluding branch: ${branch.id} - ${branch["Branch Office"]} (Branch: ${branch["Branch Office"]}, Town: ${branch["Town"]})`);
      }

      return shouldInclude;
    });

    console.log(`Filtered ${branches.length} branches down to ${filtered.length} for town "${currentTown}"`);
    console.log('=== END BRANCH FILTERING DEBUG ===');

    return filtered;
  }, [branches, currentTown, selectedTowns, eligibleBranches]);
  // Process data to create employee performance objects (now using filtered employees)
  const processedEmployees = filteredEmployeesByTown.map(employee => {
    const employeeClients = clients.filter(client => client.loan_officer === employee["Employee Number"]);
    const employeeLoans = loans.filter(loan => loan.loan_officer === employee["Employee Number"]);

    const latestPerformance = employeePerformance
      .filter(perf => perf.employee_id === employee["Employee Number"])
      .sort((a, b) => new Date(b.month).getTime() - new Date(a.month).getTime())[0];

    const employeeTargets = performanceTargets
      .filter(target => target.employee_id === employee["Employee Number"] && target.is_active);

    const disbursementTarget = employeeTargets.find(t => t.target_type === 'disbursement')?.target_value || 0;
    const loansDisbursed = employeeLoans.filter(loan =>
      loan.status === 'Disbursed' || loan.status === 'Active' || loan.status === 'Completed'
    ).length;

    const collectionTarget = employeeTargets.find(t => t.target_type === 'collection')?.target_value || 0;
    const totalPortfolio = employeeLoans.reduce((sum, loan) => sum + (loan.amount_disbursed || 0), 0);
    const outstandingBalance = employeeLoans.reduce((sum, loan) => sum + (loan.outstanding_balance || 0), 0);
    const collectedAmount = totalPortfolio - outstandingBalance;
    const collectionRate = totalPortfolio > 0 ? (collectedAmount / totalPortfolio) * 100 : 0;

    const parLoans = employeeLoans.filter(loan => loan.par_days > 0);
    const parAmount = parLoans.reduce((sum, loan) => sum + (loan.outstanding_balance || 0), 0);
    const parRate = totalPortfolio > 0 ? (parAmount / totalPortfolio) * 100 : 0;

    const fieldVisitsTarget = employeeTargets.find(t => t.target_type === 'field_visits')?.target_value || 0;
    const fieldVisits = clientVisits
      .filter(visit => visit.employee_id === employee["Employee Number"])
      .length;

    const attendanceTarget = employeeTargets.find(t => t.target_type === 'attendance')?.target_value || 0;
    const attendanceDays = latestPerformance?.attendance_days || 0;
    const workingDays = latestPerformance?.working_days || 1;
    const attendanceRate = (attendanceDays / workingDays) * 100;

    const tatAverage = latestPerformance?.tat_average || 0;

    // Use employee's branch/town information directly instead of trying to match with filtered branches
    const employeeBranch = employee.Town || employee.Branch || 'Unknown';
    const dailyDisbursementTarget = employeeTargets
      .find(t => t.target_type === 'disbursement' && t.period === 'daily')?.target_value || 0;
    const weeklyDisbursementTarget = employeeTargets
      .find(t => t.target_type === 'disbursement' && t.period === 'weekly')?.target_value || 0;

    const today = new Date().toISOString().split('T')[0];
    const todayDisbursements = employeeLoans.filter(loan =>
      loan.disbursement_date === today
    ).length;

    const thisWeekDisbursements = Math.floor(employeeLoans.length / 4);

    return {
      id: employee["Employee Number"],
      name: `${employee["First Name"]} ${employee["Last Name"]}`,
      role: employee["Job Title"],
      branch: employeeBranch,
      loansDisbursed,
      target: disbursementTarget,
      attendance: attendanceRate,
      fieldVisits,
      par: parRate,
      collection: collectionRate,
      tat: tatAverage,
      clients: employeeClients.map(client => ({
        id: client.client_id,
        name: `${client.first_name} ${client.last_name}`,
        status: client.status || 'active',
        loanAmount: loans.find(loan => loan.client_id === client.client_id)?.amount_disbursed || 0,
        lastPayment: loanPayments
          .filter(payment => loans.some(loan =>
            loan.loan_id === payment.loan_id && loan.client_id === client.client_id))
          .sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime())[0]?.payment_date || ''
      })),
      disbursementTargets: {
        daily: dailyDisbursementTarget,
        weekly: weeklyDisbursementTarget,
        monthly: disbursementTarget,
        achieved: {
          today: todayDisbursements,
          thisWeek: thisWeekDisbursements,
          thisMonth: loansDisbursed
        }
      },
      collectionMetrics: {
        totalPortfolio,
        collectedThisWeek: collectedAmount / 4,
        overdueAmount: parAmount,
        collectionRate
      }
    };
  });
  // Process branch performance data (now using filtered branches)
  const processedBranchAverages = filteredBranchesByTown.map(branch => {
    const branchEmployees = filteredEmployeesByTown.filter(employee => {
      // Use the same matching logic as the town filtering
      return isStringMatch(employee.Branch || '', branch["Branch Office"] || '') ||
        isStringMatch(employee.Town || '', branch["Town"] || '');
    }).map(employee => {
      // Calculate performance metrics for each employee
      const employeeClients = clients.filter(client => client.loan_officer === employee["Employee Number"]);
      const employeeLoans = loans.filter(loan => loan.loan_officer === employee["Employee Number"]);

      const loansDisbursed = employeeLoans.filter(loan =>
        loan.status === 'Disbursed' || loan.status === 'Active' || loan.status === 'Completed'
      ).length;

      const totalPortfolio = employeeLoans.reduce((sum, loan) => sum + (loan.amount_disbursed || 0), 0);
      const outstandingBalance = employeeLoans.reduce((sum, loan) => sum + (loan.outstanding_balance || 0), 0);
      const collectedAmount = totalPortfolio - outstandingBalance;
      const collectionRate = totalPortfolio > 0 ? (collectedAmount / totalPortfolio) * 100 : 0;

      const parLoans = employeeLoans.filter(loan => loan.par_days > 0);
      const parAmount = parLoans.reduce((sum, loan) => sum + (loan.outstanding_balance || 0), 0);
      const parRate = totalPortfolio > 0 ? (parAmount / totalPortfolio) * 100 : 0;

      const fieldVisits = clientVisits
        .filter(visit => visit.employee_id === employee["Employee Number"])
        .length;

      const latestPerformance = employeePerformance
        .filter(perf => perf.employee_id === employee["Employee Number"])
        .sort((a, b) => new Date(b.month).getTime() - new Date(a.month).getTime())[0];

      const attendanceDays = latestPerformance?.attendance_days || 0;
      const workingDays = latestPerformance?.working_days || 1;
      const attendanceRate = (attendanceDays / workingDays) * 100;

      const tatAverage = latestPerformance?.tat_average || 0;

      const employeeTargets = performanceTargets
        .filter(target => target.employee_id === employee["Employee Number"] && target.is_active);
      const disbursementTarget = employeeTargets.find(t => t.target_type === 'disbursement')?.target_value || 0;

      return {
        loansDisbursed,
        target: disbursementTarget,
        attendance: attendanceRate,
        fieldVisits,
        par: parRate,
        collection: collectionRate,
        tat: tatAverage
      };
    });
    const count = branchEmployees.length;

    if (count === 0) return {
      branch: branch["Branch Office"] || branch.id,
      loansDisbursed: 0,
      target: 0,
      attendance: 0,
      fieldVisits: 0,
      par: 0,
      collection: 0,
      tat: 0
    };
    return {
      branch: branch["Branch Office"] || branch.id,
      loansDisbursed: branchEmployees.reduce((sum, e) => sum + e.loansDisbursed, 0) / count,
      target: branchEmployees.reduce((sum, e) => sum + e.target, 0) / count,
      attendance: branchEmployees.reduce((sum, e) => sum + e.attendance, 0) / count,
      fieldVisits: branchEmployees.reduce((sum, e) => sum + e.fieldVisits, 0) / count,
      par: branchEmployees.reduce((sum, e) => sum + e.par, 0) / count,
      collection: branchEmployees.reduce((sum, e) => sum + e.collection, 0) / count,
      tat: branchEmployees.reduce((sum, e) => sum + e.tat, 0) / count
    };
  });
  const roles = ['All Roles', 'Loan Officer', 'Branch Manager', 'Credit Analyst', 'Relationship Officer'];
  const filteredEmployees = processedEmployees.filter(employee => {
    const matchesBranch = selectedBranch === 'all' || isStringMatch(employee.branch, selectedBranch);
    const matchesRole = selectedRole === 'All Roles' || isStringMatch(employee.role, selectedRole);
    const matchesSearch = employee.name.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesBranch && matchesRole && matchesSearch;
  });
  const filteredBranches = filteredBranchesByTown.filter(branch => {
    const branchName = branch["Branch Office"] || '';
    const matchesBranch = selectedBranch === 'all' || isStringMatch(branchName, selectedBranch);
    const matchesSearch = branchName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      branch["Area"]?.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesBranch && matchesSearch;
  });
  // Pagination calculations
  const totalEmployeePages = Math.ceil(filteredEmployees.length / rowsPerPage);
  const totalBranchPages = Math.ceil(filteredBranches.length / rowsPerPage);

  const paginatedEmployees = filteredEmployees.slice(
    (employeePage - 1) * rowsPerPage,
    employeePage * rowsPerPage
  );

  const paginatedBranches = filteredBranches.slice(
    (branchPage - 1) * rowsPerPage,
    branchPage * rowsPerPage
  );
  const toggleEmployeeExpand = (employeeId: string) => {
    setExpandedEmployee(expandedEmployee === employeeId ? null : employeeId);
  };
  const handleEmployeePageChange = (page: number) => {
    setEmployeePage(page);
    setExpandedEmployee(null);
  };
  const handleBranchPageChange = (page: number) => {
    setBranchPage(page);
  };
  const handleRowsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRowsPerPage = parseInt(e.target.value);
    setRowsPerPage(newRowsPerPage);
    setEmployeePage(1);
    setBranchPage(1);
  };
  // Client operations
  const handleUpdateClient = async (updatedClient: Client) => {
    try {
      const { error } = await supabase
        .from('clients')
        .update(updatedClient)
        .eq('client_id', updatedClient.client_id);

      if (error) throw error;
      setClients(prevClients =>
        prevClients.map(c =>
          c.client_id === updatedClient.client_id ? updatedClient : c
        )
      );

      await refreshData();
      handleCloseModal();

    } catch (error) {
      console.error('Error saving client:', error);
    }
  };
  const handleDeleteClient = async (id: string) => {
    try {
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('client_id', id);

      if (error) throw error;
      setClients(clients.filter(c => c.client_id !== id));
      await refreshData();
    } catch (error) {
      console.error('Error deleting client:', error);
    }
  };
  // Loan operations
  const handleUpdateLoan = async (updatedLoan: Loan) => {
    try {
      const { error } = await supabase
        .from('loans')
        .update(updatedLoan)
        .eq('loan_id', updatedLoan.loan_id);

      if (error) throw error;
      setLoans(loans.map(l => l.loan_id === updatedLoan.loan_id ? updatedLoan : l));
      await refreshData();
    } catch (error) {
      console.error('Error updating loan:', error);
    }
  };
  const handleDeleteLoan = async (id: string) => {
    try {
      const { error } = await supabase
        .from('loans')
        .delete()
        .eq('loan_id', id);

      if (error) throw error;
      setLoans(loans.filter(l => l.loan_id !== id));
      await refreshData();
    } catch (error) {
      console.error('Error deleting loan:', error);
    }
  };
  // Payment operations
  const handleUpdatePayment = async (updatedPayment: LoanPayment) => {
    try {
      const { error } = await supabase
        .from('loan_payments')
        .update(updatedPayment)
        .eq('payment_id', updatedPayment.payment_id);

      if (error) throw error;
      setLoanPayments(loanPayments.map(p => p.payment_id === updatedPayment.payment_id ? updatedPayment : p));
      await refreshData();
    } catch (error) {
      console.error('Error updating payment:', error);
    }
  };
  const handleDeletePayment = async (id: number) => {
    try {
      const { error } = await supabase
        .from('loan_payments')
        .delete()
        .eq('payment_id', id);

      if (error) throw error;
      setLoanPayments(loanPayments.filter(p => p.payment_id !== id));
      await refreshData();
    } catch (error) {
      console.error('Error deleting payment:', error);
    }
  };
  // Fixed Employee Performance operations
  const handleUpdateEmployeePerformance = async (updatedPerf: EmployeePerformance) => {
    try {
      // Validate that we have a valid ID - handle both string and number IDs
      const id = updatedPerf.id;
      if (!id || id === 'undefined' || (typeof id === 'string' && id.trim() === '') || (typeof id === 'number' && isNaN(id))) {
        console.error('Invalid performance ID provided:', id);
        toast.error('Cannot update performance record: Invalid ID. Please refresh the page and try again.');
        return;
      }
      // Convert ID to string for database operations if needed
      const stringId = typeof id === 'number' ? id.toString() : id;
      // Ensure numeric fields are properly converted
      const safePerf = {
        ...updatedPerf,
        id: stringId, // Ensure ID is properly formatted
        total_clients: Number(updatedPerf.total_clients) || 0,
        retained_clients: Number(updatedPerf.retained_clients) || 0,
        new_clients_active: Number(updatedPerf.new_clients_active) || 0,
        new_clients_inactive: Number(updatedPerf.new_clients_inactive) || 0,
        retained_active: Number(updatedPerf.retained_active) || 0,
        retained_inactive: Number(updatedPerf.retained_inactive) || 0,
        total_active: Number(updatedPerf.total_active) || 0,
        total_inactive: Number(updatedPerf.total_inactive) || 0,
        no_of_disb: Number(updatedPerf.no_of_disb) || 0,
        disb_amount: Number(updatedPerf.disb_amount) || 0,
        targeted_disb_no: Number(updatedPerf.targeted_disb_no) || 0,
        targeted_disb_amount: Number(updatedPerf.targeted_disb_amount) || 0,
        targeted_olb: Number(updatedPerf.targeted_olb) || 0,
        actual_olb: Number(updatedPerf.actual_olb) || 0,
        collected_loan_amount: Number(updatedPerf.collected_loan_amount) || 0,
        overdue_loans: Number(updatedPerf.overdue_loans) || 0,
      };
      console.log('Updating performance with ID:', stringId);

      const { error } = await supabase
        .from('employee_performance')
        .update(safePerf)
        .eq('id', stringId);
      if (error) {
        console.error('Supabase update error:', error);
        throw error;
      }
      // Update local state
      setEmployeePerformance(
        employeePerformance.map(p => p.id === stringId ? safePerf : p)
      );

      await refreshData();
      console.log('Performance updated successfully');
    } catch (error) {
      console.error('Error updating performance:', error);
      toast.error('Failed to update performance record. Please try again.');
    }
  };
  const handleDeleteEmployeePerformance = async (id: string) => {
    try {
      if (!id || id.trim() === '' || id === 'undefined') {
        console.error('Invalid performance ID for deletion:', id);
        toast.error('Cannot delete performance record: Invalid ID.');
        return;
      }
      const { error } = await supabase
        .from('employee_performance')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setEmployeePerformance(employeePerformance.filter(p => p.id !== id));
      await refreshData();
    } catch (error) {
      console.error('Error deleting employee performance:', error);
      toast.error('Failed to delete performance record. Please try again.');
    }
  };
  // Branch Performance operations
  const handleUpdateBranchPerformance = async (updatedPerf: BranchPerformance) => {
    try {
      const { error } = await supabase
        .from('branch_performance')
        .update(updatedPerf)
        .eq('id', updatedPerf.id);

      if (error) throw error;
      setBranchPerformance(branchPerformance.map(p => p.id === updatedPerf.id ? updatedPerf : p));
      await refreshData();
    } catch (error) {
      console.error('Error updating branch performance:', error);
    }
  };
  const handleDeleteBranchPerformance = async (id: string) => {
    try {
      const { error } = await supabase
        .from('branch_performance')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setBranchPerformance(branchPerformance.filter(p => p.id !== id));
      await refreshData();
    } catch (error) {
      console.error('Error deleting branch performance:', error);
    }
  };
  // Performance Target operations
  const handleUpdatePerformanceTarget = async (updatedTarget: PerformanceTarget) => {
    try {
      const { error } = await supabase
        .from('performance_targets')
        .update(updatedTarget)
        .eq('id', updatedTarget.id);

      if (error) throw error;
      setPerformanceTargets(performanceTargets.map(t => t.id === updatedTarget.id ? updatedTarget : t));
      await refreshData();
    } catch (error) {
      console.error('Error updating performance target:', error);
    }
  };
  const handleDeletePerformanceTarget = async (id: number) => {
    try {
      const { error } = await supabase
        .from('performance_targets')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setPerformanceTargets(performanceTargets.filter(t => t.id !== id));
      await refreshData();
    } catch (error) {
      console.error('Error deleting performance target:', error);
    }
  };
  // Client Visit operations
  const handleUpdateClientVisit = async (updatedVisit: ClientVisit) => {
    try {
      const { error } = await supabase
        .from('client_visits')
        .update(updatedVisit)
        .eq('visit_id', updatedVisit.visit_id);

      if (error) throw error;
      setClientVisits(clientVisits.map(v => v.visit_id === updatedVisit.visit_id ? updatedVisit : v));
      await refreshData();
    } catch (error) {
      console.error('Error updating client visit:', error);
    }
  };
  const handleDeleteClientVisit = async (id: number | string) => {
    try {
      const numericId = typeof id === 'string' ? Number(id) : id;
      const { error } = await supabase
        .from('client_visits')
        .delete()
        .eq('visit_id', numericId);

      if (error) throw error;
      setClientVisits(clientVisits.filter(v => v.visit_id !== numericId));
      await refreshData();
    } catch (error) {
      console.error('Error deleting client visit:', error);
    }
  };

  if (loading) {
    return (
      <div className="p-4 flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-500"></div>
      </div>
    );
  }
  return (
    <div className="p-2 space-y-3 bg-gray-50 min-h-screen max-w-screen-2xl mx-auto">
      {/* Enhanced Header with Town Display */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Performance Dashboard</h1>
            <p className="text-xs text-gray-600 mt-1 flex items-center">
              Monitor and manage employee and branch performance
              <span className="flex items-center ml-4 text-indigo-600 font-medium">
                <MapPin className="w-4 h-4 mr-1" />
                {getDisplayName()}
              </span>
            </p>

            {/* Enhanced Debug info with branch coverage */}
            <div className="text-xs text-gray-400 mt-2 space-y-1">
              <div>Coverage: {filteredEmployees.length} employees, {filteredBranches.length} branches</div>

            </div>
          </div>
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <GlowButton
              variant="secondary"
              icon={Filter}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </GlowButton>
          </div>
        </div>
      </div>
      {/* Filters Section */}
      {showFilters && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Performance Filters</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Branch Location</label>
              <select
                value={selectedBranch}
                onChange={(e) => {
                  setSelectedBranch(e.target.value);
                  setEmployeePage(1);
                }}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500"
              >
                <option value="all">All Branches</option>
                {filteredBranchesByTown.map(branch => {
                  const branchName = branch["Branch Office"] || '';
                  return (
                    <option
                      key={branch.id}
                      value={branchName} // Use the actual branch name instead of lowercase
                    >
                      {branchName}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Employee Role</label>
              <select
                value={selectedRole}
                onChange={(e) => {
                  setSelectedRole(e.target.value);
                  setEmployeePage(1);
                }}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500"
              >
                {roles.map(role => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Rows per page</label>
              <select
                value={rowsPerPage}
                onChange={handleRowsPerPageChange}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500"
              >
                {[5, 10, 20, 50].map(num => (
                  <option key={num} value={num}>{num}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Search</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type="text"
                  placeholder={selectedTab === 'individual' ? "Search employees..." : "Search branches..."}
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setEmployeePage(1);
                    setBranchPage(1);
                  }}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-green-100 focus:border-green-500 text-xs"
                />
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Send Performance Report</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1">Report Type</label>
                <select
                  value={emailType}
                  onChange={(e) => {
                    setEmailType(e.target.value as 'individual' | 'branch');
                    setSelectedEmailRecipient(''); // Reset selection when type changes
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="individual">Individual Performance</option>
                  <option value="branch">Branch Performance</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Recipient</label>
                <select
                  value={emailRecipientType}
                  onChange={(e) => {
                    setEmailRecipientType(e.target.value as 'all' | 'specific');
                    setSelectedEmailRecipient(''); // Reset selection when recipient type changes
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-2"
                >
                  <option value="all">All {emailType === 'individual' ? 'Employees' : 'Branches'}</option>
                  <option value="specific">Specific {emailType === 'individual' ? 'Employee' : 'Branch'}</option>
                </select>

                {emailRecipientType === 'specific' && (
                  <Select
                    options={emailOptions[emailType]}
                    value={emailOptions[emailType].find((option: any) => option.value === selectedEmailRecipient) || null}
                    onChange={(selectedOption: any) => setSelectedEmailRecipient(selectedOption ? selectedOption.value : '')}
                    placeholder={`Select ${emailType === 'individual' ? 'Employee' : 'Branch'}`}
                    isSearchable={true}
                  />
                )}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Frequency</label>
                <select
                  value={emailFrequency}
                  onChange={(e) => setEmailFrequency(e.target.value as any)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="once">Send Once</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <GlowButton
                variant="secondary"
                onClick={() => setShowEmailModal(false)}
                disabled={emailSending}
              >
                Cancel
              </GlowButton>
              <GlowButton
                onClick={handleSendEmails}
                disabled={emailSending || (emailRecipientType === 'specific' && !selectedEmailRecipient)}
                icon={emailSending ? Clock : Send}
              >
                {emailSending ? 'Sending...' : 'Send Email'}
              </GlowButton>
            </div>
          </div>
        </div>
      )}
      {/* Tabs Navigation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-200 bg-white">
          <div className="flex items-center">
            <nav className="flex overflow-x-auto [&::-webkit-scrollbar]:hidden flex-1">
              {[
                { key: "individual", label: "Individual Performance" },
                { key: "branch", label: "Branch Performance" },
                { key: "employeePerformance", label: "Employee Performance Table" },
                { key: "branchPerformance", label: "Branch Performance Table" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setSelectedTab(tab.key as any)}
                  className={`py-4 px-6 whitespace-nowrap text-center border-b-2 font-medium text-xs transition-colors duration-200 border-r border-gray-200 last:border-r-0
                    ${selectedTab === tab.key
                      ? "border-b-green-500 text-green-600 bg-green-50"
                      : "border-b-transparent text-gray-500 hover:text-gray-700 hover:border-b-gray-300 bg-transparent hover:bg-gray-50"}`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            {/* View Mode Capsule - Only for Individual Performance */}
            {selectedTab === "individual" && (
              <div className="flex-shrink-0 px-6 py-2">
                <div className="inline-flex rounded-full bg-gray-100 p-1">
                  <button
                    onClick={() => setViewMode("summary")}
                    className={`px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 ${viewMode === "summary"
                        ? "bg-white text-green-600 shadow-sm"
                        : "text-gray-600 hover:text-gray-800"
                      }`}
                  >
                    Summary
                  </button>
                  <button
                    onClick={() => setViewMode("detailed")}
                    className={`px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 ${viewMode === "detailed"
                        ? "bg-white text-green-600 shadow-sm"
                        : "text-gray-600 hover:text-gray-800"
                      }`}
                  >
                    Detailed
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Enhanced Individual Performance View */}
      {selectedTab === 'individual' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 md:p-6 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Staff Performance Metrics</h2>
              <p className="text-gray-600 text-xs">
                Showing {paginatedEmployees.length} of {filteredEmployees.length} employees
                <span className="text-xs font-normal text-gray-500 ml-2">
                  in {getDisplayName()}
                </span>
              </p>
            </div>
            <GlowButton
              icon={Mail}
              onClick={() => {
                setEmailType('individual');
                setShowEmailModal(true);
              }}
            >
              Send Reports
            </GlowButton>
          </div>

          {viewMode === 'summary' ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left py-3 px-4 text-gray-700 font-semibold">Employee</th>
                      <th className="text-left py-3 px-4 text-gray-700 font-semibold">Role</th>
                      <th className="text-left py-3 px-4 text-gray-700 font-semibold">Branch</th>
                      <th className="text-left py-3 px-4 text-gray-700 font-semibold">Disbursement Targets</th>
                      <th className="text-left py-3 px-4 text-gray-700 font-semibold">Clients</th>
                      <th className="text-left py-3 px-4 text-gray-700 font-semibold">Collection Metrics</th>
                      <th className="text-left py-3 px-4 text-gray-700 font-semibold">PAR</th>
                      <th className="text-center py-3 px-4 text-gray-700 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedEmployees.map((employee) => {
                      const activeClients = employee.clients.filter(c => c.status === 'active').length;
                      const clientRatio = employee.clients.length > 0 ? Math.round((activeClients / employee.clients.length) * 100) : 0;

                      return (
                        <React.Fragment key={employee.id}>
                          <tr className="border-b border-gray-300 hover:bg-gray-50">
                            <td className="py-4 px-4">
                              <div className="space-y-1">
                                <p className="text-gray-900 font-semibold">{employee.name}</p>
                                <p className="text-xs text-gray-500">ID: {employee.id}</p>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <p className="text-gray-700">{employee.role}</p>
                            </td>
                            <td className="py-4 px-4">
                              <p className="text-gray-700">{employee.branch}</p>
                            </td>
                            <td className="py-4 px-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">Today:</span>
                                  <span className={`text-xs ${employee.disbursementTargets.achieved.today >= employee.disbursementTargets.daily ? 'text-green-600' : 'text-red-600'}`}>
                                    {employee.disbursementTargets.achieved.today}/{employee.disbursementTargets.daily}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">Week:</span>
                                  <span className={`text-xs ${employee.disbursementTargets.achieved.thisWeek >= employee.disbursementTargets.weekly ? 'text-green-600' : 'text-red-600'}`}>
                                    {employee.disbursementTargets.achieved.thisWeek}/{employee.disbursementTargets.weekly}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Users className="w-4 h-4 text-gray-500" />
                                  <span>{employee.clients.length} total</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <UserCheck className="w-4 h-4 text-green-500" />
                                  <span>{activeClients} active</span>
                                  <StatusBadge status="Attendance" value={clientRatio} />
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span>Rate:</span>
                                  <StatusBadge status="Collection" value={employee.collectionMetrics.collectionRate} />
                                </div>
                                <div className="flex items-center gap-2">
                                  <span>Overdue:</span>
                                  <span className="text-xs font-medium text-red-600">
                                    KSh {employee.collectionMetrics.overdueAmount?.toLocaleString() || '0'}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <StatusBadge status="PAR" value={employee.par} />
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex justify-center gap-1">
                                <GlowButton
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => toggleEmployeeExpand(employee.id)}
                                >
                                  {expandedEmployee === employee.id ? 'Hide Details' : 'View Details'}
                                </GlowButton>
                              </div>
                            </td>
                          </tr>

                          {expandedEmployee === employee.id && (
                            <tr className="bg-gray-50">
                              <td colSpan={8} className="px-4 py-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                  {/* Disbursement Targets Card */}
                                  <div className="border border-gray-200 rounded-lg p-4">
                                    <h3 className="font-semibold text-xs flex items-center gap-2 mb-3">
                                      <Target className="w-4 h-4 text-green-500" />
                                      Disbursement Targets
                                    </h3>
                                    <div className="space-y-3">
                                      <div>
                                        <div className="flex justify-between text-xs mb-1">
                                          <span>Daily Target</span>
                                          <span className="font-medium">
                                            {employee.disbursementTargets.achieved.today}/{employee.disbursementTargets.daily}
                                          </span>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                          <div
                                            className="bg-green-500 h-2 rounded-full"
                                            style={{ width: `${Math.min(100, (employee.disbursementTargets.achieved.today / (employee.disbursementTargets.daily || 1)) * 100)}%` }}
                                          ></div>
                                        </div>
                                      </div>
                                      <div>
                                        <div className="flex justify-between text-xs mb-1">
                                          <span>Weekly Target</span>
                                          <span className="font-medium">
                                            {employee.disbursementTargets.achieved.thisWeek}/{employee.disbursementTargets.weekly}
                                          </span>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                          <div
                                            className="bg-purple-500 h-2 rounded-full"
                                            style={{ width: `${Math.min(100, (employee.disbursementTargets.achieved.thisWeek / (employee.disbursementTargets.weekly || 1)) * 100)}%` }}
                                          ></div>
                                        </div>
                                      </div>
                                      <div>
                                        <div className="flex justify-between text-xs mb-1">
                                          <span>Monthly Target</span>
                                          <span className="font-medium">
                                            {employee.loansDisbursed}/{employee.target}
                                          </span>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                          <div
                                            className="bg-green-500 h-2 rounded-full"
                                            style={{ width: `${Math.min(100, (employee.loansDisbursed / (employee.target || 1)) * 100)}%` }}
                                          ></div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Client Portfolio Card */}
                                  <div className="border border-gray-200 rounded-lg p-4">
                                    <h3 className="font-semibold text-xs flex items-center gap-2 mb-3">
                                      <Users className="w-4 h-4 text-green-500" />
                                      Client Portfolio
                                    </h3>
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs">Active:</span>
                                        <span className="font-medium text-green-600">{employee.clients.filter(c => c.status === 'active').length}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs">Inactive:</span>
                                        <span className="font-medium text-red-600">{employee.clients.length - employee.clients.filter(c => c.status === 'active').length}</span>
                                      </div>
                                    </div>
                                    <div className="h-32 flex items-center justify-center">
                                      <div className="relative w-24 h-24">
                                        <PieChart className="w-full h-full text-gray-200" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                          <span className="text-xs font-semibold">{Math.round((employee.clients.filter(c => c.status === 'active').length / (employee.clients.length || 1)) * 100)}%</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Collection Metrics Card */}
                                  <div className="border border-gray-200 rounded-lg p-4">
                                    <h3 className="font-semibold text-xs flex items-center gap-2 mb-3">
                                      <Coins className="w-4 h-4 text-yellow-500" />
                                      Collection Metrics
                                    </h3>
                                    <div className="space-y-3">
                                      <div>
                                        <div className="flex justify-between text-xs mb-1">
                                          <span>Total Portfolio</span>
                                          <span className="font-medium">
                                            KSh {employee.collectionMetrics.totalPortfolio?.toLocaleString() || '0'}
                                          </span>
                                        </div>
                                      </div>
                                      <div>
                                        <div className="flex justify-between text-xs mb-1">
                                          <span>Collected This Week</span>
                                          <span className="font-medium text-green-600">
                                            KSh {employee.collectionMetrics.collectedThisWeek?.toLocaleString() || '0'}
                                          </span>
                                        </div>
                                      </div>
                                      <div>
                                        <div className="flex justify-between text-xs mb-1">
                                          <span>Overdue Amount</span>
                                          <span className="font-medium text-red-600">
                                            KSh {employee.collectionMetrics.overdueAmount?.toLocaleString() || '0'}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="pt-2 border-t border-gray-200">
                                        <div className="flex justify-between items-center">
                                          <span className="text-xs">Collection Rate</span>
                                          <StatusBadge status="Collection" value={employee.collectionMetrics.collectionRate} />
                                        </div>
                                      </div>
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
              <div className="p-4 border-t border-gray-200">
                <Pagination
                  currentPage={employeePage}
                  totalPages={totalEmployeePages}
                  onPageChange={handleEmployeePageChange}
                />
              </div>
            </>
          ) : (
            <>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {paginatedEmployees.map(employee => {
                  // Find the corresponding branch data for display
                  const branchInfo = filteredBranchesByTown.find(b =>
                    isStringMatch(b["Branch Office"] || '', employee.branch || '') ||
                    isStringMatch(b["Town"] || '', employee.branch || '')
                  );
                  const activeClients = employee.clients.filter(c => c.status === 'active').length;
                  const clientRatio = employee.clients.length > 0 ? Math.round((activeClients / employee.clients.length) * 100) : 0;

                  return (
                    <div key={employee.id} className="border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow">
                      <div className="p-5 bg-white">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h3 className="font-semibold text-gray-900">{employee.name}</h3>
                            <p className="text-xs text-gray-500">
                              {employee.role} • {employee.branch}
                            </p>
                            <p className="text-xs text-gray-400">ID: {employee.id}</p>
                          </div>
                          <StatusBadge status="PAR" value={employee.par} />
                        </div>

                        <div className="space-y-4">
                          {/* Disbursement Targets */}
                          <div>
                            <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                              <Target className="w-3 h-3" /> Disbursement Targets
                            </h4>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">Today:</span>
                                <span className={`text-xs ${employee.disbursementTargets.achieved.today >= employee.disbursementTargets.daily ? 'text-green-600' : 'text-red-600'}`}>
                                  {employee.disbursementTargets.achieved.today}/{employee.disbursementTargets.daily}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">Week:</span>
                                <span className={`text-xs ${employee.disbursementTargets.achieved.thisWeek >= employee.disbursementTargets.weekly ? 'text-green-600' : 'text-red-600'}`}>
                                  {employee.disbursementTargets.achieved.thisWeek}/{employee.disbursementTargets.weekly}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Client Portfolio */}
                          <div>
                            <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                              <Users className="w-3 h-3" /> Client Portfolio
                            </h4>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Users className="w-4 h-4 text-gray-500" />
                                <span>{employee.clients.length} total</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <UserCheck className="w-4 h-4 text-green-500" />
                                <span>{activeClients} active</span>
                                <StatusBadge status="Attendance" value={clientRatio} />
                              </div>
                            </div>
                          </div>

                          {/* Collection Metrics */}
                          <div>
                            <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                              <Coins className="w-3 h-3" /> Collection Metrics
                            </h4>
                            <div className="space-y-3">
                              <div>
                                <div className="flex justify-between text-xs mb-1">
                                  <span>Total Portfolio</span>
                                  <span className="font-medium">
                                    KSh {employee.collectionMetrics.totalPortfolio?.toLocaleString() || '0'}
                                  </span>
                                </div>
                              </div>
                              <div>
                                <div className="flex justify-between text-xs mb-1">
                                  <span>Collected This Week</span>
                                  <span className="font-medium text-green-600">
                                    KSh {employee.collectionMetrics.collectedThisWeek?.toLocaleString() || '0'}
                                  </span>
                                </div>
                              </div>
                              <div>
                                <div className="flex justify-between text-xs mb-1">
                                  <span>Overdue Amount</span>
                                  <span className="font-medium text-red-600">
                                    KSh {employee.collectionMetrics.overdueAmount?.toLocaleString() || '0'}
                                  </span>
                                </div>
                              </div>
                              <div className="pt-2 border-t border-gray-200">
                                <div className="flex justify-between items-center">
                                  <span className="text-xs">Collection Rate</span>
                                  <StatusBadge status="Collection" value={employee.collectionMetrics.collectionRate} />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-gray-50 px-5 py-3 border-t border-gray-200 flex justify-between items-center">
                        <div className="text-xs text-gray-600">
                          Last updated: Today
                        </div>
                        <GlowButton variant="secondary" size="sm">View Details</GlowButton>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="p-4 border-t border-gray-200">
                <Pagination
                  currentPage={employeePage}
                  totalPages={totalEmployeePages}
                  onPageChange={handleEmployeePageChange}
                />
              </div>
            </>
          )}
        </div>
      )}
      {/* Branch Performance View */}
      {selectedTab === 'branch' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Branch Performance Comparison</h2>
                <p className="text-gray-600 text-xs">
                  Showing {paginatedBranches.length} of {filteredBranches.length} branches
                  <span className="text-xs font-normal text-gray-500 ml-2">
                    in {getDisplayName()}
                  </span>
                </p>
              </div>
              <GlowButton
                icon={Mail}
                onClick={() => {
                  setEmailType('branch');
                  setShowEmailModal(true);
                }}
              >
                Send Reports
              </GlowButton>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedBranches.map(branch => {
                const branchData = processedBranchAverages.find(b => b.branch === branch.id) || {
                  loansDisbursed: 0,
                  target: 0,
                  attendance: 0,
                  fieldVisits: 0,
                  par: 0,
                  collection: 0,
                  tat: 0
                };

                return (
                  <div key={branch.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {branch?.["Branch Office"] || ""}
                      </h3>
                      <p className="text-gray-600 text-xs">{branch["Area"]}</p>
                    </div>

                    <div className="space-y-3 mt-4">
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Loan Disbursement Rate</p>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{Math.round(branchData.loansDisbursed)}/{Math.round(branchData.target)}</span>
                          <span className={`text-xs ${branchData.loansDisbursed >= branchData.target ? 'text-green-600' : 'text-red-600'}`}>
                            ({Math.round(branchData.loansDisbursed / (branchData.target || 1) * 100)}%)
                          </span>
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-gray-600 mb-1">Portfolio at Risk (PAR)</p>
                        <StatusBadge status="PAR" value={branchData.par} />
                      </div>

                      <div>
                        <p className="text-xs text-gray-600 mb-1">Collection Efficiency</p>
                        <StatusBadge status="Collection" value={branchData.collection} />
                      </div>

                      <div>
                        <p className="text-xs text-gray-600 mb-1">Average TAT</p>
                        <div className={`text-xs font-medium ${branchData.tat < 36 ? 'text-green-600' : branchData.tat < 48 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {Math.round(branchData.tat)} hours
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-200 flex justify-end">
                      <GlowButton variant="secondary" size="sm">View Details</GlowButton>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200">
              <Pagination
                currentPage={branchPage}
                totalPages={totalBranchPages}
                onPageChange={handleBranchPageChange}
              />
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Branch Performance Metrics</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-gray-700 font-semibold">Branch</th>
                    <th className="text-left py-3 px-4 text-gray-700 font-semibold">Loans Disbursed vs Target</th>
                    <th className="text-left py-3 px-4 text-gray-700 font-semibold">Avg Attendance</th>
                    <th className="text-left py-3 px-4 text-gray-700 font-semibold">Avg Field Visits</th>
                    <th className="text-left py-3 px-4 text-gray-700 font-semibold">Avg PAR</th>
                    <th className="text-left py-3 px-4 text-gray-700 font-semibold">Avg Collection</th>
                    <th className="text-left py-3 px-4 text-gray-700 font-semibold">Avg TAT</th>
                    <th className="text-center py-3 px-4 text-gray-700 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedBranches.map(branch => {
                    const branchData = processedBranchAverages.find(b =>
                      b.branch === branch["Branch Office"] || b.branch === branch.id
                    ) || {
                      loansDisbursed: 0,
                      target: 0,
                      attendance: 0,
                      fieldVisits: 0,
                      par: 0,
                      collection: 0,
                      tat: 0
                    };
                    const disbursementRate = branchData.target > 0 ?
                      Math.round(branchData.loansDisbursed / branchData.target * 100) : 0;

                    return (
                      <React.Fragment key={branch["Branch Office"] || branch.id}>
                        <tr className="border-b border-gray-300 hover:bg-gray-50">
                          <td className="py-4 px-4">
                            <p className="text-gray-900 font-semibold">
                              {branch?.["Branch Office"] || ""}
                            </p>
                            <p className="text-gray-600 text-xs">{branch?.["Area"]}</p>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{Math.round(branchData.loansDisbursed)}/{Math.round(branchData.target)}</span>
                              <span className={`text-xs ${disbursementRate >= 100 ? 'text-green-600' : 'text-red-600'}`}>
                                ({disbursementRate}%)
                              </span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <StatusBadge status="Attendance" value={Math.round(branchData.attendance)} />
                          </td>
                          <td className="py-4 px-4">
                            <StatusBadge status="Attendance" value={Math.round(branchData.fieldVisits)} />
                          </td>
                          <td className="py-4 px-4">
                            <StatusBadge status="PAR" value={Math.round(branchData.par * 10) / 10} />
                          </td>
                          <td className="py-4 px-4">
                            <StatusBadge status="Collection" value={Math.round(branchData.collection)} />
                          </td>
                          <td className="py-4 px-4">
                            <div className={`text-xs font-medium ${branchData.tat < 36 ? 'text-green-600' : branchData.tat < 48 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {Math.round(branchData.tat)}h
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex justify-center gap-1">
                              <GlowButton
                                variant="secondary"
                                icon={BarChart2}
                                size="sm"
                                onClick={() => {
                                  const branchKey = branch["Branch Office"] || branch.id;
                                  setExpandedBranch(expandedBranch === branchKey ? null : branchKey);
                                }}
                              >
                                {expandedBranch === (branch["Branch Office"] || branch.id) ? 'Hide Analytics' : 'Analytics'}
                              </GlowButton>
                            </div>
                          </td>
                        </tr>

                        {expandedBranch === (branch["Branch Office"] || branch.id) && (
                          <tr className="bg-gray-50">
                            <td colSpan={8} className="px-4 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Disbursement Targets Card */}
                                <div className="border border-gray-200 rounded-lg p-4">
                                  <h3 className="font-semibold text-xs flex items-center gap-2 mb-3">
                                    <Target className="w-4 h-4 text-green-500" />
                                    Disbursement Targets
                                  </h3>
                                  <div className="space-y-3">
                                    <div>
                                      <div className="flex justify-between text-xs mb-1">
                                        <span>Monthly Target</span>
                                        <span className="font-medium">
                                          {Math.round(branchData.loansDisbursed)}/{Math.round(branchData.target)}
                                        </span>
                                      </div>
                                      <div className="w-full bg-gray-200 rounded-full h-2">
                                        <div
                                          className="bg-green-500 h-2 rounded-full"
                                          style={{ width: `${Math.min(100, disbursementRate)}%` }}
                                        ></div>
                                      </div>
                                    </div>
                                    <div className="pt-2">
                                      <div className="flex justify-between text-xs">
                                        <span>Achievement Rate</span>
                                        <span className={`font-medium ${disbursementRate >= 100 ? 'text-green-600' : 'text-red-600'}`}>
                                          {disbursementRate}%
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Staff Metrics Card */}
                                <div className="border border-gray-200 rounded-lg p-4">
                                  <h3 className="font-semibold text-xs flex items-center gap-2 mb-3">
                                    <Users className="w-4 h-4 text-green-500" />
                                    Staff Metrics
                                  </h3>
                                  <div className="space-y-3">
                                    <div>
                                      <div className="flex justify-between text-xs mb-1">
                                        <span>Average Attendance</span>
                                        <StatusBadge status="Attendance" value={Math.round(branchData.attendance)} />
                                      </div>
                                    </div>
                                    <div>
                                      <div className="flex justify-between text-xs mb-1">
                                        <span>Average Field Visits</span>
                                        <span className="font-medium">
                                          {Math.round(branchData.fieldVisits)}
                                        </span>
                                      </div>
                                    </div>
                                    <div>
                                      <div className="flex justify-between text-xs mb-1">
                                        <span>Average TAT</span>
                                        <span className={`text-xs font-medium ${branchData.tat < 36 ? 'text-green-600' : branchData.tat < 48 ? 'text-yellow-600' : 'text-red-600'}`}>
                                          {Math.round(branchData.tat)} hours
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Portfolio Metrics Card */}
                                <div className="border border-gray-200 rounded-lg p-4">
                                  <h3 className="font-semibold text-xs flex items-center gap-2 mb-3">
                                    <Coins className="w-4 h-4 text-yellow-500" />
                                    Portfolio Metrics
                                  </h3>
                                  <div className="space-y-3">
                                    <div>
                                      <div className="flex justify-between text-xs mb-1">
                                        <span>Portfolio at Risk (PAR)</span>
                                        <StatusBadge status="PAR" value={Math.round(branchData.par * 10) / 10} />
                                      </div>
                                    </div>
                                    <div>
                                      <div className="flex justify-between text-xs mb-1">
                                        <span>Collection Rate</span>
                                        <StatusBadge status="Collection" value={Math.round(branchData.collection)} />
                                      </div>
                                    </div>
                                    <div className="pt-2 border-t border-gray-200">
                                      <div className="flex justify-between text-xs">
                                        <span>Staff Count</span>
                                        <span className="font-medium">
                                          {filteredEmployeesByTown.filter(e =>
                                            isStringMatch(e.Branch || '', branch["Branch Office"] || '') ||
                                            isStringMatch(e.Town || '', branch["Town"] || '')
                                          ).length}
                                        </span>
                                      </div>
                                    </div>
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
            <div className="mt-4 pt-4 border-t border-gray-200">
              <Pagination
                currentPage={branchPage}
                totalPages={totalBranchPages}
                onPageChange={handleBranchPageChange}
              />
            </div>
          </div>
        </div>
      )}
      {/* Data Management Tabs */}
      {selectedTab === 'employeePerformance' && (
        <EmployeePerformanceTable
          performance={employeePerformance.filter(perf =>
            filteredEmployeesByTown.some(emp => emp["Employee Number"] === perf.employee_id)
          )}
          employees={filteredEmployeesByTown}
          onUpdate={handleUpdateEmployeePerformance}
          onDelete={handleDeleteEmployeePerformance}
        />
      )}
      {selectedTab === 'branchPerformance' && (
        <BranchPerformanceTable
          employeePerformance={employeePerformance}
          employees={filteredEmployeesByTown}
        />
      )}
      <ChatFloater />
    </div>
  );
};
export default PerformanceDashboard;