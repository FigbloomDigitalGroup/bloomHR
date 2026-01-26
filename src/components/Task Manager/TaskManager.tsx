import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { 
  Plus, Check, Circle, Trash2, Calendar, AlertCircle, Clock, User, 
  ChevronDown, X, Users, Building, Shield, RadioTower, Filter,
  Edit3, Star, Repeat, Tag, FolderOpen, Link, Paperclip, MessageSquare,
  List, Grid, ChevronLeft, ChevronRight, Eye, EyeOff, Lock, Unlock,
  CreditCard, FileText, Landmark, Wallet, Target, MapPin, BarChart3,
  Download, Upload, Share2, Copy, Archive, RotateCcw, Search, Play, Pause, Square
} from 'lucide-react';

// Simple Auth Hook
const useAuth = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setUser(session?.user ?? null);
      } catch (error) {
        console.error('Error getting session:', error);
      } finally {
        setLoading(false);
      }
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { 
    user, 
    userId: user?.id,
    userRole: 'staff',
    userBranch: 'Nairobi HQ',
    loading: loading,
    isAdmin: false,
    isStaff: true
  };
};

// Employees Hook
const useEmployees = () => {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEmployees = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('"Employee Number", "First Name", "Middle Name", "Last Name", "Town", "Work Email", "Branch"')
        .order('"First Name"', { ascending: true });

      if (error) throw error;

      // Format employee data for dropdown
      const formattedEmployees = (data || []).map(emp => ({
        id: emp['Employee Number'],
        name: `${emp['First Name'] || ''} ${emp['Middle Name'] || ''} ${emp['Last Name'] || ''}`.trim(),
        employeeNumber: emp['Employee Number'],
        town: emp['Town'],
        email: emp['Work Email'],
        branch: emp['Branch']
      }));

      setEmployees(formattedEmployees);
    } catch (error) {
      console.error('Error fetching employees:', error);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  return { employees, loading, refetch: fetchEmployees };
};

// Timer Hook for tracking time spent on tasks
const useTaskTimer = (todoId: string, initialTimeSpent: number = 0, isCompleted: boolean = false) => {
  const [timeSpent, setTimeSpent] = useState(initialTimeSpent);
  const [isRunning, setIsRunning] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isRunning && startTime) {
      interval = setInterval(() => {
        const currentTime = Date.now();
        const elapsedSeconds = Math.floor((currentTime - startTime) / 1000);
        setTimeSpent(initialTimeSpent + elapsedSeconds);
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, startTime, initialTimeSpent]);

  const startTimer = () => {
    if (!isCompleted) {
      setIsRunning(true);
      setStartTime(Date.now());
    }
  };

  const pauseTimer = () => {
    setIsRunning(false);
  };

  const stopTimer = async () => {
    setIsRunning(false);
    // Save the time to the database
    try {
      const { error } = await supabase
        .from('todos')
        .update({ 
          actual_time_spent: timeSpent,
          updated_at: new Date().toISOString()
        })
        .eq('id', todoId);

      if (error) throw error;
    } catch (error) {
      console.error('Error saving time:', error);
    }
  };

  const resetTimer = () => {
    setIsRunning(false);
    setTimeSpent(0);
    setStartTime(null);
  };

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return {
    timeSpent,
    isRunning,
    formattedTime: formatTime(timeSpent),
    startTimer,
    pauseTimer,
    stopTimer,
    resetTimer,
    setTimeSpent
  };
};

// Enhanced Constants
const MICROFINANCE_CONSTANTS = {
  priorities: [
    { value: 'low', label: 'Low', color: 'green' },
    { value: 'medium', label: 'Medium', color: 'amber' },
    { value: 'high', label: 'High', color: 'orange' },
    { value: 'critical', label: 'Critical', color: 'red' }
  ] as const,
  statuses: [
    { value: 'not-started', label: 'Not Started', color: 'gray' },
    { value: 'in-progress', label: 'In Progress', color: 'blue' },
    { value: 'pending-review', label: 'Pending Review', color: 'purple' },
    { value: 'pending-approval', label: 'Pending Approval', color: 'violet' },
    { value: 'on-hold', label: 'On Hold', color: 'yellow' },
    { value: 'completed', label: 'Completed', color: 'green' },
    { value: 'cancelled', label: 'Cancelled', color: 'red' }
  ] as const,
  categories: [
    'loan-processing', 'client-followup', 'collections', 'accounting', 
    'compliance', 'reporting', 'training', 'meeting', 'administrative', 'other'
  ] as const,
  departments: [
    'operations', 'credit', 'accounting', 'relationship', 
    'compliance', 'management', 'it', 'hr', 'marketing'
  ] as const,
  branches: [
    'Nairobi HQ', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Thika', 
    'Meru', 'Nyeri', 'Malindi', 'Kitale', 'Garissa', 'Lodwar', 'Kakamega', 'Other'
  ] as const,
  repeatOptions: [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'yearly', label: 'Yearly' }
  ] as const,
  counties: [
    'Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Uasin Gishu', 'Kiambu', 
    'Meru', 'Nyeri', 'Kilifi', 'Trans Nzoia', 'Garissa', 'Turkana', 'Other'
  ] as const,
  tabs: [
    'all', 'active', 'completed', 'assigned-to-me', 
    'created-by-me', 'important', 'overdue', 'today'
  ] as const,
  itemsPerPage: 12,
};

// Enhanced Types
type MicrofinanceTodo = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  completed: boolean;
  priority: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  branch: string;
  department: string;
  county: string;
  status: string;
  important: boolean;
  category: string;
  repeat: string;
  completed_comment: string | null;
  completed_at: string | null;
  requires_approval: boolean;
  approved_by?: string;
  approved_at?: string;
  tags: string[];
  attachments: string[];
  time_estimate: number | null;
  actual_time_spent: number | null;
  parent_task_id: string | null;
  related_tasks: string[];
  progress: number;
  last_activity_at: string;
  is_private: boolean;
  timer_started_at?: string;
  timer_running?: boolean;
};

type FormData = {
  title: string;
  description: string;
  priority: string;
  due_date: string;
  assigned_to: string;
  branch: string;
  department: string;
  county: string;
  status: string;
  important: boolean;
  category: string;
  repeat: string;
  requires_approval: boolean;
  tags: string[];
  time_estimate: string;
  is_private: boolean;
};

// Enhanced Utility functions with Emojis
const getStatusEmoji = (status: string) => {
  switch (status) {
    case 'not-started': return '⭕';
    case 'in-progress': return '🔄';
    case 'pending-review': return '👀';
    case 'pending-approval': return '🛡️';
    case 'on-hold': return '⏸️';
    case 'completed': return '✅';
    case 'cancelled': return '❌';
    default: return '📝';
  }
};

const getPriorityEmoji = (priority: string) => {
  switch (priority) {
    case 'critical': return '🚨';
    case 'high': return '🔴';
    case 'medium': return '🟡';
    case 'low': return '🟢';
    default: return '⚪';
  }
};

const getAssignedEmoji = (assignedTo: string | null, userId: string) => {
  if (!assignedTo) return '👤';
  if (assignedTo === userId) return '👉';
  return '👥';
};

const getImportantEmoji = (important: boolean) => {
  return important ? '⭐' : '☆';
};

const getPrivateEmoji = (isPrivate: boolean) => {
  return isPrivate ? '🔒' : '🔓';
};

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'critical': return 'bg-red-50 text-red-700 border-red-200';
    case 'high': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'medium': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'low': return 'bg-green-50 text-green-700 border-green-200';
    default: return 'bg-slate-50 text-slate-700 border-slate-200';
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'not-started': return 'bg-gray-50 text-gray-700 border-gray-200';
    case 'in-progress': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'pending-review': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'pending-approval': return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'on-hold': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    case 'completed': return 'bg-green-50 text-green-700 border-green-200';
    case 'cancelled': return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-slate-50 text-slate-700 border-slate-200';
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'not-started': return <Circle className="w-3 h-3" />;
    case 'in-progress': return <Clock className="w-3 h-3" />;
    case 'pending-review': return <Eye className="w-3 h-3" />;
    case 'pending-approval': return <Shield className="w-3 h-3" />;
    case 'on-hold': return <AlertCircle className="w-3 h-3" />;
    case 'completed': return <Check className="w-3 h-3" />;
    case 'cancelled': return <X className="w-3 h-3" />;
    default: return <Circle className="w-3 h-3" />;
  }
};

const getDepartmentColor = (department: string) => {
  switch (department) {
    case 'operations': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'credit': return 'bg-green-50 text-green-700 border-green-200';
    case 'accounting': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'relationship': return 'bg-pink-50 text-pink-700 border-pink-200';
    case 'compliance': return 'bg-red-50 text-red-700 border-red-200';
    case 'management': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'it': return 'bg-teal-50 text-teal-700 border-teal-200';
    case 'hr': return 'bg-amber-50 text-amber-700 border-amber-200';
    default: return 'bg-slate-50 text-slate-700 border-slate-200';
  }
};

const getDepartmentIcon = (department: string) => {
  switch (department) {
    case 'operations': return <RadioTower className="w-3 h-3" />;
    case 'credit': return <CreditCard className="w-3 h-3" />;
    case 'accounting': return <FileText className="w-3 h-3" />;
    case 'relationship': return <Users className="w-3 h-3" />;
    case 'compliance': return <Shield className="w-3 h-3" />;
    case 'management': return <Landmark className="w-3 h-3" />;
    case 'it': return <Circle className="w-3 h-3" />;
    case 'hr': return <User className="w-3 h-3" />;
    default: return <FolderOpen className="w-3 h-3" />;
  }
};

const getCategoryColor = (category: string) => {
  switch (category) {
    case 'loan-processing': return 'bg-green-50 text-green-700 border-green-200';
    case 'client-followup': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'collections': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'accounting': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'compliance': return 'bg-red-50 text-red-700 border-red-200';
    case 'reporting': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'training': return 'bg-teal-50 text-teal-700 border-teal-200';
    case 'meeting': return 'bg-pink-50 text-pink-700 border-pink-200';
    case 'other': return 'bg-slate-50 text-slate-700 border-slate-200';
    default: return 'bg-slate-50 text-slate-700 border-slate-200';
  }
};

// Enhanced Form Components with text-xs
const MicrofinanceFormInput = ({ 
  label, value, onChange, placeholder, required, type = "text", icon: Icon, helperText 
}: any) => {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-2">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full ${Icon ? 'pl-8' : 'px-3'} pr-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder:text-slate-400 text-xs`}
          placeholder={placeholder}
          required={required}
        />
      </div>
      {helperText && <p className="mt-1 text-xs text-slate-500">{helperText}</p>}
    </div>
  );
};

const MicrofinanceFormSelect = ({ label, value, onChange, options, icon: Icon, helperText, disabled = false }: any) => (
  <div>
    <label className="block text-xs font-medium text-slate-700 mb-2">{label}</label>
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 z-10" />}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full ${Icon ? 'pl-8' : 'px-3'} pr-8 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all appearance-none cursor-pointer text-xs relative z-0 ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        {options.map((option: any) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
    </div>
    {helperText && <p className="mt-1 text-xs text-slate-500">{helperText}</p>}
  </div>
);

// Enhanced Employee Select Component
const EmployeeSelect = ({ label, value, onChange, employees, loading, helperText }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedEmployee = employees.find((emp: any) => emp.id === value);

  if (loading) {
    return (
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-2">{label}</label>
        <div className="relative">
          <div className="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-lg text-xs text-slate-500">
            Loading employees...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-slate-700 mb-2">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-xs text-left flex justify-between items-center hover:bg-slate-50"
        >
          <span className="truncate">
            {selectedEmployee 
              ? `${selectedEmployee.name} (${selectedEmployee.employeeNumber})`
              : value === 'current-user' 
                ? 'Assign to me' 
                : 'Unassigned'
            }
          </span>
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            <div className="p-2 space-y-1">
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setIsOpen(false);
                }}
                className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-slate-100 ${
                  value === '' ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                }`}
              >
                <div className="font-medium">Unassigned</div>
              </button>
              
              <button
                type="button"
                onClick={() => {
                  onChange('current-user');
                  setIsOpen(false);
                }}
                className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-slate-100 ${
                  value === 'current-user' ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                }`}
              >
                <div className="font-medium">Assign to me</div>
              </button>

              {employees.length > 0 && (
                <div className="border-t border-slate-200 pt-1 mt-1">
                  <div className="px-2 py-1 text-xs font-semibold text-slate-500 bg-slate-50 rounded">
                    Employees ({employees.length})
                  </div>
                  {employees.map((emp: any) => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => {
                        onChange(emp.id);
                        setIsOpen(false);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-slate-100 flex flex-col ${
                        value === emp.id ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                      }`}
                    >
                      <span className="font-medium truncate">{emp.name}</span>
                      <span className="text-slate-500 text-xs truncate">
                        {emp.employeeNumber} • {emp.town} • {emp.email}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {helperText && <p className="mt-1 text-xs text-slate-500">{helperText}</p>}
    </div>
  );
};

// FIXED TagInput Component
const TagInput = ({ tags, onChange }: any) => {
  const [inputValue, setInputValue] = useState('');

  // Ensure tags is always an array
  const safeTags = Array.isArray(tags) ? tags : [];

  const addTag = (tag: string) => {
    const trimmedTag = tag.trim();
    if (trimmedTag && !safeTags.includes(trimmedTag)) {
      onChange([...safeTags, trimmedTag]);
    }
    setInputValue('');
  };

  const removeTag = (index: number) => {
    onChange(safeTags.filter((_: any, i: number) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(inputValue);
    }
  };

  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-2">Tags</label>
      <div className="border border-slate-300 rounded-lg p-2 min-h-[40px]">
        <div className="flex flex-wrap gap-1 mb-1">
          {safeTags.map((tag: string, index: number) => (
            <span key={index} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
              {tag}
              <button 
                type="button" 
                onClick={() => removeTag(index)} 
                className="text-blue-500 hover:text-blue-700"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type and press Enter to add tags..."
          className="w-full border-0 focus:ring-0 text-xs placeholder:text-slate-400 p-0"
        />
      </div>
    </div>
  );
};

// Enhanced Progress Bar Component
const ProgressBar = ({ progress, size = 'sm' }: { progress: number; size?: 'sm' | 'md' | 'lg' }) => {
  const height = size === 'sm' ? 'h-1.5' : size === 'md' ? 'h-2' : 'h-2.5';
  
  return (
    <div className="w-full bg-slate-200 rounded-full">
      <div 
        className={`${height} bg-blue-600 rounded-full transition-all duration-300`}
        style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
      />
    </div>
  );
};

// Timer Display Component
const TimerDisplay = ({ timeSpent, isRunning }: { timeSpent: number; isRunning: boolean }) => {
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-mono ${
      isRunning ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-600'
    }`}>
      <Clock className="w-3 h-3" />
      <span>{formatTime(timeSpent)}</span>
      {isRunning && (
        <div className="flex items-center gap-0.5">
          <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse"></div>
          <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
          <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
        </div>
      )}
    </div>
  );
};

// Main Component
export function MicrofinanceTodoList() {
  const { user, userId, loading: authLoading } = useAuth();
  const { employees, loading: employeesLoading } = useEmployees();
  const [todos, setTodos] = useState<MicrofinanceTodo[]>([]);
  const [filteredTodos, setFilteredTodos] = useState<MicrofinanceTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTodo, setEditingTodo] = useState<MicrofinanceTodo | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');

  // Enhanced Filters
  const [branchFilter, setBranchFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [dateRangeFilter, setDateRangeFilter] = useState('');

  // Get unique towns and branches from employees for dropdowns
  const uniqueTowns = useMemo(() => {
    const towns = employees.map(emp => emp.town).filter(Boolean);
    return [...new Set(towns)].sort();
  }, [employees]);

  const uniqueBranches = useMemo(() => {
    const branches = employees.map(emp => emp.branch).filter(Boolean);
    return [...new Set(branches)].sort();
  }, [employees]);

  // Pagination
  const totalPages = Math.ceil(filteredTodos.length / MICROFINANCE_CONSTANTS.itemsPerPage);
  const startIndex = (currentPage - 1) * MICROFINANCE_CONSTANTS.itemsPerPage;
  const paginatedTodos = filteredTodos.slice(startIndex, startIndex + MICROFINANCE_CONSTANTS.itemsPerPage);

  // Enhanced fetch with real data simulation
  const fetchTodos = async () => {
    try {
      const { data, error } = await supabase
        .from('todos')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const enhancedTodos = (data || []).map(todo => ({
        ...todo,
        user_name: 'User',
        assigned_user_name: 'Team Member',
        status: todo.status || 'not-started',
        important: todo.important || false,
        category: todo.category || 'other',
        department: todo.department || 'operations',
        branch: todo.branch || 'Nairobi HQ',
        county: todo.county || 'Nairobi',
        requires_approval: todo.requires_approval || false,
        tags: Array.isArray(todo.tags) ? todo.tags : [], // FIXED: Ensure tags is always array
        progress: todo.progress || 0,
        is_private: todo.is_private || false,
        time_estimate: todo.time_estimate || null,
        actual_time_spent: todo.actual_time_spent || null,
        timer_running: todo.timer_running || false,
        timer_started_at: todo.timer_started_at || null
      }));

      setTodos(enhancedTodos);
    } catch (error) {
      console.error('Error fetching todos:', error);
      // Fallback to sample data
      setTodos([]);
    } finally {
      setLoading(false);
    }
  };

  // Enhanced form handlers
  const handleFormSubmit = useCallback(async (formData: FormData) => {
    try {
      if (!userId) {
        alert('Please log in to create tasks');
        return;
      }

      // Handle current-user assignment
      const assignedTo = formData.assigned_to === 'current-user' ? userId : formData.assigned_to;

      const { error } = await supabase.from('todos').insert([{
        user_id: userId,
        title: formData.title,
        description: formData.description,
        priority: formData.priority,
        due_date: formData.due_date || null,
        assigned_to: assignedTo,
        branch: formData.branch,
        department: formData.department,
        county: formData.county,
        status: formData.status,
        important: formData.important,
        category: formData.category,
        repeat: formData.repeat,
        requires_approval: formData.requires_approval,
        tags: formData.tags,
        time_estimate: formData.time_estimate ? parseInt(formData.time_estimate) : null,
        is_private: formData.is_private,
        completed: false,
        progress: 0,
        actual_time_spent: 0, // Initialize timer
        timer_running: true, // Start timer automatically when task is created
        timer_started_at: new Date().toISOString()
      }]);

      if (error) throw error;
      
      fetchTodos();
      setShowForm(false);
    } catch (error: any) {
      console.error('Error creating todo:', error);
      alert('Error creating task');
    }
  }, [userId]);

  const handleUpdateTodo = useCallback(async (id: string, formData: FormData) => {
    try {
      // Handle current-user assignment
      const assignedTo = formData.assigned_to === 'current-user' ? userId : formData.assigned_to;

      const { error } = await supabase
        .from('todos')
        .update({
          ...formData,
          assigned_to: assignedTo,
          time_estimate: formData.time_estimate ? parseInt(formData.time_estimate) : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;
      
      fetchTodos();
      setShowForm(false);
      setEditingTodo(null);
    } catch (error) {
      console.error('Error updating todo:', error);
    }
  }, [userId]);

  // Action handlers
  const toggleComplete = useCallback(async (id: string, completed: boolean) => {
    try {
      const { error } = await supabase
        .from('todos')
        .update({ 
          completed: !completed,
          status: completed ? 'not-started' : 'completed',
          updated_at: new Date().toISOString(),
          timer_running: completed ? true : false, // Stop timer when completed
          completed_at: completed ? null : new Date().toISOString()
        })
        .eq('id', id);
      if (error) throw error;
      fetchTodos();
    } catch (error) {
      console.error('Error updating todo:', error);
    }
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('todos')
        .delete()
        .eq('id', id);
      if (error) throw error;
      fetchTodos();
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  }, []);

  // Close task handler
  const closeTask = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('todos')
        .update({ 
          completed: true,
          status: 'completed',
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          timer_running: false // Stop timer when task is closed
        })
        .eq('id', id);
      if (error) throw error;
      fetchTodos();
    } catch (error) {
      console.error('Error closing task:', error);
    }
  }, []);

  // Timer control handlers
  const startTimer = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('todos')
        .update({ 
          timer_running: true,
          timer_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', id);
      if (error) throw error;
      fetchTodos();
    } catch (error) {
      console.error('Error starting timer:', error);
    }
  }, []);

  const pauseTimer = useCallback(async (id: string) => {
    try {
      // First get current task to calculate time spent
      const { data: task } = await supabase
        .from('todos')
        .select('actual_time_spent, timer_started_at')
        .eq('id', id)
        .single();

      if (task) {
        let additionalTime = 0;
        if (task.timer_started_at) {
          additionalTime = Math.floor((Date.now() - new Date(task.timer_started_at).getTime()) / 1000);
        }

        const { error } = await supabase
          .from('todos')
          .update({ 
            timer_running: false,
            actual_time_spent: (task.actual_time_spent || 0) + additionalTime,
            timer_started_at: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', id);
        if (error) throw error;
        fetchTodos();
      }
    } catch (error) {
      console.error('Error pausing timer:', error);
    }
  }, []);

  // Enhanced filters with search
  useEffect(() => {
    let filtered = [...todos];

    // Tab-based filtering
    switch (activeTab) {
      case 'active':
        filtered = filtered.filter(todo => !todo.completed && todo.status !== 'cancelled');
        break;
      case 'completed':
        filtered = filtered.filter(todo => todo.completed);
        break;
      case 'assigned-to-me':
        filtered = filtered.filter(todo => todo.assigned_to === userId);
        break;
      case 'created-by-me':
        filtered = filtered.filter(todo => todo.user_id === userId);
        break;
      case 'important':
        filtered = filtered.filter(todo => todo.important);
        break;
      case 'overdue':
        filtered = filtered.filter(todo => 
          !todo.completed && todo.due_date && new Date(todo.due_date) < new Date()
        );
        break;
      case 'today':
        filtered = filtered.filter(todo => 
          todo.due_date && new Date(todo.due_date).toDateString() === new Date().toDateString()
        );
        break;
    }

    // Search filtering
    if (searchQuery) {
      filtered = filtered.filter(todo => 
        todo.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        todo.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (Array.isArray(todo.tags) && todo.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())))
      );
    }

    // Additional filters
    if (branchFilter) filtered = filtered.filter(todo => todo.branch === branchFilter);
    if (departmentFilter) filtered = filtered.filter(todo => todo.department === departmentFilter);
    if (statusFilter) filtered = filtered.filter(todo => todo.status === statusFilter);
    if (categoryFilter) filtered = filtered.filter(todo => todo.category === categoryFilter);
    if (priorityFilter) filtered = filtered.filter(todo => todo.priority === priorityFilter);

    setFilteredTodos(filtered);
    setCurrentPage(1);
  }, [todos, activeTab, searchQuery, branchFilter, departmentFilter, statusFilter, categoryFilter, priorityFilter, userId]);

  // Initialize
  useEffect(() => {
    if (!authLoading) {
      fetchTodos();
    }
  }, [authLoading]);

  // Enhanced Todo Item Component with Timer and Close Button
  const TodoItem = ({ todo }: { todo: MicrofinanceTodo }) => {
    const isAssignedToMe = todo.assigned_to === userId;
    const isCreatedByMe = todo.user_id === userId;
    
    // Find assigned employee details
    const assignedEmployee = employees.find(emp => emp.id === todo.assigned_to);
    
    // Ensure tags is always an array
    const safeTags = Array.isArray(todo.tags) ? todo.tags : [];

    // Get assigned employee info for display
    const assignedInfo = assignedEmployee 
      ? `${assignedEmployee.name} (${assignedEmployee.employeeNumber})`
      : todo.assigned_to === userId 
        ? 'Assigned to me' 
        : 'Unassigned';

    // Calculate time spent considering running timer
    const calculateTimeSpent = () => {
      let totalTime = todo.actual_time_spent || 0;
      if (todo.timer_running && todo.timer_started_at) {
        const additionalTime = Math.floor((Date.now() - new Date(todo.timer_started_at).getTime()) / 1000);
        totalTime += additionalTime;
      }
      return totalTime;
    };

    const currentTimeSpent = calculateTimeSpent();

    const formatTime = (seconds: number) => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
      <div className={`bg-white rounded-xl border border-slate-300 p-3 transition-all hover:border-slate-400 hover:shadow-lg ${
        todo.completed ? 'opacity-60' : ''
      }`}>
        
        {/* Header with Emojis */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm" title={`Status: ${todo.status}`}>
            {getStatusEmoji(todo.status)}
          </span>
          <span className="text-sm" title={`Priority: ${todo.priority}`}>
            {getPriorityEmoji(todo.priority)}
          </span>
          <span className="text-sm" title={isAssignedToMe ? "Assigned to me" : "Assignment"}>
            {getAssignedEmoji(todo.assigned_to, userId)}
          </span>
          {todo.important && (
            <span className="text-sm" title="Important task">
              {getImportantEmoji(todo.important)}
            </span>
          )}
          {todo.is_private && (
            <span className="text-sm" title="Private task">
              {getPrivateEmoji(todo.is_private)}
            </span>
          )}
        </div>

        <div className="flex justify-between items-start mb-2">
          <div className="flex items-start gap-2 flex-1">
            <button
              onClick={() => toggleComplete(todo.id, todo.completed)}
              className={`flex-shrink-0 mt-0.5 transition-all ${
                todo.completed 
                  ? 'text-green-500 hover:text-slate-400' 
                  : 'text-slate-300 hover:text-blue-600'
              }`}
            >
              {todo.completed ? (
                <Check className="w-3 h-3" strokeWidth={2.5} />
              ) : (
                <Circle className="w-3 h-3" strokeWidth={2.5} />
              )}
            </button>
            
            <div className="flex-1">
              <h3 className={`text-xs font-medium leading-tight ${todo.completed ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                {todo.title}
              </h3>
              {todo.description && (
                <p className="text-xs text-slate-600 mt-1 line-clamp-2">{todo.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => { setEditingTodo(todo); setShowForm(true); }}
              className="text-slate-400 hover:text-blue-500 transition-colors p-1"
              title="Edit task"
            >
              <Edit3 className="w-3 h-3" />
            </button>
            {(isCreatedByMe) && (
              <button
                onClick={() => deleteTask(todo.id)}
                className="text-slate-400 hover:text-red-500 transition-colors p-1"
                title="Delete task"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Timer and Close Button Section */}
        {!todo.completed && (
          <div className="flex items-center justify-between mb-2 p-2 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-2">
              <TimerDisplay timeSpent={currentTimeSpent} isRunning={todo.timer_running || false} />
              <div className="flex items-center gap-1">
                {!todo.timer_running ? (
                  <button
                    onClick={() => startTimer(todo.id)}
                    className="flex items-center gap-1 px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs transition-colors"
                    title="Start timer"
                  >
                    <Play className="w-3 h-3" />
                  </button>
                ) : (
                  <button
                    onClick={() => pauseTimer(todo.id)}
                    className="flex items-center gap-1 px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-xs transition-colors"
                    title="Pause timer"
                  >
                    <Pause className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            
            <button
              onClick={() => closeTask(todo.id)}
              className="flex items-center gap-1 px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium transition-colors"
              title="Close task"
            >
              <Check className="w-3 h-3" />
              Close
            </button>
          </div>
        )}

        {/* Assigned Employee Info */}
        {todo.assigned_to && (
          <div className="flex items-center gap-1 text-xs text-slate-600 mb-2">
            <User className="w-3 h-3" />
            <span className="truncate" title={assignedInfo}>
              {assignedInfo}
            </span>
          </div>
        )}

        {/* Progress Bar */}
        {!todo.completed && todo.progress > 0 && (
          <div className="mb-2">
            <div className="flex justify-between text-xs text-slate-600 mb-1">
              <span>Progress</span>
              <span>{todo.progress}%</span>
            </div>
            <ProgressBar progress={todo.progress} size="sm" />
          </div>
        )}

        {/* Tags */}
        {safeTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {safeTags.map((tag, index) => (
              <span key={index} className="inline-flex items-center px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-1 mb-2">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${getStatusColor(todo.status)}`}>
            {getStatusIcon(todo.status)}
            {todo.status.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
          </span>

          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${getPriorityColor(todo.priority)}`}>
            {todo.priority.charAt(0).toUpperCase() + todo.priority.slice(1)}
          </span>

          {todo.time_estimate && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-700 border border-slate-200">
              <Clock className="w-3 h-3" />
              {todo.time_estimate}h
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-200">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <Building className="w-3 h-3" />
              <span>{todo.branch}</span>
            </div>
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              <span>{todo.county}</span>
            </div>
            {todo.due_date && (
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                <span className={new Date(todo.due_date) < new Date() && !todo.completed ? 'text-red-500 font-medium' : ''}>
                  {new Date(todo.due_date).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Enhanced Todo Form Modal
  const TodoFormModal = () => {
    const [formData, setFormData] = useState<FormData>({
      title: '',
      description: '',
      priority: 'medium',
      due_date: '',
      assigned_to: '',
      branch: '',
      department: 'operations',
      county: '',
      status: 'not-started',
      important: false,
      category: 'other',
      repeat: 'none',
      requires_approval: false,
      tags: [], // FIXED: Initialize as empty array
      time_estimate: '',
      is_private: false
    });

    useEffect(() => {
      if (editingTodo) {
        // Convert assigned_to to 'current-user' if it's the current user
        const assignedTo = editingTodo.assigned_to === userId ? 'current-user' : editingTodo.assigned_to;
        
        setFormData({
          title: editingTodo.title,
          description: editingTodo.description || '',
          priority: editingTodo.priority,
          due_date: editingTodo.due_date || '',
          assigned_to: assignedTo || '',
          branch: editingTodo.branch,
          department: editingTodo.department,
          county: editingTodo.county,
          status: editingTodo.status,
          important: editingTodo.important,
          category: editingTodo.category,
          repeat: editingTodo.repeat,
          requires_approval: editingTodo.requires_approval,
          tags: Array.isArray(editingTodo.tags) ? editingTodo.tags : [], // FIXED: Ensure tags is array
          time_estimate: editingTodo.time_estimate?.toString() || '',
          is_private: editingTodo.is_private || false
        });
      }
    }, [editingTodo, userId]);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (editingTodo) {
        handleUpdateTodo(editingTodo.id, formData);
      } else {
        handleFormSubmit(formData);
      }
    };

    if (!showForm && !editingTodo) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center p-4 border-b border-slate-200 sticky top-0 bg-white z-10">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {editingTodo ? 'Edit Task' : 'Create New Task'}
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                {editingTodo ? 'Update task details and progress' : 'Add a new task to your workflow'}
              </p>
            </div>
            <button 
              onClick={() => { setShowForm(false); setEditingTodo(null); }}
              className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded-lg hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <form onSubmit={handleSubmit} className="p-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column - Core Information */}
              <div className="space-y-4">
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-1 text-xs">
                    <FileText className="w-3 h-3" />
                    Core Information
                  </h4>
                  
                  <MicrofinanceFormInput
                    label="Task Title"
                    value={formData.title}
                    onChange={(value: string) => setFormData(prev => ({ ...prev, title: value }))}
                    placeholder="What needs to be done?"
                    required
                    helperText="Be specific and actionable"
                  />

                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-700 mb-2">
                      Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder:text-slate-400 text-xs resize-none"
                      placeholder="Provide detailed instructions, context, or requirements..."
                      rows={3}
                    />
                  </div>

                  <TagInput
                    tags={formData.tags}
                    onChange={(tags: string[]) => setFormData(prev => ({ ...prev, tags }))}
                  />
                </div>

                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <h4 className="font-semibold text-slate-900 mb-2 flex items-center gap-1 text-xs">
                    <Clock className="w-3 h-3" />
                    Time & Scheduling
                  </h4>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-2">Due Date</label>
                      <div className="relative">
                        <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                        <input
                          type="date"
                          value={formData.due_date}
                          onChange={(e) => setFormData(prev => ({ ...prev, due_date: e.target.value }))}
                          min={new Date().toISOString().split('T')[0]}
                          className="w-full pl-7 pr-2 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer text-xs"
                        />
                      </div>
                    </div>

                    <MicrofinanceFormInput
                      label="Time Estimate (hours)"
                      value={formData.time_estimate}
                      onChange={(value: string) => setFormData(prev => ({ ...prev, time_estimate: value }))}
                      placeholder="0"
                      type="number"
                      helperText="Estimated hours to complete"
                    />
                  </div>

                  <MicrofinanceFormSelect
                    label="Repeat"
                    value={formData.repeat}
                    onChange={(value: string) => setFormData(prev => ({ ...prev, repeat: value }))}
                    options={MICROFINANCE_CONSTANTS.repeatOptions}
                    icon={Repeat}
                    helperText="Set up recurring tasks"
                  />
                </div>
              </div>

              {/* Right Column - Classification & Settings */}
              <div className="space-y-4">
                <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                  <h4 className="font-semibold text-green-900 mb-2 flex items-center gap-1 text-xs">
                    <Users className="w-3 h-3" />
                    Assignment & Location
                  </h4>
                  
                  <div className="grid grid-cols-2 gap-3">
                    {/* Branch dropdown from Town column */}
                    <MicrofinanceFormSelect
                      label="Branch"
                      value={formData.branch}
                      onChange={(value: string) => setFormData(prev => ({ ...prev, branch: value }))}
                      options={[
                        { value: '', label: 'Select Branch' },
                        ...uniqueTowns.map(town => ({ value: town, label: town }))
                      ]}
                      icon={Building}
                      helperText="From Town column"
                    />

                    {/* County dropdown from Branch column */}
                    <MicrofinanceFormSelect
                      label="County"
                      value={formData.county}
                      onChange={(value: string) => setFormData(prev => ({ ...prev, county: value }))}
                      options={[
                        { value: '', label: 'Select County' },
                        ...uniqueBranches.map(branch => ({ value: branch, label: branch }))
                      ]}
                      icon={MapPin}
                      helperText="From Branch column"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <MicrofinanceFormSelect
                      label="Department"
                      value={formData.department}
                      onChange={(value: string) => setFormData(prev => ({ ...prev, department: value }))}
                      options={MICROFINANCE_CONSTANTS.departments.map(dept => ({
                        value: dept,
                        label: dept.charAt(0).toUpperCase() + dept.slice(1)
                      }))}
                      icon={RadioTower}
                    />

                    {/* Enhanced Employee Select */}
                    <EmployeeSelect
                      label="Assign To"
                      value={formData.assigned_to}
                      onChange={(value: string) => setFormData(prev => ({ ...prev, assigned_to: value }))}
                      employees={employees}
                      loading={employeesLoading}
                      helperText="Select employee from database"
                    />
                  </div>
                </div>

                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                  <h4 className="font-semibold text-amber-900 mb-2 flex items-center gap-1 text-xs">
                    <BarChart3 className="w-3 h-3" />
                    Classification
                  </h4>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <MicrofinanceFormSelect
                      label="Priority"
                      value={formData.priority}
                      onChange={(value: string) => setFormData(prev => ({ ...prev, priority: value }))}
                      options={MICROFINANCE_CONSTANTS.priorities}
                    />

                    <MicrofinanceFormSelect
                      label="Status"
                      value={formData.status}
                      onChange={(value: string) => setFormData(prev => ({ ...prev, status: value }))}
                      options={MICROFINANCE_CONSTANTS.statuses}
                    />
                  </div>

                  <MicrofinanceFormSelect
                    label="Category"
                    value={formData.category}
                    onChange={(value: string) => setFormData(prev => ({ ...prev, category: value }))}
                    options={MICROFINANCE_CONSTANTS.categories.map(category => ({
                      value: category,
                      label: category.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
                    }))}
                    icon={FolderOpen}
                  />
                </div>

                <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                  <h4 className="font-semibold text-purple-900 mb-2 flex items-center gap-1 text-xs">
                    <Shield className="w-3 h-3" />
                    Settings & Permissions
                  </h4>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-300">
                      <div className="flex items-center gap-2">
                        <Star className={`w-4 h-4 ${formData.important ? 'text-amber-500 fill-amber-500' : 'text-slate-400'}`} />
                        <div>
                          <div className="font-medium text-slate-900 text-xs">Mark as Important</div>
                          <div className="text-xs text-slate-600">Priority attention required</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, important: !prev.important }))}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          formData.important ? 'bg-amber-500' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            formData.important ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-300">
                      <div className="flex items-center gap-2">
                        {formData.is_private ? <Lock className="w-4 h-4 text-slate-600" /> : <Unlock className="w-4 h-4 text-slate-600" />}
                        <div>
                          <div className="font-medium text-slate-900 text-xs">Private Task</div>
                          <div className="text-xs text-slate-600">Only visible to you and assigned person</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, is_private: !prev.is_private }))}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          formData.is_private ? 'bg-blue-500' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            formData.is_private ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-300">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-slate-600" />
                        <div>
                          <div className="font-medium text-slate-900 text-xs">Requires Approval</div>
                          <div className="text-xs text-slate-600">Needs manager approval to complete</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, requires_approval: !prev.requires_approval }))}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          formData.requires_approval ? 'bg-purple-500' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            formData.requires_approval ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-4 mt-4 border-t border-slate-200">
              <button
                type="submit"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold transition-all text-xs shadow-lg hover:shadow-xl"
              >
                {editingTodo ? 'Update Task' : 'Create Task'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingTodo(null); }}
                className="flex-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 py-2 rounded-lg font-medium transition-all text-xs"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // Enhanced Search and Filters with text-xs
  const SearchAndFilters = () => (
    <div className="bg-white rounded-xl p-4 mb-4 border border-slate-300 shadow-sm">
      <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center justify-between mb-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search tasks, descriptions, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-xs"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1 px-2 py-1.5 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-all text-xs">
            <Download className="w-3 h-3" />
            Export
          </button>
          <button className="flex items-center gap-1 px-2 py-1.5 bg-slate-100 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-200 transition-all text-xs">
            <Filter className="w-3 h-3" />
            More Filters
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {/* Branch filter from Town data */}
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="px-2 py-1.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-xs"
        >
          <option value="">All Branches</option>
          {uniqueTowns.map(town => (
            <option key={town} value={town}>{town}</option>
          ))}
        </select>

        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="px-2 py-1.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-xs"
        >
          <option value="">All Departments</option>
          {MICROFINANCE_CONSTANTS.departments.map(dept => (
            <option key={dept} value={dept}>
              {dept.charAt(0).toUpperCase() + dept.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2 py-1.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-xs"
        >
          <option value="">All Statuses</option>
          {MICROFINANCE_CONSTANTS.statuses.map(status => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-2 py-1.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-xs"
        >
          <option value="">All Priorities</option>
          {MICROFINANCE_CONSTANTS.priorities.map(priority => (
            <option key={priority.value} value={priority.value}>
              {priority.label}
            </option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-2 py-1.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-xs"
        >
          <option value="">All Categories</option>
          {MICROFINANCE_CONSTANTS.categories.map(category => (
            <option key={category} value={category}>
              {category.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  // Enhanced Tabs Component with text-xs
  const Tabs = () => (
    <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-300 mb-4 overflow-x-auto shadow-sm">
      {[
        { id: 'all', label: 'All Tasks', count: todos.length, icon: List },
        { id: 'active', label: 'Active', count: todos.filter(t => !t.completed && t.status !== 'cancelled').length, icon: Clock },
        { id: 'today', label: 'Today', count: todos.filter(t => t.due_date && new Date(t.due_date).toDateString() === new Date().toDateString()).length, icon: Calendar },
        { id: 'important', label: 'Important', count: todos.filter(t => t.important).length, icon: Star },
        { id: 'assigned-to-me', label: 'My Tasks', count: todos.filter(t => t.assigned_to === userId).length, icon: User },
        { id: 'created-by-me', label: 'Created by Me', count: todos.filter(t => t.user_id === userId).length, icon: Edit3 },
        { id: 'overdue', label: 'Overdue', count: todos.filter(t => !t.completed && t.due_date && new Date(t.due_date) < new Date()).length, icon: AlertCircle },
        { id: 'completed', label: 'Completed', count: todos.filter(t => t.completed).length, icon: Check },
      ].map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs transition-all whitespace-nowrap ${
            activeTab === tab.id
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <tab.icon className="w-3 h-3" />
          {tab.label}
          <span className={`px-1 py-0.5 rounded text-xs font-medium ${
            activeTab === tab.id
              ? 'bg-blue-100 text-blue-700'
              : 'bg-slate-200 text-slate-600'
          }`}>
            {tab.count}
          </span>
        </button>
      ))}
    </div>
  );

  // Stats Overview with text-xs
  const StatsOverview = () => {
    const stats = useMemo(() => ({
      total: todos.length,
      completed: todos.filter(t => t.completed).length,
      overdue: todos.filter(t => !t.completed && t.due_date && new Date(t.due_date) < new Date()).length,
      important: todos.filter(t => t.important).length,
      inProgress: todos.filter(t => t.status === 'in-progress').length,
      totalTime: todos.reduce((acc, todo) => acc + (todo.actual_time_spent || 0), 0)
    }), [todos]);

    const formatTime = (seconds: number) => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    };

    return (
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        <div className="bg-white p-3 rounded-xl border border-slate-300 shadow-sm">
          <div className="text-lg font-bold text-slate-900">{stats.total}</div>
          <div className="text-xs text-slate-600">Total Tasks</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-300 shadow-sm">
          <div className="text-lg font-bold text-green-600">{stats.completed}</div>
          <div className="text-xs text-slate-600">Completed</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-300 shadow-sm">
          <div className="text-lg font-bold text-red-600">{stats.overdue}</div>
          <div className="text-xs text-slate-600">Overdue</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-300 shadow-sm">
          <div className="text-lg font-bold text-amber-600">{stats.important}</div>
          <div className="text-xs text-slate-600">Important</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-300 shadow-sm">
          <div className="text-lg font-bold text-blue-600">{stats.inProgress}</div>
          <div className="text-xs text-slate-600">In Progress</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-300 shadow-sm">
          <div className="text-lg font-bold text-purple-600">{formatTime(stats.totalTime)}</div>
          <div className="text-xs text-slate-600">Total Time</div>
        </div>
      </div>
    );
  };

  // Loading states
  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-300 p-8 text-center">
        <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <Shield className="w-6 h-6 text-slate-400" />
        </div>
        <h3 className="text-base font-semibold text-slate-900 mb-1">Authentication Required</h3>
        <p className="text-xs text-slate-500 mb-3">
          Please log in to access the task management system
        </p>
        <button
          onClick={() => window.location.href = '/login'}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg font-semibold transition-all text-xs"
        >
          Go to Login
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Task Management</h1>
          <p className="text-xs text-slate-600 mt-1">
            Manage microfinance operations and workflows
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-300">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded transition-all ${
                viewMode === 'grid'
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Grid className="w-3 h-3" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded transition-all ${
                viewMode === 'list'
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3 h-3" />
            </button>
          </div>

          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-semibold transition-all text-xs shadow-lg hover:shadow-xl"
          >
            <Plus className="w-3 h-3" />
            New Task
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      <StatsOverview />

      {/* Tabs */}
      <Tabs />

      {/* Search and Filters */}
      <SearchAndFilters />

      {/* Todo Form Modal */}
      <TodoFormModal />

      {/* Todo List */}
      {filteredTodos.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-300 p-8 text-center">
          <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <FileText className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 mb-1">
            {todos.length === 0 ? 'No Tasks Yet' : 'No Tasks Match Your Criteria'}
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            {todos.length === 0 
              ? 'Create your first task to get started with microfinance operations' 
              : 'Try adjusting your search or filters to see more results'
            }
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg font-semibold transition-all text-xs"
          >
            Create Your First Task
          </button>
        </div>
      ) : (
        <div className={`${viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4' : 'space-y-3'}`}>
          {paginatedTodos.map((todo) => (
            <TodoItem key={todo.id} todo={todo} />
          ))}
        </div>
      )}

      {/* Pagination with text-xs */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-300">
          <div className="text-xs text-slate-600">
            Showing {startIndex + 1}-{Math.min(startIndex + MICROFINANCE_CONSTANTS.itemsPerPage, filteredTodos.length)} of {filteredTodos.length} tasks
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs disabled:opacity-50 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 transition-all"
            >
              <ChevronLeft className="w-3 h-3" />
              Previous
            </button>
            
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNum = currentPage <= 3 ? i + 1 : currentPage >= totalPages - 2 ? totalPages - 4 + i : currentPage - 2 + i;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-6 h-6 rounded text-xs font-medium transition-all ${
                      currentPage === pageNum
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs disabled:opacity-50 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 transition-all"
            >
              Next
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}