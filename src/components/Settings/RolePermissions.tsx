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
    Square,
    ChevronRight,
    ArrowUpRight,
    Activity,
    ShieldCheck,
    CheckCircle2,
    X,
    Filter
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
                    <p className="text-gray-500 font-bold text-[10px] uppercase tracking-widest">Hydrating Protocol Registry...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-12">
            {/* Premium Header Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:col-span-1 bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-[2.5rem] p-8 text-white shadow-xl shadow-indigo-100 relative overflow-hidden group"
                >
                    <div className="relative z-10 space-y-6">
                        <div className="space-y-1">
                            <h2 className="text-2xl font-black tracking-tight italic uppercase">Access Gates</h2>
                            <p className="text-indigo-100 text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Security Policy Coordinator</p>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                                <ShieldCheck className="w-5 h-5 text-indigo-300" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-100 italic">Auth Level 7 High Console</span>
                        </div>

                        <div className="flex flex-col gap-2 pt-4">
                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest border-b border-white/10 pb-2">
                                <span>Active Segments</span>
                                <span className="text-emerald-400">{currentRolePermissions.length}</span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/50 pt-2">
                                <span>Total Modules</span>
                                <span>{permissions.length}</span>
                            </div>
                        </div>

                        <AnimatePresence>
                            {hasChanges && (
                                <motion.button
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.9, opacity: 0 }}
                                    onClick={savePermissions}
                                    disabled={saving}
                                    className="w-full py-4 bg-white text-indigo-600 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70"
                                >
                                    {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    Commit Policies
                                </motion.button>
                            )}
                        </AnimatePresence>
                    </div>
                    <Activity className="absolute -bottom-10 -right-10 w-48 h-48 text-white/5" />
                </motion.div>

                {/* Role Matrix */}
                <div className="lg:col-span-3 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8 flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                            <UserCog className="w-4 h-4" />
                        </div>
                        <h3 className="text-lg font-black text-gray-900 uppercase italic">Role Segments</h3>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {AVAILABLE_ROLES.map((role) => {
                            const isSelected = selectedRole === role.id;
                            const count = (rolePermissions[role.id] || []).length;
                            return (
                                <button
                                    key={role.id}
                                    onClick={() => {
                                        if (hasChanges && !window.confirm('You have unsaved changes. Continue?')) return;
                                        setSelectedRole(role.id);
                                        setHasChanges(false);
                                    }}
                                    className={`px-6 py-4 rounded-[2rem] border transition-all flex items-center gap-4 group ${isSelected
                                            ? 'bg-indigo-600 text-white border-transparent shadow-xl shadow-indigo-100'
                                            : 'bg-white text-gray-400 border-gray-100 hover:border-indigo-200 hover:text-indigo-600'
                                        }`}
                                >
                                    <div className="flex flex-col items-start">
                                        <span className="text-[10px] font-black uppercase tracking-widest">{role.name}</span>
                                        <span className={`text-[8px] font-bold uppercase tracking-tighter ${isSelected ? 'text-indigo-200' : 'text-gray-300'}`}>
                                            {count} Active Nodes
                                        </span>
                                    </div>
                                    <ChevronRight className={`w-4 h-4 transition-transform ${isSelected ? 'rotate-90 text-white' : 'group-hover:translate-x-1'}`} />
                                </button>
                            );
                        })}
                    </div>

                    <div className="mt-auto pt-8 border-t border-gray-50 flex items-center justify-between">
                        <div className="flex items-center gap-6">
                            <button
                                onClick={grantAllPermissions}
                                className="flex items-center gap-2 text-[9px] font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-700 transition-colors"
                            >
                                <Unlock className="w-3.5 h-3.5" /> Full Scalar Grant
                            </button>
                            <button
                                onClick={clearAllPermissions}
                                className="flex items-center gap-2 text-[9px] font-black text-red-500 uppercase tracking-widest hover:text-red-700 transition-colors"
                            >
                                <Lock className="w-3.5 h-3.5" /> Total Revocation
                            </button>
                        </div>

                        <div className="flex items-center gap-3">
                            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Clone from:</span>
                            <select
                                onChange={(e) => e.target.value && copyPermissionsFrom(e.target.value)}
                                value=""
                                className="px-4 py-2 bg-gray-50 border-none rounded-xl text-[9px] font-black uppercase tracking-widest focus:ring-2 focus:ring-indigo-100 transition-all outline-none"
                            >
                                <option value="">Select Protocol Source...</option>
                                {AVAILABLE_ROLES.filter(r => r.id !== selectedRole).map(role => (
                                    <option key={role.id} value={role.id}>{role.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Permissions Engine Grid */}
            <div className="bg-white rounded-[3rem] border border-gray-100 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
                <div className="p-8 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                    <div className="flex items-center gap-6 flex-1">
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="SEARCH POLICY BY MODULE..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-14 pr-6 py-4 bg-white border border-gray-100 rounded-[2rem] text-[10px] font-black uppercase tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all font-mono shadow-sm"
                            />
                        </div>
                        <div className="flex items-center bg-white p-1.5 rounded-2xl border border-gray-100 shadow-sm">
                            <button
                                onClick={() => setSelectedCategory('all')}
                                className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${selectedCategory === 'all' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-indigo-600'
                                    }`}
                            >
                                All Segments
                            </button>
                            {PERMISSION_CATEGORIES.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => setSelectedCategory(cat.id)}
                                    className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${selectedCategory === cat.id ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-indigo-600'
                                        }`}
                                >
                                    {cat.name}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="p-8 space-y-10">
                    {PERMISSION_CATEGORIES.filter(cat => selectedCategory === 'all' || selectedCategory === cat.id).map(category => {
                        const categoryPerms = getPermissionsByCategory(category.id);
                        if (categoryPerms.length === 0) return null;

                        return (
                            <div key={category.id} className="space-y-6">
                                <div className="flex items-center justify-between px-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                                            {getCategoryIcon(category.id)}
                                        </div>
                                        <h4 className="text-sm font-black text-gray-900 uppercase italic tracking-widest">{category.name}</h4>
                                    </div>
                                    <div className="px-4 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-[9px] font-black text-gray-400 uppercase tracking-widest">
                                        {categoryPerms.filter(p => currentRolePermissions.includes(p.module_id)).length} / {categoryPerms.length} Active Nodes
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {categoryPerms.map(permission => {
                                        const hasPermission = currentRolePermissions.includes(permission.module_id);
                                        return (
                                            <motion.div
                                                key={permission.id}
                                                whileHover={{ y: -2 }}
                                                onClick={() => togglePermission(permission.module_id)}
                                                className={`
                                                    cursor-pointer p-6 rounded-[2rem] border transition-all duration-300 group relative overflow-hidden
                                                    ${hasPermission
                                                        ? 'bg-gradient-to-br from-indigo-50 to-white border-indigo-200 shadow-lg shadow-indigo-100/50'
                                                        : 'bg-white border-gray-100 hover:border-indigo-100'
                                                    }
                                                `}
                                            >
                                                <div className="flex items-start gap-4 relative z-10">
                                                    <div className={`mt-0.5 transition-colors ${hasPermission ? 'text-indigo-600' : 'text-gray-200 group-hover:text-indigo-200'}`}>
                                                        {hasPermission ? <CheckSquare className="w-6 h-6" /> : <Square className="w-6 h-6" />}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className={`text-[11px] font-black transition-colors uppercase italic ${hasPermission ? 'text-indigo-900' : 'text-gray-700'}`}>
                                                            {permission.module_name}
                                                        </p>
                                                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-loose">
                                                            {permission.description}
                                                        </p>
                                                    </div>
                                                </div>
                                                {hasPermission && (
                                                    <div className="absolute -bottom-4 -right-4 w-12 h-12 bg-indigo-100/30 rounded-full flex items-center justify-center">
                                                        <Shield className="w-6 h-6 text-indigo-200" />
                                                    </div>
                                                )}
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}

                    {filteredPermissions.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-32 space-y-4">
                            <div className="w-24 h-24 bg-gray-50 rounded-[2.5rem] flex items-center justify-center border border-gray-100 shadow-inner">
                                <Search className="w-10 h-10 text-gray-300" />
                            </div>
                            <div className="text-center space-y-1">
                                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Zero Policy Discovery</h3>
                                <p className="text-[9px] font-bold text-gray-300 uppercase italic">Try broadening search parameters...</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
