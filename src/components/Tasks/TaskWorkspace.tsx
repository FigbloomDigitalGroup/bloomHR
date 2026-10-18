import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Archive, FolderKanban, Kanban, List, Plus, Repeat, Settings2, Tag, User, Layers } from 'lucide-react';
import { Button, EmptyState, PageHeader, SearchInput } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { useEmployeeDirectory } from '../../hooks/useEmployeeDirectory';
import {
  EMPTY_FILTERS, PRIORITIES, activeFilterCount, canEditTask, filterTasks,
  type DueFilter, type Task, type TaskFilters, type TaskLabel, type TaskPriority, type TaskProject, type TaskSort,
  type TaskStatus, type TaskViewer,
} from '../../lib/tasks';
import {
  createTask, loadLabels, loadProjectMembers, loadProjects, loadTasks, loadTaskViewer, updateTask,
} from '../../lib/tasksApi';
import TaskBoard from './TaskBoard';
import TaskList from './TaskList';
import TaskDetail from './TaskDetail';
import TaskCreateModal from './TaskCreateModal';
import ProjectModal from './ProjectModal';
import LabelsModal from './LabelsModal';
import TemplatesPanel from './TemplatesPanel';
import type { MentionPerson } from './MentionInput';

type Scope = 'my' | 'all' | 'templates' | `project:${string}`;

interface TaskWorkspaceProps {
  /** admin: the Task Manager page; staff: the staff portal's Tasks */
  mode: 'admin' | 'staff';
  /** a supervisor's view of their team: only tasks assigned to these people */
  teamNumbers?: string[];
  /** a task to open straight away (from the calendar) */
  initialOpenId?: string | null;
}

const typingIn = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
};

/**
 * Tasks like Linear: projects down the side, a board (drag between columns) or a list grouped by status, filters,
 * "My tasks", and a task's full detail. The database decides what each person sees and may change.
 */
export default function TaskWorkspace({ mode, teamNumbers, initialOpenId = null }: TaskWorkspaceProps) {
  const { employees } = useEmployeeDirectory();
  const [viewer, setViewer] = useState<TaskViewer | null>(null);
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [members, setMembers] = useState<Record<string, string[]>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  const team = teamNumbers ?? null;
  const [scope, setScope] = useState<Scope>(team ? 'all' : 'my');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<TaskSort>('manual');
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [creating, setCreating] = useState<{ status?: TaskStatus } | null>(null);
  const [editingProject, setEditingProject] = useState<TaskProject | 'new' | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const reloadTasks = useCallback(async () => {
    setTasks(await loadTasks());
  }, []);

  const reload = useCallback(async () => {
    try {
      const [v, p, m, t, l] = await Promise.all([loadTaskViewer(), loadProjects(), loadProjectMembers(), loadTasks(), loadLabels()]);
      setViewer(v);
      setProjects(p);
      setMembers(m);
      setTasks(t);
      setLabels(l);
      setProblem(null);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // names, and the viewer's own department (a project's department makes its people members)
  const byNumber = useMemo(() => new Map(employees.map((e) => [e.employeeNumber, e])), [employees]);
  const nameOf = useCallback((n: string | null) => (n ? byNumber.get(n)?.fullName ?? n : 'Unassigned'), [byNumber]);
  const myDepartment = viewer?.employeeNumber ? byNumber.get(viewer.employeeNumber)?.departmentId ?? null : null;
  const people = useMemo<MentionPerson[]>(
    () => employees.filter((e) => !/terminat|resign|exit|left/i.test(e.status)).map((e) => ({ number: e.employeeNumber, name: e.fullName, detail: e.jobTitle })),
    [employees]
  );

  const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const labelById = useMemo(() => Object.fromEntries(labels.map((l) => [l.id, l])), [labels]);

  // one of the project's people (sees all its tasks); running tasks alone is not membership
  const isMember = useCallback((p: TaskProject) => {
    if (!viewer) return false;
    if (p.created_by === viewer.userId) return true;
    const me = viewer.employeeNumber;
    return !!me && (p.lead_number === me || (members[p.id] ?? []).includes(me) || (!!p.department_id && p.department_id === myDepartment));
  }, [viewer, members, myDepartment]);
  // edits the project and its members: its lead, or the people who run tasks
  const leads = useCallback((p: TaskProject) => !!viewer && (viewer.manages || p.created_by === viewer.userId || (!!viewer.employeeNumber && p.lead_number === viewer.employeeNumber)), [viewer]);

  const sidebarProjects = useMemo(
    () => projects.filter((p) => (showArchived || !p.archived) && (mode === 'admin' || isMember(p) || tasks.some((t) => t.project_id === p.id))),
    [projects, showArchived, mode, isMember, tasks]
  );
  // the people who run tasks may add a task to any project (they then see it, as its creator)
  const creatable = useMemo(() => projects.filter((p) => !p.archived && (!!viewer?.manages || isMember(p))), [projects, isMember, viewer]);

  // what this scope shows, before the filters
  const scoped = useMemo(() => {
    let list = tasks;
    if (team) list = list.filter((t) => t.assignee_number && team.includes(t.assignee_number));
    if (scope === 'my') {
      const me = viewer?.employeeNumber;
      list = list.filter((t) => (me && t.assignee_number === me) || (!t.assignee_number && t.created_by === viewer?.userId && !t.is_group));
    } else if (scope.startsWith('project:')) {
      const id = scope.slice('project:'.length);
      list = list.filter((t) => t.project_id === id);
    }
    return list;
  }, [tasks, team, scope, viewer]);
  const shown = useMemo(() => filterTasks(scoped, filters, nameOf), [scoped, filters, nameOf]);
  const assigneesInView = useMemo(
    () => [...new Set(scoped.map((t) => t.assignee_number).filter((n): n is string => !!n))].sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [scoped, nameOf]
  );

  const canEdit = useCallback((t: Task) => !!viewer && canEditTask(t, viewer, projectById[t.project_id]), [viewer, projectById]);

  const move = async (task: Task, status: TaskStatus, sortOrder: number) => {
    const before = tasks;
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, status, sort_order: sortOrder } : t)));
    try {
      const saved = await updateTask(task.id, task.status === status ? { sort_order: sortOrder } : { status, sort_order: sortOrder });
      setTasks((cur) => cur.map((t) => (t.id === saved.id ? saved : t)));
      // a sub-task of a group task: the group task follows
      if (task.parent_id && task.status !== status) void reloadTasks();
    } catch (e) {
      setTasks(before);
      toast.error((e as Error).message);
    }
  };

  // "C" makes a new task (not while typing or with a dialog open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'c' || e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target)) return;
      if (openId || creating || editingProject || showLabels || document.querySelector('[role="dialog"]')) return;
      if (!creatable.length) return;
      e.preventDefault();
      setCreating({});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, creating, editingProject, showLabels, creatable.length]);

  if (loading) return <FigbloomLoader label="Loading tasks" />;
  if (problem || !viewer) {
    return <EmptyState icon={<Kanban size={22} />} title="Could not load tasks" description={problem ?? 'Please sign in again.'} action={<Button onClick={() => { setLoading(true); void reload(); }}>Try again</Button>} />;
  }

  const open = openId ? tasks.find((t) => t.id === openId) ?? null : null;
  const currentProject = scope.startsWith('project:') ? projectById[scope.slice('project:'.length)] : null;
  // HR and admins see every task in the company (read-only unless they're involved); everyone else what concerns them
  const allLabel = viewer.oversees ? 'All company tasks' : 'Everything I can see';
  const title = team ? 'Team tasks' : scope === 'my' ? 'My tasks' : scope === 'all' ? allLabel : scope === 'templates' ? 'Recurring tasks' : currentProject?.name ?? 'Tasks';
  const set = (patch: Partial<TaskFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const navButton = (id: Scope, label: string, icon: ReactNode, count?: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setScope(id)}
      aria-current={scope === id ? 'page' : undefined}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-left ${scope === id ? 'bg-brand/10 text-brand font-medium' : 'text-ink hover:bg-secondary'}`}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[10px] text-muted-foreground">{count}</span>}
    </button>
  );

  const openCount = (pred: (t: Task) => boolean) => tasks.filter((t) => pred(t) && t.status !== 'done' && t.status !== 'cancelled').length;

  return (
    <div className="min-w-0">
      <PageHeader
        title={team ? 'Team tasks' : 'Tasks'}
        subtitle={team ? 'Tasks given to the people who report to you' : 'Projects, boards and your own work. Press C to create a task.'}
        actions={
          <div className="flex flex-wrap gap-2">
            {mode === 'admin' && viewer.manages && (
              <>
                <Button variant="secondary" icon={<Tag size={14} />} onClick={() => setShowLabels(true)}>Labels</Button>
                <Button variant="secondary" icon={<FolderKanban size={14} />} onClick={() => setEditingProject('new')}>New project</Button>
              </>
            )}
            {!team && <Button icon={<Plus size={14} />} onClick={() => (creatable.length ? setCreating({}) : toast.error(mode === 'admin' ? 'Create a project first' : 'You are not in any project yet: ask HR to add you'))}>New task</Button>}
          </div>
        }
      />

      {!team && (
        <p className="mb-3 text-[12px] text-muted-foreground">
          {viewer.oversees
            ? "As HR/admin you can see every task in the company (read-only unless you're involved)."
            : "You see tasks you're involved in: yours, ones you created, your projects', and your team's."}
        </p>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        {!team && (
          <nav aria-label="Task views" className="lg:w-56 shrink-0 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
            {navButton('my', 'My tasks', <User size={14} />, openCount((t) => !!viewer.employeeNumber && t.assignee_number === viewer.employeeNumber))}
            {navButton('all', allLabel, <Layers size={14} />)}
            {mode === 'admin' && viewer.manages && navButton('templates', 'Recurring', <Repeat size={14} />)}
            <p className="hidden lg:block mt-3 mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Projects</p>
            {sidebarProjects.map((p) => (
              <div key={p.id} className="group flex items-center min-w-[9rem] lg:min-w-0">
                {navButton(`project:${p.id}`, p.name, <span className="font-mono text-[9px] px-1 rounded bg-secondary text-muted-foreground">{p.key}</span>, openCount((t) => t.project_id === p.id))}
                {leads(p) && (
                  <button type="button" aria-label={`Edit ${p.name}`} onClick={() => setEditingProject(p)} className="p-1 rounded-md text-muted-foreground opacity-60 hover:opacity-100 hover:bg-secondary">
                    <Settings2 size={12} />
                  </button>
                )}
              </div>
            ))}
            {sidebarProjects.length === 0 && <p className="px-2.5 text-[11px] text-muted-foreground">No projects yet.</p>}
            {mode === 'admin' && projects.some((p) => p.archived) && (
              <button type="button" onClick={() => setShowArchived((s) => !s)} className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-muted-foreground hover:underline">
                <Archive size={11} /> {showArchived ? 'Hide archived' : 'Show archived'}
              </button>
            )}
          </nav>
        )}

        <main className="flex-1 min-w-0">
          {scope === 'templates' ? (
            <TemplatesPanel projects={projects} nameOf={nameOf} onTasksMade={reloadTasks} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-ink mr-auto">{title}</h2>
                <div className="inline-flex rounded-tile border border-border overflow-hidden" role="group" aria-label="Layout">
                  <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')} className={`px-2.5 py-1.5 text-xs inline-flex items-center gap-1 ${view === 'board' ? 'bg-secondary font-medium' : 'bg-white'}`}><Kanban size={13} /> Board</button>
                  <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`px-2.5 py-1.5 text-xs inline-flex items-center gap-1 ${view === 'list' ? 'bg-secondary font-medium' : 'bg-white'}`}><List size={13} /> List</button>
                </div>
              </div>

              {currentProject && !viewer.oversees && !isMember(currentProject) && (
                <p className="mb-3 text-[12px] text-muted-foreground">
                  You are not in this project, so you only see its tasks you're involved in.{leads(currentProject) ? ' Add yourself as a member to see all of them.' : ''}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 mb-3" aria-label="Filters">
                <SearchInput aria-label="Search tasks" placeholder="Search tasks" value={filters.search} onChange={(e) => set({ search: e.target.value })} className="w-full sm:w-56" />
                <select aria-label="Assignee" className="text-xs border border-border rounded-tile px-2 py-1.5 bg-white" value={filters.assignee} onChange={(e) => set({ assignee: e.target.value })}>
                  <option value="">Anyone</option>
                  <option value="none">Unassigned</option>
                  {assigneesInView.map((n) => <option key={n} value={n}>{nameOf(n)}</option>)}
                </select>
                <select aria-label="Priority" className="text-xs border border-border rounded-tile px-2 py-1.5 bg-white" value={filters.priority} onChange={(e) => set({ priority: e.target.value as TaskPriority | '' })}>
                  <option value="">Any priority</option>
                  {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                {labels.length > 0 && (
                  <select aria-label="Label" className="text-xs border border-border rounded-tile px-2 py-1.5 bg-white" value={filters.label} onChange={(e) => set({ label: e.target.value })}>
                    <option value="">Any label</option>
                    {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                )}
                <select aria-label="Due" className="text-xs border border-border rounded-tile px-2 py-1.5 bg-white" value={filters.due} onChange={(e) => set({ due: e.target.value as DueFilter })}>
                  <option value="any">Any due date</option>
                  <option value="overdue">Overdue</option>
                  <option value="today">Due today</option>
                  <option value="week">Due this week</option>
                  <option value="none">No due date</option>
                </select>
                {!scope.startsWith('project:') && (
                  <select aria-label="Project" className="text-xs border border-border rounded-tile px-2 py-1.5 bg-white" value={filters.project} onChange={(e) => set({ project: e.target.value })}>
                    <option value="">Any project</option>
                    {sidebarProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                <select aria-label="Sort" className="text-xs border border-border rounded-tile px-2 py-1.5 bg-white" value={sort} onChange={(e) => setSort(e.target.value as TaskSort)}>
                  <option value="manual">Manual order</option>
                  <option value="priority">Priority</option>
                  <option value="due">Due date</option>
                  <option value="created">Newest</option>
                  <option value="updated">Recently changed</option>
                </select>
                <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="checkbox" checked={filters.showClosed} onChange={(e) => set({ showClosed: e.target.checked })} /> Show done
                </label>
                {activeFilterCount(filters) > 0 && (
                  <button type="button" className="text-xs text-brand hover:underline" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
                )}
              </div>

              {shown.length === 0 && view === 'list' ? (
                <EmptyState
                  icon={<Kanban size={22} />}
                  title={scoped.length ? 'No tasks match these filters' : 'No tasks here yet'}
                  description={scoped.length ? 'Clear a filter to see more.' : creatable.length ? 'Press C or "New task" to add one.' : undefined}
                />
              ) : (
                (() => {
                  const viewProps = {
                    tasks: shown, allTasks: tasks, projects: projectById, labels: labelById, nameOf, canEdit,
                    onOpen: (t: Task) => setOpenId(t.id), onMove: move, sort,
                  };
                  return view === 'board' ? <TaskBoard {...viewProps} /> : <TaskList {...viewProps} />;
                })()
              )}
            </>
          )}
        </main>
      </div>

      {open && (
        <TaskDetail
          key={open.id}
          task={open}
          allTasks={tasks}
          projects={projects}
          labels={labels}
          viewer={viewer}
          nameOf={nameOf}
          people={people}
          onClose={() => setOpenId(null)}
          onChanged={(t) => {
            setTasks((cur) => cur.map((x) => (x.id === t.id ? t : x)));
            if (t.parent_id) void reloadTasks();
          }}
          onDeleted={(id) => {
            setOpenId(null);
            setTasks((cur) => cur.filter((x) => x.id !== id && x.parent_id !== id));
            void reloadTasks();
          }}
          onOpen={(t) => setOpenId(t.id)}
          onCreateSubtask={async (parent, subTitle) => {
            await createTask({ project_id: parent.project_id, parent_id: parent.id, title: subTitle, priority: parent.priority }, viewer);
            await reloadTasks();
          }}
        />
      )}

      {creating && (
        <TaskCreateModal
          open
          onClose={() => setCreating(null)}
          projects={creatable}
          labels={labels}
          viewer={viewer}
          nameOf={nameOf}
          defaultProject={currentProject?.id}
          defaultStatus={creating.status}
          allowGroups
          onCreated={reloadTasks}
        />
      )}

      {editingProject && (
        <ProjectModal
          project={editingProject === 'new' ? null : editingProject}
          members={editingProject === 'new' ? [] : members[editingProject.id] ?? []}
          takenKeys={projects.map((p) => p.key)}
          nameOf={nameOf}
          manages={viewer.manages}
          onClose={() => setEditingProject(null)}
          onSaved={(p) => {
            setEditingProject(null);
            setScope(`project:${p.id}`);
            void reload();
          }}
        />
      )}

      {showLabels && (
        <LabelsModal labels={labels} onClose={() => setShowLabels(false)} onChanged={() => { void loadLabels().then(setLabels); void reloadTasks(); }} />
      )}
    </div>
  );
}
