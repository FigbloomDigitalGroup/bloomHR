
import { useState, useEffect } from 'react';
import {
  Search, Plus, Mail, Phone,
  ChevronLeft, ChevronRight, ChevronDown,
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
import BulkTerminateModal from './BulkTerminateModal';
import { TownProps } from '../../types/supabase';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { PageHeader, Card, Button, StatusPill, EmptyState, SearchInput } from '../UI';
import { profileItems, profileScore } from '../../lib/profileCompleteness';
import { useNavigate, useSearchParams } from 'react-router-dom';

import RoleButtonWrapper from '../ProtectedRoutes/RoleButton';

type Employee = Database['public']['Tables']['employees']['Row'];

interface AreaTownMapping {
  [area: string]: string[];
}



const INCOMPLETE = 'Incomplete profiles';
const COMPLETE = 'Complete profiles';

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
  const [searchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [selectedEmploymentType, setSelectedEmploymentType] = useState('all');
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  // how complete each person's own information is (they fill most of it in themselves)
  const [selectedProfile, setSelectedProfile] = useState('all');
  const [emergencyContacts, setEmergencyContacts] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('emergency_contact')
      .select('"Employee Number"')
      .then(({ data, error }) => {
        if (cancelled || error || !data) return; // unknown: the emergency contact is then left out of the score
        setEmergencyContacts(new Set(data.map((r: Record<string, unknown>) => String(r['Employee Number']))));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scoreOf = (employee: Employee) =>
    profileScore(profileItems(employee as unknown as Record<string, unknown>, emergencyContacts ? emergencyContacts.has(String(employee['Employee Number'])) : null));

  // Bulk Edit State
  const [selectionAction, setSelectionAction] = useState<'relocate' | 'terminate' | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [showBulkTerminateModal, setShowBulkTerminateModal] = useState(false);

  // Single-employee terminate confirmation (hands off to HR Lifecycle)
  const [terminateTarget, setTerminateTarget] = useState<Employee | null>(null);

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
    const matchesProfile =
      selectedProfile === 'all' || (selectedProfile === INCOMPLETE ? !scoreOf(employee).complete : scoreOf(employee).complete);

    return matchesSearch && matchesDepartment && matchesBranch && matchesEmploymentType && matchesProfile;
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
      <div className="p-6 flex justify-center items-center min-h-[60vh] text-xs">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-14 h-14 bg-green-tint rounded-full mb-5" />
          <div className="h-4 bg-secondary rounded-full w-64 mb-3" />
          <div className="h-3 bg-secondary rounded-full w-48" />
        </div>
      </div>
    );
  }

  if (error) return <div className="p-6 text-center text-status-danger">Error: {error}</div>;

  const pillSelect =
    'appearance-none rounded-tile border border-border bg-white pl-3 pr-7 py-2 text-xs font-semibold text-ink outline-none focus:border-brand cursor-pointer';

  const renderPillSelect = (
    options: string[],
    value: string,
    onChange: (v: string) => void,
    allLabel: string,
    ariaLabel: string
  ) => (
    <label className="relative inline-block">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCurrentPage(1);
        }}
        className={pillSelect}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === 'all' ? allLabel : o}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-subtle" strokeWidth={2} />
    </label>
  );

  return (
    <div>
      <PageHeader
        title="Employee Management"
        subtitle={
          <>
            Managing employees for <span className="font-semibold text-brand">{getDisplayName()}</span>
          </>
        }
        actions={
          <RoleButtonWrapper allowedRoles={['ADMIN', 'HR', 'MANAGER', 'REGIONAL']}>
            <Button onClick={() => navigate('/add-employee')} icon={<Plus className="w-3.5 h-3.5" strokeWidth={2.2} />}>
              Add Employee
            </Button>
          </RoleButtonWrapper>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-[18px] relative z-20">
        <div className="flex-1 min-w-[200px]">
          <SearchInput
            placeholder="Search by name, ID, email, or phone..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="!bg-white !border-border"
          />
        </div>

        {renderPillSelect(departments, selectedDepartment, setSelectedDepartment, 'All Departments', 'Filter by department')}
        {renderPillSelect(branches, selectedBranch, setSelectedBranch, 'All Branches', 'Filter by branch')}
        {renderPillSelect(employmentTypes, selectedEmploymentType, setSelectedEmploymentType, 'Town Office', 'Filter by town office')}
        {renderPillSelect(['all', INCOMPLETE, COMPLETE], selectedProfile, setSelectedProfile, 'All profiles', 'Filter by profile completeness')}

        {selectionAction ? (
          <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
            <Button
              variant="secondary"
              onClick={() => {
                setSelectionAction(null);
                setSelectedIds([]);
              }}
              icon={<X className="w-3.5 h-3.5" />}
            >
              Cancel
            </Button>
            <Button variant="ghost" onClick={handleSelectAllOnPage}>
              Toggle Page
            </Button>
            <Button
              disabled={selectedIds.length === 0}
              onClick={() => {
                if (selectionAction === 'relocate') setShowBulkEditModal(true);
                if (selectionAction === 'terminate') setShowBulkTerminateModal(true);
              }}
              icon={<Save className="w-3.5 h-3.5" />}
            >
              Update ({selectedIds.length})
            </Button>
          </RoleButtonWrapper>
        ) : (
          <>
            <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
              <Button variant="secondary" onClick={() => setShowDuplicateModal(true)} icon={<Copy className="w-3.5 h-3.5" />}>
                Duplicates
              </Button>
            </RoleButtonWrapper>
            <RoleButtonWrapper allowedRoles={['ADMIN']}>
              <Button variant="secondary" onClick={() => navigate('/fogs')} icon={<Edit3Icon className="w-3.5 h-3.5" />}>
                Bulk Edit
              </Button>
            </RoleButtonWrapper>
            <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
              <Button variant="secondary" onClick={() => setSelectionAction('relocate')} icon={<Building2 className="w-3.5 h-3.5" />}>
                Relocate
              </Button>
            </RoleButtonWrapper>
            <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
              <Button
                variant="secondary"
                className="!text-status-danger"
                onClick={() => setSelectionAction('terminate')}
                icon={<UserRoundCog className="w-3.5 h-3.5" />}
              >
                Bulk Terminate
              </Button>
            </RoleButtonWrapper>
          </>
        )}
      </div>

      {/* Employee Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {currentEmployees.map((employee) => {
          const empNo = employee['Employee Number'];
          const isSelected = selectedIds.includes(empNo);
          const isInactive = !!employee['Termination Date'];
          const fullName = [employee['First Name'], employee['Last Name']].filter(Boolean).join(' ');
          return (
            <Card
              key={empNo}
              onClick={() => {
                if (selectionAction) toggleEmployeeSelection(empNo);
              }}
              className={`relative transition-colors ${selectionAction ? 'cursor-pointer' : ''} ${
                isSelected ? '!border-brand ring-2 ring-brand/20' : ''
              }`}
            >
              {selectionAction && (
                <div
                  className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    isSelected ? 'bg-brand border-brand' : 'bg-white border-border'
                  }`}
                >
                  {isSelected && <CheckSquare size={12} className="text-white" />}
                </div>
              )}

              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-[38px] h-[38px] shrink-0 rounded-full bg-brand text-white flex items-center justify-center text-[12.5px] font-bold">
                    {getInitials(employee['First Name'], null, employee['Last Name'])}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-ink truncate">{fullName}</div>
                    <div className="text-[10.5px] text-subtle">{empNo}</div>
                  </div>
                </div>
                {!selectionAction && (
                  <StatusPill label={isInactive ? 'Inactive' : 'Active'} tone={isInactive ? 'warning' : 'success'} />
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground mb-2.5">
                <div className="min-w-0">
                  <div className="text-[9.5px] font-bold uppercase text-subtle">Position</div>
                  <div className="truncate" title={employee['Job Title'] || ''}>{employee['Job Title'] || 'N/A'}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[9.5px] font-bold uppercase text-subtle">Location</div>
                  <div className="truncate">{[employee.Branch, employee.Town].filter(Boolean).join(' / ') || 'N/A'}</div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-[9px] py-[7px] bg-background rounded-lg mb-1.5">
                <Mail className="w-3 h-3 shrink-0" strokeWidth={2} />
                <span className="truncate">{employee['Work Email'] || '—'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-[9px] py-[7px] bg-background rounded-lg mb-3">
                <Phone className="w-3 h-3 shrink-0" strokeWidth={2} />
                <span className="truncate">{employee['Mobile Number'] || '—'}</span>
              </div>

              {(() => {
                const score = scoreOf(employee);
                return (
                  <div className="mb-3" title={score.complete ? 'Profile complete' : `Still to add: ${score.missing.map((m) => m.label).join(', ')}`}>
                    <div className="flex items-center justify-between text-[10px] font-semibold text-subtle mb-1">
                      <span>Profile</span>
                      <span className={score.complete ? 'text-status-success' : ''}>{score.percent}% complete</span>
                    </div>
                    <div className="h-1 rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full rounded-full ${score.complete ? 'bg-status-success' : 'bg-brand'}`} style={{ width: `${score.percent}%` }} />
                    </div>
                  </div>
                );
              })()}

              <div className={`flex gap-2 ${selectionAction ? 'opacity-40 pointer-events-none' : ''}`}>
                <RoleButtonWrapper allowedRoles={['ADMIN', 'HR', 'MANAGER', 'REGIONAL']}>
                  <button
                    type="button"
                    className="flex-1 text-center py-[7px] rounded-lg border border-border bg-white text-[11px] font-semibold text-ink hover:bg-secondary transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/edit-employee/${empNo}`);
                    }}
                  >
                    Manage
                  </button>
                </RoleButtonWrapper>
                <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                  <button
                    type="button"
                    disabled={isInactive}
                    className="flex-1 text-center py-[7px] rounded-lg border border-[#F6DCC7] bg-white text-[11px] font-semibold text-status-danger hover:bg-orange-tint transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTerminateTarget(employee);
                    }}
                  >
                    Terminate
                  </button>
                </RoleButtonWrapper>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {filteredEmployees.length > 0 && (
        <div className="mt-6 flex flex-col text-xs sm:flex-row justify-between items-center gap-4">
          <div className="text-xs text-muted-foreground">
            Showing {indexOfFirstEmployee + 1} to {Math.min(indexOfLastEmployee, filteredEmployees.length)} of {filteredEmployees.length} employees
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              aria-label="Previous page"
              className="px-3 py-1 border border-border bg-white rounded-lg disabled:opacity-50 hover:bg-secondary transition-colors"
            >
              <ChevronLeft size={16} />
            </button>

            <button
              onClick={() => setCurrentPage(1)}
              className={`px-3 py-1 border rounded-lg transition-colors ${currentPage === 1 ? 'bg-green-tint border-brand text-brand font-semibold' : 'bg-white border-border hover:bg-secondary'}`}
            >
              1
            </button>

            {currentPage > 3 && <span className="px-3 py-1">...</span>}

            {Array.from({ length: Math.max(0, Math.min(5, totalPages - 2)) }, (_, i) => {
              const page = Math.max(2, Math.min(currentPage - 2, totalPages - 4)) + i;
              if (page > 1 && page < totalPages) {
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-1 border rounded-lg transition-colors ${currentPage === page ? 'bg-green-tint border-brand text-brand font-semibold' : 'bg-white border-border hover:bg-secondary'}`}
                  >
                    {page}
                  </button>
                );
              }
              return null;
            })}

            {currentPage < totalPages - 2 && <span className="px-3 py-1">...</span>}

            {totalPages > 1 && (
              <button
                onClick={() => setCurrentPage(totalPages)}
                className={`px-3 py-1 border rounded-lg transition-colors ${currentPage === totalPages ? 'bg-green-tint border-brand text-brand font-semibold' : 'bg-white border-border hover:bg-secondary'}`}
              >
                {totalPages}
              </button>
            )}

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              aria-label="Next page"
              className="px-3 py-1 border border-border bg-white rounded-lg disabled:opacity-50 hover:bg-secondary transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {filteredEmployees.length === 0 && (
        <Card className="mt-4">
          <EmptyState
            icon={<Search size={20} />}
            title="No employees found"
            description="Try adjusting your search or filters"
          />
        </Card>
      )}

      {/* Terminate confirmation: hands off to HR Lifecycle, where the termination itself is recorded */}
      {terminateTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terminate-title"
          onClick={() => setTerminateTarget(null)}
        >
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 id="terminate-title" className="m-0 text-[15px] font-bold text-ink">
              Terminate {terminateTarget['First Name']} {terminateTarget['Last Name']}?
            </h2>
            <p className="text-xs text-muted-foreground mt-2 mb-4">
              You will be taken to HR Lifecycle to record the termination date and reason for{' '}
              <span className="font-semibold text-ink">{terminateTarget['Employee Number']}</span>. Nothing changes until you confirm there.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setTerminateTarget(null)}>
                Cancel
              </Button>
              <Button
                className="!bg-status-danger !border-status-danger"
                onClick={() => {
                  const id = terminateTarget['Employee Number'];
                  setTerminateTarget(null);
                  navigate(`/hr-lifecycle?tab=status&q=${encodeURIComponent(id)}`);
                }}
              >
                Continue to HR Lifecycle
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Duplicate Check Modal */}
      <DuplicateCheckModal
        isOpen={showDuplicateModal}
        onClose={() => setShowDuplicateModal(false)}
        employees={employees}
        onRefresh={fetchEmployees}
      />

      <BulkEditModal
        isOpen={showBulkEditModal}
        onClose={() => setShowBulkEditModal(false)}
        selectedIds={selectedIds}
        availableBranches={branches}
        availableTowns={townOptions}
        onSuccess={() => {
          fetchEmployees();
          setSelectedIds([]);
          setSelectionAction(null);
        }}
      />

      <BulkTerminateModal
        isOpen={showBulkTerminateModal}
        onClose={() => setShowBulkTerminateModal(false)}
        selectedIds={selectedIds}
        onSuccess={() => {
          fetchEmployees();
          setSelectedIds([]);
          setSelectionAction(null);
        }}
      />
    </div>
  );
};

export default EmployeeList;
