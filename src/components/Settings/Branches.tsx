import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { MapPin, Pencil, Plus, Star } from 'lucide-react';
import { Button, Card, EmptyState, Modal, PageHeader, StatusPill } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { useBranches } from '../../hooks/useBranches';
import { useEmployeeDirectory } from '../../hooks/useEmployeeDirectory';
import { usePermissions } from '../../hooks/usePermissions';
import {
  BRANCH_COUNTRIES,
  Branch,
  addBranch,
  currencyFor,
  headcountByBranch,
  moveBranchStaff,
  updateBranch,
} from '../../lib/branches';

const inputClass = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand';
const OTHER = '__other__';

interface Draft {
  id: string | null; // null: a new branch
  name: string;
  /** one of BRANCH_COUNTRIES, or OTHER with otherCountry typed */
  country: string;
  otherCountry: string;
  currency: string;
  /** the currency was changed by hand (it no longer follows the country) */
  currencyTouched: boolean;
  city: string;
  address: string;
}

const isListed = (country: string) => (BRANCH_COUNTRIES as readonly string[]).includes(country);

/**
 * Settings → Branches (FIG-905): the company's offices, each in a country. Public holidays and the minimum wage follow
 * the branch's country, and every employee belongs to one (people with none are in the default branch). ADMIN, HR and
 * Settings add, edit, deactivate (once nobody is left in it) and choose the default; everyone else sees the list.
 */
export default function Branches() {
  const { branches, loading, error, reload } = useBranches();
  const { employees } = useEmployeeDirectory();
  const { hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const canEdit = !permissionsLoading && hasAnyPermission(['employees', 'settings']);
  const [showInactive, setShowInactive] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [moving, setMoving] = useState<{ branch: Branch; to: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const headcount = useMemo(() => headcountByBranch(employees, branches), [employees, branches]);
  const rows = useMemo(
    () =>
      branches
        .filter((b) => showInactive || b.active)
        .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name)),
    [branches, showInactive]
  );

  const open = (b: Branch | null) =>
    setDraft({
      id: b?.id ?? null,
      name: b?.name ?? '',
      country: b ? (isListed(b.country) ? b.country : OTHER) : 'Kenya',
      otherCountry: b && !isListed(b.country) ? b.country : '',
      currency: b?.currency ?? 'KES',
      currencyTouched: !!b && b.currency !== currencyFor(b.country),
      city: b?.city ?? '',
      address: b?.address ?? '',
    });

  const draftCountry = draft ? (draft.country === OTHER ? draft.otherCountry.trim() : draft.country) : '';

  const save = async () => {
    if (!draft || !draft.name.trim() || !draftCountry) return;
    setBusy(true);
    try {
      const fields = {
        name: draft.name.trim(),
        country: draftCountry,
        currency: (draft.currency.trim() || currencyFor(draftCountry)).toUpperCase(),
        city: draft.city.trim() || null,
        address: draft.address.trim() || null,
      };
      if (draft.id) await updateBranch(draft.id, fields);
      else await addBranch(fields);
      await reload();
      toast.success(draft.id ? 'Branch saved' : 'Branch added');
      setDraft(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (b: Branch, active: boolean) => {
    if (!active && (headcount.get(b.id) || 0) > 0) {
      // people are still in it: offer to move them first
      const to = branches.find((x) => x.active && x.id !== b.id && x.is_default) || branches.find((x) => x.active && x.id !== b.id);
      setMoving({ branch: b, to: to?.id || '' });
      return;
    }
    try {
      await updateBranch(b.id, { active });
      await reload();
      toast.success(active ? `${b.name} reactivated` : `${b.name} deactivated`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const moveAndDeactivate = async () => {
    if (!moving?.to) return;
    setBusy(true);
    try {
      const n = await moveBranchStaff(moving.branch.id, moving.to);
      await updateBranch(moving.branch.id, { active: false });
      await reload();
      const to = branches.find((b) => b.id === moving.to);
      toast.success(`Moved ${n} ${n === 1 ? 'person' : 'people'} to ${to?.name ?? 'the other branch'} and deactivated ${moving.branch.name}`);
      setMoving(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const makeDefault = async (b: Branch) => {
    try {
      await updateBranch(b.id, { is_default: true });
      await reload();
      toast.success(`${b.name} is now the default branch`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Branches"
        subtitle="Your offices and the country each is in. Public holidays and the minimum wage follow an employee's branch."
        actions={canEdit ? <Button onClick={() => open(null)} icon={<Plus className="w-3.5 h-3.5" strokeWidth={2.2} />}>Add branch</Button> : undefined}
      />

      <div className="flex justify-end mb-3">
        <label className="inline-flex items-center gap-2 text-[12px] text-ink">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-brand" />
          Show inactive
        </label>
      </div>

      <Card className="!p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center p-8"><FigbloomLoader label="Loading branches" /></div>
        ) : error ? (
          <p className="m-0 p-4 text-[12.5px] text-status-danger" role="alert">Could not load branches: {error}</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<MapPin className="w-5 h-5" />} title="No branches yet" />
        ) : (
          <ul className="m-0 p-0 list-none divide-y divide-border" aria-label="Branches">
            {rows.map((b) => {
              const n = headcount.get(b.id) || 0;
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[13px] font-semibold truncate ${b.active ? 'text-ink' : 'text-subtle line-through'}`}>{b.name}</span>
                      {b.is_default && <StatusPill tone="success" label="Default" />}
                      {!b.active && <StatusPill tone="neutral" label="Inactive" />}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground truncate">
                      {[b.country, b.currency, b.city, `${n} ${n === 1 ? 'person' : 'people'}`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button variant="ghost" onClick={() => open(b)} aria-label={`Edit ${b.name}`} icon={<Pencil className="w-3 h-3" />}>Edit</Button>
                      {b.active && !b.is_default && (
                        <Button variant="ghost" onClick={() => void makeDefault(b)} aria-label={`Make ${b.name} the default`} icon={<Star className="w-3 h-3" />}>Make default</Button>
                      )}
                      {!b.is_default && (
                        <Button variant="ghost" onClick={() => void setActive(b, !b.active)} aria-label={`${b.active ? 'Deactivate' : 'Reactivate'} ${b.name}`}>
                          {b.active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="mt-2 mb-0 text-[11.5px] text-muted-foreground">
        People with no branch are in the default branch. Payroll for Tanzania and Uganda comes next: until then their payslips are worked out with Kenya's rules.
      </p>

      {draft && (
        <Modal open onClose={() => setDraft(null)} title={draft.id ? 'Edit branch' : 'Add branch'} size="md" closeOnBackdrop={!busy}>
          <div className="space-y-3.5">
            <label className="block">
              <span className="block text-[12px] font-semibold text-ink mb-1">Name</span>
              <input className={inputClass} value={draft.name} maxLength={100} autoFocus placeholder="e.g. Dar es Salaam" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-[12px] font-semibold text-ink mb-1">Country</span>
              <select
                className={inputClass}
                value={draft.country}
                onChange={(e) => {
                  const country = e.target.value;
                  setDraft({ ...draft, country, currency: draft.currencyTouched ? draft.currency : currencyFor(country === OTHER ? draft.otherCountry : country) });
                }}
              >
                {BRANCH_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value={OTHER}>Other</option>
              </select>
            </label>
            {draft.country === OTHER && (
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">Other country</span>
                <input className={inputClass} value={draft.otherCountry} maxLength={60} onChange={(e) => setDraft({ ...draft, otherCountry: e.target.value })} />
              </label>
            )}
            <label className="block">
              <span className="block text-[12px] font-semibold text-ink mb-1">Currency</span>
              <input
                className={inputClass}
                value={draft.currency}
                maxLength={3}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase(), currencyTouched: true })}
              />
            </label>
            <label className="block">
              <span className="block text-[12px] font-semibold text-ink mb-1">City</span>
              <input className={inputClass} value={draft.city} maxLength={100} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-[12px] font-semibold text-ink mb-1">Address</span>
              <textarea className={inputClass} rows={2} value={draft.address} maxLength={300} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={() => void save()} disabled={busy || !draft.name.trim() || !draftCountry || !/^[A-Za-z]{3}$/.test(draft.currency.trim())}>
                {busy ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {moving && (
        <Modal open onClose={() => setMoving(null)} title={`Deactivate ${moving.branch.name}`} size="md" closeOnBackdrop={!busy}>
          <div className="space-y-3.5">
            <p className="m-0 text-[12.5px] text-ink">
              {headcount.get(moving.branch.id) || 0} {(headcount.get(moving.branch.id) || 0) === 1 ? 'person is' : 'people are'} in {moving.branch.name}. Move them to another branch first.
            </p>
            <label className="block">
              <span className="block text-[12px] font-semibold text-ink mb-1">Move them to</span>
              <select className={inputClass} value={moving.to} onChange={(e) => setMoving({ ...moving, to: e.target.value })}>
                <option value="">Choose a branch</option>
                {branches.filter((b) => b.active && b.id !== moving.branch.id).map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.country})</option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setMoving(null)}>Cancel</Button>
              <Button onClick={() => void moveAndDeactivate()} disabled={busy || !moving.to}>{busy ? 'Moving...' : 'Move and deactivate'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
