import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import { STATUSES, formatDue, groupByStatus, isOverdue, sortOrderBetween, subtaskProgress, type TaskStatus } from '../../lib/tasks';
import { LabelChip, PersonBadge, PriorityIcon, StatusIcon } from './TaskBits';
import type { TaskViewProps } from './TaskBoard';

/** Tasks grouped by status (closed groups start folded); the status can be changed in place. */
export default function TaskList(props: TaskViewProps) {
  const groups = useMemo(() => groupByStatus(props.tasks, props.sort ?? 'manual'), [props.tasks, props.sort]);
  const [folded, setFolded] = useState<Record<string, boolean>>({ cancelled: true });

  const visible = STATUSES.filter((s) => groups[s.value].length > 0);
  if (!visible.length) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="task-list">
      {visible.map((s) => {
        const list = groups[s.value];
        const isFolded = !!folded[s.value];
        return (
          <section key={s.value} aria-label={s.label} className="border border-border rounded-card bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setFolded((f) => ({ ...f, [s.value]: !isFolded }))}
              className="w-full flex items-center gap-2 px-3 py-2 bg-secondary/60 text-xs font-semibold text-ink"
              aria-expanded={!isFolded}
            >
              {isFolded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <StatusIcon status={s.value} />
              {s.label}
              <span className="text-muted-foreground font-normal">{list.length}</span>
            </button>
            {!isFolded && (
              <ul className="divide-y divide-border">
                {list.map((t) => {
                  const editable = props.canEdit(t);
                  const progress = t.is_group ? subtaskProgress(t.id, props.allTasks) : null;
                  const project = props.projects[t.project_id];
                  return (
                    <li key={t.id} className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/40" data-testid={`task-row-${t.key}`}>
                      <PriorityIcon priority={t.priority} />
                      <span className="font-mono text-[10px] text-muted-foreground w-16 shrink-0">{t.key}</span>
                      {editable ? (
                        <select
                          aria-label={`Status of ${t.key}`}
                          value={t.status}
                          onChange={(e) => {
                            const status = e.target.value as TaskStatus;
                            const last = groups[status][groups[status].length - 1];
                            props.onMove(t, status, sortOrderBetween(last?.sort_order, null));
                          }}
                          className="text-[11px] border border-border rounded-md px-1 py-0.5 bg-white shrink-0"
                        >
                          {STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                        </select>
                      ) : (
                        <StatusIcon status={t.status} />
                      )}
                      <button type="button" onClick={() => props.onOpen(t)} className="flex-1 min-w-0 text-left text-xs text-ink truncate hover:underline">
                        {t.parent_id && <span className="text-muted-foreground">↳ </span>}
                        {t.title}
                      </button>
                      <span className="hidden md:flex items-center gap-1">
                        {t.labels.map((id) => props.labels[id] && <LabelChip key={id} label={props.labels[id]} />)}
                      </span>
                      {progress && progress.total > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"><GitBranch size={10} />{progress.done}/{progress.total}</span>
                      )}
                      {project && <span className="hidden lg:inline text-[10px] text-muted-foreground">{project.name}</span>}
                      {t.due_date && (
                        <span className={`text-[10px] w-12 text-right ${isOverdue(t) ? 'text-status-danger font-medium' : 'text-muted-foreground'}`}>{formatDue(t.due_date)}</span>
                      )}
                      <PersonBadge name={t.assignee_number ? props.nameOf(t.assignee_number) : null} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
