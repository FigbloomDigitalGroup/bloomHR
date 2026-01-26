import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Shield,
    Save,
    RefreshCw,
    Users,
    Lock,
    Unlock,
    AlertCircle,
    CheckCircle2,
    Search
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

interface RolePermission {
    role_name: string;
    permissions: string[];
}

const AVAILABLE_ROLES = [
    { id: 'ADMIN', name: 'Administrator', color: 'red', description: 'Full system access' },
    { id: 'HR', name: 'Human Resources', color: 'blue', description: 'HR management access' },
    { id: 'CHECKER', name: 'Checker', color: 'purple', description: 'Verification and approval access' },
    { id: 'MANAGER', name: 'Manager', color: 'green', description: 'Team management access' },
    { id: 'REGIONAL', name: 'Regional Manager', color: 'amber', description: 'Regional oversight access' },
    { id: 'OPERATIONS', name: 'Operations', color: 'cyan', description: 'Operational access' },
    { id: 'STAFF', name: 'Staff', color: 'gray', description: 'Basic employee access' },
];

const PERMISSION_CATEGORIES = [
    { id: 'overview', name: 'Overview', icon: '📊' },
    { id: 'workspace', name: 'Workspace', icon: '💼' },
    { id: 'people-hr', name: 'People & HR', icon: '👥' },
    { id: 'finance', name: 'Finance & Assets', icon: '💰' },
    { id: 'system', name: 'System', icon: '⚙️' },
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
    const selectedRoleData = AVAILABLE_ROLES.find(r => r.id === selectedRole);

    const getPermissionsByCategory = (category: string) => {
        return filteredPermissions.filter(p => p.category === category);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="text-center">
                    <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
                    <p className="text-sm text-gray-600">Loading permissions...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                        <Shield className="w-8 h-8 text-blue-600" />
                        Role & Permissions Management
                    </h1>
                    <p className="text-sm text-gray-600 mt-1">
                        Configure access rights for different user roles
                    </p>
                </div>

                {hasChanges && (
                    <motion.button
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        onClick={savePermissions}
                        disabled={saving}
                        className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-200"
                    >
                        {saving ? (
                            <>
                                <RefreshCw className="w-5 h-5 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save className="w-5 h-5" />
                                Save Changes
                            </>
                        )}
                    </motion.button>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Role Selection Sidebar */}
                <div className="lg:col-span-1">
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
                        <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <Users className="w-4 h-4" />
                            Select Role
                        </h3>

                        <div className="space-y-2">
                            {AVAILABLE_ROLES.map((role) => {
                                const permCount = (rolePermissions[role.id] || []).length;
                                const isSelected = selectedRole === role.id;

                                return (
                                    <button
                                        key={role.id}
                                        onClick={() => {
                                            if (hasChanges && !window.confirm('You have unsaved changes. Continue?')) {
                                                return;
                                            }
                                            setSelectedRole(role.id);
                                            setHasChanges(false);
                                        }}
                                        className={`w-full text-left p-3 rounded-xl transition-all ${isSelected
                                            ? 'bg-blue-50 border-2 border-blue-500 shadow-sm'
                                            : 'bg-gray-50 border-2 border-transparent hover:border-gray-300'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <span className={`text-sm font-semibold ${isSelected ? 'text-blue-700' : 'text-gray-900'
                                                }`}>
                                                {role.name}
                                            </span>
                                            <span className={`text-xs px-2 py-1 rounded-full ${isSelected ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'
                                                }`}>
                                                {permCount}
                                            </span>
                                        </div>
                                        <p className="text-xs text-gray-500">{role.description}</p>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Quick Actions */}
                        <div className="mt-6 pt-6 border-t border-gray-200 space-y-2">
                            <button
                                onClick={grantAllPermissions}
                                className="w-full px-3 py-2 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors flex items-center justify-center gap-2"
                            >
                                <Unlock className="w-4 h-4" />
                                Grant All
                            </button>
                            <button
                                onClick={clearAllPermissions}
                                className="w-full px-3 py-2 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                            >
                                <Lock className="w-4 h-4" />
                                Clear All
                            </button>
                        </div>
                    </div>
                </div>

                {/* Permissions Panel */}
                <div className="lg:col-span-3">
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
                        {/* Panel Header */}
                        <div className="p-6 border-b border-gray-200">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h2 className="text-lg font-bold text-gray-900">
                                        {selectedRoleData?.name} Permissions
                                    </h2>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {currentRolePermissions.length} of {permissions.length} permissions granted
                                    </p>
                                </div>

                                {/* Copy from another role */}
                                <select
                                    onChange={(e) => e.target.value && copyPermissionsFrom(e.target.value)}
                                    value=""
                                    className="px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">Copy from role...</option>
                                    {AVAILABLE_ROLES.filter(r => r.id !== selectedRole).map(role => (
                                        <option key={role.id} value={role.id}>{role.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Search and Filter */}
                            <div className="flex gap-3">
                                <div className="flex-1 relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Search permissions..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <select
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="all">All Categories</option>
                                    {PERMISSION_CATEGORIES.map(cat => (
                                        <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Permissions List */}
                        <div className="p-6 max-h-[600px] overflow-y-auto">
                            {selectedCategory === 'all' ? (
                                // Group by category
                                PERMISSION_CATEGORIES.map(category => {
                                    const categoryPerms = getPermissionsByCategory(category.id);
                                    if (categoryPerms.length === 0) return null;

                                    return (
                                        <div key={category.id} className="mb-6 last:mb-0">
                                            <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                                                <span>{category.icon}</span>
                                                {category.name}
                                                <span className="text-xs font-normal text-gray-500">
                                                    ({categoryPerms.filter(p => currentRolePermissions.includes(p.module_id)).length}/{categoryPerms.length})
                                                </span>
                                            </h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {categoryPerms.map(permission => {
                                                    const hasPermission = currentRolePermissions.includes(permission.module_id);

                                                    return (
                                                        <motion.button
                                                            key={permission.id}
                                                            onClick={() => togglePermission(permission.module_id)}
                                                            whileHover={{ scale: 1.02 }}
                                                            whileTap={{ scale: 0.98 }}
                                                            className={`p-4 rounded-xl border-2 transition-all text-left ${hasPermission
                                                                ? 'bg-green-50 border-green-500 shadow-sm'
                                                                : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                                                                }`}
                                                        >
                                                            <div className="flex items-start justify-between">
                                                                <div className="flex-1">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        {hasPermission ? (
                                                                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                                                                        ) : (
                                                                            <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
                                                                        )}
                                                                        <span className={`text-sm font-semibold ${hasPermission ? 'text-green-700' : 'text-gray-900'
                                                                            }`}>
                                                                            {permission.module_name}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-xs text-gray-600 ml-6">
                                                                        {permission.description}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </motion.button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                // Single category view
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {filteredPermissions.map(permission => {
                                        const hasPermission = currentRolePermissions.includes(permission.module_id);

                                        return (
                                            <motion.button
                                                key={permission.id}
                                                onClick={() => togglePermission(permission.module_id)}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                                className={`p-4 rounded-xl border-2 transition-all text-left ${hasPermission
                                                    ? 'bg-green-50 border-green-500 shadow-sm'
                                                    : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                                                    }`}
                                            >
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            {hasPermission ? (
                                                                <CheckCircle2 className="w-4 h-4 text-green-600" />
                                                            ) : (
                                                                <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
                                                            )}
                                                            <span className={`text-sm font-semibold ${hasPermission ? 'text-green-700' : 'text-gray-900'
                                                                }`}>
                                                                {permission.module_name}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-gray-600 ml-6">
                                                            {permission.description}
                                                        </p>
                                                    </div>
                                                </div>
                                            </motion.button>
                                        );
                                    })}
                                </div>
                            )}

                            {filteredPermissions.length === 0 && (
                                <div className="text-center py-12">
                                    <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                                    <p className="text-sm text-gray-600">No permissions found</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
