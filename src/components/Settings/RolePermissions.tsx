import { useState, useEffect, FormEvent } from 'react';
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
    Info,
    Plus,
    Pencil,
    Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { isHiddenModule } from '../../lib/hiddenModules';
import { Card, Button, SearchInput } from '../UI';
import { queryClient, queryKeys } from '../../lib/queryClient';
import FigbloomLoader from '../UI/FigbloomLoader';

interface Permission {
    id: string;
    module_name: string;
    module_id: string;
    description: string;
    category: string;
}

/**
 * A role of the company (FIG-827, 20261015300000_company_roles.sql). `role_name` is its key, what people's
 * memberships hold, and never changes; renaming changes `display_name`. ADMIN and STAFF are built in (is_system).
 */
interface CompanyRole {
    role_name: string;
    display_name: string | null;
    description: string | null;
    is_system: boolean;
    permissions: string[] | null;
}

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

// the administrator first, staff next, then the company's other roles by name
const roleOrder = (r: CompanyRole) => (r.role_name === 'ADMIN' ? 0 : r.role_name === 'STAFF' ? 1 : 2);
const sortRoles = (roles: CompanyRole[]) =>
    [...roles].sort((a, b) => roleOrder(a) - roleOrder(b) || (a.display_name || a.role_name).localeCompare(b.display_name || b.role_name));

/** Supabase errors are plain objects: the database's own message says why (e.g. a module you do not have). */
const reason = (error: unknown) =>
    typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : 'Please try again.';

export default function RolePermissions() {
    const [roles, setRoles] = useState<CompanyRole[]>([]);
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
    // the open form, if any: a new role, renaming the selected one, or deleting it
    const [form, setForm] = useState<null | 'new' | 'rename' | 'delete'>(null);
    const [formName, setFormName] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [replacement, setReplacement] = useState('');
    const [busy, setBusy] = useState(false);

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
            setPermissions((data || []).filter(p => !isHiddenModule(p.module_id)));
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
                .select('role_name, display_name, description, is_system, permissions');

            if (error) throw error;

            const permissionsMap: Record<string, string[]> = {};
            (data || []).forEach((rp: CompanyRole) => {
                permissionsMap[rp.role_name] = rp.permissions || [];
            });

            setRoles(sortRoles((data || []) as CompanyRole[]));
            setRolePermissions(permissionsMap);
            setSavedPermissions(permissionsMap);
        } catch (error) {
            console.error('Error fetching role permissions:', error);
            toast.error('Failed to load role permissions');
        } finally {
            setLoading(false);
        }
    };

    const role = roles.find(r => r.role_name === selectedRole);
    const roleName = (key: string) => roles.find(r => r.role_name === key)?.display_name || key;
    const selectedName = roleName(selectedRole);
    // ADMIN always has every module; nothing about it can be changed
    const locked = selectedRole === 'ADMIN';

    const togglePermission = (moduleId: string) => {
        if (locked) return;
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
            // tenant_id comes from the row (one per company, FIG-515); the database refuses modules you lack yourself
            const { data, error } = await supabase
                .from('role_permissions')
                .update({ permissions: toSave, updated_at: new Date().toISOString() })
                .eq('role_name', selectedRole)
                .select('role_name');

            if (error) throw error;
            if (!data || data.length === 0) throw { message: 'You cannot change this role.' };

            setSavedPermissions(prev => ({ ...prev, [selectedRole]: toSave }));
            // the sidebar reads the signed-in user's permissions from the shared cache: refresh them now
            queryClient.invalidateQueries({ queryKey: queryKeys.myPermissions });
            toast.success(`Permissions saved for ${selectedName}`);
            setHasChanges(false);
        } catch (error) {
            console.error('Error saving permissions:', error);
            toast.error(`Failed to save permissions: ${reason(error)}`);
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
        setForm(null);
        setSelectedRole(roleId);
    };

    const openForm = (which: 'new' | 'rename' | 'delete') => {
        if (hasChanges && !window.confirm('You have unsaved changes. Discard them and continue?')) return;
        if (hasChanges) {
            setRolePermissions(savedPermissions);
            setHasChanges(false);
        }
        setForm(which);
        setFormName(which === 'rename' ? role?.display_name || '' : '');
        setFormDescription(which === 'rename' ? role?.description || '' : '');
        setReplacement('');
    };

    const createRole = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const { data, error } = await supabase.rpc('create_company_role', {
                p_name: formName.trim(),
                p_description: formDescription.trim() || null,
                p_permissions: [],
            });
            if (error) throw error;
            toast.success(`Role "${formName.trim()}" created. Choose its modules.`);
            setForm(null);
            await fetchRolePermissions();
            setSelectedRole(String(data));
        } catch (error) {
            toast.error(`Could not create the role: ${reason(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const renameRole = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const { data, error } = await supabase
                .from('role_permissions')
                .update({ display_name: formName.trim(), description: formDescription.trim() || null, updated_at: new Date().toISOString() })
                .eq('role_name', selectedRole)
                .select('role_name');
            if (error) throw error;
            if (!data || data.length === 0) throw { message: 'You cannot change this role.' };
            toast.success('Role renamed');
            setForm(null);
            await fetchRolePermissions();
        } catch (error) {
            toast.error(`Could not rename the role: ${reason(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const deleteRole = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const { data, error } = await supabase.rpc('delete_company_role', {
                p_role: selectedRole,
                p_replacement: replacement || null,
            });
            if (error) throw error;
            const moved = Number(data) || 0;
            toast.success(moved ? `Role deleted. ${moved} ${moved === 1 ? 'person was' : 'people were'} moved to ${roleName(replacement)}.` : 'Role deleted');
            setForm(null);
            setSelectedRole(replacement || 'ADMIN');
            await fetchRolePermissions();
            queryClient.invalidateQueries({ queryKey: queryKeys.myPermissions });
        } catch (error) {
            toast.error(`Could not delete the role: ${reason(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const copyPermissionsFrom = async (sourceRole: string) => {
        if (window.confirm(`Copy all permissions from ${roleName(sourceRole)} to ${selectedName}?`)) {
            setRolePermissions(prev => ({
                ...prev,
                [selectedRole]: [...(prev[sourceRole] || [])]
            }));
            setHasChanges(true);
            toast.success(`Permissions copied from ${roleName(sourceRole)}`);
        }
    };

    const clearAllPermissions = () => {
        if (window.confirm(`Remove all permissions for ${selectedName}?`)) {
            setRolePermissions(prev => ({
                ...prev,
                [selectedRole]: []
            }));
            setHasChanges(true);
            toast.success('All permissions cleared');
        }
    };

    const grantAllPermissions = () => {
        if (window.confirm(`Grant all permissions to ${selectedName}?`)) {
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
    const inputClass =
        'w-full px-3 py-2 rounded-tile border border-border text-[12.5px] text-ink bg-white focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand';
    const linkButtonClass = 'inline-flex items-center gap-1 text-[11.5px] font-bold disabled:opacity-50';

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <FigbloomLoader label="Loading permissions" />
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
                        Your company's roles and what each can use. Add your own roles, rename them, or remove ones you no longer need.
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
                    <div className="flex items-center justify-between mb-2 px-1.5">
                        <div className="text-[10px] font-bold uppercase text-subtle" id="role-list-label">Select Role</div>
                        <button type="button" onClick={() => openForm('new')} className={`${linkButtonClass} text-brand`}>
                            <Plus className="w-3 h-3" strokeWidth={2.5} /> New role
                        </button>
                    </div>
                    <div role="group" aria-labelledby="role-list-label" className="space-y-0.5">
                        {roles.map((r) => {
                            const permCount = (rolePermissions[r.role_name] || []).length;
                            const isSelected = selectedRole === r.role_name;

                            return (
                                <button
                                    type="button"
                                    key={r.role_name}
                                    aria-pressed={isSelected}
                                    onClick={() => selectRole(r.role_name)}
                                    className={`w-full text-left px-2.5 py-[9px] rounded-[9px] transition-colors flex items-center justify-between ${isSelected
                                        ? 'bg-green-tint text-brand'
                                        : 'text-ink hover:bg-background'
                                        }`}
                                >
                                    <span className={`text-[12.5px] ${isSelected ? 'font-bold' : 'font-medium'}`}>{r.display_name || r.role_name}</span>
                                    <span className="text-[10.5px] font-bold text-subtle">{r.role_name === 'ADMIN' ? 'All' : permCount}</span>
                                </button>
                            );
                        })}
                    </div>

                    {!locked && (
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
                    )}
                </Card>

                {/* Permissions */}
                <div>
                    {form === 'new' && (
                        <Card className="mb-3.5">
                            <form onSubmit={createRole} aria-label="New role" className="flex flex-wrap items-end gap-3">
                                <label className="flex-1 min-w-[180px]">
                                    <span className="block text-[11.5px] font-semibold text-muted-foreground mb-1">Role name</span>
                                    <input required minLength={2} maxLength={60} value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Field Officer" className={inputClass} />
                                </label>
                                <label className="flex-[2] min-w-[200px]">
                                    <span className="block text-[11.5px] font-semibold text-muted-foreground mb-1">Description (optional)</span>
                                    <input maxLength={200} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className={inputClass} />
                                </label>
                                <Button type="submit" disabled={busy || formName.trim().length < 2}>Create role</Button>
                                <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
                            </form>
                        </Card>
                    )}

                    {role && (
                        <div className="flex flex-wrap items-start justify-between gap-3 mb-3.5">
                            <div>
                                <h2 className="m-0 text-[15px] font-bold text-ink">{selectedName}</h2>
                                {role.description && <p className="m-0 text-[11.5px] text-muted-foreground">{role.description}</p>}
                                {role.is_system && <p className="m-0 text-[10.5px] font-semibold text-subtle">Built in</p>}
                            </div>
                            {!locked && (
                                <div className="flex items-center gap-3">
                                    <button type="button" onClick={() => openForm('rename')} className={`${linkButtonClass} text-ink`}>
                                        <Pencil className="w-3 h-3" /> Rename
                                    </button>
                                    {!role.is_system && (
                                        <button type="button" onClick={() => openForm('delete')} className={`${linkButtonClass} text-status-danger`}>
                                            <Trash2 className="w-3 h-3" /> Delete role
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {form === 'rename' && !locked && (
                        <Card className="mb-3.5">
                            <form onSubmit={renameRole} aria-label="Rename role" className="flex flex-wrap items-end gap-3">
                                <label className="flex-1 min-w-[180px]">
                                    <span className="block text-[11.5px] font-semibold text-muted-foreground mb-1">Role name</span>
                                    <input required minLength={2} maxLength={60} value={formName} onChange={(e) => setFormName(e.target.value)} className={inputClass} />
                                </label>
                                <label className="flex-[2] min-w-[200px]">
                                    <span className="block text-[11.5px] font-semibold text-muted-foreground mb-1">Description (optional)</span>
                                    <input maxLength={200} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className={inputClass} />
                                </label>
                                <Button type="submit" disabled={busy || formName.trim().length < 2}>Save name</Button>
                                <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
                            </form>
                            <p className="m-0 mt-2 text-[11px] text-muted-foreground">People in this role keep it: only its name changes.</p>
                        </Card>
                    )}

                    {form === 'delete' && role && !role.is_system && (
                        <Card className="mb-3.5">
                            <form onSubmit={deleteRole} aria-label="Delete role" className="flex flex-wrap items-end gap-3">
                                <label className="flex-1 min-w-[220px]">
                                    <span className="block text-[11.5px] font-semibold text-muted-foreground mb-1">
                                        Move anyone in {selectedName} (and their open invitations) to
                                    </span>
                                    <span className="relative block">
                                        <select value={replacement} onChange={(e) => setReplacement(e.target.value)} className={`${selectClass} w-full`}>
                                            <option value="">Nobody is in this role</option>
                                            {roles.filter(r => r.role_name !== selectedRole).map(r => (
                                                <option key={r.role_name} value={r.role_name}>{r.display_name || r.role_name}</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-subtle" strokeWidth={2} />
                                    </span>
                                </label>
                                <Button type="submit" disabled={busy}>Delete {selectedName}</Button>
                                <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
                            </form>
                            <p className="m-0 mt-2 text-[11px] text-muted-foreground">A role that people still have cannot be deleted until they are moved to another one.</p>
                        </Card>
                    )}

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
                        {!locked && (
                            <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-subtle">
                                Copy from
                                <span className="relative inline-block normal-case">
                                    <select
                                        onChange={(e) => e.target.value && copyPermissionsFrom(e.target.value)}
                                        value=""
                                        className={selectClass}
                                    >
                                        <option value="">Select role...</option>
                                        {roles.filter(r => r.role_name !== selectedRole && r.role_name !== 'ADMIN').map(r => (
                                            <option key={r.role_name} value={r.role_name}>{r.display_name || r.role_name}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-subtle" strokeWidth={2} />
                                </span>
                            </label>
                        )}
                    </div>

                    {locked && (
                        <div className="flex items-start gap-2 p-3 mb-3.5 bg-status-info-tint rounded-xl text-xs text-status-info">
                            <Info className="w-4 h-4 shrink-0 mt-px" />
                            <span>Administrators always have access to every screen. This role is built in and cannot be changed or deleted.</span>
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
                                                {locked ? categoryPerms.length : categoryPerms.filter(p => currentRolePermissions.includes(p.module_id)).length} / {categoryPerms.length} Active
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                            {categoryPerms.map(permission => {
                                                const hasPermission = locked || currentRolePermissions.includes(permission.module_id);

                                                return (
                                                    <button
                                                        type="button"
                                                        key={permission.id}
                                                        role="switch"
                                                        aria-checked={hasPermission}
                                                        disabled={locked}
                                                        onClick={() => togglePermission(permission.module_id)}
                                                        className={`flex gap-2.5 p-3 rounded-[10px] border text-left transition-colors disabled:cursor-not-allowed ${hasPermission
                                                            ? 'border-green-tint bg-gray-50'
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
