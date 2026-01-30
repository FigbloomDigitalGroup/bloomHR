import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Shield,
    Save,
    RefreshCw,
    Users,
    Lock,
    Unlock,
    Search,
    LayoutDashboard,
    Building2,
    Wallet,
    Settings,
    Briefcase,
    UserCog,
    CheckSquare,
    Square
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

interface Permission {
    id: string;
    module_name: string;
    module_id: string;
    description: string;
    category: string;
}

const AVAILABLE_ROLES = [
    { id: 'ADMIN', name: 'Administrator', description: 'Full system access & configuration' },
    { id: 'HR', name: 'Human Resources', description: 'Employee & payroll management' },
    { id: 'CHECKER', name: 'Checker', description: 'Verification & approval workflows' },
    { id: 'MANAGER', name: 'Manager', description: 'Team oversight & reporting' },
    { id: 'REGIONAL', name: 'Regional Manager', description: 'Multi-branch supervision' },
    { id: 'OPERATIONS', name: 'Operations', description: 'Day-to-day system operations' },
    { id: 'STAFF', name: 'Staff', description: 'Basic portal access' },
];

const CATEGORY_ICONS: Record<string, any> = {
    'overview': LayoutDashboard,
    'workspace': Building2,
    'people-hr': Users,
    'finance': Wallet,
    'system': Settings,
    'default': Briefcase
};

const PERMISSION_CATEGORIES = [
    { id: 'overview', name: 'Overview' },
    { id: 'workspace', name: 'Workspace' },
    { id: 'people-hr', name: 'People & HR' },
    { id: 'finance', name: 'Finance & Assets' },
    { id: 'system', name: 'System' },
];

export default function RolePermissions() {
    const [selectedRole, setSelectedRole] = useState<string>('ADMIN');
    const [permissions, setPermissions] = useState<Permission[]>([]);
    const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        fetchPermissions();
        fetchRolePermissions();
    }, []);

    const fetchPermissions = async () => {
        try {
            const { data, error } = await supabase
                .from('permissions')
                .select('*')
                .order('category', { ascending: true })
                .order('module_name', { ascending: true });

            if (error) throw error;
            setPermissions(data || []);
        } catch (error) {
            console.error('Error fetching permissions:', error);
            toast.error('Failed to load permissions');
        }
    };

    const fetchRolePermissions = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('role_permissions')
                .select('*');

            if (error) throw error;

            const permissionsMap: Record<string, string[]> = {};
            (data || []).forEach((rp: any) => {
                permissionsMap[rp.role_name] = rp.permissions || [];
            });

            setRolePermissions(permissionsMap);
        } catch (error) {
            console.error('Error fetching role permissions:', error);
            toast.error('Failed to load role permissions');
        } finally {
            setLoading(false);
        }
    };

    const togglePermission = (moduleId: string) => {
        setHasChanges(true);
        setRolePermissions(prev => {
            const currentPermissions = prev[selectedRole] || [];
            const hasPermission = currentPermissions.includes(moduleId);

            return {
                ...prev,
                [selectedRole]: hasPermission
                    ? currentPermissions.filter(p => p !== moduleId)
                    : [...currentPermissions, moduleId]
            };
        });
    };

    const savePermissions = async () => {
        try {
            setSaving(true);
            const { error } = await supabase
                .from('role_permissions')
                .upsert({
                    role_name: selectedRole,
                    permissions: rolePermissions[selectedRole] || [],
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'role_name'
                });

            if (error) throw error;

            toast.success(`Permissions saved for ${selectedRole}`);
            setHasChanges(false);
        } catch (error) {
            console.error('Error saving permissions:', error);
            toast.error('Failed to save permissions');
        } finally {
            setSaving(false);
        }
    };

    const copyPermissionsFrom = async (sourceRole: string) => {
        if (window.confirm(`Copy all permissions from ${sourceRole} to ${selectedRole}?`)) {
            setRolePermissions(prev => ({
                ...prev,
                [selectedRole]: [...(prev[sourceRole] || [])]
            }));
            setHasChanges(true);
            toast.success(`Permissions copied from ${sourceRole}`);
        }
    };

    const clearAllPermissions = () => {
        if (window.confirm(`Remove all permissions for ${selectedRole}?`)) {
            setRolePermissions(prev => ({
                ...prev,
                [selectedRole]: []
            }));
            setHasChanges(true);
            toast.success('All permissions cleared');
        }
    };

    const grantAllPermissions = () => {
        if (window.confirm(`Grant all permissions to ${selectedRole}?`)) {
            setRolePermissions(prev => ({
                ...prev,
                [selectedRole]: permissions.map(p => p.module_id)
            }));
            setHasChanges(true);
            toast.success('All permissions granted');
        }
    };

    const filteredPermissions = permissions.filter(p => {
        const matchesSearch = p.module_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    const currentRolePermissions = rolePermissions[selectedRole] || [];

    const getPermissionsByCategory = (category: string) => {
        return filteredPermissions.filter(p => p.category === category);
    };

    const getCategoryIcon = (categoryId: string) => {
        const Icon = CATEGORY_ICONS[categoryId] || CATEGORY_ICONS['default'];
        return <Icon className="w-5 h-5 text-gray-500" />;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center">
                    <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
                    <p className="text-gray-500 font-medium text-sm">Loading permissions...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 font-['Inter',sans-serif] text-gray-900 p-8">
            <div className="max-w-[1600px] mx-auto space-y-8">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <Shield className="w-6 h-6 text-indigo-600" />
                            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Role & Permissions</h1>
                        </div>
                        <p className="text-sm text-gray-500">
                            Configure access controls and security policies for each role.
                        </p>
                    </div>

                    <AnimatePresence>
                        {hasChanges && (
                            <motion.button
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                onClick={savePermissions}
                                disabled={saving}
                                className="px-5 py-2.5 bg-gray-900 text-white rounded-lg font-medium shadow-sm hover:bg-black transition-colors flex items-center gap-2 disabled:opacity-70"
                            >
                                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                <span>Save Changes</span>
                            </motion.button>
                        )}
                    </AnimatePresence>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Role Selection Sidebar */}
                    <div className="lg:col-span-3 space-y-6">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                                <UserCog className="w-4 h-4 text-gray-500" />
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Select Role</span>
                            </div>

                            <div className="p-2 space-y-1">
                                {AVAILABLE_ROLES.map((role) => {
                                    const permCount = (rolePermissions[role.id] || []).length;
                                    const isSelected = selectedRole === role.id;

                                    return (
                                        <button
                                            key={role.id}
                                            onClick={() => {
                                                if (hasChanges && !window.confirm('You have unsaved changes. Continue?')) return;
                                                setSelectedRole(role.id);
                                                setHasChanges(false);
                                            }}
                                            className={`w-full text-left px-3 py-3 rounded-lg transition-colors flex items-center justify-between group ${isSelected
                                                ? 'bg-indigo-50 text-indigo-700'
                                                : 'text-gray-700 hover:bg-gray-50'
                                                }`}
                                        >
                                            <div>
                                                <span className="text-sm font-semibold block">{role.name}</span>
                                            </div>
                                            <div className={`
                                                px-2 py-0.5 rounded text-xs font-bold
                                                ${isSelected
                                                    ? 'bg-indigo-100/50 text-indigo-700'
                                                    : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200'
                                                }
                                            `}>
                                                {permCount}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="p-3 border-t border-gray-100 bg-gray-50 space-y-2">
                                <button
                                    onClick={grantAllPermissions}
                                    className="w-full px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    <Unlock className="w-3.5 h-3.5" />
                                    Grant All
                                </button>
                                <button
                                    onClick={clearAllPermissions}
                                    className="w-full px-3 py-2 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    <Lock className="w-3.5 h-3.5" />
                                    Revoke All
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="lg:col-span-9 space-y-6">
                        {/* Controls Bar */}
                        <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="flex items-center gap-4 w-full sm:w-auto">
                                <div className="relative flex-1 sm:flex-none sm:w-64">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Search permissions..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                                    />
                                </div>
                                <select
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                                >
                                    <option value="all">All Categories</option>
                                    {PERMISSION_CATEGORIES.map(cat => (
                                        <option key={cat.id} value={cat.id}>
                                            {cat.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex items-center gap-3 w-full sm:w-auto">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Copy from:</span>
                                <select
                                    onChange={(e) => e.target.value && copyPermissionsFrom(e.target.value)}
                                    value=""
                                    className="flex-1 sm:flex-none px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                                >
                                    <option value="">Select role...</option>
                                    {AVAILABLE_ROLES.filter(r => r.id !== selectedRole).map(role => (
                                        <option key={role.id} value={role.id}>{role.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Permissions Grid */}
                        <div className="space-y-6">
                            {filteredPermissions.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                                    <div className="p-3 bg-gray-50 rounded-full mb-3">
                                        <Search className="w-6 h-6 text-gray-400" />
                                    </div>
                                    <h3 className="text-gray-900 font-medium">No permissions found</h3>
                                    <p className="text-gray-500 text-sm">Try adjusting your search filters.</p>
                                </div>
                            ) : (
                                PERMISSION_CATEGORIES.filter(cat =>
                                    selectedCategory === 'all' || selectedCategory === cat.id
                                ).map(category => {
                                    const categoryPerms = getPermissionsByCategory(category.id);
                                    if (categoryPerms.length === 0) return null;

                                    return (
                                        <div key={category.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                            <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    {getCategoryIcon(category.id)}
                                                    <h3 className="font-semibold text-gray-900">{category.name}</h3>
                                                </div>
                                                <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                                    {categoryPerms.filter(p => currentRolePermissions.includes(p.module_id)).length} / {categoryPerms.length} Active
                                                </span>
                                            </div>

                                            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {categoryPerms.map(permission => {
                                                    const hasPermission = currentRolePermissions.includes(permission.module_id);

                                                    return (
                                                        <div
                                                            key={permission.id}
                                                            onClick={() => togglePermission(permission.module_id)}
                                                            className={`
                                                                cursor-pointer relative p-4 rounded-xl border text-left transition-all duration-200 group
                                                                ${hasPermission
                                                                    ? 'bg-indigo-50/50 border-indigo-200 shadow-sm'
                                                                    : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                                                }
                                                            `}
                                                        >
                                                            <div className="flex items-start gap-3">
                                                                <div className={`mt-0.5 ${hasPermission ? 'text-indigo-600' : 'text-gray-300 group-hover:text-gray-400'}`}>
                                                                    {hasPermission ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                                                                </div>
                                                                <div>
                                                                    <p className={`text-sm font-semibold mb-1 ${hasPermission ? 'text-indigo-900' : 'text-gray-700'}`}>
                                                                        {permission.module_name}
                                                                    </p>
                                                                    <p className="text-xs text-gray-500 leading-relaxed">
                                                                        {permission.description}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
