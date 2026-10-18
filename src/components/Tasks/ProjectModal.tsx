import { useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { Button, Modal } from '../UI';
import EmployeePicker from '../UI/EmployeePicker';
import DepartmentPicker from '../UI/DepartmentPicker';
import { suggestProjectKey, validProjectKey, type TaskProject } from '../../lib/tasks';
import { saveProject, setProjectMembers } from '../../lib/tasksApi';
import { fieldClass, labelClass } from './TaskBits';

interface ProjectModalProps {
  project: TaskProject | null;
  members: string[];
  takenKeys: string[];
  nameOf: (n: string | null) => string;
  /** whoever holds "Manage projects" may change the department and archive; a lead edits the rest */
  manages: boolean;
  onClose: () => void;
  onSaved: (project: TaskProject) => void;
}

/** A project: name, key, department (its people count as members), lead and members. */
export default function ProjectModal({ project, members, takenKeys, nameOf, manages, onClose, onSaved }: ProjectModalProps) {
  const [name, setName] = useState(project?.name ?? '');
  const [key, setKey] = useState(project?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(!!project);
  const [description, setDescription] = useState(project?.description ?? '');
  const [department, setDepartment] = useState<string | null>(project?.department_id ?? null);
  const [lead, setLead] = useState<string | null>(project?.lead_number ?? null);
  const [people, setPeople] = useState<string[]>(members);
  const [archived, setArchived] = useState(project?.archived ?? false);
  const [saving, setSaving] = useState(false);

  const others = takenKeys.filter((k) => k !== project?.key);
  const shownKey = keyTouched ? key : suggestProjectKey(name, others);

  const submit = async () => {
    const k = shownKey.toUpperCase();
    if (!name.trim()) return toast.error('Give the project a name');
    if (!validProjectKey(k)) return toast.error('The key is 2 to 6 capital letters or digits, starting with a letter (e.g. OPS)');
    if (others.includes(k)) return toast.error(`The key ${k} is already used`);
    setSaving(true);
    try {
      const saved = await saveProject({ key: k, name: name.trim(), description: description.trim() || null, department_id: department, lead_number: lead, archived }, project?.id);
      await setProjectMembers(saved.id, people, project ? members : []);
      toast.success(project ? 'Project saved' : 'Project created');
      onSaved(saved);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={project ? `Edit ${project.name}` : 'New project'} size="xl" closeOnBackdrop={!saving}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <div>
            <label className={labelClass} htmlFor="project-name">Name</label>
            <input id="project-name" className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Operations" autoFocus />
          </div>
          <div>
            <label className={labelClass} htmlFor="project-key">Key</label>
            <input
              id="project-key"
              className={`${fieldClass} font-mono uppercase`}
              value={shownKey}
              maxLength={6}
              onChange={(e) => { setKeyTouched(true); setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">Tasks are numbered with the key: {shownKey || 'OPS'}-1, {shownKey || 'OPS'}-2...</p>
        <div>
          <label className={labelClass} htmlFor="project-description">Description</label>
          <textarea id="project-description" className={fieldClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <DepartmentPicker value={department} onChange={(d) => setDepartment(d?.id ?? null)} label="Department (optional: its people are members)" disabled={!manages} />
        <EmployeePicker label="Lead" value={lead} onChange={(e) => setLead(e?.employeeNumber ?? null)} placeholder="Who leads it" />
        <div>
          <span className={labelClass}>Members</span>
          <EmployeePicker value={null} onChange={(e) => e && setPeople((cur) => (cur.includes(e.employeeNumber) ? cur : [...cur, e.employeeNumber]))} placeholder="Add a member..." />
          <div className="flex flex-wrap gap-1 mt-2">
            {people.map((n) => (
              <span key={n} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-secondary text-[11px]">
                {nameOf(n)}
                <button type="button" aria-label={`Remove ${nameOf(n)}`} onClick={() => setPeople((cur) => cur.filter((x) => x !== n))}><X size={10} /></button>
              </span>
            ))}
            {people.length === 0 && <span className="text-[11px] text-muted-foreground">No members added.</span>}
          </div>
        </div>
        {project && manages && (
          <label className="inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived (hidden from the sidebar; tasks are kept)
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving...' : project ? 'Save' : 'Create project'}</Button>
        </div>
      </form>
    </Modal>
  );
}
