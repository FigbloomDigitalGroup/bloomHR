import { useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { CalendarDays, GitBranch } from 'lucide-react';
import {
  STATUSES, dropPosition, formatDue, groupByStatus, isOverdue, subtaskProgress,
  type Task, type TaskLabel, type TaskProject, type TaskSort, type TaskStatus,
} from '../../lib/tasks';
import { LabelChip, PersonBadge, PriorityIcon, StatusIcon } from './TaskBits';

export interface TaskViewProps {
  /** the tasks to show (already filtered) */
  tasks: Task[];
  /** every task the viewer can see (for sub-task progress) */
  allTasks: Task[];
  projects: Record<string, TaskProject>;
  labels: Record<string, TaskLabel>;
  nameOf: (employeeNumber: string | null) => string;
  canEdit: (task: Task) => boolean;
  onOpen: (task: Task) => void;
  /** a task moved to a status (and position) */
  onMove: (task: Task, status: TaskStatus, sortOrder: number) => void;
  sort?: TaskSort;
}

const DRAG_TYPE = 'text/x-task-id';

export function TaskCard({ task, props, dragging, onDragStart, onDragEnd, onDropBefore }: {
  task: Task;
  props: TaskViewProps;
  dragging: boolean;
  onDragStart: (e: DragEvent, t: Task) => void;
  onDragEnd: () => void;
  onDropBefore: (e: DragEvent, t: Task) => void;
}) {
  const editable = props.canEdit(task);
  const progress = task.is_group || props.allTasks.some((t) => t.parent_id === task.id) ? subtaskProgress(task.id, props.allTasks) : null;
  const overdue = isOverdue(task);
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`task-card-${task.key}`}
      data-task-card
      draggable={editable}
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => onDropBefore(e, task)}
      onClick={() => props.onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') props.onOpen(task);
      }}
      className={`group bg-white border border-border rounded-tile p-2.5 text-left shadow-sm hover:border-brand/50 transition-colors ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${dragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <PriorityIcon priority={task.priority} size={12} />
        <span className="font-mono">{task.key}</span>
        <span className="ml-auto"><PersonBadge name={task.assignee_number ? props.nameOf(task.assignee_number) : task.is_group ? 'Group' : null} /></span>
      </div>
      <p className="mt-1 text-xs font-medium text-ink leading-snug break-words">{task.title}</p>
      {(task.labels.length > 0 || task.due_date || progress) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {task.labels.map((id) => props.labels[id] && <LabelChip key={id} label={props.labels[id]} />)}
          {task.due_date && (
            <span className={`inline-flex items-center gap-0.5 text-[10px] ${overdue ? 'text-status-danger font-medium' : 'text-muted-foreground'}`}>
              <CalendarDays size={10} /> {formatDue(task.due_date)}
            </span>
          )}
          {progress && progress.total > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="Sub-tasks done">
              <GitBranch size={10} /> {progress.done}/{progress.total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// pressing on these moves them (or uses them), not the board
const NOT_PANNED = '[data-task-card], button, a, input, select, textarea, label';

/**
 * Columns per status; drag a card to another column or between cards (HTML5 drag and drop). Grab the board anywhere
 * else and drag to pan across the columns (no scrollbar); touch screens swipe as usual.
 */
export default function TaskBoard(props: TaskViewProps) {
  const columns = useMemo(() => groupByStatus(props.tasks, props.sort ?? 'manual'), [props.tasks, props.sort]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; left: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const startPan = (e: PointerEvent<HTMLDivElement>) => {
    // touch screens already swipe the board
    if (e.pointerType === 'touch' || e.button !== 0 || (e.target as HTMLElement).closest(NOT_PANNED)) return;
    pan.current = { x: e.clientX, left: e.currentTarget.scrollLeft };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setPanning(true);
  };
  const movePan = (e: PointerEvent<HTMLDivElement>) => {
    if (!pan.current || !boardRef.current) return;
    boardRef.current.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
  };
  const endPan = () => {
    pan.current = null;
    setPanning(false);
  };

  const byId = useMemo(() => new Map(props.tasks.map((t) => [t.id, t])), [props.tasks]);

  const onDragStart = (e: DragEvent, t: Task) => {
    if (!props.canEdit(t)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(DRAG_TYPE, t.id);
    e.dataTransfer.setData('text/plain', t.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragId(t.id);
  };
  const finish = () => {
    setDragId(null);
    setOverStatus(null);
  };
  const draggedFrom = (e: DragEvent) => byId.get(e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData('text/plain') || dragId || '');

  const drop = (e: DragEvent, status: TaskStatus, beforeId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const task = draggedFrom(e);
    finish();
    if (!task || task.id === beforeId) return;
    const order = dropPosition(columns[status], task.id, beforeId);
    if (task.status === status && order === task.sort_order) return;
    props.onMove(task, status, order);
  };

  return (
    <div
      ref={boardRef}
      className={`flex gap-3 overflow-x-auto pb-2 min-h-[50vh] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${panning ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
      data-testid="task-board"
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      {STATUSES.map((s) => (
        <section
          key={s.value}
          aria-label={s.label}
          data-testid={`column-${s.value}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (overStatus !== s.value) setOverStatus(s.value);
          }}
          onDragLeave={() => setOverStatus((cur) => (cur === s.value ? null : cur))}
          onDrop={(e) => drop(e, s.value, null)}
          className={`flex flex-col w-64 shrink-0 rounded-card bg-secondary/60 p-2 transition-colors ${overStatus === s.value ? 'ring-2 ring-brand/40' : ''}`}
        >
          <header className="flex items-center gap-1.5 px-1 pb-2 text-xs font-semibold text-ink">
            <StatusIcon status={s.value} />
            {s.label}
            <span className="ml-1 text-muted-foreground font-normal">{columns[s.value].length}</span>
          </header>
          <div className="flex flex-col gap-2 min-h-[40px]">
            {columns[s.value].map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                props={props}
                dragging={dragId === t.id}
                onDragStart={onDragStart}
                onDragEnd={finish}
                onDropBefore={(e, before) => drop(e, s.value, before.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
