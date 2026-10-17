import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Paperclip, Plus, Trash2, X } from 'lucide-react';
import { Button, Modal, TabBar } from '../UI';
import EmployeePicker from '../UI/EmployeePicker';
import {
  PRIORITIES, STATUSES, canDeleteTask, canEditTask, describeActivity, mentionsInText, subtaskProgress,
  type Task, type TaskActivity, type TaskAttachment, type TaskComment, type TaskLabel, type TaskPriority, type TaskProject,
  type TaskStatus, type TaskViewer,
} from '../../lib/tasks';
import {
  addComment, attachmentUrl, deleteComment, deleteTask, loadActivity, loadAttachments, loadComments, removeAttachment,
  setTaskLabels, updateTask, uploadAttachment, type TaskChange,
} from '../../lib/tasksApi';
import { confirmDialog } from '../../lib/confirmDialog';
import MentionInput, { type MentionPerson } from './MentionInput';
import { LabelChip, PersonBadge, StatusIcon, fieldClass, labelClass } from './TaskBits';

interface TaskDetailProps {
  task: Task;
  allTasks: Task[];
  projects: TaskProject[];
  labels: TaskLabel[];
  viewer: TaskViewer;
  nameOf: (n: string | null) => string;
  /** people offered in the @mention list */
  people: MentionPerson[];
  onClose: () => void;
  onChanged: (task: Task) => void;
  onDeleted: (id: string) => void;
  onOpen: (task: Task) => void;
  onCreateSubtask: (parent: Task, title: string) => Promise<void>;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Everything about one task: its fields, sub-tasks, comments (with @mentions), activity and files. */
export default function TaskDetail(props: TaskDetailProps) {
  const { task, viewer } = props;
  const project = props.projects.find((p) => p.id === task.project_id) ?? null;
  const editable = canEditTask(task, viewer, project);
  const deletable = canDeleteTask(task, viewer, project);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [files, setFiles] = useState<TaskAttachment[]>([]);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<MentionPerson[]>([]);
  const [posting, setPosting] = useState(false);
  const [subtask, setSubtask] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? '');
  }, [task.id, task.title, task.description]);

  const refresh = useCallback(async () => {
    try {
      const [c, a, f] = await Promise.all([loadComments(task.id), loadActivity(task.id), loadAttachments(task.id)]);
      setComments(c);
      setActivity(a);
      setFiles(f);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [task.id]);

  useEffect(() => {
    void refresh();
  }, [refresh, task.updated_at]);

  const save = async (change: TaskChange) => {
    try {
      props.onChanged(await updateTask(task.id, change));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const toggleLabel = async (id: string) => {
    const next = task.labels.includes(id) ? task.labels.filter((l) => l !== id) : [...task.labels, id];
    try {
      await setTaskLabels(task.id, next, task.labels);
      props.onChanged({ ...task, labels: next });
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const post = async () => {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    try {
      await addComment(task.id, body, mentionsInText(body, picked), viewer);
      setDraft('');
      setPicked([]);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete ${task.key}?`, message: 'The task, its sub-tasks, comments and files are deleted.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await deleteTask(task.id);
      props.onDeleted(task.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const children = useMemo(() => props.allTasks.filter((t) => t.parent_id === task.id).sort((a, b) => a.number - b.number), [props.allTasks, task.id]);
  const progress = subtaskProgress(task.id, props.allTasks);
  const parent = task.parent_id ? props.allTasks.find((t) => t.id === task.parent_id) : null;

  return (
    <Modal open onClose={props.onClose} size="5xl" title={`${task.key} ${task.title}`} hideTitle className="bg-white rounded-2xl shadow-xl p-0">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border text-xs text-muted-foreground">
        <span className="font-mono">{task.key}</span>
        {project && <span>· {project.name}</span>}
        {parent && (
          <button type="button" className="hover:underline" onClick={() => props.onOpen(parent)}>· sub-task of {parent.key}</button>
        )}
        <span className="ml-auto flex items-center gap-1">
          {deletable && (
            <button type="button" onClick={remove} className="p-1.5 rounded-md hover:bg-secondary" aria-label="Delete task"><Trash2 size={14} /></button>
          )}
          <button type="button" onClick={props.onClose} className="p-1.5 rounded-md hover:bg-secondary" aria-label="Close"><X size={14} /></button>
        </span>
      </div>

      <div className="flex flex-col md:flex-row">
        <div className="flex-1 min-w-0 p-5 flex flex-col gap-4">
          <input
            aria-label="Title"
            value={title}
            disabled={!editable}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title.trim() !== task.title && save({ title: title.trim() })}
            className="w-full text-lg font-semibold text-ink bg-transparent outline-none border-b border-transparent focus:border-brand disabled:text-ink"
          />
          <textarea
            aria-label="Description"
            value={description}
            disabled={!editable}
            placeholder={editable ? 'Add a description...' : 'No description'}
            rows={5}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== (task.description ?? '') && save({ description: description.trim() || null })}
            className={`${fieldClass} resize-y whitespace-pre-wrap`}
          />

          <section aria-label="Sub-tasks">
            <h3 className="text-xs font-semibold text-ink mb-2">
              Sub-tasks {progress.total > 0 && <span className="text-muted-foreground font-normal">{progress.done}/{progress.total} done</span>}
            </h3>
            {progress.total > 0 && (
              <div className="h-1.5 rounded-full bg-secondary mb-2 overflow-hidden" aria-hidden>
                <div className="h-full bg-status-success" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </div>
            )}
            <ul className="flex flex-col gap-1">
              {children.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => props.onOpen(c)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary text-left">
                    <StatusIcon status={c.status} />
                    <span className="font-mono text-[10px] text-muted-foreground">{c.key}</span>
                    <span className="flex-1 text-xs text-ink truncate">{c.title}</span>
                    <PersonBadge name={c.assignee_number ? props.nameOf(c.assignee_number) : null} />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-2 mt-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!subtask.trim()) return;
                try {
                  await props.onCreateSubtask(task, subtask.trim());
                  setSubtask('');
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              <input aria-label="New sub-task" value={subtask} onChange={(e) => setSubtask(e.target.value)} placeholder="Add a sub-task..." className={fieldClass} />
              <Button type="submit" variant="secondary" icon={<Plus size={14} />} disabled={!subtask.trim()}>Add</Button>
            </form>
          </section>

          <section>
            <TabBar
              items={[{ id: 'comments', label: `Comments (${comments.length})` }, { id: 'activity', label: 'Activity' }]}
              activeId={tab}
              onChange={(id) => setTab(id as 'comments' | 'activity')}
              className="mb-3"
            />
            {tab === 'comments' ? (
              <div className="flex flex-col gap-3">
                {comments.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-2" data-testid="task-comment">
                    <PersonBadge name={c.author_name} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-ink">{c.author_name || 'Someone'}</span> · {when(c.created_at)}
                        {c.author_id === viewer.userId && (
                          <button
                            type="button"
                            className="ml-2 hover:underline"
                            onClick={async () => {
                              try {
                                await deleteComment(c.id);
                                await refresh();
                              } catch (e) {
                                toast.error((e as Error).message);
                              }
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </p>
                      <p className="text-xs text-ink whitespace-pre-wrap break-words">{c.body}</p>
                    </div>
                  </div>
                ))}
                <MentionInput
                  value={draft}
                  onChange={setDraft}
                  onMention={(p) => setPicked((cur) => (cur.some((x) => x.number === p.number) ? cur : [...cur, p]))}
                  people={props.people}
                  placeholder="Write a comment... type @ to mention someone"
                  onSubmit={post}
                />
                <div className="flex justify-end">
                  <Button onClick={post} disabled={posting || !draft.trim()}>{posting ? 'Posting...' : 'Comment'}</Button>
                </div>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5" data-testid="task-activity">
                {activity.map((a) => (
                  <li key={a.id} className="text-[11px] text-muted-foreground">
                    {describeActivity(a, props.nameOf)} · {when(a.created_at)}
                  </li>
                ))}
                {activity.length === 0 && <li className="text-xs text-muted-foreground">Nothing yet.</li>}
              </ul>
            )}
          </section>
        </div>

        <aside className="md:w-64 shrink-0 border-t md:border-t-0 md:border-l border-border p-5 flex flex-col gap-3 bg-secondary/30">
          <div>
            <label className={labelClass} htmlFor="task-status">Status</label>
            <select id="task-status" className={fieldClass} value={task.status} disabled={!editable} onChange={(e) => save({ status: e.target.value as TaskStatus })}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="task-priority">Priority</label>
            <select id="task-priority" className={fieldClass} value={task.priority} disabled={!editable} onChange={(e) => save({ priority: e.target.value as TaskPriority })}>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {task.is_group ? (
            <p className="text-[11px] text-muted-foreground">Given to {progress.total} {progress.total === 1 ? 'person' : 'people'}: each has their own sub-task.</p>
          ) : (
            <EmployeePicker
              label="Assignee"
              value={task.assignee_number}
              disabled={!editable}
              onChange={(e) => save({ assignee_number: e?.employeeNumber ?? null })}
              fallbackLabel={task.assignee_number ? props.nameOf(task.assignee_number) : undefined}
            />
          )}
          <div>
            <label className={labelClass} htmlFor="task-due">Due date</label>
            <input id="task-due" type="date" className={fieldClass} value={task.due_date ?? ''} disabled={!editable} onChange={(e) => save({ due_date: e.target.value || null })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="task-project">Project</label>
            <select
              id="task-project"
              className={fieldClass}
              value={task.project_id}
              disabled={!editable || !!task.parent_id}
              onChange={(e) => save({ project_id: e.target.value })}
            >
              {props.projects.filter((p) => !p.archived || p.id === task.project_id).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.key})</option>)}
            </select>
          </div>
          <div>
            <span className={labelClass}>Labels</span>
            {props.labels.length === 0 && <p className="text-[11px] text-muted-foreground">No labels yet.</p>}
            <div className="flex flex-wrap gap-1">
              {props.labels.map((l) => {
                const on = task.labels.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={on}
                    disabled={!editable}
                    onClick={() => toggleLabel(l.id)}
                    className={`rounded-pill ${on ? 'ring-2 ring-brand/50' : 'opacity-50 hover:opacity-100'} disabled:cursor-not-allowed`}
                  >
                    <LabelChip label={l} />
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <span className={labelClass}>Files</span>
            <ul className="flex flex-col gap-1 mb-1">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-1 text-[11px]">
                  <Paperclip size={11} className="shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className="flex-1 min-w-0 truncate text-left text-brand hover:underline"
                    onClick={async () => {
                      try {
                        window.open(await attachmentUrl(f), '_blank', 'noopener');
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    {f.file_name}
                  </button>
                  {(f.uploaded_by === viewer.userId || editable) && (
                    <button
                      type="button"
                      aria-label={`Remove ${f.file_name}`}
                      className="p-0.5 hover:text-status-danger"
                      onClick={async () => {
                        try {
                          await removeAttachment(f);
                          await refresh();
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                    >
                      <X size={11} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <label className="inline-flex items-center gap-1 text-[11px] text-brand cursor-pointer hover:underline">
              <Paperclip size={11} /> {uploading ? 'Uploading...' : 'Attach a file'}
              <input
                type="file"
                className="sr-only"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setUploading(true);
                  try {
                    await uploadAttachment(task.id, file);
                    await refresh();
                  } catch (err) {
                    toast.error((err as Error).message);
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
          </div>
          <p className="text-[10px] text-muted-foreground mt-auto">
            Created {when(task.created_at)}{task.creator_number ? ` by ${props.nameOf(task.creator_number)}` : ''}
            {task.completed_at ? ` · done ${when(task.completed_at)}` : ''}
          </p>
        </aside>
      </div>
    </Modal>
  );
}
