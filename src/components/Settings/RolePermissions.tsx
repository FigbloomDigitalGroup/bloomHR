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
    Lock,
    CalendarRange,
    Target,
    Eye
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { isHiddenModule } from '../../lib/hiddenModules';
import { Card, Button, SearchInput } from '../UI';
import { queryClient, queryKeys } from '../../lib/queryClient';
import FigbloomLoader from '../UI/FigbloomLoader';
import {
    CompanyRole,
    RoleHolders,
    SYSTEM_ROLES,
    ADMIN_ONLY_MODULES,
    fallbackRoles,
    moduleAllowedForBase,
    roleDisplayName,
    rolesApi
} from '../../lib/roles';

import { confirmDialog } from '../../lib/confirmDialog';
import { MODULE_AREAS, moduleInfo } from '../../lib/modules';
import { screensFor, usesStaffPortal } from '../../lib/routeModules';
import RoleHoldersCard from './RoleHolders';
import RolePreviewPanel from './RolePreviewPanel';
interface Permission {
    id: string;
    module_name: string;
    module_id: string;
    description: string;
    category: string;
}

const CATEGORY_ICONS: Record<string, any> = {
    'overview': LayoutDashboard,
    'workspace': Building2,
    'people': Users,
    'time': CalendarRange,
    'performance': Target,
    'pay': Wallet,
    'system': Settings,
    'default': Briefcase
};

// the modules grouped by area (src/lib/modules.ts); a module the app does not know yet goes under "Other"
const PERMISSION_CATEGORIES: { id: string; name: string; explain?: string }[] = [
    ...MODULE_AREAS,
    { id: 'other', name: 'Other' },
];
const areaOf = (moduleId: string) => moduleInfo(moduleId)?.area ?? 'other';
const explainOf = (p: { module_id: string; description: string }) => moduleInfo(p.module_id)?.explain ?? p.description;

/** Where people with this base role work: Staff use the staff portal, every other role the admin app. */
export const workspaceOf = (base: string) =>
    usesStaffPortal(base)
        ? { label: 'Staff portal', explain: 'People with this role use the staff portal, never the admin app. Ticked modules that work in the portal (Manage projects, See every task, Teams) show up there.' }
        : { label: 'Admin app', explain: 'People with this role use the admin app; the menu shows the screens their ticked modules open.' };

const inputClass =
    'w-full rounded-tile border border-border bg-white px-3 py-2 text-xs text-ink outline-none focus:border-brand';

/** Why a module cannot be ticked for a role with this base role, or null when it can. */
export const lockedReason = (base: string, moduleId: string) =>
    moduleAllowedForBase(base, moduleId)
        ? null
        : ADMIN_ONLY_MODULES.includes(moduleId)
            ? 'Only for roles based on Administrator'
            : 'Not for roles based on Staff';

/**
 * The company's roles (FIG-827): its seven standard roles, which it may rename, and roles of its own, each based on a
 * standard role, with the modules ticked here. The database decides what may be saved (no role holds more than its
 * base role may, only administrators create roles based on Administrator, a role people hold cannot be deleted).
 */
export default function RolePermissions() {
    const [roles, setRoles] = useState<CompanyRole[]>(fallbackRoles);
    const [holders, setHolders] = useState<RoleHolders>({});
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
    const [creating, setCreating] = useState(false);
    const [newRole, setNewRole] = useState({ name: '', baseRole: 'STAFF', description: '' });
    const [details, setDetails] = useState({ name: '', description: '' });
    const [busy, setBusy] = useState(false);

    const current = roles.find((r) => r.role_key === selectedRole) ?? roles[0];
    const roleName = current?.name ?? selectedRole;

    useEffect(() => {
        fetchPermissions();
        fetchRolePermissions();
        loadRoles();
    }, []);

    useEffect(() => {
        setDetails({ name: current?.name ?? '', description: current?.description ?? '' });
    }, [current?.role_key, current?.name, current?.description]);

    const loadRoles = async () => {
        const [list, counts] = await Promise.all([rolesApi.list(), rolesApi.holders()]);
        setRoles(list);
        setHolders(counts);
        return list;
    };

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
        if (current && lockedReason(current.base_role, moduleId)) return;
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
            if (current && !current.is_system && current.id) {
                // a company's own role: through the database function, which checks what the role may hold
                await rolesApi.setModules(current.id, toSave);
            } else {
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
            }

            setSavedPermissions(prev => ({ ...prev, [selectedRole]: toSave }));
            // the sidebar reads the signed-in user's permissions from the shared cache: refresh them now
            queryClient.invalidateQueries({ queryKey: queryKeys.myPermissions });
            toast.success(`Permissions saved for ${roleName}`);
            setHasChanges(false);
        } catch (error) {
            console.error('Error saving permissions:', error);
            const reason = (error as Error)?.message;
            toast.error(reason ? `Failed to save permissions: ${reason}` : 'Failed to save permissions');
        } finally {
            setSaving(false);
        }
    };

    const confirmDiscard = async () => {
        if (!hasChanges) return true;
        if (!(await confirmDialog({ title: 'Discard your unsaved changes?', confirmLabel: 'Discard', tone: 'danger' }))) return false;
        // put the stored permissions back, otherwise the edits would stay on screen looking saved
        setRolePermissions(savedPermissions);
        setHasChanges(false);
        return true;
    };

    const selectRole = async (roleKey: string) => {
        if (roleKey === selectedRole && !creating) return;
        // (asked only when there are changes, so a plain switch happens at once)
        if (hasChanges && !(await confirmDiscard())) return;
        setCreating(false);
        setSelectedRole(roleKey);
    };

    const copyPermissionsFrom = async (sourceRole: string) => {
        const sourceName = roles.find((r) => r.role_key === sourceRole)?.name ?? roleDisplayName(roles, sourceRole);
        if (await confirmDialog({ title: `Copy all permissions from ${sourceName} to ${roleName}?`, confirmLabel: 'Copy' })) {
            setRolePermissions(prev => ({
                ...prev,
                // only what this role may hold
                [selectedRole]: (prev[sourceRole] || []).filter((m) => !current || !lockedReason(current.base_role, m))
            }));
            setHasChanges(true);
            toast.success(`Permissions copied from ${sourceName}`);
        }
    };

    const clearAllPermissions = async () => {
        if (await confirmDialog({ title: `Remove all permissions for ${roleName}?`, confirmLabel: 'Remove all', tone: 'danger' })) {
            setRolePermissions(prev => ({
                ...prev,
                [selectedRole]: []
            }));
            setHasChanges(true);
            toast.success('All permissions cleared');
        }
    };

    const grantAllPermissions = async () => {
        if (await confirmDialog({ title: `Grant all permissions to ${roleName}?`, confirmLabel: 'Grant all' })) {
            setRolePermissions(prev => ({
                ...prev,
                [selectedRole]: permissions.map(p => p.module_id).filter((m) => !current || !lockedReason(current.base_role, m))
            }));
            setHasChanges(true);
            toast.success('All permissions granted');
        }
    };

    const startCreating = async () => {
        if (hasChanges && !(await confirmDiscard())) return;
        setNewRole({ name: '', baseRole: 'STAFF', description: '' });
        setCreating(true);
    };

    const createRole = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            // it starts with its base role's modules, as far as it may hold them; untick what it should not have
            const modules = (rolePermissions[newRole.baseRole] || []).filter((m) => moduleAllowedForBase(newRole.baseRole, m));
            const id = await rolesApi.create({ name: newRole.name.trim(), baseRole: newRole.baseRole, description: newRole.description.trim() || null, modules });
            const list = await loadRoles();
            const created = list.find((r) => r.id === id);
            if (created) {
                setRolePermissions((prev) => ({ ...prev, [created.role_key]: modules }));
                setSavedPermissions((prev) => ({ ...prev, [created.role_key]: modules }));
                setSelectedRole(created.role_key);
            }
            setCreating(false);
            toast.success(`Role "${newRole.name.trim()}" created`);
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const saveDetails = async (e: FormEvent) => {
        e.preventDefault();
        if (!current?.id) return;
        setBusy(true);
        try {
            await rolesApi.update(current.id, { name: details.name.trim(), description: details.description.trim() });
            await loadRoles();
            queryClient.invalidateQueries({ queryKey: queryKeys.myPermissions });
            toast.success('Role saved');
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const setActive = async (active: boolean) => {
        if (!current?.id) return;
        setBusy(true);
        try {
            await rolesApi.update(current.id, { active });
            await loadRoles();
            toast.success(active ? `${current.name} switched on` : `${current.name} switched off: it can no longer be given`);
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const deleteRole = async () => {
        if (!current?.id) return;
        if (!(await confirmDialog({ title: `Delete the role ${current.name}?`, message: 'Invitations not yet accepted with this role will give its base role instead.', confirmLabel: 'Delete', tone: 'danger' }))) return;
        setBusy(true);
        try {
            await rolesApi.remove(current.id);
            await loadRoles();
            setHasChanges(false);
            setSelectedRole('ADMIN');
            toast.success('Role deleted');
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const filteredPermissions = permissions.filter(p => {
        const matchesSearch = p.module_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            explainOf(p).toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || areaOf(p.module_id) === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    const currentRolePermissions = rolePermissions[selectedRole] || [];
    const people = holders[selectedRole] ?? 0;

    const getPermissionsByCategory = (category: string) => {
        return filteredPermissions.filter(p => areaOf(p.module_id) === category);
    };

    const selectClass =
        'appearance-none rounded-tile border border-border bg-white pl-3 pr-8 py-2 text-xs font-semibold text-ink outline-none focus:border-brand cursor-pointer';

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <FigbloomLoader label="Loading permissions" />
            </div>
        );
    }

    const systemRoles = roles.filter((r) => r.is_system);
    const ownRoles = roles.filter((r) => !r.is_system);

    const roleButton = (role: CompanyRole) => {
        const permCount = (rolePermissions[role.role_key] || []).length;
        const isSelected = !creating && selectedRole === role.role_key;
        return (
            <button
                type="button"
                key={role.role_key}
                aria-pressed={isSelected}
                onClick={() => selectRole(role.role_key)}
                className={`w-full text-left px-2.5 py-[9px] rounded-[9px] transition-colors flex items-center justify-between gap-2 ${isSelected
                    ? 'bg-green-tint text-brand'
                    : 'text-ink hover:bg-background'
                    }`}
            >
                <span className={`text-[12.5px] truncate ${isSelected ? 'font-bold' : 'font-medium'} ${role.active ? '' : 'line-through opacity-60'}`}>{role.name}</span>
                <span className="text-[10.5px] font-bold text-subtle">{permCount}</span>
            </button>
        );
    };

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
                        Your company&apos;s roles and what each may use. Create roles of your own, each based on a standard role.
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
                    <div className="text-[10px] font-bold uppercase text-subtle mb-2 px-1.5" id="role-list-label">Standard roles</div>
                    <div role="group" aria-labelledby="role-list-label" className="space-y-0.5">
                        {systemRoles.map(roleButton)}
                    </div>

                    <div className="text-[10px] font-bold uppercase text-subtle mt-3.5 mb-2 px-1.5" id="own-role-list-label">Your roles</div>
                    <div role="group" aria-labelledby="own-role-list-label" className="space-y-0.5">
                        {ownRoles.length === 0 && <p className="m-0 px-1.5 text-[11px] text-muted-foreground">None yet, e.g. Supervisors or Operators.</p>}
                        {ownRoles.map(roleButton)}
                    </div>
                    <button
                        type="button"
                        onClick={startCreating}
                        className="mt-2 w-full flex items-center justify-center gap-1.5 py-[9px] rounded-[9px] border border-dashed border-border text-[11.5px] font-bold text-brand hover:bg-background"
                    >
                        <Plus className="w-3.5 h-3.5" /> New role
                    </button>

                    {!creating && (
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

                {creating ? (
                    <Card>
                        <form onSubmit={createRole} className="space-y-3" aria-label="New role">
                            <h2 className="m-0 text-[14px] font-bold text-ink">New role</h2>
                            <label className="block">
                                <span className="block text-[11.5px] font-semibold text-muted-foreground mb-1">Name</span>
                                <input required maxLength={60} value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} placeholder="e.g. Supervisors" className={inputClass} />
                            </label>
                            <label className="block">
                                <span className="block text-[11.5px] font-semibold text-muted-foreground mb-1">Based on</span>
                                <select value={newRole.baseRole} onChange={(e) => setNewRole({ ...newRole, baseRole: e.target.value })} className={inputClass}>
                                    {SYSTEM_ROLES.map((r) => (
                                        <option key={r} value={r}>{roleDisplayName(roles, r)}</option>
                                    ))}
                                </select>
                                <span className="block mt-1 text-[11px] text-muted-foreground">
                                    People with this role work as the standard role does (staff use the staff portal, for example) and get at most what it may hold:
                                    only roles based on Administrator get Settings and Role Permissions; roles based on Staff never get Payroll and the other powers over pay and
                                    people&apos;s records, but can get tasks and projects. Only an administrator can create a role based on Administrator.
                                </span>
                            </label>
                            <label className="block">
                                <span className="block text-[11.5px] font-semibold text-muted-foreground mb-1">Description (optional)</span>
                                <input maxLength={300} value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} className={inputClass} />
                            </label>
                            <p className="m-0 text-[11px] text-muted-foreground">It starts with the permissions of the role it is based on; change them once it is created.</p>
                            <div className="flex gap-2">
                                <Button type="submit" disabled={busy || !newRole.name.trim()}>{busy ? 'Creating…' : 'Create role'}</Button>
                                <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
                            </div>
                        </form>
                    </Card>
                ) : (
                <div>
                    {current && (
                        <Card className="mb-3.5">
                            <form onSubmit={saveDetails} className="flex flex-wrap items-end gap-2.5" aria-label="Role details">
                                <label className="flex-1 min-w-[160px]">
                                    <span className="block text-[11px] font-semibold text-muted-foreground mb-1">{current.is_system ? 'Shown as' : 'Name'}</span>
                                    <input aria-label="Role name" required maxLength={60} disabled={!current.id} value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} className={inputClass} />
                                </label>
                                <label className="flex-[2] min-w-[200px]">
                                    <span className="block text-[11px] font-semibold text-muted-foreground mb-1">Description</span>
                                    <input aria-label="Role description" maxLength={300} disabled={!current.id} value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} className={inputClass} />
                                </label>
                                <Button type="submit" variant="secondary" disabled={busy || !current.id || (details.name === current.name && details.description === (current.description ?? ''))}>
                                    Save details
                                </Button>
                            </form>
                            <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 text-[11.5px] text-muted-foreground">
                                <span>
                                    {current.is_system ? 'A standard role' : `Based on ${roleDisplayName(roles, current.base_role)}`}
                                    {' · '}
                                    {people === 1 ? '1 person has it' : `${people} people have it`}
                                    {!current.active && ' · switched off'}
                                </span>
                                {!current.is_system && current.id && (
                                    <span className="flex gap-2">
                                        <Button type="button" variant="secondary" disabled={busy || (current.active && people > 0)} onClick={() => setActive(!current.active)}>
                                            {current.active ? 'Switch off' : 'Switch on'}
                                        </Button>
                                        <Button type="button" variant="secondary" disabled={busy || people > 0} onClick={deleteRole}>
                                            Delete role
                                        </Button>
                                    </span>
                                )}
                            </div>
                            {!current.is_system && people > 0 && (
                                <p className="m-0 mt-1.5 text-[11px] text-muted-foreground">To delete or switch off this role, first give the people who have it another role (Change role, under Who has {current.name}).</p>
                            )}
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
                        <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-subtle">
                            Copy from
                            <span className="relative inline-block normal-case">
                                <select
                                    onChange={(e) => e.target.value && copyPermissionsFrom(e.target.value)}
                                    value=""
                                    className={selectClass}
                                >
                                    <option value="">Select role...</option>
                                    {roles.filter(r => r.role_key !== selectedRole).map(role => (
                                        <option key={role.role_key} value={role.role_key}>{role.name}</option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-subtle" strokeWidth={2} />
                            </span>
                        </label>
                    </div>

                    {current && <RoleSummary role={current} modules={currentRolePermissions} />}

                    {/* the menu a holder would get, from the ticks on screen (saved or not) */}
                    {current && <RolePreviewPanel role={current} modules={currentRolePermissions} />}

                    {/* the people who hold it, each of whom can be given another role */}
                    {current && <RoleHoldersCard role={current} roles={roles} count={people} onChanged={loadRoles} />}

                    {current?.base_role === 'ADMIN' && (
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
                                                {category.explain && <span className="hidden sm:inline text-[11px] text-muted-foreground">{category.explain}</span>}
                                            </div>
                                            <span className="text-[11px] text-muted-foreground">
                                                {categoryPerms.filter(p => currentRolePermissions.includes(p.module_id)).length} / {categoryPerms.length} Active
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                            {categoryPerms.map(permission => {
                                                const hasPermission = currentRolePermissions.includes(permission.module_id);
                                                const locked = current ? lockedReason(current.base_role, permission.module_id) : null;

                                                return (
                                                    <button
                                                        type="button"
                                                        key={permission.id}
                                                        role="switch"
                                                        aria-checked={hasPermission}
                                                        aria-disabled={locked ? true : undefined}
                                                        title={locked ?? undefined}
                                                        onClick={() => togglePermission(permission.module_id)}
                                                        className={`flex gap-2.5 p-3 rounded-[10px] border text-left transition-colors ${locked ? 'border-border bg-background opacity-60 cursor-not-allowed' : hasPermission
                                                            ? 'border-green-tint bg-gray-50'
                                                            : 'border-border bg-white hover:bg-background'
                                                            }`}
                                                    >
                                                        <span
                                                            className={`w-[18px] h-[18px] shrink-0 rounded-[5px] flex items-center justify-center ${hasPermission ? 'bg-brand text-white' : 'border border-border bg-white'}`}
                                                            aria-hidden="true"
                                                        >
                                                            {locked ? <Lock className="w-[10px] h-[10px] text-subtle" /> : hasPermission && <Check className="w-[11px] h-[11px]" strokeWidth={3} />}
                                                        </span>
                                                        <span>
                                                            <span className="block text-xs font-bold text-ink">{permission.module_name}</span>
                                                            <span className="block text-[10.5px] text-subtle">{explainOf(permission)}</span>
                                                            {locked && (
                                                                <span className="mt-0.5 flex items-center gap-1 text-[10.5px] font-semibold text-orange-text-alt">
                                                                    <Lock className="w-[10px] h-[10px]" aria-hidden="true" /> {locked}
                                                                </span>
                                                            )}
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
                )}
            </div>
        </div>
    );
}

/** Why a module is locked for a role, in full: shown above the modules of a role that has locked ones. */
const LOCK_RULES: Record<string, string> = {
    admin: 'Settings and Role Permissions can only be given to roles based on Administrator: whoever holds them could give themselves everything else.',
    staff: 'Roles based on Staff never get Payroll, pay and loans, approving sign-ups, assigning managers, HR Lifecycle, exits, HR administration or sign-in security: the powers over money and other people\'s records.',
};

/**
 * "What can this role do": where its people work (staff portal or admin app), the screens its ticked modules open,
 * and the modules it cannot hold, with why.
 */
export function RoleSummary({ role, modules }: { role: CompanyRole; modules: string[] }) {
    const isAdmin = role.base_role === 'ADMIN';
    const held = (m: string) => isAdmin || (modules.includes(m) && !lockedReason(role.base_role, m));
    const where = workspaceOf(role.base_role);
    const screens = usesStaffPortal(role.base_role) ? [] : screensFor(held);
    const portalExtras = [
        held('task-projects') && 'Manage projects (create projects, assign tasks to teams)',
        held('task-oversight') && 'See every task, read-only',
        held('teams') && 'Teams chat',
        held('task-manager') && 'Their tasks',
    ].filter(Boolean) as string[];
    const locks = [
        role.base_role !== 'ADMIN' && LOCK_RULES.admin,
        role.base_role === 'STAFF' && LOCK_RULES.staff,
    ].filter(Boolean) as string[];
    return (
        <Card className="mb-3.5" aria-label="What this role can do">
            <div className="flex flex-wrap items-center gap-2 mb-2">
                <Eye className="w-[15px] h-[15px] text-muted-foreground" strokeWidth={1.8} />
                <h3 className="m-0 text-[13px] font-bold text-ink">What {role.name} can do</h3>
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${usesStaffPortal(role.base_role) ? 'bg-orange-tint-alt text-orange-text-alt' : 'bg-green-tint text-brand-dark'}`}>
                    {where.label}
                </span>
            </div>
            <p className="m-0 mb-2 text-[11.5px] text-muted-foreground">{where.explain}</p>
            {usesStaffPortal(role.base_role) ? (
                <ul className="m-0 pl-4 text-xs text-ink list-disc" aria-label="In the staff portal">
                    <li>Their own profile, leave, payslips and requests</li>
                    {portalExtras.map((x) => <li key={x}>{x}</li>)}
                </ul>
            ) : isAdmin ? (
                <p className="m-0 text-xs text-ink">Every screen and every action, whatever is ticked.</p>
            ) : screens.length === 0 ? (
                <p className="m-0 text-xs text-ink">No screens yet: tick modules below.</p>
            ) : (
                <ul className="m-0 flex flex-wrap gap-1.5 p-0 list-none" aria-label="Screens it opens">
                    {screens.map((s) => (
                        <li key={s.path} className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-ink">{s.label}</li>
                    ))}
                </ul>
            )}
            {locks.length > 0 && (
                <div className="mt-2.5 space-y-1">
                    {locks.map((l) => (
                        <p key={l} className="m-0 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                            <Lock className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" /> {l}
                        </p>
                    ))}
                </div>
            )}
        </Card>
    );
}
