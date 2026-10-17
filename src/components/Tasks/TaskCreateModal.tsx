import { useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { Button, Modal } from '../UI';
import EmployeePicker from '../UI/EmployeePicker';
import DepartmentPicker from '../UI/DepartmentPicker';
import { PRIORITIES, STATUSES, type TaskLabel, type TaskPriority, type TaskProject, type TaskStatus, type TaskViewer } from '../../lib/tasks';
import { createGroupTask, createTask } from '../../lib/tasksApi';
import { LabelChip, fieldClass, labelClass } from './TaskBits';

type Target = 'person' | 'department' | 'job_title' | 'people';

interface TaskCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** projects the viewer can add tasks to */
  projects: TaskProject[];
  labels: TaskLabel[];
  viewer: TaskViewer;
  nameOf: (n: string | null) => string;
  defaultProject?: string;
  defaultStatus?: TaskStatus;
  /** offer "a department / job title / several people" (one task each, under a group task) */
  allowGroups?: boolean;
  /** limit the assignee to these employee numbers (e.g. a supervisor's team) */
  assignable?: string[];
  onCreated: () => void;
}

/** A new task: for one person, or for a whole department / job title / several people (one each). */
export default function TaskCreateModal(props: TaskCreateModalProps) {
  const firstProject = props.defaultProject && props.projects.some((p) => p.id === props.defaultProject) ? props.defaultProject : props.projects[0]?.id ?? '';
  const [project, setProject] = useState(firstProject);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>(props.defaultStatus ?? 'todo');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [due, setDue] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [target, setTarget] = useState<Target>('person');
  const [assignee, setAssignee] = useState<string | null>(props.viewer.employeeNumber);
  const [department, setDepartment] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!project) return toast.error('Choose a project');
    if (!title.trim()) return toast.error('Give the task a title');
    setSaving(true);
    try {
      if (target === 'person') {
        await createTask({
          project_id: project, title: title.trim(), description: description.trim() || null, status, priority,
          assignee_number: assignee, due_date: due || null, labels,
        }, props.viewer);
        toast.success('Task created');
      } else {
        if (target === 'department' && !department) throw new Error('Choose a department');
        if (target === 'job_title' && !jobTitle.trim()) throw new Error('Type a job title');
        if (target === 'people' && people.length === 0) throw new Error('Add at least one person');
        await createGroupTask({
          project_id: project, title: title.trim(), description: description.trim() || null, priority, due_date: due || null,
          kind: target, department_id: department, job_title: jobTitle.trim() || null, people, labels,
        });
        toast.success('Tasks created, one for each person');
      }
      props.onCreated();
      props.onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={props.open} onClose={props.onClose} title="New task" size="2xl" closeOnBackdrop={!saving}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input aria-label="Task title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className={`${fieldClass} text-sm font-medium`} />
        <textarea aria-label="Task description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={3} className={fieldClass} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <label className={labelClass} htmlFor="new-task-project">Project</label>
            <select id="new-task-project" className={fieldClass} value={project} onChange={(e) => setProject(e.target.value)}>
              {props.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.key})</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="new-task-status">Status</label>
            <select id="new-task-status" className={fieldClass} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} disabled={target !== 'person'}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="new-task-priority">Priority</label>
            <select id="new-task-priority" className={fieldClass} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="new-task-due">Due date</label>
            <input id="new-task-due" type="date" className={fieldClass} value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>

        {props.labels.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Labels">
            {props.labels.map((l) => {
              const on = labels.includes(l.id);
              return (
                <button key={l.id} type="button" aria-pressed={on} onClick={() => setLabels((cur) => (on ? cur.filter((x) => x !== l.id) : [...cur, l.id]))}
                  className={`rounded-pill ${on ? 'ring-2 ring-brand/50' : 'opacity-50 hover:opacity-100'}`}>
                  <LabelChip label={l} />
                </button>
              );
            })}
          </div>
        )}

        <fieldset className="border border-border rounded-tile p-3">
          <legend className="px-1 text-[11px] font-medium text-muted-foreground">Assign to</legend>
          {props.allowGroups && (
            <div className="flex flex-wrap gap-3 mb-2 text-xs">
              {([['person', 'One person'], ['department', 'A department'], ['job_title', 'A job title'], ['people', 'Several people']] as [Target, string][]).map(([v, l]) => (
                <label key={v} className="inline-flex items-center gap-1">
                  <input type="radio" name="target" value={v} checked={target === v} onChange={() => setTarget(v)} /> {l}
                </label>
              ))}
            </div>
          )}
          {target === 'person' && (
            <EmployeePicker value={assignee} onChange={(e) => setAssignee(e?.employeeNumber ?? null)} placeholder="Unassigned - search by name" allowedNumbers={props.assignable} />
          )}
          {target === 'department' && (
            <DepartmentPicker value={department} onChange={(d) => setDepartment(d?.id ?? null)} label="Department (and the departments under it)" />
          )}
          {target === 'job_title' && (
            <input aria-label="Job title" className={fieldClass} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Loan Officer" />
          )}
          {target === 'people' && (
            <div className="flex flex-col gap-2">
              <EmployeePicker value={null} onChange={(e) => e && setPeople((cur) => (cur.includes(e.employeeNumber) ? cur : [...cur, e.employeeNumber]))} placeholder="Add a person..." allowedNumbers={props.assignable} />
              <div className="flex flex-wrap gap-1">
                {people.map((n) => (
                  <span key={n} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-secondary text-[11px]">
                    {props.nameOf(n)}
                    <button type="button" aria-label={`Remove ${props.nameOf(n)}`} onClick={() => setPeople((cur) => cur.filter((x) => x !== n))}><X size={10} /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {target !== 'person' && <p className="mt-2 text-[11px] text-muted-foreground">Each current employee gets their own task; a group task shows how many have finished.</p>}
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={props.onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving || !title.trim() || !project}>{saving ? 'Creating...' : 'Create task'}</Button>
        </div>
      </form>
    </Modal>
  );
}

