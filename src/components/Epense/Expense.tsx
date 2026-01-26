import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Search,
  Filter,
  Calendar,
  Receipt,
  CreditCard,
  MapPin,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Eye,
  Download,
  TrendingUp,
  Wallet,
  FileText,
  User,
  MoreVertical,
  ArrowUpRight,
  DollarSign,
  Activity,
  Zap,
  Target,
  X,
  Upload,
  Camera,
  Paperclip,
  Grid3X3,
  List,
  ChevronDown,
  Building,
  Users,
  Home,
  Banknote,
  Loader,
  Check,
  Ban,
  MessageSquare,
  ThumbsUp
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import RoleButtonWrapper from '../ProtectedRoutes/RoleButton';
import { TownProps } from '../../types/supabase';

interface Expense {
  id: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'recommended';
  receipt?: string;
  submittedBy: string;
  location: string;
  branch: string;
  department: string;
  expenseType: string;
  employeeId?: string;
  employeeFullName?: string;
  approvedBy?: string;
  approvedDate?: string;
  rejectionReason?: string;
  recommendationReason?: string;
  recommendedBy?: string;
  recommendedDate?: string;
  avatar?: string;
  receiptUploaded?: boolean;
}

interface Employee {
  id: string;
  office: string;
  job_level: string;
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

const EXPENSE_TYPES = [
  { id: 'operational', name: 'Operational Expenses' },
  { id: 'travel', name: 'Travel & Transport' },
  { id: 'rent', name: 'Rent & Utilities' },
  { id: 'petty-cash', name: 'Petty Cash' },
  { id: 'employee', name: 'Employee Expenses' },
  { id: 'maintenance', name: 'Maintenance & Repairs' }
];

const EXPENSE_CATEGORIES = [
  { id: 'transport', name: 'Transport', color: 'bg-blue-500' },
  { id: 'accommodation', name: 'Accommodation', color: 'bg-purple-500' },
  { id: 'meals', name: 'Meals & Entertainment', color: 'bg-orange-500' },
  { id: 'office', name: 'Office Supplies', color: 'bg-green-500' },
  { id: 'communication', name: 'Communication', color: 'bg-indigo-500' },
  { id: 'training', name: 'Training & Development', color: 'bg-pink-500' },
  { id: 'medical', name: 'Medical', color: 'bg-red-500' },
  { id: 'fuel', name: 'Fuel', color: 'bg-yellow-500' },
  { id: 'maintenance', name: 'Maintenance', color: 'bg-gray-500' },
  { id: 'rent', name: 'Rent & Utilities', color: 'bg-cyan-500' },
  { id: 'petty-cash', name: 'Petty Cash', color: 'bg-teal-500' },
  { id: 'utilities', name: 'Utilities', color: 'bg-emerald-500' },
  { id: 'other', name: 'Other', color: 'bg-slate-500' }
];

const ExpenseModule: React.FC<TownProps> = ({ selectedTown, onTownChange, selectedRegion }) => {
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [expenseTypeFilter, setExpenseTypeFilter] = useState<string>('all');
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalExpense, setApprovalExpense] = useState<Expense | null>(null);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject' | 'recommend'>('approve');
  const [rejectionReason, setRejectionReason] = useState('');
  const [recommendationReason, setRecommendationReason] = useState('');
  const [showReceiptUpload, setShowReceiptUpload] = useState(false);
  const [receiptUploadExpense, setReceiptUploadExpense] = useState<Expense | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  // Enhanced town filtering state with improved mappings
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

  const [newExpense, setNewExpense] = useState({
    title: '',
    category: '',
    amount: '',
    date: '',
    description: '',
    location: '',
    branch: '',
    department: '',
    expenseType: '',
    employeeId: '',
    employeeFullName: '',
    receiptFile: null as File | null
  });

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

  // Fix currentTown initialization to ensure it's properly set from selectedTown
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
        setDebugInfo("No town selected - will show all expenses");
        console.log('No town selected, currentTown set to empty string');
      }
    }
  }, [selectedTown, onTownChange]);

  // Enhanced town selection logic with comprehensive branch matching
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
      setDebugInfo("No town filter - showing all expenses");
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
    // Check if current selection is a town
    else {
      setIsArea(false);
      
      // Add the selected town
      selectedTownsList.push(currentTown);
      
      // Get branches that serve this town
      const branchesForTown = townBranchMapping[currentTown] || [];
      eligibleBranchesList.push(...branchesForTown);
      
      // Check if this town belongs to an area and get sibling towns
      if (townAreaMapping[currentTown]) {
        const parentArea = townAreaMapping[currentTown];
        const siblingTowns = areaTownMapping[parentArea] || [];
        
        // Add sibling towns
        siblingTowns.forEach(town => {
          if (!selectedTownsList.includes(town)) {
            selectedTownsList.push(town);
          }
          
          // Add branches for sibling towns
          const siblingBranches = townBranchMapping[town] || [];
          siblingBranches.forEach(branch => {
            if (!eligibleBranchesList.includes(branch)) {
              eligibleBranchesList.push(branch);
            }
          });
        });
        
        // Also add the parent area as a potential branch
        if (!eligibleBranchesList.includes(parentArea)) {
          eligibleBranchesList.push(parentArea);
        }
        
    
      } else {
        // Standalone town - also try direct name matching
        if (!eligibleBranchesList.includes(currentTown)) {
          eligibleBranchesList.push(currentTown);
        }
        
      
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

  // Fetch expenses and employee data from Supabase
  useEffect(() => {
    fetchExpenses();
    fetchEmployeeData();
  }, []);

  // Enhanced expense filtering with comprehensive branch matching and stricter logic
  const filteredByTown = useMemo(() => {
    console.log('=== EXPENSE FILTERING DEBUG ===');
    console.log('currentTown:', currentTown);
    console.log('Total expenses before filter:', allExpenses.length);
    console.log('Eligible branches:', eligibleBranches);
    console.log('Selected towns:', selectedTowns);

    // If no town is selected or ADMIN_ALL is selected, show all expenses
    if (!currentTown || currentTown === 'ADMIN_ALL' || currentTown === '') {
      console.log('Showing all expenses (no town filter)');
      return allExpenses;
    }
    
    if (eligibleBranches.length === 0 && selectedTowns.length === 0) {
      console.log('No eligible branches or towns found, returning empty result');
      return [];
    }

    const filtered = allExpenses.filter(expense => {
      let shouldInclude = false;
      let matchReason = '';

      // Skip expenses with no branch information
      if (!expense.branch && !expense.location) {
        console.log('Expense has no branch or location:', expense.id, expense.title);
        return false;
      }
      
      // Check if expense branch matches any eligible branch
      if (expense.branch && eligibleBranches.length > 0) {
        const branchMatches = eligibleBranches.some(eligibleBranch => {
          const matches = isStringMatch(expense.branch, eligibleBranch);
          if (matches) {
            console.log(`✓ Branch match: "${expense.branch}" matches "${eligibleBranch}"`);
            matchReason = `branch matches ${eligibleBranch}`;
          }
          return matches;
        });
        if (branchMatches) shouldInclude = true;
      }
      
      // Check if expense location matches any selected town
      if (expense.location && selectedTowns.length > 0) {
        const locationMatches = selectedTowns.some(town => {
          const matches = isStringMatch(expense.location || '', town);
          if (matches) {
            console.log(`✓ Location match: "${expense.location}" matches "${town}"`);
            matchReason = `location matches ${town}`;
          }
          return matches;
        });
        if (locationMatches) shouldInclude = true;
      }
      
      if (shouldInclude) {
        console.log(`✓ Including expense: ${expense.id} - ${expense.title} (Reason: ${matchReason})`);
      } else {
        console.log(`✗ Excluding expense: ${expense.id} - ${expense.title} (Branch: ${expense.branch}, Location: ${expense.location})`);
      }
      
      return shouldInclude;
    });
    
    console.log(`Filtered ${allExpenses.length} expenses down to ${filtered.length} for town "${currentTown}"`);
    console.log('=== END FILTERING DEBUG ===');
    
    return filtered;
  }, [allExpenses, currentTown, selectedTowns, eligibleBranches]);

  const fetchExpenses = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('date', { ascending: false });

      if (error) {
        throw error;
      }

      if (data) {
        // Transform data to match our interface
        const formattedData: Expense[] = data.map((item: any) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          amount: item.amount,
          date: item.date,
          description: item.description,
          status: item.status,
          receipt: item.receipt,
          submittedBy: item.submitted_by,
          location: item.location,
          branch: item.branch,
          department: item.department,
          expenseType: item.expense_type,
          employeeId: item.employee_id,
          employeeFullName: item.employee_full_name,
          approvedBy: item.approved_by,
          approvedDate: item.approved_date,
          rejectionReason: item.rejection_reason,
          recommendationReason: item.rec_reason,
          recommendedBy: item.recommended_by,
          recommendedDate: item.recommended_date,
          avatar: item.avatar,
          receiptUploaded: !!item.receipt
        }));
        
        setAllExpenses(formattedData);
        console.log('Loaded expenses:', formattedData.length);
        console.log('Unique branches in expenses:', [...new Set(formattedData.map(e => e.branch))]);
        console.log('Unique locations in expenses:', [...new Set(formattedData.map(e => e.location))]);
      }
    } catch (error) {
      console.error('Error fetching expenses:', error);
      alert('Error fetching expenses. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployeeData = async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('Office, "Job Level"');

      if (error) {
        throw error;
      }

      if (data) {
        // Extract unique branches (offices) and departments (job levels)
        const uniqueBranches = [...new Set(data.map(emp => emp.Office).filter(Boolean))];
        const uniqueDepartments = [...new Set(data.map(emp => emp["Job Level"]).filter(Boolean))];
        
        setBranches(uniqueBranches);
        setDepartments(uniqueDepartments);
      }
    } catch (error) {
      console.error('Error fetching employee data:', error);
      // Fallback to default values if employees table doesn't exist or has issues
      setBranches(['Nairobi HQ', 'Mombasa', 'Kisumu', 'Eldoret', 'Nakuru']);
      setDepartments(['Human Resources', 'Finance', 'IT & Technology', 'Operations', 'Sales']);
    }
  };

  // Calculate summary statistics using filtered data
  const summaryStats = useMemo(() => {
    const expenses = filteredByTown; // Use filtered data instead of all expenses
    const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const approvedExpenses = expenses.filter(e => e.status === 'approved');
    const pendingExpenses = expenses.filter(e => e.status === 'pending');
    const rejectedExpenses = expenses.filter(e => e.status === 'rejected');
    const recommendedExpenses = expenses.filter(e => e.status === 'recommended');

    // Calculate by expense type
    const rentExpenses = expenses.filter(e => e.expenseType === 'rent').reduce((sum, expense) => sum + expense.amount, 0);
    const pettyCashExpenses = expenses.filter(e => e.expenseType === 'petty-cash').reduce((sum, expense) => sum + expense.amount, 0);
    const employeeExpenses = expenses.filter(e => e.expenseType === 'employee').reduce((sum, expense) => sum + expense.amount, 0);

    const thisMonth = new Date().getMonth();
    const thisMonthExpenses = expenses.filter(e => new Date(e.date).getMonth() === thisMonth);
    const thisMonthTotal = thisMonthExpenses.reduce((sum, expense) => sum + expense.amount, 0);

    return {
      total: totalExpenses,
      approved: approvedExpenses.reduce((sum, expense) => sum + expense.amount, 0),
      pending: pendingExpenses.reduce((sum, expense) => sum + expense.amount, 0),
      rejected: rejectedExpenses.reduce((sum, expense) => sum + expense.amount, 0),
      recommended: recommendedExpenses.reduce((sum, expense) => sum + expense.amount, 0),
      count: expenses.length,
      approvedCount: approvedExpenses.length,
      pendingCount: pendingExpenses.length,
      rejectedCount: rejectedExpenses.length,
      recommendedCount: recommendedExpenses.length,
      thisMonth: thisMonthTotal,
      avgExpense: totalExpenses / expenses.length || 0,
      rent: rentExpenses,
      pettyCash: pettyCashExpenses,
      employee: employeeExpenses
    };
  }, [filteredByTown]);

  // Filter expenses (now applying to already town-filtered data)
  const filteredExpenses = useMemo(() => {
    return filteredByTown.filter(expense => {
      const matchesSearch = expense.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           expense.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           expense.submittedBy.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           expense.employeeId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           expense.employeeFullName?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || expense.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || expense.category === categoryFilter;
      const matchesBranch = branchFilter === 'all' || expense.branch === branchFilter;
      const matchesDepartment = departmentFilter === 'all' || expense.department === departmentFilter;
      const matchesExpenseType = expenseTypeFilter === 'all' || expense.expenseType === expenseTypeFilter;
      
      return matchesSearch && matchesStatus && matchesCategory && matchesBranch && matchesDepartment && matchesExpenseType;
    });
  }, [filteredByTown, searchTerm, statusFilter, categoryFilter, branchFilter, departmentFilter, expenseTypeFilter]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    
    try {
      let receiptUrl = '';
      
      // Upload receipt if provided
      if (newExpense.receiptFile) {
        const fileExt = newExpense.receiptFile.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `receipts/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('expense-receipts')
          .upload(filePath, newExpense.receiptFile);

        if (uploadError) {
          throw uploadError;
        }

        const { data: { publicUrl } } = supabase.storage
          .from('expense-receipts')
          .getPublicUrl(filePath);
          
        receiptUrl = publicUrl;
      }

      // Insert expense into database
      const { data, error } = await supabase
        .from('expenses')
        .insert([
          {
            title: newExpense.title,
            category: newExpense.category,
            amount: parseFloat(newExpense.amount),
            date: newExpense.date,
            description: newExpense.description,
            location: newExpense.location,
            branch: newExpense.branch,
            department: newExpense.department,
            expense_type: newExpense.expenseType,
            employee_id: newExpense.employeeId,
            employee_full_name: newExpense.employeeFullName,
            receipt: receiptUrl,
            submitted_by: 'Expense Proposer', // You would get this from your auth system
            avatar: 'EP',
            status: 'pending'
          }
        ])
        .select();

      if (error) {
        throw error;
      }

      if (data && data.length > 0) {
        // Add the new expense to our state
        const newExpenseData: Expense = {
          id: data[0].id,
          title: data[0].title,
          category: data[0].category,
          amount: data[0].amount,
          date: data[0].date,
          description: data[0].description,
          status: data[0].status,
          receipt: data[0].receipt,
          submittedBy: data[0].submitted_by,
          location: data[0].location,
          branch: data[0].branch,
          department: data[0].department,
          expenseType: data[0].expense_type,
          employeeId: data[0].employee_id,
          employeeFullName: data[0].employee_full_name,
          avatar: data[0].avatar,
          receiptUploaded: !!data[0].receipt
        };
        
        setAllExpenses([newExpenseData, ...allExpenses]);
      }

      // Reset form
      setNewExpense({
        title: '',
        category: '',
        amount: '',
        date: '',
        description: '',
        location: '',
        branch: '',
        department: '',
        expenseType: '',
        employeeId: '',
        employeeFullName: '',
        receiptFile: null
      });
      
      setShowAddForm(false);
      alert('Expense submitted successfully!');
    } catch (error) {
      console.error('Error adding expense:', error);
      alert('Error adding expense. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleApprovalAction = async () => {
    if (!approvalExpense) return;
    
    setUploading(true);
    try {
      const updateData: any = {
        
        approved_date: new Date().toISOString()
      };

      // Handle different actions
      if (approvalAction === 'approve') {
        updateData.status = 'approved';
      } else if (approvalAction === 'reject') {
        updateData.status = 'rejected';
        if (rejectionReason) {
          updateData.rejection_reason = rejectionReason;
        }
      } else if (approvalAction === 'recommend') {
        // For recommend, we keep the existing status and just add recommendation info
        // This allows recommended expenses to still be approved or rejected later
        if (recommendationReason) {
          updateData.rec_reason = recommendationReason;
    
          updateData.recommended_date = new Date().toISOString();
        }
        // Don't change the status for recommendations - they remain actionable
        delete updateData.status;
      }

      const { error } = await supabase
        .from('expenses')
        .update(updateData)
        .eq('id', approvalExpense.id);

      if (error) {
        throw error;
      }

      // Update local state
      setAllExpenses(allExpenses.map(expense => 
        expense.id === approvalExpense.id 
          ? {
              ...expense,
              ...(approvalAction !== 'recommend' ? { status: approvalAction as 'approved' | 'rejected' } : {}),
              ...(approvalAction === 'approve' ? {
                
                approvedDate: new Date().toISOString()
              } : {}),
              ...(approvalAction === 'reject' ? {
                rejectionReason: rejectionReason
              } : {}),
              ...(approvalAction === 'recommend' ? {
                recommendationReason: recommendationReason,
                
                recommendedDate: new Date().toISOString()
              } : {})
            }
          : expense
      ));

      setShowApprovalModal(false);
      setApprovalExpense(null);
      setRejectionReason('');
      setRecommendationReason('');
      
      const actionMessage = approvalAction === 'recommend' 
        ? 'Recommendation added successfully! Expense can still be approved or rejected.'
        : `Expense ${approvalAction}d successfully!`;
      alert(actionMessage);
    } catch (error) {
      console.error('Error updating expense:', error);
      alert('Error updating expense. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleReceiptUpload = async () => {
    if (!receiptUploadExpense || !receiptFile) return;
    
    setUploading(true);
    try {
      const fileExt = receiptFile.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `receipts/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('expense-receipts')
        .upload(filePath, receiptFile);

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('expense-receipts')
        .getPublicUrl(filePath);

      const { error } = await supabase
        .from('expenses')
        .update({ receipt: publicUrl })
        .eq('id', receiptUploadExpense.id);

      if (error) {
        throw error;
      }

      // Update local state
      setAllExpenses(allExpenses.map(expense => 
        expense.id === receiptUploadExpense.id 
          ? { ...expense, receipt: publicUrl, receiptUploaded: true }
          : expense
      ));

      setShowReceiptUpload(false);
      setReceiptUploadExpense(null);
      setReceiptFile(null);
      alert('Receipt uploaded successfully!');
    } catch (error) {
      console.error('Error uploading receipt:', error);
      alert('Error uploading receipt. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setNewExpense({
        ...newExpense,
        receiptFile: e.target.files[0]
      });
    }
  };

  const handleReceiptFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setReceiptFile(e.target.files[0]);
    }
  };

  const getCategoryInfo = (categoryId: string) => {
    return EXPENSE_CATEGORIES.find(cat => cat.id === categoryId) || EXPENSE_CATEGORIES[12];
  };

  const getExpenseTypeName = (expenseTypeId: string) => {
    return EXPENSE_TYPES.find(type => type.id === expenseTypeId)?.name || expenseTypeId;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'text-emerald-600 bg-emerald-50';
      case 'rejected': return 'text-red-600 bg-red-50';
      case 'recommended': return 'text-blue-600 bg-blue-50';
      default: return 'text-amber-600 bg-amber-50';
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Enhanced display name function with better coverage info
  const getDisplayName = () => {
    if (!currentTown || currentTown === '' || currentTown === 'ADMIN_ALL') return "All Towns";
    
    if (isArea) {
      return `${currentTown} Region`;
    } else if (selectedTowns.length > 1) {
      const parentArea = townAreaMapping[currentTown];
      return `${currentTown} (${parentArea} area - ${selectedTowns.length} towns)`;
    }
    
    return currentTown;
  };

  // Check if expense can be acted upon (pending or recommended expenses can be approved/rejected)
  const canTakeAction = (expense: Expense) => {
    return expense.status === 'pending' || expense.status === 'recommended';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-8 h-8 animate-spin mx-auto text-gray-900" />
          <p className="mt-2 text-gray-600">Loading expenses...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Enhanced Header with Better Coverage Display */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Expense Management</h1>
              <p className="text-xs text-gray-600 mt-1 flex items-center">
                Track expenses across branches, departments, rent, and petty cash
                <span className="flex items-center ml-4 text-indigo-600 font-medium">
                  <MapPin className="w-4 h-4 mr-1" />
                  {getDisplayName()}
                </span>
                
              </p>
              
              {/* Enhanced Debug info with branch coverage */}
              <div className="text-xs text-gray-400 mt-2 space-y-1">
                
                
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg transition-colors text-xs font-medium"
              >
                <Plus className="w-4 h-4" />
                <span>New Expense</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 py-8 space-y-8">
        {/* Enhanced Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600">Total</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{formatCurrency(summaryStats.total)}</p>
                <p className="text-xs text-gray-500 mt-1">{summaryStats.count} expenses</p>
              </div>
              <div className="w-2 h-2 bg-gray-900 rounded-full"></div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600">Rent & Utilities</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{formatCurrency(summaryStats.rent)}</p>
              </div>
              <div className="w-2 h-2 bg-cyan-500 rounded-full"></div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600">Petty Cash</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{formatCurrency(summaryStats.pettyCash)}</p>
              </div>
              <div className="w-2 h-2 bg-teal-500 rounded-full"></div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600">Travel</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{formatCurrency(summaryStats.employee)}</p>
              </div>
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600">Pending</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{formatCurrency(summaryStats.pending)}</p>
                <p className="text-xs text-gray-500 mt-1">{summaryStats.pendingCount} items</p>
              </div>
              <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600">Recommended</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{formatCurrency(summaryStats.recommended)}</p>
                <p className="text-xs text-gray-500 mt-1">{summaryStats.recommendedCount} items</p>
              </div>
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            </div>
          </div>
        </div>

        {/* Enhanced Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex flex-col space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
              <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search expenses, employees..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 pr-4 py-2 w-full sm:w-80 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="recommended">Recommended</option>
                  <option value="rejected">Rejected</option>
                </select>

                <select
                  value={expenseTypeFilter}
                  onChange={(e) => setExpenseTypeFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                >
                  <option value="all">All Types</option>
                  {EXPENSE_TYPES.map(type => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <div className="flex items-center bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-1.5 rounded-md transition-colors text-xs ${
                      viewMode === 'list' 
                        ? 'bg-white shadow-sm text-gray-900' 
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-1.5 rounded-md transition-colors text-xs ${
                      viewMode === 'grid' 
                        ? 'bg-white shadow-sm text-gray-900' 
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Grid3X3 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Secondary Filters */}
            <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4">
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
              >
                <option value="all">All Branches</option>
                {branches.map(branch => (
                  <option key={branch} value={branch}>{branch}</option>
                ))}
              </select>

              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
              >
                <option value="all">All Departments</option>
                {departments.map(department => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
              >
                <option value="all">All Categories</option>
                {EXPENSE_CATEGORIES.map(category => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Enhanced Expense List */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">
              {filteredExpenses.length} expenses
              <span className="text-xs font-normal text-gray-500 ml-2">
                in {getDisplayName()}
              </span>
            </h2>
          </div>

          {filteredExpenses.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <Receipt className="w-8 h-8 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No expenses found</h3>
              <p className="text-gray-600 mb-4">
                No expenses found for {getDisplayName()}. Try adjusting your search or filter criteria.
              </p>
            </div>
          ) : (
            <div className={viewMode === 'grid' 
              ? "grid grid-cols-1 lg:grid-cols-2 gap-4" 
              : "space-y-3"
            }>
              {filteredExpenses.map((expense) => {
                const categoryInfo = getCategoryInfo(expense.category);
                
                return (
                  <div
                    key={expense.id}
                    className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
                  >
                    <div className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-start space-x-4 flex-1 min-w-0">
                          <div className={`w-2 h-2 ${categoryInfo.color} rounded-full mt-2 flex-shrink-0`}></div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-3 mb-2">
                              <h3 className="text-base font-medium text-gray-900 truncate">
                                {expense.title}
                              </h3>
                              <span className={`px-2 py-1 rounded-md text-xs font-medium ${getStatusColor(expense.status)}`}>
                                {expense.status}
                              </span>
                              {expense.status === 'approved' && !expense.receiptUploaded && (
                                <span className="px-2 py-1 rounded-md text-xs font-medium text-orange-600 bg-orange-50">
                                  Receipt Pending
                                </span>
                              )}
                              {expense.recommendationReason && (
                                <span className="px-2 py-1 rounded-md text-xs font-medium text-blue-600 bg-blue-50">
                                  Has Recommendation
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-600 line-clamp-2 mb-3">
                              {expense.description}
                            </p>
                            {/* Enhanced Details */}
                            <div className="flex items-center space-x-4 text-xs text-gray-500">
                              <div className="flex items-center space-x-1">
                                <Building className="w-3 h-3" />
                                <span>{expense.branch}</span>
                              </div>
                              <div className="flex items-center space-x-1">
                                <Users className="w-3 h-3" />
                                <span>{expense.department}</span>
                              </div>
                              <div className="flex items-center space-x-1">
                                <span className="text-gray-400">Type:</span>
                                <span>{getExpenseTypeName(expense.expenseType)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="text-right ml-4">
                          <div className="text-lg font-semibold text-gray-900">
                            {formatCurrency(expense.amount)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {categoryInfo.name}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                        <div className="flex items-center space-x-6 text-xs text-gray-600">
                          <div className="flex items-center space-x-2">
                            <div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs font-medium text-gray-700">
                              {expense.avatar}
                            </div>
                            <div className="flex flex-col">
                              <span>{expense.submittedBy}</span>
                              <div className="flex space-x-2 text-gray-400">
                                {expense.employeeId && <span>ID: {expense.employeeId}</span>}
                                {expense.employeeFullName && <span>({expense.employeeFullName})</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-1">
                            <Calendar className="w-3 h-3" />
                            <span>{new Date(expense.date).toLocaleDateString('en-GB')}</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <MapPin className="w-3 h-3" />
                            <span>{expense.branch}</span>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          {canTakeAction(expense) && (
                            <div className="flex items-center space-x-2">
                              <RoleButtonWrapper allowedRoles={['ADMIN','OPERATIONS']}>
                              <button
                                onClick={() => {
                                  setApprovalExpense(expense);
                                  setApprovalAction('approve');
                                  setShowApprovalModal(true);
                                }}
                                className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors text-xs font-medium"
                              >
                                <Check className="w-3 h-3" />
                                <span>Approve</span>
                              </button>
                              </RoleButtonWrapper>
                               <RoleButtonWrapper allowedRoles={['ADMIN','OPERATIONS']}>
                              <button
                                onClick={() => {
                                  setApprovalExpense(expense);
                                  setApprovalAction('recommend');
                                  setShowApprovalModal(true);
                                }}
                                className="flex items-center space-x-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-xs font-medium"
                              >
                                <ThumbsUp className="w-3 h-3" />
                                <span>Recommend</span>
                              </button>
                              </RoleButtonWrapper>
                               <RoleButtonWrapper allowedRoles={['ADMIN','OPERATIONS']}>
                              <button
                                onClick={() => {
                                  setApprovalExpense(expense);
                                  setApprovalAction('reject');
                                  setShowApprovalModal(true);
                                }}
                                className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors text-xs font-medium"
                              >
                                <Ban className="w-3 h-3" />
                                <span>Reject</span>
                              </button>
                              </RoleButtonWrapper>
                            </div>
                          )}
                          
                          {expense.status === 'approved' && !expense.receiptUploaded && (
                            <button
                              onClick={() => {
                                setReceiptUploadExpense(expense);
                                setShowReceiptUpload(true);
                              }}
                              className="flex items-center space-x-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-xs font-medium"
                            >
                              <Upload className="w-3 h-3" />
                              <span>Upload Receipt</span>
                            </button>
                          )}
                          
                          <button
                            onClick={() => setSelectedExpense(expense)}
                            className="text-xs font-medium text-gray-900 hover:text-gray-700 transition-colors"
                          >
                            View Details
                          </button>
                        </div>
                      </div>

                      {expense.status === 'rejected' && expense.rejectionReason && (
                        <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-lg">
                          <div className="flex items-start space-x-2">
                            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-medium text-red-800 mb-1">Rejection Reason</p>
                              <p className="text-xs text-red-700">{expense.rejectionReason}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {expense.recommendationReason && (
                        <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                          <div className="flex items-start space-x-2">
                            <ThumbsUp className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-medium text-blue-800 mb-1">Recommendation</p>
                              <p className="text-xs text-blue-700 mb-2">{expense.recommendationReason}</p>
                              {expense.recommendedBy && expense.recommendedDate && (
                                <p className="text-xs text-blue-600">
                                  Recommended on{' '}
                                  {new Date(expense.recommendedDate).toLocaleDateString('en-GB')}
                                </p>
                              )}
                              {canTakeAction(expense) && (
                                <p className="text-xs text-blue-600 mt-1 font-medium">
                                  This expense can still be approved or rejected
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {expense.status === 'approved' && expense.approvedBy && (
                        <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                          <div className="flex items-center space-x-2 text-xs text-emerald-800">
                            <CheckCircle className="w-4 h-4" />
                            <span>
                              Approved by <strong>{expense.approvedBy}</strong> on{' '}
                              {expense.approvedDate && new Date(expense.approvedDate).toLocaleDateString('en-GB')}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
            <div className="border-b border-gray-200 px-6 py-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-medium text-gray-900">New Expense</h2>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="overflow-y-auto max-h-[calc(90vh-120px)]">
              <form onSubmit={handleAddExpense} className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-gray-700 mb-2">
                      Title
                    </label>
                    <input
                      type="text"
                      value={newExpense.title}
                      onChange={(e) => setNewExpense({...newExpense, title: e.target.value})}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                      placeholder="Expense title"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">
                      Expense Type
                    </label>
                    <select
                      value={newExpense.expenseType}
                      onChange={(e) => setNewExpense({...newExpense, expenseType: e.target.value})}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                      required
                    >
                      <option value="">Select type</option>
                      {EXPENSE_TYPES.map(type => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">
                      Category
                    </label>
                    <select
                      value={newExpense.category}
                      onChange={(e) => setNewExpense({...newExpense, category: e.target.value})}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                      required
                    >
                      <option value="">Select category</option>
                      {EXPENSE_CATEGORIES.map(category => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">
                      Amount (KES)
                    </label>
                    <input
                      type="number"
                      value={newExpense.amount}
                      onChange={(e) => setNewExpense({...newExpense, amount: e.target.value})}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                      placeholder="0.00"
                      required
                      min="0"
                      step="0.01"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">
                      Branch
                    </label>
                    <select
                      value={newExpense.branch}
                      onChange={(e) => setNewExpense({...newExpense, branch: e.target.value})}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                      required
                    >
                      <option value="">Select branch</option>
                      {branches.map(branch => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">
                      Department
                    </label>
                    <select
                      value={newExpense.department}
                      onChange={(e) => setNewExpense({...newExpense, department: e.target.value})}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                      required
                    >
                      <option value="">Select department</option>
                      {departments.map(department => (
                        <option key={department} value={department}>
                          {department}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">
                      Date
                    </label>
                    <input
                      type="date"
                      value={newExpense.date}
                      onChange={(e) => setNewExpense({...newExpense, date: e.target.value})}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">
                      Employee ID
                    </label>
                    <input
                      type="text"
                      value={newExpense.employeeId}
                      onChange={(e) => setNewExpense({...newExpense, employeeId: e.target.value})}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                      placeholder=""
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">
                      Employee Full Name
                    </label>
                    <input
                      type="text"
                      value={newExpense.employeeFullName}
                      onChange={(e) => setNewExpense({...newExpense, employeeFullName: e.target.value})}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs"
                      placeholder=""
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    value={newExpense.description}
                    onChange={(e) => setNewExpense({...newExpense, description: e.target.value})}
                    rows={4}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs resize-none"
                    placeholder="Expense description"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Receipt (Optional)
                  </label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                    <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                    <p className="text-xs text-gray-600 mb-2">
                      {newExpense.receiptFile 
                        ? `Selected: ${newExpense.receiptFile.name}` 
                        : 'Upload receipt'
                      }
                    </p>
                    <label className="cursor-pointer">
                      <span className="text-xs font-medium text-gray-900 hover:text-gray-700 transition-colors px-3 py-1.5 bg-gray-100 rounded-md">
                        Choose file
                      </span>
                      <input
                        type="file"
                        onChange={handleFileUpload}
                        accept="image/*,.pdf,.doc,.docx"
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={uploading}
                    className="px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white rounded-lg transition-colors text-xs font-medium flex items-center space-x-2"
                  >
                    {uploading && <Loader className="w-4 h-4 animate-spin" />}
                    <span>{uploading ? 'Submitting...' : 'Submit Expense'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

       {/* Approval Modal */}
            {showApprovalModal && approvalExpense && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                  <div className="border-b border-gray-200 px-6 py-4">
                    <div className="flex justify-between items-center">
                      <h2 className="text-lg font-medium text-gray-900">
                        {approvalAction === 'approve' && 'Approve Expense'}
                        {approvalAction === 'reject' && 'Reject Expense'}
                        {approvalAction === 'recommend' && 'Add Recommendation'}
                      </h2>
                      <button
                        onClick={() => setShowApprovalModal(false)}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="p-6 space-y-4">
                    <div>
                      <h3 className="text-base font-medium text-gray-900 mb-2">{approvalExpense.title}</h3>
                      <p className="text-xs text-gray-600 mb-4">{formatCurrency(approvalExpense.amount)}</p>
                      {approvalExpense.recommendationReason && (
                        <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg mb-4">
                          <p className="text-xs font-medium text-blue-800 mb-1">Existing Recommendation</p>
                          <p className="text-xs text-blue-700">{approvalExpense.recommendationReason}</p>
                        </div>
                      )}
                    </div>
      
                    {approvalAction === 'reject' && (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-2">
                          Rejection Reason
                        </label>
                        <textarea
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs resize-none"
                          placeholder="Please provide a reason for rejection..."
                          required
                        />
                      </div>
                    )}

                    {approvalAction === 'recommend' && (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-2">
                          Recommendation Reason
                        </label>
                        <textarea
                          value={recommendationReason}
                          onChange={(e) => setRecommendationReason(e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-xs resize-none"
                          placeholder="Please provide your reason for recommending this expense..."
                          required
                        />
                        <p className="text-xs text-gray-500 mt-2">
                          Note: This expense will remain available for approval or rejection after adding this recommendation.
                        </p>
                      </div>
                    )}
      
                    <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => setShowApprovalModal(false)}
                        className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleApprovalAction}
                        disabled={uploading || 
                          (approvalAction === 'reject' && !rejectionReason.trim()) ||
                          (approvalAction === 'recommend' && !recommendationReason.trim())
                        }
                        className={`px-4 py-2 rounded-lg transition-colors text-xs font-medium flex items-center space-x-2 ${
                          approvalAction === 'approve'
                            ? 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white'
                            : approvalAction === 'recommend'
                            ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white'
                            : 'bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white'
                        }`}
                      >
                        {uploading && <Loader className="w-4 h-4 animate-spin" />}
                        <span>{uploading ? 'Processing...' : 
                          (approvalAction === 'approve' ? 'Approve' : 
                           approvalAction === 'recommend' ? 'Add Recommendation' : 'Reject')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

{/* Receipt Upload Modal */}
      {showReceiptUpload && receiptUploadExpense && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="border-b border-gray-200 px-6 py-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-medium text-gray-900">Upload Receipt</h2>
                <button
                  onClick={() => setShowReceiptUpload(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-base font-medium text-gray-900 mb-2">{receiptUploadExpense.title}</h3>
                <p className="text-xs text-gray-600 mb-4">{formatCurrency(receiptUploadExpense.amount)}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  Receipt File
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                  <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                  <p className="text-xs text-gray-600 mb-2">
                    {receiptFile 
                      ? `Selected: ${receiptFile.name}` 
                      : 'Upload receipt as proof of expense'
                    }
                  </p>
                  <label className="cursor-pointer">
                    <span className="text-xs font-medium text-gray-900 hover:text-gray-700 transition-colors px-3 py-1.5 bg-gray-100 rounded-md">
                      Choose file
                    </span>
                    <input
                      type="file"
                      onChange={handleReceiptFileUpload}
                      accept="image/*,.pdf,.doc,.docx"
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setShowReceiptUpload(false)}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReceiptUpload}
                  disabled={uploading || !receiptFile}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors text-xs font-medium flex items-center space-x-2"
                >
                  {uploading && <Loader className="w-4 h-4 animate-spin" />}
                  <span>{uploading ? 'Uploading...' : 'Upload Receipt'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expense Details Modal */}
            {selectedExpense && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
                  <div className="border-b border-gray-200 px-6 py-4">
                    <div className="flex justify-between items-center">
                      <h2 className="text-lg font-medium text-gray-900">Expense Details</h2>
                      <button
                        onClick={() => setSelectedExpense(null)}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="p-6 space-y-4">
                    <div>
                      <h3 className="text-base font-medium text-gray-900 mb-2">{selectedExpense.title}</h3>
                      <p className="text-xs text-gray-600">{selectedExpense.description}</p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <p className="font-medium text-gray-700">Amount</p>
                        <p className="text-gray-900">{formatCurrency(selectedExpense.amount)}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Status</p>
                        <span className={`inline-block px-2 py-1 rounded-md text-xs font-medium ${getStatusColor(selectedExpense.status)}`}>
                          {selectedExpense.status}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Date</p>
                        <p className="text-gray-900">{new Date(selectedExpense.date).toLocaleDateString('en-GB')}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Location</p>
                        <p className="text-gray-900">{selectedExpense.location}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Branch</p>
                        <p className="text-gray-900">{selectedExpense.branch}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Department</p>
                        <p className="text-gray-900">{selectedExpense.department}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Submitted by</p>
                        <p className="text-gray-900">{selectedExpense.submittedBy}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Employee ID</p>
                        <p className="text-gray-900">{selectedExpense.employeeId || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Employee Name</p>
                        <p className="text-gray-900">{selectedExpense.employeeFullName || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Category</p>
                        <p className="text-gray-900">{getCategoryInfo(selectedExpense.category).name}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Type</p>
                        <p className="text-gray-900">{getExpenseTypeName(selectedExpense.expenseType)}</p>
                      </div>
                    </div>
      
                    {selectedExpense.receipt && (
                      <div>
                        <p className="font-medium text-gray-700 mb-2">Receipt</p>
                        <a
                          href={selectedExpense.receipt}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                        >
                          <Eye className="w-4 h-4" />
                          <span>View Receipt</span>
                        </a>
                      </div>
                    )}

                    {selectedExpense.recommendationReason && (
                      <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                        <p className="text-xs font-medium text-blue-800 mb-1">Recommendation</p>
                        <p className="text-xs text-blue-700 mb-2">{selectedExpense.recommendationReason}</p>
                        {selectedExpense.recommendedBy && selectedExpense.recommendedDate && (
                          <p className="text-xs text-blue-600">
                            Recommended on{' '}
                            {new Date(selectedExpense.recommendedDate).toLocaleDateString('en-GB')}
                          </p>
                        )}
                      </div>
                    )}
      
                    {selectedExpense.status === 'approved' && selectedExpense.approvedBy && (
                      <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                        <p className="text-xs text-emerald-800">
                          Approved by <strong>{selectedExpense.approvedBy}</strong> on{' '}
                          {selectedExpense.approvedDate && new Date(selectedExpense.approvedDate).toLocaleDateString('en-GB')}
                        </p>
                      </div>
                    )}
      
                    {selectedExpense.status === 'rejected' && selectedExpense.rejectionReason && (
                      <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                        <p className="text-xs font-medium text-red-800 mb-1">Rejection Reason</p>
                        <p className="text-xs text-red-700">{selectedExpense.rejectionReason}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

    </div>
  );
};

export default ExpenseModule;