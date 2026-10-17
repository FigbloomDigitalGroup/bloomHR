import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, BriefcaseBusiness, ChevronRight, GitMerge, Plus } from 'lucide-react';
import { Button, Card, EmptyState, Modal, PageHeader, SearchInput, StatusPill, TableScroll } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { usePermissions } from '../../hooks/usePermissions';
import { confirmDialog } from '../../lib/confirmDialog';
import { Department, departmentPath, loadDepartments } from '../../lib/orgStructure';
import {
  JobGroupChoice,
  JobTitleOverview,
  likelyDuplicates,
  loadJobGroupChoices,
  loadJobTitlesOverview,
  mergeJobTitles,
  saveJobTitle,
  titleNameProblem,
} from '../../lib/jobTitles';

const inputClass = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand';
const labelClass = 'block text-[11.5px] font-semibold text-muted-foreground mb-1';

/** Who may manage job titles (the database decides; this only hides the page from others). */
export function canManageJobTitles(role: string | null, has: (m: string) => boolean): boolean {
  if (role === 'ADMIN' || role === 'HR') return true;
  if (has('employees')) return true;
  return has('performance') && role !== 'MANAGER' && role !== 'REGIONAL';
}

interface Draft {
  id: string | null;
  name: string;
  departmentId: string;
  jobGroupId: string;
}

/**
 * Settings → Job titles: the company's list of job titles, made from what employees already had. HR adds, renames
 * (employees' "Job Title" follows), sets a usual department and job group, merges duplicates and deactivates titles.
 * KPI templates can be set per job title.
 */
export default function JobTitles() {
  const { hasPermission, userRole, loading: permissionsLoading } = usePermissions();
  const allowed = !permissionsLoading && canManageJobTitles(userRole, hasPermission);
  const [titles, setTitles] = useState<JobTitleOverview[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [groups, setGroups] = useState<JobGroupChoice[]>([]);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [merging, setMerging] = useState<JobTitleOverview | null>(null);

  const reload = useCallback(async () => {
    try {
      setTitles(await loadJobTitlesOverview());
    } catch (e) {
      toast.error((e as Error).message);
      setTitles((t) => t ?? []);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void reload();
    loadDepartments().then(setDepartments).catch(() => setDepartments([]));
    loadJobGroupChoices().then(setGroups);
  }, [allowed, reload]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (titles ?? []).filter((t) => (showInactive || t.active) && (!q || t.name.toLowerCase().includes(q)));
  }, [titles, query, showInactive]);
  const duplicates = useMemo(() => likelyDuplicates((titles ?? []).filter((t) => t.active)), [titles]);
  const groupLabel = (id: string | null) => {
    const g = groups.find((x) => x.id === id);
    return g ? (g.name !== g.code ? `${g.code} – ${g.name}` : g.code) : '—';
  };

  const toggleActive = async (t: JobTitleOverview) => {
    if (t.active && t.employee_count > 0) {
      const ok = await confirmDialog({
        title: `Deactivate ${t.name}?`,
        message: `${t.employee_count} ${t.employee_count === 1 ? 'employee keeps' : 'employees keep'} it, but it can't be chosen for anyone else.`,
        confirmLabel: 'Deactivate',
      });
      if (!ok) return;
    }
    try {
      await saveJobTitle(t.id, { active: !t.active });
      toast.success(t.active ? `${t.name} deactivated` : `${t.name} active again`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const header = (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[11.5px] text-muted-foreground mb-2">
        <Link to="/settings" className="hover:text-brand">Settings</Link>
        <ChevronRight className="w-3 h-3" />
        <span>Job titles</span>
      </nav>
      <PageHeader
        title="Job titles"
        subtitle="The titles employees can have. Renaming one renames it on every employee; KPI templates can be set per title."
        actions={allowed && (
          <Button icon={<Plus className="w-3 h-3" strokeWidth={2.2} />} onClick={() => setDraft({ id: null, name: '', departmentId: '', jobGroupId: '' })}>
            Add job title
          </Button>
        )}
      />
    </>
  );

  if (permissionsLoading) {
    return <div className="p-4 sm:p-6"><Card className="flex items-center justify-center !p-8"><FigbloomLoader label="Loading job titles" /></Card></div>;
  }
  if (!allowed) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl">
        {header}
        <Card><p className="m-0 text-[12.5px] text-ink" role="status">Only HR, an admin or someone with Employees or Performance can manage job titles.</p></Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      {header}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 mb-3">
        <div className="flex-1">
          <SearchInput placeholder="Search job titles..." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search job titles" />
        </div>
        <label className="inline-flex items-center gap-2 text-[12px] text-ink">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-brand" />
          Show inactive
        </label>
      </div>

      {duplicates.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-tile px-3 py-2 mb-3 text-[12px] text-orange-text-alt bg-orange-tint-alt">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            These look like the same job written differently: {duplicates.map((g) => g.map((t) => `“${t.name}”`).join(' and ')).join('; ')}. Use Merge to
            combine them.
          </span>
        </div>
      )}

      {titles === null ? (
        <Card className="flex items-center justify-center !p-8"><FigbloomLoader label="Loading job titles" /></Card>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BriefcaseBusiness className="w-5 h-5" />}
            title={query ? 'No job titles match' : 'No job titles yet'}
            description={query ? undefined : 'Add the job titles your company uses, or type one on an employee to add it.'}
          />
        </Card>
      ) : (
        <Card className="!p-0">
          <TableScroll>
            <table className="w-full min-w-[720px] text-left text-[12.5px]">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Job title</th>
                  <th className="px-4 py-2.5 font-semibold">Usual department</th>
                  <th className="px-4 py-2.5 font-semibold">Usual job group</th>
                  <th className="px-4 py-2.5 font-semibold">Employees</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{t.name}</div>
                      {t.template_count > 0 && (
                        <div className="text-[11px] text-muted-foreground">{t.template_count} KPI {t.template_count === 1 ? 'template' : 'templates'}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{t.department_id ? departmentPath(departments, t.department_id) || '—' : '—'}</td>
                    <td className="px-4 py-3">{groupLabel(t.job_group_id)}</td>
                    <td className="px-4 py-3">{t.employee_count}</td>
                    <td className="px-4 py-3"><StatusPill label={t.active ? 'Active' : 'Inactive'} tone={t.active ? 'success' : 'neutral'} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button variant="secondary" aria-label={`Edit ${t.name}`}
                          onClick={() => setDraft({ id: t.id, name: t.name, departmentId: t.department_id ?? '', jobGroupId: t.job_group_id ?? '' })}>
                          Edit
                        </Button>
                        <Button variant="ghost" icon={<GitMerge size={13} />} aria-label={`Merge ${t.name}`} onClick={() => setMerging(t)}>Merge</Button>
                        <Button variant="ghost" aria-label={`${t.active ? 'Deactivate' : 'Reactivate'} ${t.name}`} onClick={() => void toggleActive(t)}>
                          {t.active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit job title' : 'Add job title'} size="md">
        {draft && (
          <TitleForm
            draft={draft}
            titles={titles ?? []}
            departments={departments}
            groups={groups}
            onCancel={() => setDraft(null)}
            onSaved={async () => {
              setDraft(null);
              await reload();
            }}
          />
        )}
      </Modal>

      <Modal open={!!merging} onClose={() => setMerging(null)} title={merging ? `Merge ${merging.name} into…` : 'Merge'} size="md">
        {merging && (
          <MergeForm
            from={merging}
            titles={(titles ?? []).filter((t) => t.id !== merging.id)}
            onCancel={() => setMerging(null)}
            onMerged={async () => {
              setMerging(null);
              await reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function TitleForm({
  draft,
  titles,
  departments,
  groups,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  titles: JobTitleOverview[];
  departments: Department[];
  groups: JobGroupChoice[];
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState(draft);
  const [busy, setBusy] = useState(false);
  const problem = titleNameProblem(form.name, titles, form.id);
  const original = titles.find((t) => t.id === form.id);
  const renaming = original && original.name !== form.name.trim() && original.employee_count > 0;

  const save = async () => {
    if (problem) return;
    setBusy(true);
    try {
      await saveJobTitle(form.id, { name: form.name, department_id: form.departmentId || null, job_group_id: form.jobGroupId || null });
      toast.success(form.id ? 'Job title saved' : 'Job title added');
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div>
        <label htmlFor="job-title-name" className={labelClass}>Name</label>
        <input id="job-title-name" className={inputClass} value={form.name} maxLength={140} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        {renaming && (
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {original.employee_count} {original.employee_count === 1 ? 'employee' : 'employees'} will show the new name.
          </p>
        )}
      </div>
      <div>
        <label htmlFor="job-title-department" className={labelClass}>Usual department (optional)</label>
        <select id="job-title-department" className={inputClass} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
          <option value="">None</option>
          {departments.filter((d) => d.active || d.id === form.departmentId).map((d) => (
            <option key={d.id} value={d.id}>{departmentPath(departments, d.id) || d.name}</option>
          ))}
        </select>
      </div>
      {groups.length > 0 && (
        <div>
          <label htmlFor="job-title-group" className={labelClass}>Usual job group (optional)</label>
          <select id="job-title-group" className={inputClass} value={form.jobGroupId} onChange={(e) => setForm({ ...form, jobGroupId: e.target.value })}>
            <option value="">None</option>
            {groups.filter((g) => g.active || g.id === form.jobGroupId).map((g) => (
              <option key={g.id} value={g.id}>{g.name !== g.code ? `${g.code} – ${g.name}` : g.code}</option>
            ))}
          </select>
        </div>
      )}
      <p className="text-[11.5px] text-muted-foreground">The usual department and job group are filled in when you add an employee with this title.</p>
      {problem && <p className="text-[12px] text-status-danger">{problem}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy || !!problem}>Save</Button>
      </div>
    </form>
  );
}

function MergeForm({
  from,
  titles,
  onCancel,
  onMerged,
}: {
  from: JobTitleOverview;
  titles: JobTitleOverview[];
  onCancel: () => void;
  onMerged: () => void | Promise<void>;
}) {
  const [into, setInto] = useState('');
  const [busy, setBusy] = useState(false);
  const target = titles.find((t) => t.id === into);
  const merge = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const n = await mergeJobTitles(from.id, target.id);
      toast.success(`${from.name} merged into ${target.name}${n ? ` (${n} ${n === 1 ? 'employee' : 'employees'} moved)` : ''}`);
      await onMerged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-ink">
        Everyone with “{from.name}” ({from.employee_count}) moves to the title you choose, its KPI templates follow, and “{from.name}” is removed.
      </p>
      <div>
        <label htmlFor="merge-into" className={labelClass}>Merge into</label>
        <select id="merge-into" className={inputClass} value={into} onChange={(e) => setInto(e.target.value)}>
          <option value="">Choose a job title</option>
          {titles.map((t) => <option key={t.id} value={t.id}>{t.name}{t.active ? '' : ' (inactive)'}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={() => void merge()} disabled={busy || !target}>Merge</Button>
      </div>
    </div>
  );
}
