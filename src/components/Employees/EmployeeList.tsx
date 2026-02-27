
import { useState, useEffect } from 'react';
import {
  Search, Plus, MapPin, Mail, Phone,
  ChevronLeft, ChevronRight, Briefcase,
  Settings,
  Edit3Icon,
  UserRoundCog,
  Copy,
  Building2,
  CheckSquare,
  X,
  Save
} from 'lucide-react';
import DuplicateCheckModal from './DuplicateCheckModal';
import BulkEditModal from './BulkEditModal';
import SearchableDropdown from '../UI/SearchableDropdown';
import { motion } from 'framer-motion';
import { TownProps } from '../../types/supabase';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import GlowButton from '../UI/GlowButton';
import { useNavigate } from 'react-router-dom';

import RoleButtonWrapper from '../ProtectedRoutes/RoleButton';

type Employee = Database['public']['Tables']['employees']['Row'];

interface AreaTownMapping {
  [area: string]: string[];
}



const EmployeeList: React.FC<TownProps> = ({ selectedTown, onTownChange }) => {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Area/Town mapping state
  const [areaTownMapping, setAreaTownMapping] = useState<AreaTownMapping>({});

  const [isArea, setIsArea] = useState<boolean>(false);
  const [townsInArea, setTownsInArea] = useState<string[]>([]);
  const [currentTown, setCurrentTown] = useState<string>(selectedTown || '');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const employeesPerPage = 6;

  // Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [selectedEmploymentType, setSelectedEmploymentType] = useState('all');
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  // Bulk Edit State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);

  // Load area-town mapping and set current town
  useEffect(() => {
    const loadMappings = async () => {
      try {
        // Fetch the area-town mapping from the database
        const { data: employeesData, error: employeesError } = await supabase
          .from('employees')
          .select('Branch, Town');

        if (employeesError) {
          console.error("Error loading area-town mapping:", employeesError);
          return;
        }

        // Convert the data to a mapping object
        const mapping: AreaTownMapping = {};
        employeesData?.forEach(item => {
          if (item.Branch && item.Town) {
            if (!mapping[item.Branch]) {
              mapping[item.Branch] = [];
            }
            if (!mapping[item.Branch].includes(item.Town)) {
              mapping[item.Branch].push(item.Town);
            }
          }
        });

        setAreaTownMapping(mapping);

        // Set current town from props or localStorage
        const savedTown = localStorage.getItem('selectedTown');
        if (savedTown && (!selectedTown || selectedTown === 'ADMIN_ALL')) {
          setCurrentTown(savedTown);
          if (onTownChange) {
            onTownChange(savedTown);
          }
        } else if (selectedTown) {
          setCurrentTown(selectedTown);
          localStorage.setItem('selectedTown', selectedTown);
        }
      } catch (error) {
        console.error("Error in loadMappings:", error);
      }
    };

    loadMappings();
  }, [selectedTown, onTownChange]);

  // Check if current selection is an area and get its towns
  useEffect(() => {
    if (currentTown && areaTownMapping[currentTown]) {
      setIsArea(true);
      setTownsInArea(areaTownMapping[currentTown]);
    } else {
      setIsArea(false);
      setTownsInArea([]);
    }
  }, [currentTown, areaTownMapping]);

  // Fetch employees from Supabase
  const fetchEmployees = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('employees')
        .select('*')
        .order('Employee Number', { ascending: false });

      // Apply town/area filtering
      if (currentTown && currentTown !== 'ADMIN_ALL') {
        if (isArea && townsInArea.length > 0) {
          // Filter by all towns in the area
          query = query.in('Town', townsInArea);
        } else {
          // Filter by specific town
          query = query.eq('Town', currentTown);
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      setEmployees(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch employees');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, [currentTown, isArea, townsInArea]);

  // Filter employees
  const filteredEmployees = employees.filter(employee => {
    // Apply town/area filter
    if (currentTown && currentTown !== 'ADMIN_ALL') {
      if (isArea) {
        // Check if employee's town is in the area's towns list
        if (!townsInArea.includes(employee.Town || '')) {
          return false;
        }
      } else {
        // Check if employee's town matches the selected town
        if (employee.Town !== currentTown) {
          return false;
        }
      }
    }

    // Apply other filters
    const fullName = `${employee['First Name']} ${employee['Middle Name']} ${employee['Last Name']}`.toLowerCase();
    const searchLower = searchTerm.toLowerCase();

    // Search Fields: Name, ID, Email, Phone
    const matchesSearch = fullName.includes(searchLower) ||
      (employee['Employee Number'] && String(employee['Employee Number']).toLowerCase().includes(searchLower)) ||
      (employee['Work Email'] && String(employee['Work Email']).toLowerCase().includes(searchLower)) ||
      (employee['Mobile Number'] && String(employee['Mobile Number']).toLowerCase().includes(searchLower));
    const matchesDepartment = selectedDepartment === 'all' || employee['Employee Type'] === selectedDepartment;
    const matchesBranch = selectedBranch === 'all' || employee.Branch === selectedBranch;
    const matchesEmploymentType = selectedEmploymentType === 'all' || employee.Town === selectedEmploymentType;

    return matchesSearch && matchesDepartment && matchesBranch && matchesEmploymentType;
  });

  // Get display name for current selection
  const getDisplayName = () => {
    if (!currentTown) return "All Towns";
    if (currentTown === 'ADMIN_ALL') return "All Towns";

    if (isArea) {
      return `${currentTown} Region`;
    }

    return currentTown;
  };

  // Pagination logic
  const indexOfLastEmployee = currentPage * employeesPerPage;
  const indexOfFirstEmployee = indexOfLastEmployee - employeesPerPage;
  // const currentEmployees = filteredEmployees.slice(indexOfFirstEmployee, indexOfLastEmployee);
  // NOTE: For Bulk Edit, it's confusing if we select across pages or not. 
  // For now, let's keep pagination but allow global selection if possible... 
  // Actually, let's stick to simple page-based finding but accumulate selectedIds globally.
  const currentEmployees = filteredEmployees.slice(indexOfFirstEmployee, indexOfLastEmployee);

  const totalPages = Math.ceil(filteredEmployees.length / employeesPerPage);

  // Get unique departments and branches for filters
  const departments = ['all', ...new Set(employees.map(e => e['Employee Type']).filter(Boolean) as string[])];
  const branches = ['all', ...new Set(employees.map(e => e.Branch).filter(Boolean) as string[])];
  const townOptions = ['all', ...new Set(employees.map(e => e.Town).filter(Boolean) as string[])];
  const employmentTypes = townOptions; // Previous code aliased Town as employmentTypes prop?

  // Helper functions
  const getInitials = (firstName: string | null, middleName: string | null, lastName: string | null) => {
    return [firstName?.[0], middleName?.[0], lastName?.[0]].filter(Boolean).join('').toUpperCase();
  };

  const toggleEmployeeSelection = (empId: string) => {
    setSelectedIds(prev => {
      if (prev.includes(empId)) {
        return prev.filter(id => id !== empId);
      } else {
        return [...prev, empId];
      }
    });
  };

  const handleSelectAllOnPage = () => {
    const pageIds = currentEmployees.map(e => e['Employee Number']);
    const allSelected = pageIds.every(id => selectedIds.includes(id));

    if (allSelected) {
      // Deselect all on this page
      setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)));
    } else {
      // Select all on this page
      const newIds = [...selectedIds];
      pageIds.forEach(id => {
        if (!newIds.includes(id)) newIds.push(id);
      });
      setSelectedIds(newIds);
    }
  };


  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-6 max-w-6xl mx-auto flex justify-center items-center min-h-[60vh] text-xs"
      >
        <div className="text-center">
          <div className="animate-pulse flex flex-col items-center">
            <div className="w-16 h-16 bg-gradient-to-r from-green-50 to-green-200 rounded-full mb-6"></div>
            <div className="h-5 bg-gradient-to-r from-gray-100 to-gray-200 rounded-full w-64 mb-4"></div>
            <div className="h-4 bg-gradient-to-r from-gray-100 to-gray-200 rounded-full w-48"></div>
          </div>
        </div>
      </motion.div>
    );
  }

  if (error) return <div className="p-6 text-center text-red-500">Error: {error}</div>;

  return (
    <div className="p-6 space-y-6">


      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Employee Management</h1>
          <p className="text-gray-600 mt-1">
            Managing employees for <span className="font-semibold text-green-600">{getDisplayName()}</span>
          </p>
        </div>
        <div className='flex space-x-3'>
          <RoleButtonWrapper allowedRoles={['ADMIN', 'HR', 'MANAGER', 'REGIONAL']}>
            <GlowButton
              icon={Plus}
              onClick={() => navigate('/add-employee')}
            >
              Add Employee
            </GlowButton>
          </RoleButtonWrapper>


        </div>
      </div>

      {/* Filters */}
      <div className="bg-white/80 text-xs backdrop-blur-sm border border-gray-200 rounded-lg p-3 relative z-20">
        <div className="grid grid-cols-1 md:grid-cols-5 lg:grid-cols-7 gap-2 items-center">
          {/* Search Input */}
          <div className="relative md:col-span-2 lg:col-span-2">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
            <input
              type="text"
              placeholder="Search by name, ID, email, or phone..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-8 pr-3 py-1.5 text-[11px] border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          {/* Department Dropdown */}
          <SearchableDropdown
            options={departments}
            value={selectedDepartment}
            onChange={(value) => {
              setSelectedDepartment(value);
              setCurrentPage(1);
            }}
            placeholder="All Departments"
            icon={Briefcase}
          />

          {/* Branch Dropdown */}
          <SearchableDropdown
            options={branches}
            value={selectedBranch}
            onChange={(value) => {
              setSelectedBranch(value);
              setCurrentPage(1);
            }}
            placeholder="All Branches"
            icon={MapPin}
          />

          {/* Employment Type Dropdown */}
          <SearchableDropdown
            options={employmentTypes}
            value={selectedEmploymentType}
            onChange={(value) => {
              setSelectedEmploymentType(value);
              setCurrentPage(1);
            }}
            placeholder="Town Office"
            icon={Building2}
          />

          {/* Buttons */}
          <div className="flex space-x-2 h-[32px] md:col-span-5 lg:col-span-2">
            <div className="flex space-x-1.5 h-full w-full justify-end">
              {isSelectionMode ? (
                <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                  <GlowButton
                    variant="secondary"
                    size="sm"
                    className="h-full !text-[11px] bg-red-50 text-red-600 border-red-100 hover:bg-red-100"
                    onClick={() => {
                      setIsSelectionMode(false);
                      setSelectedIds([]);
                    }}
                    icon={X}
                  >
                    Cancel
                  </GlowButton>
                  <GlowButton
                    variant="primary"
                    size="sm"
                    className="h-full !text-[11px]"
                    disabled={selectedIds.length === 0}
                    onClick={() => setShowBulkEditModal(true)}
                    icon={Save}
                  >
                    Update ({selectedIds.length})
                  </GlowButton>
                  <button
                    className="text-[10px] text-gray-500 hover:text-emerald-600 underline ml-1"
                    onClick={handleSelectAllOnPage}
                  >
                    Toggle Page
                  </button>
                </RoleButtonWrapper>
              ) : (
                <>
                  <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                    <GlowButton
                      variant="secondary"
                      icon={Copy}
                      size="sm"
                      className="h-full !text-[11px]"
                      onClick={() => setShowDuplicateModal(true)}
                    >
                      Duplicates
                    </GlowButton>
                  </RoleButtonWrapper>

                  <RoleButtonWrapper allowedRoles={['ADMIN']}>
                    <GlowButton
                      variant="primary"
                      icon={Edit3Icon}
                      size="sm"
                      className="h-full !text-[11px]"
                      onClick={() => navigate('/fogs')}
                    >
                      Bulk Edit
                    </GlowButton>
                  </RoleButtonWrapper>

                  <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                    <GlowButton
                      variant="secondary"
                      icon={Building2}
                      size="sm"
                      className="h-full !text-[11px]"
                      onClick={() => setIsSelectionMode(true)}
                    >
                      Relocate
                    </GlowButton>
                  </RoleButtonWrapper>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Employee Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {currentEmployees.map((employee, index) => {
          const isSelected = selectedIds.includes(employee["Employee Number"]);
          return (
            <motion.div
              key={employee["Employee Number"]}
              onClick={() => {
                if (isSelectionMode) toggleEmployeeSelection(employee["Employee Number"]);
              }}
              className={`group flex flex-col bg-white rounded-2xl border shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-300 overflow-hidden relative cursor-pointer
                ${isSelected
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-lg'
                  : 'border-gray-200/60 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:border-green-500/20'}
            `}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ y: isSelectionMode ? 0 : -4 }}
            >
              {/* CHECKBOX OVERLAY */}
              {isSelectionMode && (
                <div className="absolute top-3 right-3 z-20">
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors
                        ${isSelected ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-gray-300 group-hover:border-emerald-400'}
                     `}>
                    {isSelected && <CheckSquare size={14} className="text-white" />}
                  </div>
                </div>
              )}

              {/* Header Section */}
              <div className="relative h-14 px-4 flex items-center bg-gradient-to-r from-green-200/70 to-white">
                <div className="flex items-center space-x-3 w-full">
                  {/* Avatar */}
                  <div className="relative">
                    <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-emerald-700 rounded-full flex items-center justify-center text-white font-bold text-sm border border-green-500/30 shadow-sm transition-colors duration-300">
                      {getInitials(employee['First Name'], employee['Middle Name'], employee['Last Name'])}
                    </div>
                    <div className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${employee['Termination Date'] ? 'bg-red-500' : 'bg-emerald-500'}`} />
                  </div>

                  {/* Name & ID */}
                  <div className="space-y-0.5 min-w-0">
                    <h3 className="text-gray-900 font-bold text-[13px] leading-tight group-hover:text-green-700 transition-colors truncate">
                      {employee['First Name']} {employee['Last Name']}
                    </h3>
                    <div className="flex items-center space-x-1.5">
                      <span className="px-1.5 py-0.5 rounded-md bg-white/70 text-gray-500 text-[9px] font-medium tracking-wide border border-gray-200/50">
                        {employee['Employee Number']}
                      </span>
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${employee['Termination Date']
                        ? 'bg-red-50 text-red-600 border border-red-100'
                        : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                        }`}>
                        {employee['Termination Date'] ? 'Inactive' : 'Active'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Slick Line Separator */}
              <div className="h-px w-full bg-gray-300" />

              {/* Body Content */}
              <div className="px-5 py-5 space-y-4 flex-grow bg-white">
                {/* Role & Location */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Position</p>
                    <div className="flex items-center text-xs font-medium text-gray-700 truncate" title={employee['Job Title'] || ''}>
                      <Briefcase className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
                      <span className="truncate">{employee['Job Title'] || 'N/A'}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Location</p>
                    <div className="flex items-center text-xs font-medium text-gray-700 truncate">
                      <MapPin className="w-3.5 h-3.5 mr-1.5 text-black" />
                      <span className="truncate font-bold text-black">{employee.Branch} / {employee.Town}</span>
                    </div>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center p-2 rounded-lg bg-gray-50/50 border border-gray-100 group-hover:border-green-100 group-hover:bg-green-50/10 transition-colors">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white flex items-center justify-center text-gray-400 shadow-sm border border-gray-100 group-hover:text-green-600 transition-colors">
                      <Mail size={14} />
                    </div>
                    <div className="ml-3 min-w-0">
                      <p className="text-[10px] text-gray-400 font-medium">Email Address</p>
                      <p className="text-xs font-medium text-gray-700 truncate">{employee['Work Email']}</p>
                    </div>
                  </div>

                  <div className="flex items-center p-2 rounded-lg bg-gray-50/50 border border-gray-100 group-hover:border-green-100 group-hover:bg-green-50/10 transition-colors">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white flex items-center justify-center text-gray-400 shadow-sm border border-gray-100 group-hover:text-green-600 transition-colors">
                      <Phone size={14} />
                    </div>
                    <div className="ml-3 min-w-0">
                      <p className="text-[10px] text-gray-400 font-medium">Phone Number</p>
                      <p className="text-xs font-medium text-gray-700">{employee['Mobile Number']}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Separator */}
              <div className="h-px w-full bg-gray-200" />

              {/* Footer Actions - DISABLED IN SELECTION MODE */}
              <div className={`h-14 px-4 flex items-center bg-white border-t-0 mt-auto transition-opacity ${isSelectionMode ? 'opacity-40 pointer-events-none' : ''}`}>
                <div className="flex items-center gap-2 w-full">
                  <RoleButtonWrapper allowedRoles={['ADMIN', 'HR', 'MANAGER', 'REGIONAL']}>
                    <GlowButton
                      variant="secondary"
                      size="sm"
                      className="flex-1 bg-white border-gray-200 text-gray-600 hover:text-green-700 hover:border-green-200 hover:bg-green-50/30 shadow-sm !h-7 !text-[11px] !py-0"
                      icon={Settings}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/edit-employee/${employee['Employee Number']}`)
                      }}
                    >
                      Manage
                    </GlowButton>
                  </RoleButtonWrapper>

                  <RoleButtonWrapper allowedRoles={['ADMIN', 'HR', 'MANAGER', 'REGIONAL']}>
                    <GlowButton
                      variant="secondary"
                      size="sm"
                      className="flex-1 bg-white border-gray-200 text-gray-600 hover:text-emerald-700 hover:border-emerald-200 hover:bg-emerald-50/30 shadow-sm !h-7 !text-[11px] !py-0"
                      icon={UserRoundCog}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/view-employee/${employee['Employee Number']}`)
                      }}
                    >
                      Terminate
                    </GlowButton>
                  </RoleButtonWrapper>
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Pagination */}
      {
        filteredEmployees.length > 0 && (
          <div className="mt-6 flex flex-col text-xs sm:flex-row justify-between items-center gap-4">
            <div className="text-xs text-gray-600">
              Showing {indexOfFirstEmployee + 1} to {Math.min(indexOfLastEmployee, filteredEmployees.length)} of {filteredEmployees.length} employees
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 text-xs py-1 border rounded disabled:opacity-50 hover:bg-gray-50 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>

              {/* Always show first page */}
              <button
                onClick={() => setCurrentPage(1)}
                className={`px-3 py-1 border rounded hover:bg-gray-50 transition-colors ${currentPage === 1 ? 'bg-green-100 border-green-500 text-green-800' : ''
                  }`}
              >
                1
              </button>

              {/* Show ellipsis if needed */}
              {currentPage > 3 && (
                <span className="px-3 py-1">...</span>
              )}

              {/* Show current page and neighbors */}
              {Array.from({ length: Math.min(5, totalPages - 2) }, (_, i) => {
                const page = Math.max(2, Math.min(currentPage - 2, totalPages - 4)) + i;
                if (page > 1 && page < totalPages) {
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-1 border rounded hover:bg-gray-50 transition-colors ${currentPage === page ? 'bg-green-100 border-green-500 text-green-800' : ''
                        }`}
                    >
                      {page}
                    </button>
                  );
                }
                return null;
              })}

              {/* Show ellipsis if needed */}
              {currentPage < totalPages - 2 && (
                <span className="px-3 py-1">...</span>
              )}

              {/* Always show last page if there's more than one page */}
              {totalPages > 1 && (
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  className={`px-3 py-1 border rounded hover:bg-gray-50 transition-colors ${currentPage === totalPages ? 'bg-green-100 border-green-500 text-green-800' : ''
                    }`}
                >
                  {totalPages}
                </button>
              )}

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-gray-50 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )
      }

      {/* Empty state */}
      {
        filteredEmployees.length === 0 && (
          <div className="mt-12 text-center">
            <div className="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <Search className="text-gray-400" size={32} />
            </div>
            <h3 className="text-lg font-medium text-gray-700">No employees found</h3>
            <p className="text-gray-500">Try adjusting your search or filters</p>
          </div>
        )
      }

      {/* Duplicate Check Modal */}
      <DuplicateCheckModal
        isOpen={showDuplicateModal}
        onClose={() => setShowDuplicateModal(false)}
        employees={employees}
        onRefresh={fetchEmployees}
      />

      {/* NEW: Bulk Edit Modal */}
      <BulkEditModal
        isOpen={showBulkEditModal}
        onClose={() => setShowBulkEditModal(false)}
        selectedIds={selectedIds}
        availableBranches={branches}
        availableTowns={townOptions}
        onSuccess={() => {
          fetchEmployees();
          setSelectedIds([]);
          setIsSelectionMode(false);
        }}
      />
    </div>
  );
};

export default EmployeeList;