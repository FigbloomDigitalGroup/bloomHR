import { useState, useEffect } from 'react';
import {
    Shield,
    Save,
    RefreshCw,
    Users,
    Search,
    LayoutDashboard,
    Building2,
    Wallet,
    Settings,
    Briefcase,
    Check,
    ChevronDown,
    Info
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { Card, Button, SearchInput } from '../UI';

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
    // What is stored in the database, so edits that are discarded really are discarded
    const [savedPermissions, setSavedPermissions] = useState<Record<string, string[]>>({});
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
            setSavedPermissions(permissionsMap);
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
            const toSave = rolePermissions[selectedRole] || [];
            const { error } = await supabase
                .from('role_permissions')
                .upsert({
                    role_name: selectedRole,
                    permissions: toSave,
                    updated_at: new Date().toISOString()
                }, {
                    // unique per tenant (FIG-515); tenant_id is stamped by the column default
                    onConflict: 'tenant_id,role_name'
                });

            if (error) throw error;

            setSavedPermissions(prev => ({ ...prev, [selectedRole]: toSave }));
            toast.success(`Permissions saved for ${selectedRole}`);
            setHasChanges(false);
        } catch (error) {
            console.error('Error saving permissions:', error);
            toast.error('Failed to save permissions');
        } finally {
            setSaving(false);
        }
    };

    const selectRole = (roleId: string) => {
        if (roleId === selectedRole) return;
        if (hasChanges) {
            if (!window.confirm('You have unsaved changes. Discard them and continue?')) return;
            // put the stored permissions back, otherwise the edits would stay on screen looking saved
            setRolePermissions(savedPermissions);
            setHasChanges(false);
        }
        setSelectedRole(roleId);
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

    const selectClass =
        'appearance-none rounded-tile border border-border bg-white pl-3 pr-8 py-2 text-xs font-semibold text-ink outline-none focus:border-brand cursor-pointer';

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center">
                    <RefreshCw className="w-8 h-8 text-brand animate-spin mb-4" />
                    <p className="text-muted-foreground font-medium text-sm">Loading permissions...</p>
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-[18px]">
                <div>
                    <div className="flex items-center gap-2.5 mb-1">
                        <Shield className="w-[19px] h-[19px] text-brand" strokeWidth={1.8} />
                        <h1 className="m-0 text-xl font-bold text-ink">Role &amp; Permissions</h1>
                    </div>
                    <p className="m-0 ml-[29px] text-xs text-muted-foreground">
                        Configure access controls and security policies for each role
                    </p>
                </div>

                {hasChanges && (
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-orange-text-alt" role="status">Unsaved changes</span>
                        <Button
                            onClick={savePermissions}
                            disabled={saving}
                            icon={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        >
                            Save Changes
                        </Button>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
                {/* Role selection */}
                <Card padding="sm" className="!p-3.5">
                    <div className="text-[10px] font-bold uppercase text-subtle mb-2 px-1.5" id="role-list-label">Select Role</div>
                    <div role="group" aria-labelledby="role-list-label" className="space-y-0.5">
                        {AVAILABLE_ROLES.map((role) => {
                            const permCount = (rolePermissions[role.id] || []).length;
                            const isSelected = selectedRole === role.id;

                            return (
                                <button
                                    type="button"
                                    key={role.id}
                                    aria-pressed={isSelected}
                                    onClick={() => selectRole(role.id)}
                                    className={`w-full text-left px-2.5 py-[9px] rounded-[9px] transition-colors flex items-center justify-between ${isSelected
                                        ? 'bg-green-tint text-brand'
                                        : 'text-ink hover:bg-background'
                                        }`}
                                >
                                    <span className={`text-[12.5px] ${isSelected ? 'font-bold' : 'font-medium'}`}>{role.name}</span>
                                    <span className="text-[10.5px] font-bold text-subtle">{permCount}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex flex-col gap-2 mt-3.5">
                        <button
                            type="button"
                            onClick={grantAllPermissions}
                            className="w-full text-center py-[9px] rounded-[9px] bg-green-tint text-brand-dark text-[11.5px] font-bold hover:bg-[#d3e6d9] transition-colors"
                        >
                            Grant All
                        </button>
                        <button
                            type="button"
                            onClick={clearAllPermissions}
                            className="w-full text-center py-[9px] rounded-[9px] bg-orange-tint-alt text-status-danger text-[11.5px] font-bold hover:bg-[#fbdcc5] transition-colors"
                        >
                            Revoke All
                        </button>
                    </div>
                </Card>

                {/* Permissions */}
                <div>
                    <div className="flex flex-wrap items-center gap-2.5 mb-[18px]">
                        <div className="flex-1 min-w-[200px]">
                            <SearchInput
                                placeholder="Search permissions..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="!bg-white !border-border"
                            />
                        </div>
                        <label className="relative inline-block">
                            <select
                                aria-label="Filter by category"
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className={selectClass}
                            >
                                <option value="all">All Categories</option>
                                {PERMISSION_CATEGORIES.map(cat => (
                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-subtle" strokeWidth={2} />
                        </label>
                        <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-subtle">
                            Copy from
                            <span className="relative inline-block normal-case">
                                <select
                                    onChange={(e) => e.target.value && copyPermissionsFrom(e.target.value)}
                                    value=""
                                    className={selectClass}
                                >
                                    <option value="">Select role...</option>
                                    {AVAILABLE_ROLES.filter(r => r.id !== selectedRole).map(role => (
                                        <option key={role.id} value={role.id}>{role.name}</option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-subtle" strokeWidth={2} />
                            </span>
                        </label>
                    </div>

                    {selectedRole === 'ADMIN' && (
                        <div className="flex items-start gap-2 p-3 mb-3.5 bg-status-info-tint rounded-xl text-xs text-status-info">
                            <Info className="w-4 h-4 shrink-0 mt-px" />
                            <span>Administrators always have access to every screen, whatever is ticked here.</span>
                        </div>
                    )}

                    <div className="space-y-3.5">
                        {filteredPermissions.length === 0 ? (
                            <Card className="flex flex-col items-center justify-center py-16 border-dashed">
                                <div className="p-3 bg-secondary rounded-full mb-3">
                                    <Search className="w-5 h-5 text-subtle" />
                                </div>
                                <h3 className="m-0 text-[13px] font-bold text-ink">No permissions found</h3>
                                <p className="m-0 text-xs text-muted-foreground">Try adjusting your search filters.</p>
                            </Card>
                        ) : (
                            PERMISSION_CATEGORIES.filter(cat =>
                                selectedCategory === 'all' || selectedCategory === cat.id
                            ).map(category => {
                                const categoryPerms = getPermissionsByCategory(category.id);
                                if (categoryPerms.length === 0) return null;
                                const Icon = CATEGORY_ICONS[category.id] || CATEGORY_ICONS['default'];

                                return (
                                    <Card key={category.id}>
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <Icon className="w-[15px] h-[15px] text-muted-foreground" strokeWidth={1.8} />
                                                <h3 className="m-0 text-[13px] font-bold text-ink">{category.name}</h3>
                                            </div>
                                            <span className="text-[11px] text-muted-foreground">
                                                {categoryPerms.filter(p => currentRolePermissions.includes(p.module_id)).length} / {categoryPerms.length} Active
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                            {categoryPerms.map(permission => {
                                                const hasPermission = currentRolePermissions.includes(permission.module_id);

                                                return (
                                                    <button
                                                        type="button"
                                                        key={permission.id}
                                                        role="switch"
                                                        aria-checked={hasPermission}
                                                        onClick={() => togglePermission(permission.module_id)}
                                                        className={`flex gap-2.5 p-3 rounded-[10px] border text-left transition-colors ${hasPermission
                                                            ? 'border-green-tint bg-[#FAFCFA]'
                                                            : 'border-border bg-white hover:bg-background'
                                                            }`}
                                                    >
                                                        <span
                                                            className={`w-[18px] h-[18px] shrink-0 rounded-[5px] flex items-center justify-center ${hasPermission ? 'bg-brand text-white' : 'border border-border bg-white'}`}
                                                            aria-hidden="true"
                                                        >
                                                            {hasPermission && <Check className="w-[11px] h-[11px]" strokeWidth={3} />}
                                                        </span>
                                                        <span>
                                                            <span className="block text-xs font-bold text-ink">{permission.module_name}</span>
                                                            <span className="block text-[10.5px] text-subtle">{permission.description}</span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </Card>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
