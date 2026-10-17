import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Play, Plus, Repeat, Trash2, X } from 'lucide-react';
import { Button, Card, EmptyState, Modal, StatusPill } from '../UI';
import EmployeePicker from '../UI/EmployeePicker';
import DepartmentPicker from '../UI/DepartmentPicker';
import { useDepartments } from '../../hooks/useDepartments';
import { PRIORITIES, WEEKDAYS, describeSchedule, priorityLabel, type TaskPriority, type TaskProject, type TaskTemplate } from '../../lib/tasks';
import { deleteTemplate, loadTemplates, runTemplates, saveTemplate, type TemplateInput } from '../../lib/tasksApi';
import { confirmDialog } from '../../lib/confirmDialog';
import { fieldClass, labelClass } from './TaskBits';

interface Props {
  projects: TaskProject[];
  nameOf: (n: string | null) => string;
  onTasksMade: () => void;
}

const blank = (project: string): TemplateInput => ({
  project_id: project, title: '', description: null, priority: 'none', schedule: 'weekly', weekday: 1, month_day: 1, due_in_days: 0,
  target_kind: 'job_title', department_id: null, job_title: '', people: [], active: true,
});

/** Recurring role tasks: made for each person in a department / job title / list, every day, week or month. */
export default function TemplatesPanel({ projects, nameOf, onTasksMade }: Props) {
  const { departments } = useDepartments();
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [editing, setEditing] = useState<{ id?: string; input: TemplateInput } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => loadTemplates().then(setTemplates).catch((e) => toast.error((e as Error).message)), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const target = (t: TaskTemplate) =>
    t.target_kind === 'department' ? `Department: ${departments.find((d) => d.id === t.department_id)?.name ?? '(removed)'}`
      : t.target_kind === 'job_title' ? `Job title: ${t.job_title}`
        : t.people.map((n) => nameOf(n)).join(', ');

  const runNow = async () => {
    setBusy(true);
    try {
      const n = await runTemplates();
      toast.success(n ? `${n} task${n === 1 ? '' : 's'} made` : 'Nothing due: every recurring task is already made for this period');
      if (n) onTasksMade();
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    const i = editing.input;
    if (!i.title.trim()) return toast.error('Give it a title');
    if (i.target_kind === 'department' && !i.department_id) return toast.error('Choose a department');
    if (i.target_kind === 'job_title' && !i.job_title?.trim()) return toast.error('Type a job title');
    if (i.target_kind === 'people' && !i.people.length) return toast.error('Add at least one person');
    setBusy(true);
    try {
      await saveTemplate({ ...i, title: i.title.trim(), job_title: i.job_title?.trim() || null, description: i.description?.trim() || null }, editing.id);
      setEditing(null);
      await reload();
      toast.success('Saved. Tasks are made every morning; press "Run now" to make today\'s now.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<TemplateInput>) => setEditing((cur) => (cur ? { ...cur, input: { ...cur.input, ...patch } } : cur));
  const active = projects.filter((p) => !p.archived);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">
          Tasks a role gets again and again (e.g. every Loan Officer: "Weekly cash count"). Each person gets their own task once per day, week or month.
        </p>
        <Button variant="secondary" icon={<Play size={14} />} onClick={runNow} disabled={busy || !templates.length}>Run now</Button>
        <Button icon={<Plus size={14} />} onClick={() => active[0] ? setEditing({ input: blank(active[0].id) }) : toast.error('Create a project first')}>Recurring task</Button>
      </div>
      {templates.length === 0 ? (
        <EmptyState icon={<Repeat size={22} />} title="No recurring tasks" description="Set up tasks that repeat for a department, a job title or named people." />
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {templates.map((t) => (
            <Card key={t.id} padding="sm" className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink flex-1 truncate">{t.title}</span>
                {!t.active && <StatusPill label="Paused" />}
                <button type="button" aria-label={`Edit ${t.title}`} className="p-1 rounded-md hover:bg-secondary" onClick={() => { const { id, last_period: _last, ...input } = t; setEditing({ id, input }); }}><Pencil size={13} /></button>
                <button
                  type="button"
                  aria-label={`Delete ${t.title}`}
                  className="p-1 rounded-md hover:bg-secondary"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: `Delete "${t.title}"?`, message: 'Tasks already made are kept.', confirmLabel: 'Delete', tone: 'danger' }))) return;
                    try {
                      await deleteTemplate(t.id);
                      await reload();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">{describeSchedule(t)} · {target(t)} · {projects.find((p) => p.id === t.project_id)?.name ?? ''} · {priorityLabel(t.priority)}</p>
              {t.last_period && <p className="text-[10px] text-muted-foreground">Last made for {t.last_period}</p>}
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit recurring task' : 'New recurring task'} size="xl" closeOnBackdrop={!busy}>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <input aria-label="Recurring task title" className={`${fieldClass} text-sm`} value={editing.input.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Weekly cash count" />
            <textarea aria-label="Recurring task description" className={fieldClass} rows={2} value={editing.input.description ?? ''} onChange={(e) => set({ description: e.target.value })} placeholder="Description (optional)" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass} htmlFor="tpl-project">Project</label>
                <select id="tpl-project" className={fieldClass} value={editing.input.project_id} onChange={(e) => set({ project_id: e.target.value })}>
                  {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="tpl-priority">Priority</label>
                <select id="tpl-priority" className={fieldClass} value={editing.input.priority} onChange={(e) => set({ priority: e.target.value as TaskPriority })}>
                  {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="tpl-schedule">Repeats</label>
                <select id="tpl-schedule" className={fieldClass} value={editing.input.schedule} onChange={(e) => set({ schedule: e.target.value as TemplateInput['schedule'] })}>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                  <option value="monthly">Every month</option>
                </select>
              </div>
              {editing.input.schedule === 'weekly' && (
                <div>
                  <label className={labelClass} htmlFor="tpl-weekday">On</label>
                  <select id="tpl-weekday" className={fieldClass} value={editing.input.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                  </select>
                </div>
              )}
              {editing.input.schedule === 'monthly' && (
                <div>
                  <label className={labelClass} htmlFor="tpl-day">Day of the month</label>
                  <input id="tpl-day" type="number" min={1} max={31} className={fieldClass} value={editing.input.month_day} onChange={(e) => set({ month_day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
                </div>
              )}
              <div>
                <label className={labelClass} htmlFor="tpl-due">Due (days after it is made)</label>
                <input id="tpl-due" type="number" min={0} max={365} className={fieldClass} value={editing.input.due_in_days} onChange={(e) => set({ due_in_days: Math.min(365, Math.max(0, Number(e.target.value) || 0)) })} />
              </div>
            </div>
            <fieldset className="border border-border rounded-tile p-3">
              <legend className="px-1 text-[11px] font-medium text-muted-foreground">For</legend>
              <div className="flex flex-wrap gap-3 mb-2 text-xs">
                {([['department', 'A department'], ['job_title', 'A job title'], ['people', 'Named people']] as [TemplateInput['target_kind'], string][]).map(([v, l]) => (
                  <label key={v} className="inline-flex items-center gap-1">
                    <input type="radio" name="tpl-target" checked={editing.input.target_kind === v} onChange={() => set({ target_kind: v })} /> {l}
                  </label>
                ))}
              </div>
              {editing.input.target_kind === 'department' && (
                <DepartmentPicker value={editing.input.department_id} onChange={(d) => set({ department_id: d?.id ?? null })} label="Department (and the departments under it)" />
              )}
              {editing.input.target_kind === 'job_title' && (
                <input aria-label="Job title" className={fieldClass} value={editing.input.job_title ?? ''} onChange={(e) => set({ job_title: e.target.value })} placeholder="e.g. Loan Officer (matched ignoring capitals)" />
              )}
              {editing.input.target_kind === 'people' && (
                <div className="flex flex-col gap-2">
                  <EmployeePicker value={null} onChange={(e) => e && set({ people: editing.input.people.includes(e.employeeNumber) ? editing.input.people : [...editing.input.people, e.employeeNumber] })} placeholder="Add a person..." />
                  <div className="flex flex-wrap gap-1">
                    {editing.input.people.map((n) => (
                      <span key={n} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-secondary text-[11px]">
                        {nameOf(n)}
                        <button type="button" aria-label={`Remove ${nameOf(n)}`} onClick={() => set({ people: editing.input.people.filter((x) => x !== n) })}><X size={10} /></button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </fieldset>
            <label className="inline-flex items-center gap-2 text-xs">
              <input type="checkbox" checked={editing.input.active} onChange={(e) => set({ active: e.target.checked })} /> Active
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>Save</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
