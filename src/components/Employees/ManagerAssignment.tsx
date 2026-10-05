import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Save, UserCog, ArrowLeft, Filter, Users, MapPin, Building2, Settings, ShieldAlert, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Database } from '../../types/supabase';
import { Card, Button, TabBar, SearchInput, StatusPill, EmptyState } from '../UI';
import SearchableDropdown from '../UI/SearchableDropdown';

type Employee = Database['public']['Tables']['employees']['Row'];

const ManagerAssignment = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'appoint' | 'list'>('appoint');

    // Data state
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedLocation, setSelectedLocation] = useState('All Locations');
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(false);
    const [locations, setLocations] = useState<string[]>([]); // Derived from Town

    // Selection
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

    // Form state
    const [roleType, setRoleType] = useState<'branch' | 'regional' | null>(null);
    const [emailInput, setEmailInput] = useState('');
    const [saving, setSaving] = useState(false);

    // Assigned List State
    const [assignedManagers, setAssignedManagers] = useState<Employee[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('employees')
                .select('*')
                .order('First Name', { ascending: true });

            if (error) throw error;

            const emps = data || [];
            setEmployees(emps);
            setFilteredEmployees(emps);

            // Unique Towns (mapped to "Business Units" or Locations)
            const uniqueTowns = Array.from(new Set(emps.map(e => e.Town).filter(Boolean) as string[])).sort();
            setLocations(['All Locations', ...uniqueTowns]);

        } catch (error) {
            console.error('Error fetching data:', error);
            toast.error('Failed to load employees');
        } finally {
            setLoading(false);
        }
    };

    // Filter Logic
    useEffect(() => {
        let result = employees;
        if (activeTab === 'appoint') {
            // Regular filter
            if (selectedLocation !== 'All Locations') {
                result = result.filter(emp => emp.Town === selectedLocation);
            }
            if (searchTerm.length >= 2) {
                const lowerTerm = searchTerm.toLowerCase();
                result = result.filter(emp =>
                (emp['First Name']?.toLowerCase().includes(lowerTerm) ||
                    emp['Last Name']?.toLowerCase().includes(lowerTerm) ||
                    emp['Employee Number'].toLowerCase().includes(lowerTerm))
                );
            }
            setFilteredEmployees(result);
        } else {
            // Filter for Assigned Managers tab
            const managers = employees.filter(e => e.manager_email || e.regional_manager);
            setAssignedManagers(managers);
            setCurrentPage(1); // Reset to first page when switching tabs or data changes
        }
    }, [searchTerm, selectedLocation, employees, activeTab]);

    // Location Edit State
    const [editTown, setEditTown] = useState(''); // Maps to UI Branch
    const [editRegion, setEditRegion] = useState(''); // Maps to UI Region

    // Form Reset on Selection Change
    useEffect(() => {
        if (selectedEmployeeId) {
            const emp = employees.find(e => e['Employee Number'] === selectedEmployeeId);
            if (emp) {
                setEditTown(emp.Town || '');
                setEditRegion(emp.Branch || '');

                if (emp.manager_email) {
                    setRoleType('branch');
                    setEmailInput(emp.manager_email);
                } else if (emp.regional_manager) {
                    setRoleType('regional');
                    setEmailInput(emp.regional_manager);
                } else {
                    setRoleType(null);
                    setEmailInput('');
                }
            }
        } else {
            setRoleType(null);
            setEmailInput('');
            setEditTown('');
            setEditRegion('');
        }
    }, [selectedEmployeeId]);

    const handleRoleSelect = (type: 'branch' | 'regional') => {
        setRoleType(type);
    };

    const validateAssignment = async (emp: Employee, email: string, targetTown: string, targetRegion: string) => {
        // 1. Unique Email Check (Is this email assigned to anyone else?)
        if (email) {
            const emailConflict = employees.find(e =>
                (e.manager_email === email || e.regional_manager === email) &&
                e['Employee Number'] !== emp['Employee Number']
            );
            if (emailConflict) {
                toast.error(`Email ${email} is already assigned to ${emailConflict['First Name']} ${emailConflict['Last Name']}`);
                return false;
            }
        }

        // 3. One Manager Per Town (Branch Manager) - Check against targetTown
        if (roleType === 'branch' && targetTown) {
            const confirm = employees.find(e =>
                e.Town === targetTown &&
                e.manager_email &&
                e['Employee Number'] !== emp['Employee Number']
            );
            if (confirm) {
                toast.error(`Town '${targetTown}' already has a Manager: ${confirm['First Name']} ${confirm['Last Name']}. Unassign them first.`);
                return false;
            }
        }

        // 4. One Manager Per Region (Regional Manager) - Check against targetRegion
        if (roleType === 'regional' && targetRegion) {
            const confirm = employees.find(e =>
                e.Branch === targetRegion &&
                e.regional_manager &&
                e['Employee Number'] !== emp['Employee Number']
            );
            if (confirm) {
                toast.error(`Region '${targetRegion}' already has a Regional Manager: ${confirm['First Name']} ${confirm['Last Name']}. Unassign them first.`);
                return false;
            }
        }

        return true;
    };

    const handleAppoint = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedEmployeeId) return;

        const emp = employees.find(e => e['Employee Number'] === selectedEmployeeId);
        if (!emp) return;

        // If appointment logic is active
        if (roleType && emailInput) {
            if (!(await validateAssignment(emp, emailInput, editTown, editRegion))) return;
        }

        try {
            setSaving(true);

            const updates: any = {
                Town: editTown.trim(),
                Branch: editRegion.trim() // Maps to Region
            };

            if (roleType && emailInput) {
                updates.manager_email = roleType === 'branch' ? emailInput.trim() : null;
                updates.regional_manager = roleType === 'regional' ? emailInput.trim() : null;
            }

            const { error } = await supabase
                .from('employees')
                .update(updates)
                .eq('Employee Number', selectedEmployeeId);

            if (error) throw error;

            let msg = 'Updated location details';
            if (roleType && emailInput) {
                msg = `Appointed ${emp['First Name']} as ${roleType === 'branch' ? 'Branch' : 'Regional'} Manager & updated location`;
            }
            toast.success(msg);

            await fetchData();
            // Don't clear selection so they can keep editing if needed? Or clear? 
            // Better clear to show list update
            setSelectedEmployeeId(null);

        } catch (error) {
            console.error('Error updating:', error);
            toast.error('Failed to update employee');
        } finally {
            setSaving(false);
        }
    };

    // ... (render logic)

    const handleUnassign = async (empId: string) => {
        if (!window.confirm('Are you sure you want to remove this manager appointment?')) return;

        try {
            const { error } = await supabase
                .from('employees')
                .update({ manager_email: null, regional_manager: null })
                .eq('Employee Number', empId);

            if (error) throw error;
            toast.success('Manager unassigned successfully');
            fetchData();
        } catch (error) {
            console.error('Error unassigning:', error);
            toast.error('Failed to unassign');
        }
    };

    const inputClass =
        'w-full px-3 py-2 text-xs border border-border rounded-tile bg-white text-ink outline-none focus:border-brand transition-colors';

    return (
        <div>
            {/* Header */}
            <Card className="flex items-center justify-between mb-[18px]">
                <div className="flex items-center gap-3">
                    <div className="w-[42px] h-[42px] rounded-xl bg-green-tint text-brand flex items-center justify-center">
                        <UserCog className="w-[19px] h-[19px]" strokeWidth={1.8} />
                    </div>
                    <div>
                        <h1 className="m-0 text-[15px] font-bold text-ink">Manager Appointment Portal</h1>
                        <div className="text-xs text-muted-foreground">Appoint Branch and Regional Managers for specific locations</div>
                    </div>
                </div>
                <Button variant="secondary" onClick={() => navigate(-1)} icon={<ArrowLeft className="w-3 h-3" strokeWidth={2} />}>
                    Back to Dashboard
                </Button>
            </Card>

            <TabBar
                items={[
                    { id: 'appoint', label: 'Appoint Manager' },
                    { id: 'list', label: 'Assigned Managers List' },
                ]}
                activeId={activeTab}
                onChange={(id) => setActiveTab(id as 'appoint' | 'list')}
                className="border-b border-border mb-3.5"
            />

            {/* APPOINT TAB */}
            {activeTab === 'appoint' && (
                <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4 items-start">
                    {/* Left: search & select */}
                    <Card padding="sm" className="!p-4 flex flex-col h-[700px]">
                        <div className="flex flex-col sm:flex-row gap-2 mb-3">
                            <div className="flex-1">
                                <SearchInput
                                    placeholder="Search Employee..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="!bg-white !border-border"
                                />
                            </div>
                            <div className="min-w-[200px]">
                                <SearchableDropdown
                                    options={locations}
                                    value={selectedLocation}
                                    onChange={setSelectedLocation}
                                    placeholder="Select Location"
                                    icon={Filter}
                                />
                            </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground mb-2.5">
                            Showing {filteredEmployees.length} employees
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {loading ? (
                                <div className="flex justify-center p-8">
                                    <div className="animate-spin w-6 h-6 border-2 border-brand border-t-transparent rounded-full" />
                                </div>
                            ) : (
                                filteredEmployees.map(emp => {
                                    const isSelected = selectedEmployeeId === emp['Employee Number'];
                                    const isManager = emp.manager_email || emp.regional_manager;
                                    return (
                                        <button
                                            type="button"
                                            key={emp['Employee Number']}
                                            onClick={() => setSelectedEmployeeId(emp['Employee Number'])}
                                            aria-pressed={isSelected}
                                            className={`w-full flex items-center gap-2.5 px-1.5 py-[9px] border-b border-[#F1F5F2] text-left transition-colors ${
                                                isSelected ? 'bg-green-tint' : 'hover:bg-background'
                                            }`}
                                        >
                                            <div className="w-[30px] h-[30px] shrink-0 rounded-full bg-brand text-white flex items-center justify-center text-[10.5px] font-bold">
                                                {emp['First Name']?.[0]}{emp['Last Name']?.[0]}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-bold text-ink truncate">{emp['First Name']} {emp['Last Name']}</div>
                                                <div className="text-[10.5px] text-subtle truncate">
                                                    {emp.Town || 'No Town'}{emp.Branch ? ` · ${emp.Branch}` : ''}
                                                </div>
                                            </div>
                                            {isManager && (
                                                <StatusPill
                                                    label={emp.manager_email ? 'Branch Mgr' : 'Regional Mgr'}
                                                    tone={emp.manager_email ? 'info' : 'purple'}
                                                />
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </Card>

                    {/* Right: appointment panel */}
                    <Card className="lg:sticky lg:top-6">
                        {selectedEmployeeId ? (
                            <form onSubmit={handleAppoint} className="space-y-5">
                                <div className="flex items-center gap-2">
                                    <Settings size={16} className="text-brand" />
                                    <h2 className="m-0 text-[13px] font-bold text-ink">Role Appointment</h2>
                                </div>

                                {/* Location details */}
                                <div className="bg-background p-3.5 rounded-xl space-y-3">
                                    <h3 className="m-0 text-[10px] font-bold uppercase text-subtle flex items-center gap-1.5">
                                        <MapPin size={12} /> Location Details
                                    </h3>
                                    <div>
                                        <label htmlFor="mgr-home-branch" className="block text-[11px] font-semibold text-ink mb-1">User Home Branch</label>
                                        <input
                                            id="mgr-home-branch"
                                            value={editTown}
                                            onChange={e => setEditTown(e.target.value)}
                                            className={inputClass}
                                            placeholder="Edit Branch Name (Town)"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="mgr-home-region" className="block text-[11px] font-semibold text-ink mb-1">User Home Region</label>
                                        <input
                                            id="mgr-home-region"
                                            value={editRegion}
                                            onChange={e => setEditRegion(e.target.value)}
                                            className={inputClass}
                                            placeholder="Edit Region Name"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <h3 className="m-0 text-xs font-semibold text-ink mb-2.5">Select Role Type (Optional)</h3>
                                    <div className="grid grid-cols-2 gap-2.5">
                                        <button
                                            type="button"
                                            onClick={() => handleRoleSelect('branch')}
                                            aria-pressed={roleType === 'branch'}
                                            className={`p-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                                                roleType === 'branch'
                                                    ? 'bg-green-tint border-brand text-brand-dark'
                                                    : 'bg-white border-border text-muted-foreground hover:bg-secondary'
                                            }`}
                                        >
                                            Branch Manager
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleRoleSelect('regional')}
                                            aria-pressed={roleType === 'regional'}
                                            className={`p-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                                                roleType === 'regional'
                                                    ? 'bg-status-purple-tint border-status-purple text-status-purple'
                                                    : 'bg-white border-border text-muted-foreground hover:bg-secondary'
                                            }`}
                                        >
                                            Regional Manager
                                        </button>
                                    </div>
                                </div>

                                {roleType ? (
                                    <div className="space-y-3.5">
                                        <div>
                                            <label htmlFor="mgr-email" className="block text-[11px] font-semibold text-ink mb-1">
                                                {roleType === 'branch' ? 'Branch Manager Email' : 'Regional Manager Email'}
                                            </label>
                                            <input
                                                id="mgr-email"
                                                type="email"
                                                required
                                                value={emailInput}
                                                onChange={(e) => setEmailInput(e.target.value)}
                                                className={inputClass}
                                                placeholder="e.g. name@company.com"
                                            />
                                            <p className="m-0 text-[10px] text-subtle mt-1">Must be a unique email address.</p>
                                        </div>

                                        <div className="bg-orange-tint border border-[#F6DCC7] p-3 rounded-lg flex gap-2">
                                            <ShieldAlert size={14} className="text-orange-text-alt flex-shrink-0 mt-0.5" />
                                            <p className="m-0 text-xs text-orange-text">
                                                <strong>Rule:</strong> Only one {roleType === 'branch' ? 'manager per Town' : 'regional manager per Region'}.
                                                Assigning will fail if the location is already occupied.
                                            </p>
                                        </div>

                                        <Button
                                            type="submit"
                                            disabled={saving}
                                            className="w-full justify-center"
                                            icon={<Save className="w-3.5 h-3.5" />}
                                        >
                                            {saving ? 'Saving...' : 'Confirm Appointment'}
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="text-center text-subtle text-xs">
                                            Select a role type above to appoint, or save to update the location only.
                                        </div>
                                        <Button
                                            type="submit"
                                            variant="secondary"
                                            disabled={saving}
                                            className="w-full justify-center"
                                            icon={<Save className="w-3.5 h-3.5" />}
                                        >
                                            {saving ? 'Saving...' : 'Save Location'}
                                        </Button>
                                    </div>
                                )}
                            </form>
                        ) : (
                            <EmptyState
                                className="py-10"
                                icon={<Users size={18} />}
                                title="Role Appointment"
                                description="Select an employee from the list to appoint a role."
                            />
                        )}
                    </Card>
                </div>
            )}

            {/* ASSIGNED LIST TAB */}
            {activeTab === 'list' && (
                <Card padding="none" className="overflow-hidden">
                    <div className="px-4 py-3.5 border-b border-border flex justify-between items-center">
                        <div>
                            <h2 className="m-0 text-[13px] font-bold text-ink">Current Assignments</h2>
                            <p className="m-0 text-[11.5px] text-muted-foreground">List of all active Branch and Regional Managers</p>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Total Assigned: <span className="font-bold text-ink">{assignedManagers.length}</span>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-[#FAFBFA] border-b border-border">
                                <tr className="text-[10px] font-bold uppercase text-subtle">
                                    <th className="px-4 py-2.5 w-12 text-center">#</th>
                                    <th className="px-4 py-2.5">Employee</th>
                                    <th className="px-4 py-2.5">Role</th>
                                    <th className="px-4 py-2.5">Assigned Email</th>
                                    <th className="px-4 py-2.5">Location (Town/Region)</th>
                                    <th className="px-4 py-2.5 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {assignedManagers.length > 0 ? (
                                    assignedManagers
                                        .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                                        .map((mgr, index) => {
                                            const role = mgr.manager_email ? 'Branch Manager' : 'Regional Manager';
                                            const email = mgr.manager_email || mgr.regional_manager;
                                            const location = mgr.manager_email ? mgr.Town : mgr.Branch;
                                            const globalIndex = (currentPage - 1) * itemsPerPage + index + 1;

                                            return (
                                                <tr key={mgr['Employee Number']} className="border-b border-[#F1F5F2] hover:bg-background text-ink">
                                                    <td className="px-4 py-3 text-center text-[11px] text-subtle font-mono">
                                                        {globalIndex.toString().padStart(2, '0')}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="font-bold">{mgr['First Name']} {mgr['Last Name']}</div>
                                                        <div className="text-[10px] text-subtle">{mgr['Employee Number']}</div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <StatusPill label={role} tone={role === 'Branch Manager' ? 'success' : 'purple'} />
                                                    </td>
                                                    <td className="px-4 py-3 font-mono text-[11px]">{email}</td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-1.5">
                                                            {role === 'Branch Manager' ? <Building2 size={14} className="text-subtle" /> : <MapPin size={14} className="text-subtle" />}
                                                            {location || 'N/A'}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUnassign(mgr['Employee Number'])}
                                                            className="p-2 hover:bg-orange-tint text-subtle hover:text-status-danger rounded-lg transition-colors"
                                                            title="Unassign Role"
                                                            aria-label={`Unassign ${mgr['First Name']} ${mgr['Last Name']}`}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                ) : (
                                    <tr>
                                        <td colSpan={6}>
                                            <EmptyState
                                                className="py-10"
                                                icon={<Users size={18} />}
                                                title="No managers assigned yet"
                                                description="Appointed Branch and Regional Managers will appear here."
                                            />
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {assignedManagers.length > itemsPerPage && (
                        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
                            <Button
                                variant="secondary"
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                            >
                                Previous
                            </Button>
                            <span className="text-xs text-muted-foreground font-medium">
                                Page {currentPage} of {Math.ceil(assignedManagers.length / itemsPerPage)}
                            </span>
                            <Button
                                variant="secondary"
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(assignedManagers.length / itemsPerPage)))}
                                disabled={currentPage === Math.ceil(assignedManagers.length / itemsPerPage)}
                            >
                                Next
                            </Button>
                        </div>
                    )}
                </Card>
            )}
        </div>
    );
};

export default ManagerAssignment;
