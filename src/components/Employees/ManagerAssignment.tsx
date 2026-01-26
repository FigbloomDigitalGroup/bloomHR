import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Search, Save, UserCog, ArrowLeft, Filter, Users, MapPin, Building2, Settings, ShieldAlert, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Database } from '../../types/supabase';
import GlowButton from '../UI/GlowButton';
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
        // 1. Email Domain
        if (email && !email.trim().toLowerCase().endsWith('@mularcredit.com')) {
            toast.error('Email must end with @mularcredit.com');
            return false;
        }

        // 2. Unique Email Check (Is this email assigned to anyone else?)
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

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6 min-h-screen bg-gray-50/50">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                        <div className="p-2 bg-green-100 rounded-lg text-green-600">
                            <UserCog size={24} />
                        </div>
                        Manager Appointment Portal
                    </h1>
                    <p className="text-gray-500 text-sm mt-1 ml-12">
                        Appoint Branch and Regional Managers for specific locations
                    </p>
                </div>
                <button
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
                >
                    <ArrowLeft size={16} />
                    Back to Dashboard
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 border-b border-gray-200">
                <button
                    onClick={() => setActiveTab('appoint')}
                    className={`pb-3 px-1 text-sm font-medium transition-all border-b-2 ${activeTab === 'appoint'
                        ? 'border-green-500 text-green-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                >
                    Appoint Manager
                </button>
                <button
                    onClick={() => setActiveTab('list')}
                    className={`pb-3 px-1 text-sm font-medium transition-all border-b-2 ${activeTab === 'list'
                        ? 'border-green-500 text-green-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                >
                    Assigned Managers List
                </button>
            </div>

            {/* APPOINT TAB */}
            {activeTab === 'appoint' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left: Search & Select */}
                    <div className="lg:col-span-8 space-y-4">
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[700px]">
                            {/* Filters */}
                            <div className="p-4 border-b border-gray-100 space-y-4 bg-white sticky top-0 z-10">
                                <div className="flex flex-col sm:flex-row gap-3">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                                        <input
                                            type="text"
                                            className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all bg-gray-50/50"
                                            placeholder="Search Employee..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
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
                                <div className="text-xs text-gray-500 px-1">
                                    Showing {filteredEmployees.length} employees
                                </div>
                            </div>

                            {/* List */}
                            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                                {loading ? (
                                    <div className="flex justify-center p-8"><div className="animate-spin w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full" /></div>
                                ) : filteredEmployees.map(emp => {
                                    const isSelected = selectedEmployeeId === emp['Employee Number'];
                                    const isManager = emp.manager_email || emp.regional_manager;
                                    return (
                                        <div
                                            key={emp['Employee Number']}
                                            onClick={() => setSelectedEmployeeId(emp['Employee Number'])}
                                            className={`
                         p-3 rounded-xl border cursor-pointer transition-all flex items-center gap-3
                         ${isSelected ? 'bg-green-50 border-green-200 ring-1 ring-green-200' : 'bg-white border-gray-100 hover:bg-gray-50'}
                       `}
                                        >
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isSelected ? 'bg-green-200 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                                {emp['First Name']?.[0]}{emp['Last Name']?.[0]}
                                            </div>
                                            <div className="flex-1">
                                                <h3 className={`text-sm font-semibold ${isSelected ? 'text-green-900' : 'text-gray-900'}`}>{emp['First Name']} {emp['Last Name']}</h3>
                                                <div className="flex items-center gap-3 mt-1">
                                                    <span className="text-[10px] text-gray-500 flex items-center gap-1"><Building2 size={10} /> {emp.Town || 'No Town'}</span>
                                                    <span className="text-[10px] text-gray-500 flex items-center gap-1"><MapPin size={10} /> {emp.Branch || 'No Region'}</span>
                                                </div>
                                            </div>
                                            {isManager && (
                                                <span className="text-[10px] px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">
                                                    {emp.manager_email ? 'Branch Mgr' : 'Regional Mgr'}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Right: Appointment Form */}
                    <div className="lg:col-span-4 space-y-6">
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg sticky top-6">
                            <div className="p-5 border-b border-gray-100 bg-gray-50/50 rounded-t-2xl">
                                <h2 className="font-bold text-gray-900 flex items-center gap-2">
                                    <Settings size={18} className="text-green-600" />
                                    Role Appointment
                                </h2>
                            </div>

                            {selectedEmployeeId ? (
                                <form onSubmit={handleAppoint} className="p-6 space-y-6">

                                    {/* Location Details Editor */}
                                    <div className="bg-gray-50 p-4 rounded-xl space-y-3">
                                        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                                            <MapPin size={12} /> Location Details
                                        </h3>
                                        <div className="space-y-2">
                                            <div>
                                                <label className="text-xs text-gray-700 font-semibold">User Home Branch</label>
                                                <input
                                                    value={editTown}
                                                    onChange={e => setEditTown(e.target.value)}
                                                    className="w-full text-sm border-gray-200 rounded-md focus:ring-green-500 py-1.5 px-3"
                                                    placeholder="Edit Branch Name (Town)"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-700 font-semibold">User Home Region</label>
                                                <input
                                                    value={editRegion}
                                                    onChange={e => setEditRegion(e.target.value)}
                                                    className="w-full text-sm border-gray-200 rounded-md focus:ring-green-500 py-1.5 px-3"
                                                    placeholder="Edit Region Name"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <h3 className="text-sm font-medium text-gray-900 mb-3">2. Select Role Type (Optional)</h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                type="button"
                                                onClick={() => handleRoleSelect('branch')}
                                                className={`p-3 rounded-xl border text-sm font-medium transition-all ${roleType === 'branch'
                                                    ? 'bg-green-50 border-green-200 text-green-700 ring-1 ring-green-200'
                                                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                                    }`}
                                            >
                                                Branch Manager
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRoleSelect('regional')}
                                                className={`p-3 rounded-xl border text-sm font-medium transition-all ${roleType === 'regional'
                                                    ? 'bg-purple-50 border-purple-200 text-purple-700 ring-1 ring-purple-200'
                                                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                                    }`}
                                            >
                                                Regional Manager
                                            </button>
                                        </div>
                                    </div>

                                    <AnimatePresence mode='wait'>
                                        {roleType && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -10 }}
                                                className="space-y-4"
                                            >
                                                <div>
                                                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                                                        {roleType === 'branch' ? 'Branch Manager Email' : 'Regional Manager Email'}
                                                    </label>
                                                    <input
                                                        type="email"
                                                        required
                                                        value={emailInput}
                                                        onChange={(e) => setEmailInput(e.target.value)}
                                                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                                                        placeholder={`e.g. name@mularcredit.com`}
                                                    />
                                                    <p className="text-[10px] text-gray-400 mt-1">
                                                        Must be a unique <strong>@mularcredit.com</strong> email.
                                                    </p>
                                                </div>

                                                <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-100 flex gap-2">
                                                    <ShieldAlert size={14} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                                                    <p className="text-xs text-yellow-700">
                                                        <strong>Rule:</strong> Only one {roleType === 'branch' ? 'manager per Town' : 'regional manager per Region'}.
                                                        Assigning will fail if the location is already occupied.
                                                    </p>
                                                </div>

                                                <GlowButton
                                                    type="submit"
                                                    disabled={saving}
                                                    className="w-full justify-center"
                                                    icon={Save}
                                                >
                                                    {saving ? 'Saving...' : 'Confirm Appointment'}
                                                </GlowButton>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {!roleType && (
                                        <div className="text-center py-8 text-gray-400 text-sm">
                                            Select a role type above to proceed.
                                        </div>
                                    )}
                                </form>
                            ) : (
                                <div className="p-8 text-center text-gray-400">
                                    <Users size={32} className="mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">Select an employee from the list to appoint a role.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ASSIGNED LIST TAB */}
            {activeTab === 'list' && (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Current Assignments</h2>
                            <p className="text-sm text-gray-500">List of all active Branch and Regional Managers</p>
                        </div>
                        <div className="text-sm text-gray-500">
                            Total Assigned: <span className="font-bold text-gray-900">{assignedManagers.length}</span>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-gray-600">
                            <thead className="bg-gray-50 text-gray-900 font-semibold border-b border-gray-100">
                                <tr>
                                    <th className="px-4 py-4 w-12 text-center">#</th>
                                    <th className="px-6 py-4">Employee</th>
                                    <th className="px-6 py-4">Role</th>
                                    <th className="px-6 py-4">Assigned Email</th>
                                    <th className="px-6 py-4">Location (Town/Region)</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {assignedManagers.length > 0 ? (
                                    assignedManagers
                                        .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                                        .map((mgr, index) => {
                                            const role = mgr.manager_email ? 'Branch Manager' : 'Regional Manager';
                                            const email = mgr.manager_email || mgr.regional_manager;
                                            const location = mgr.manager_email ? mgr.Town : mgr.Branch;
                                            const globalIndex = (currentPage - 1) * itemsPerPage + index + 1;

                                            return (
                                                <tr key={mgr['Employee Number']} className="hover:bg-gray-50/50">
                                                    <td className="px-4 py-4 text-center text-xs text-gray-400 font-mono">
                                                        {globalIndex.toString().padStart(2, '0')}
                                                    </td>
                                                    <td className="px-6 py-4 font-medium text-gray-900">
                                                        {mgr['First Name']} {mgr['Last Name']}
                                                        <div className="text-xs text-gray-400 font-normal">{mgr['Employee Number']}</div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${role === 'Branch Manager' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                                                            }`}>
                                                            {role}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 font-mono text-xs">{email}</td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-1.5">
                                                            {role === 'Branch Manager' ? <Building2 size={14} className="text-gray-400" /> : <MapPin size={14} className="text-gray-400" />}
                                                            {location || 'N/A'}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button
                                                            onClick={() => handleUnassign(mgr['Employee Number'])}
                                                            className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
                                                            title="Unassign Role"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                ) : (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                                            No managers assigned yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {/* Pagination Controls */}
                    {assignedManagers.length > itemsPerPage && (
                        <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-all"
                            >
                                Previous
                            </button>
                            <span className="text-sm text-gray-600 font-medium">
                                Page {currentPage} of {Math.ceil(assignedManagers.length / itemsPerPage)}
                            </span>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(assignedManagers.length / itemsPerPage)))}
                                disabled={currentPage === Math.ceil(assignedManagers.length / itemsPerPage)}
                                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-all"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ManagerAssignment;
