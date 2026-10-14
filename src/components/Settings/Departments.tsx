import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Building2, ChevronRight, Network, Pencil, Plus } from 'lucide-react';
import { Button, Card, EmployeePicker, EmptyState, Modal, PageHeader, SearchInput, StatusPill } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { useDepartments } from '../../hooks/useDepartments';
import { useEmployeeDirectory } from '../../hooks/useEmployeeDirectory';
import { usePermissions } from '../../hooks/usePermissions';
import {
  Department,
  addDepartment,
  departmentPath,
  departmentTree,
  descendantIds,
  filterTree,
  flatten,
  updateDepartment,
} from '../../lib/orgStructure';

const inputClass = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand';

interface Draft {
  id: string | null; // null: a new department
  name: string;
  parentId: string;
  headNumber: string;
}

/**
 * Settings → Departments: the company's departments as a tree. HR (the Employees module) and ADMIN add, rename, move
 * (under another department), set the head and deactivate them; everyone else sees the list.
 */
export default function Departments() {
  const { departments, loading, error, reload } = useDepartments();
  const { employees } = useEmployeeDirectory();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canEdit = !permissionsLoading && hasPermission('employees');
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const headcount = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of employees) if (e.departmentId) n.set(e.departmentId, (n.get(e.departmentId) || 0) + 1);
    return n;
  }, [employees]);

  const rows = useMemo(() => {
    const shown = departments.filter((d) => showInactive || d.active);
    const q = query.trim().toLowerCase();
    const tree = departmentTree(shown);
    return flatten(q ? filterTree(tree, (d) => d.name.toLowerCase().includes(q)) : tree);
  }, [departments, showInactive, query]);

  const open = (d: Department | null) =>
    setDraft({
      id: d?.id ?? null,
      name: d?.name ?? '',
      parentId: d?.parent_id ?? '',
      headNumber: (d?.head_employee_id && byId.get(d.head_employee_id)?.employeeNumber) || '',
    });

  // a department can't go under itself or its own sub-departments
  const parentChoices = useMemo(() => {
    const blocked = draft?.id ? descendantIds(departments, draft.id) : new Set<string>();
    return flatten(departmentTree(departments.filter((d) => d.active && !blocked.has(d.id))));
  }, [departments, draft?.id]);

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    setBusy(true);
    try {
      const head = draft.headNumber ? employees.find((e) => e.employeeNumber === draft.headNumber)?.id || null : null;
      if (draft.id) {
        await updateDepartment(draft.id, { name: draft.name.trim(), parent_id: draft.parentId || null, head_employee_id: head });
      } else {
        const made = await addDepartment(draft.name, draft.parentId || null);
        if (head) await updateDepartment(made.id, { head_employee_id: head });
      }
      await reload();
      toast.success(draft.id ? 'Department saved' : 'Department added');
      setDraft(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (d: Department, active: boolean) => {
    try {
      await updateDepartment(d.id, { active });
      await reload();
      toast.success(active ? `${d.name} reactivated` : `${d.name} deactivated`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Departments"
        subtitle="How your company is organised. Employees are placed in a department on their record."
        actions={
          <>
            <Link to="/organogram">
              <Button variant="secondary" icon={<Network className="w-3.5 h-3.5" strokeWidth={2} />}>Organogram</Button>
            </Link>
            {canEdit && (
              <Button onClick={() => open(null)} icon={<Plus className="w-3.5 h-3.5" strokeWidth={2.2} />}>Add department</Button>
            )}
          </>
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 mb-3">
        <div className="flex-1">
          <SearchInput placeholder="Search departments..." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search departments" />
        </div>
        <label className="inline-flex items-center gap-2 text-[12px] text-ink">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-brand" />
          Show inactive
        </label>
      </div>

      <Card className="!p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center p-8"><FigbloomLoader label="Loading departments" /></div>
        ) : error ? (
          <p className="m-0 p-4 text-[12.5px] text-status-danger" role="alert">Could not load departments: {error}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Building2 className="w-5 h-5" />}
            title={query ? 'No departments match' : 'No departments yet'}
            description={canEdit && !query ? 'Add your first department to start building your org structure.' : undefined}
          />
        ) : (
          <ul className="m-0 p-0 list-none divide-y divide-border" aria-label="Departments">
            {rows.map(({ item: d, depth }) => {
              const head = d.head_employee_id ? byId.get(d.head_employee_id) : undefined;
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3" style={{ paddingLeft: 16 + Math.min(depth, 6) * 20 }}>
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {depth > 0 && <ChevronRight className="w-3.5 h-3.5 text-subtle shrink-0" aria-hidden />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[13px] font-semibold truncate ${d.active ? 'text-ink' : 'text-subtle line-through'}`}>{d.name}</span>
                        {!d.active && <StatusPill tone="neutral" label="Inactive" />}
                      </div>
                      <div className="text-[11.5px] text-muted-foreground truncate">
                        {headcount.get(d.id) || 0} {headcount.get(d.id) === 1 ? 'person' : 'people'}
                        {head ? ` · Head: ${head.fullName}` : ''}
                      </div>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" onClick={() => open(d)} aria-label={`Edit ${d.name}`} icon={<Pencil className="w-3 h-3" />}>Edit</Button>
                      <Button variant="ghost" onClick={() => void setActive(d, !d.active)}>{d.active ? 'Deactivate' : 'Reactivate'}</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {draft && (
        <Modal open onClose={() => setDraft(null)} title={draft.id ? 'Edit department' : 'Add department'} size="md" closeOnBackdrop={!busy}>
          <div className="space-y-3.5">
            <label className="block">
              <span className="block text-[12px] font-semibold text-ink mb-1">Name</span>
              <input className={inputClass} value={draft.name} maxLength={100} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-[12px] font-semibold text-ink mb-1">Part of</span>
              <select className={inputClass} value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}>
                <option value="">None (top level)</option>
                {parentChoices.map((n) => (
                  <option key={n.item.id} value={n.item.id}>{departmentPath(departments, n.item.id)}</option>
                ))}
              </select>
            </label>
            <EmployeePicker
              label="Head of department"
              value={draft.headNumber}
              onChange={(e) => setDraft({ ...draft, headNumber: e?.employeeNumber || '' })}
              placeholder="Search for the head..."
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={() => void save()} disabled={busy || !draft.name.trim()}>{busy ? 'Saving...' : 'Save'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
