import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button, Modal, StatusPill, TabBar } from '../UI';
import { Field, inputClass } from './OfferEditor';
import {
  OWNER_LABELS,
  SUGGESTED_ITEMS,
  type OrientationTemplate,
  type OwnerRole,
  type Quiz,
  type RequiredTrainingRule,
  type TrainingOption,
  addRequiredTraining,
  deleteOrientationTemplate,
  deleteQuiz,
  loadOrientationTemplates,
  loadQuizzes,
  loadRequiredTraining,
  loadTrainingOptions,
  quizError,
  removeRequiredTraining,
  saveOrientationTemplate,
  saveQuiz,
  templateError,
} from '../../lib/afterHiring';

// Setting up what new employees get after hiring: orientation checklists, the training required of them, and tests.

const smallInput = 'rounded-lg border border-border px-2 py-1.5 text-sm bg-white text-ink';
const int = (v: string) => (v.trim() === '' ? 0 : Math.trunc(Number(v)));

// --- checklists ----------------------------------------------------------------------------

type TemplateDraft = Omit<OrientationTemplate, 'id'> & { id: string | null };

function ChecklistsTab() {
  const [templates, setTemplates] = useState<OrientationTemplate[] | null>(null);
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => loadOrientationTemplates().then(setTemplates, (err) => toast.error((err as Error).message));
  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!editing) return;
    const problem = templateError(editing);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await saveOrientationTemplate(editing.id, editing);
      toast.success('Checklist saved');
      setEditing(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    const setItem = (i: number, patch: Partial<TemplateDraft['items'][number]>) =>
      setEditing({ ...editing, items: editing.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name"><input className={inputClass} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <Field label="For the job title (optional)" hint="New employees with this job title get this checklist">
            <input className={inputClass} value={editing.job_title ?? ''} onChange={(e) => setEditing({ ...editing, job_title: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-ink">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
            Default: give it to new employees whose job title has no checklist of its own
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Due day: days after the start date (0 = the first day, -2 = two days before).</p>
        <ul className="space-y-2">
          {editing.items.map((item, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
              <input className={`${smallInput} flex-1 min-w-[180px]`} value={item.title} placeholder="What needs doing" aria-label={`Item ${i + 1}`}
                onChange={(e) => setItem(i, { title: e.target.value })} />
              <select className={smallInput} value={item.owner_role} aria-label={`Who does item ${i + 1}`} onChange={(e) => setItem(i, { owner_role: e.target.value as OwnerRole })}>
                {(Object.keys(OWNER_LABELS) as OwnerRole[]).map((r) => <option key={r} value={r}>{OWNER_LABELS[r]}</option>)}
              </select>
              <input type="number" className={`${smallInput} w-20`} value={item.due_offset_days} aria-label={`Due day of item ${i + 1}`}
                onChange={(e) => setItem(i, { due_offset_days: int(e.target.value) })} />
              <button type="button" aria-label={`Remove item ${i + 1}`} className="p-1 text-muted-foreground hover:text-status-danger"
                onClick={() => setEditing({ ...editing, items: editing.items.filter((_, j) => j !== i) })}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" icon={<Plus className="h-4 w-4" />}
            onClick={() => setEditing({ ...editing, items: [...editing.items, { title: '', description: null, owner_role: 'hr', due_offset_days: 0 }] })}>
            Add item
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Save checklist</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {templates?.length === 0 && <p className="text-sm text-muted-foreground">No checklists yet. Start from the suggested one and change it to suit you.</p>}
      {templates?.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
          <div className="flex-1 min-w-[160px]">
            <p className="text-sm font-medium text-ink">{t.name}</p>
            <p className="text-xs text-muted-foreground">{t.items.length} items{t.job_title ? ` · for ${t.job_title}` : ''}</p>
          </div>
          {t.is_default && <StatusPill label="Default" tone="success" />}
          {!t.active && <StatusPill label="Inactive" />}
          <Button variant="secondary" onClick={() => setEditing({ ...t })}>Edit</Button>
          <button type="button" aria-label={`Delete ${t.name}`} className="p-1 text-muted-foreground hover:text-status-danger"
            onClick={() => window.confirm(`Delete “${t.name}”? Checklists already given to employees stay.`) &&
              void deleteOrientationTemplate(t.id).then(load, (err) => toast.error((err as Error).message))}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={() => setEditing({ id: null, name: 'First weeks', job_title: null, is_default: !templates?.some((t) => t.is_default), active: true, items: SUGGESTED_ITEMS.map((i) => ({ ...i })) })}>
          Start from suggested
        </Button>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ id: null, name: '', job_title: null, is_default: false, active: true, items: [] })}>
          New checklist
        </Button>
      </div>
    </div>
  );
}

// --- required training ---------------------------------------------------------------------

function TrainingTab() {
  const [rules, setRules] = useState<RequiredTrainingRule[] | null>(null);
  const [options, setOptions] = useState<TrainingOption[]>([]);
  const [choice, setChoice] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [days, setDays] = useState(30);
  const load = () => loadRequiredTraining().then(setRules, (err) => toast.error((err as Error).message));
  useEffect(() => {
    void load();
    loadTrainingOptions().then(setOptions, () => setOptions([]));
  }, []);

  const add = async () => {
    const [kind, id] = choice.split(':');
    try {
      await addRequiredTraining({ item_kind: kind as 'video' | 'document', item_id: id, job_title: jobTitle || null, due_days: days });
      setChoice('');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const titleOf = (r: RequiredTrainingRule) => options.find((o) => o.id === r.item_id)?.title ?? 'Training';
  return (
    <div className="space-y-3">
      {rules?.length === 0 && <p className="text-sm text-muted-foreground">No training required yet. Completion is read from the Training module.</p>}
      <ul className="space-y-2">
        {rules?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
            <div className="flex-1 min-w-[160px]">
              <p className="text-sm text-ink">{titleOf(r)}</p>
              <p className="text-xs text-muted-foreground">
                {r.item_kind === 'video' ? 'Video' : 'Document'} · {r.job_title ? `new ${r.job_title}s` : 'every new employee'} · within {r.due_days} days of starting
              </p>
            </div>
            <button type="button" aria-label={`Stop requiring ${titleOf(r)}`} className="p-1 text-muted-foreground hover:text-status-danger"
              onClick={() => void removeRequiredTraining(r.id).then(load, (err) => toast.error((err as Error).message))}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add training videos or documents in Training first.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_100px_auto] gap-2 items-end">
          <Field label="Training">
            <select className={inputClass} value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Training to require">
              <option value="">Choose…</option>
              {options.map((o) => <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>{o.title} ({o.kind})</option>)}
            </select>
          </Field>
          <Field label="Job title (empty: everyone)">
            <input className={inputClass} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </Field>
          <Field label="Within days">
            <input type="number" min={0} max={365} className={inputClass} value={days} onChange={(e) => setDays(int(e.target.value))} />
          </Field>
          <Button disabled={!choice} onClick={() => void add()} icon={<Plus className="h-4 w-4" />}>Require</Button>
        </div>
      )}
    </div>
  );
}

// --- tests ---------------------------------------------------------------------------------

type QuizDraft = Omit<Quiz, 'id'> & { id: string | null };

export function QuizEditor({ quiz, onCancel, onSaved }: { quiz: QuizDraft; onCancel: () => void; onSaved: () => void }) {
  const [q, setQ] = useState<QuizDraft>(quiz);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const setQuestion = (i: number, patch: Partial<QuizDraft['questions'][number]>) =>
    setQ({ ...q, questions: q.questions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const save = async () => {
    const error = quizError(q);
    setProblem(error);
    if (error) return;
    setBusy(true);
    try {
      await saveQuiz(q.id, q);
      toast.success('Test saved');
      onSaved();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Title"><input className={inputClass} value={q.title} onChange={(e) => setQ({ ...q, title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pass mark (%)"><input type="number" min={0} max={100} className={inputClass} value={q.pass_mark} onChange={(e) => setQ({ ...q, pass_mark: int(e.target.value) })} /></Field>
          <Field label="Days to complete"><input type="number" min={0} max={365} className={inputClass} value={q.due_days} onChange={(e) => setQ({ ...q, due_days: int(e.target.value) })} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Instructions (optional)">
            <textarea className={inputClass} rows={2} value={q.description ?? ''} onChange={(e) => setQ({ ...q, description: e.target.value })} />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm text-ink">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={q.auto_assign} onChange={(e) => setQ({ ...q, auto_assign: e.target.checked })} /> Give to new employees
        </label>
        {q.auto_assign && (
          <input className={`${smallInput} min-w-[200px]`} placeholder="Job title (empty: everyone)" aria-label="Job title" value={q.job_title ?? ''}
            onChange={(e) => setQ({ ...q, job_title: e.target.value })} />
        )}
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={q.active} onChange={(e) => setQ({ ...q, active: e.target.checked })} /> Active
        </label>
      </div>
      <ol className="space-y-3">
        {q.questions.map((x, i) => (
          <li key={i} className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex gap-2">
              <input className={`${smallInput} flex-1`} value={x.question} placeholder={`Question ${i + 1}`} aria-label={`Question ${i + 1}`}
                onChange={(e) => setQuestion(i, { question: e.target.value })} />
              <button type="button" aria-label={`Remove question ${i + 1}`} className="p-1 text-muted-foreground hover:text-status-danger"
                onClick={() => setQ({ ...q, questions: q.questions.filter((_, j) => j !== i) })}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {x.options.map((o, oi) => (
              <div key={oi} className="flex items-center gap-2 pl-2">
                <input type="radio" name={`right-${i}`} checked={x.correct_index === oi} aria-label={`Choice ${oi + 1} of question ${i + 1} is right`}
                  onChange={() => setQuestion(i, { correct_index: oi })} />
                <input className={`${smallInput} flex-1`} value={o} placeholder={`Choice ${oi + 1}`} aria-label={`Choice ${oi + 1} of question ${i + 1}`}
                  onChange={(e) => setQuestion(i, { options: x.options.map((v, k) => (k === oi ? e.target.value : v)) })} />
                {x.options.length > 2 && (
                  <button type="button" aria-label={`Remove choice ${oi + 1} of question ${i + 1}`} className="p-1 text-muted-foreground"
                    onClick={() => setQuestion(i, {
                      options: x.options.filter((_, k) => k !== oi),
                      correct_index: x.correct_index === oi ? 0 : x.correct_index > oi ? x.correct_index - 1 : x.correct_index,
                    })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {x.options.length < 8 && (
              <button type="button" className="text-xs text-brand pl-2" onClick={() => setQuestion(i, { options: [...x.options, ''] })}>+ Add a choice</button>
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">Mark the right answer of each question with its round button.</p>
      {problem && <p role="alert" className="text-sm text-status-danger">{problem}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="secondary" icon={<Plus className="h-4 w-4" />}
          onClick={() => setQ({ ...q, questions: [...q.questions, { question: '', options: ['', ''], correct_index: 0 }] })}>
          Add question
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Save test</Button>
        </div>
      </div>
    </div>
  );
}

function TestsTab() {
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null);
  const [editing, setEditing] = useState<QuizDraft | null>(null);
  const load = () => loadQuizzes().then(setQuizzes, (err) => toast.error((err as Error).message));
  useEffect(() => {
    void load();
  }, []);

  if (editing) return <QuizEditor quiz={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />;
  return (
    <div className="space-y-2">
      {quizzes?.length === 0 && <p className="text-sm text-muted-foreground">No tests yet.</p>}
      {quizzes?.map((q) => (
        <div key={q.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
          <div className="flex-1 min-w-[160px]">
            <p className="text-sm font-medium text-ink">{q.title}</p>
            <p className="text-xs text-muted-foreground">
              {q.questions.length} questions · pass mark {q.pass_mark}%{q.auto_assign ? ` · given to new ${q.job_title ? `${q.job_title}s` : 'employees'}` : ''}
            </p>
          </div>
          {!q.active && <StatusPill label="Inactive" />}
          <Button variant="secondary" onClick={() => setEditing({ ...q })}>Edit</Button>
          <button type="button" aria-label={`Delete ${q.title}`} className="p-1 text-muted-foreground hover:text-status-danger"
            onClick={() => window.confirm(`Delete “${q.title}” and everyone’s results for it?`) &&
              void deleteQuiz(q.id).then(load, (err) => toast.error((err as Error).message))}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex justify-end pt-2">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({
          id: null, title: '', description: null, pass_mark: 70, auto_assign: true, job_title: null, due_days: 14, active: true,
          questions: [{ question: '', options: ['', ''], correct_index: 0 }],
        })}>
          New test
        </Button>
      </div>
    </div>
  );
}

type Tab = 'checklists' | 'training' | 'tests';

export default function AfterHiringSetupModal({ onClose, initialTab = 'checklists' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <Modal open onClose={onClose} title="After hiring: what new employees get" size="4xl">
      <div className="mt-3 space-y-4">
        <TabBar variant="pill" activeId={tab} onChange={(id) => setTab(id as Tab)}
          items={[{ id: 'checklists', label: 'Orientation checklists' }, { id: 'training', label: 'Required training' }, { id: 'tests', label: 'Tests' }]} />
        {tab === 'checklists' && <ChecklistsTab />}
        {tab === 'training' && <TrainingTab />}
        {tab === 'tests' && <TestsTab />}
      </div>
    </Modal>
  );
}
