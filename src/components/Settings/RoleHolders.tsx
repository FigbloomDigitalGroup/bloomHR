import { useEffect, useMemo, useState } from 'react';
import { MapPin, RefreshCw, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { Card, Button, Modal, SearchInput, StatusPill } from '../UI';
import { CompanyRole, RoleHolder, roleDisplayName, rolesApi } from '../../lib/roles';

/** How many people are listed before "Show all" (the Staff role can have hundreds). */
export const HOLDERS_SHOWN = 50;

const holderName = (h: RoleHolder) => h.full_name ?? h.email ?? 'Someone without a name or email';

const selectClass =
    'w-full rounded-tile border border-border bg-white px-3 py-2 text-xs text-ink outline-none focus:border-brand';

/** The signed-in person's id, to keep them from changing their own role (the database refuses it too). */
async function myUserId(): Promise<string | null> {
    try {
        if (typeof supabase.auth?.getUser !== 'function') return null;
        const { data } = await supabase.auth.getUser();
        return data?.user?.id ?? null;
    } catch {
        return null;
    }
}

interface RoleHoldersProps {
    role: CompanyRole;
    roles: CompanyRole[];
    /** how many hold it (company_role_holders), shown while the list loads */
    count: number;
    /** after someone's role was changed: reload the counts */
    onChanged?: () => void | Promise<unknown>;
}

/**
 * "Who has this role" on the Roles screen: the people who hold the selected role, with their email and location, and a
 * way to give each another role. The change goes through rolesApi.assign (assign_company_role), as on User Roles: the
 * database checks who may give which role, refuses a change to your own role, and records it in the audit trail.
 */
export default function RoleHolders({ role, roles, count, onChanged }: RoleHoldersProps) {
    const [holders, setHolders] = useState<RoleHolder[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState<string | null>(null);
    const [me, setMe] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [showAll, setShowAll] = useState(false);
    const [changing, setChanging] = useState<RoleHolder | null>(null);
    const [pick, setPick] = useState('');
    const [saving, setSaving] = useState(false);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let live = true;
        myUserId().then((id) => live && setMe(id));
        return () => {
            live = false;
        };
    }, []);

    useEffect(() => {
        let live = true;
        setLoading(true);
        setFailed(null);
        setShowAll(false);
        setQuery('');
        rolesApi
            .holderList(role.role_key)
            .then((list) => live && setHolders(list))
            .catch((err) => {
                if (!live) return;
                setHolders([]);
                setFailed((err as Error).message);
            })
            .finally(() => live && setLoading(false));
        return () => {
            live = false;
        };
    }, [role.role_key, reload]);

    // the roles someone can be moved to: switched on, saved in the database (they have an id), not this one
    const targets = useMemo(() => roles.filter((r) => r.active && r.id && r.role_key !== role.role_key), [roles, role.role_key]);
    const baseName = (r: CompanyRole) => roleDisplayName(roles, r.base_role);

    const q = query.trim().toLowerCase();
    const matching = q
        ? holders.filter((h) => [h.full_name, h.email, h.location].some((v) => v?.toLowerCase().includes(q)))
        : holders;
    const visible = showAll ? matching : matching.slice(0, HOLDERS_SHOWN);

    const openChange = (h: RoleHolder) => {
        setPick('');
        setChanging(h);
    };

    const changeRole = async () => {
        const target = targets.find((r) => r.role_key === pick);
        if (!changing || !target?.id) return;
        setSaving(true);
        try {
            await rolesApi.assign(changing.user_id, target.id);
            toast.success(`${holderName(changing)} now has the role ${target.name}`);
            setHolders((prev) => prev.filter((h) => h.user_id !== changing.user_id));
            setChanging(null);
            await onChanged?.();
        } catch (err) {
            toast.error((err as Error).message || 'Could not change the role');
        } finally {
            setSaving(false);
        }
    };

    const picked = targets.find((r) => r.role_key === pick);
    const people = loading ? count : holders.length;

    return (
        <Card className="mb-3.5" aria-label="Who has this role">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                    <Users className="w-[15px] h-[15px] text-muted-foreground" strokeWidth={1.8} />
                    <h3 className="m-0 text-[13px] font-bold text-ink">Who has {role.name}</h3>
                    <span className="text-[11px] text-muted-foreground">{people === 1 ? '1 person' : `${people} people`}</span>
                </div>
                {holders.length > 10 && (
                    <div className="w-full sm:w-56">
                        <SearchInput
                            aria-label="Search the people with this role"
                            placeholder="Search by name, email or location"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="!bg-white !border-border"
                        />
                    </div>
                )}
            </div>

            {loading ? (
                <p className="m-0 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                    <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" /> Loading the people with this role…
                </p>
            ) : failed ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-status-danger" role="alert">
                    <span>Could not load the people with this role: {failed}</span>
                    <Button variant="secondary" onClick={() => setReload((n) => n + 1)}>Try again</Button>
                </div>
            ) : holders.length === 0 ? (
                <p className="m-0 text-xs text-muted-foreground">Nobody has this role yet. Give it to someone here from another role, or on Settings, User Roles.</p>
            ) : matching.length === 0 ? (
                <p className="m-0 text-xs text-muted-foreground">Nobody with this role matches “{query}”.</p>
            ) : (
                <>
                    <ul className="m-0 p-0 list-none divide-y divide-border" aria-label={`People with ${role.name}`}>
                        {visible.map((h) => {
                            const name = holderName(h);
                            const isMe = !!me && me === h.user_id;
                            return (
                                <li key={h.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                    <div className="min-w-0">
                                        <p className="m-0 text-xs font-bold text-ink truncate">
                                            {name}
                                            {isMe && <span className="ml-1.5 text-[10.5px] font-semibold text-subtle">(you)</span>}
                                        </p>
                                        <p className="m-0 flex flex-wrap items-center gap-x-2 text-[10.5px] text-subtle">
                                            {h.full_name && h.email && <span className="truncate">{h.email}</span>}
                                            <span className="inline-flex items-center gap-0.5">
                                                <MapPin className="w-[10px] h-[10px]" aria-hidden="true" /> {h.location ?? 'No location'}
                                            </span>
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {h.account_status && h.account_status !== 'ACTIVE' && (
                                            <StatusPill label={h.account_status === 'SUSPENDED' ? 'Suspended' : 'Deactivated'} tone={h.account_status === 'SUSPENDED' ? 'warning' : 'danger'} />
                                        )}
                                        <Button
                                            variant="secondary"
                                            aria-label={`Change role for ${name}`}
                                            title={isMe ? 'You cannot change your own role' : undefined}
                                            disabled={isMe || targets.length === 0}
                                            onClick={() => openChange(h)}
                                        >
                                            Change role
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    {!showAll && matching.length > HOLDERS_SHOWN && (
                        <button type="button" onClick={() => setShowAll(true)} className="mt-2 text-[11.5px] font-bold text-brand hover:underline">
                            Show all {matching.length}
                        </button>
                    )}
                </>
            )}

            <Modal open={!!changing} onClose={() => !saving && setChanging(null)} title={changing ? `Change ${holderName(changing)}'s role` : 'Change role'} size="md" closeOnBackdrop={!saving}>
                {changing && (
                    <div className="space-y-3">
                        <p className="m-0 text-xs text-muted-foreground">
                            {holderName(changing)} has {role.name} now. What they can open follows the new role as soon as it is given.
                        </p>
                        <label className="block">
                            <span className="block text-[11.5px] font-semibold text-muted-foreground mb-1">New role</span>
                            <select aria-label="New role" value={pick} onChange={(e) => setPick(e.target.value)} className={selectClass}>
                                <option value="">Choose a role</option>
                                {targets.map((r) => (
                                    <option key={r.role_key} value={r.role_key}>
                                        {r.name}
                                        {r.is_system ? '' : ` (based on ${baseName(r)})`}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {picked?.description && <p className="m-0 text-[11px] text-muted-foreground">{picked.description}</p>}
                        <div className="flex gap-2">
                            <Button onClick={changeRole} disabled={saving || !picked}>{saving ? 'Changing…' : 'Change role'}</Button>
                            <Button variant="secondary" disabled={saving} onClick={() => setChanging(null)}>Cancel</Button>
                        </div>
                    </div>
                )}
            </Modal>
        </Card>
    );
}
