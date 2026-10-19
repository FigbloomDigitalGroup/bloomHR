import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Button, StatusPill } from '../UI';
import OrientationChecklist from './OrientationChecklist';
import { inputClass } from './OfferEditor';
import { OFFER_STATUS_LABELS, OFFER_STATUS_TONES, type OfferStatus } from '../../lib/offers';
import {
  type AfterHiring,
  type OrientationTemplate,
  type Quiz,
  allowAnotherAttempt,
  assignChecklist,
  assignQuiz,
  isOverdue,
  loadAfterHiring,
  loadOrientationTemplates,
  loadQuizzes,
  setChecklistItemDone,
  shortDate,
} from '../../lib/afterHiring';
import { LoaderBlock } from '../UI/FigbloomLoader';

// "After hiring" on the onboarding review: the employee's offer, orientation checklist (HR ticks any item, or assigns
// another checklist), required training and tests (HR assigns one, sees the score, lets them take it again).

export default function AfterHiringPanel({ employeeId }: { employeeId: string }) {
  const [data, setData] = useState<AfterHiring | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [templates, setTemplates] = useState<OrientationTemplate[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [quizId, setQuizId] = useState('');

  const load = useCallback(() => {
    loadAfterHiring(employeeId).then(setData, (err) => setProblem((err as Error).message));
  }, [employeeId]);
  useEffect(() => {
    load();
    loadOrientationTemplates().then((t) => setTemplates(t.filter((x) => x.active)), () => undefined);
    loadQuizzes().then((q) => setQuizzes(q.filter((x) => x.active)), () => undefined);
  }, [load]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (problem) return <p className="text-sm text-muted-foreground">{problem}</p>;
  if (!data) return <LoaderBlock label="Loading" compact />;

  const assignedQuizzes = new Set(data.tests.map((t) => t.quiz_id));
  return (
    <div className="space-y-4">
      {data.offer && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
          <span className="font-medium">Offer:</span>
          <span>{data.offer.job_title}</span>
          <StatusPill label={OFFER_STATUS_LABELS[data.offer.status as OfferStatus] ?? data.offer.status} tone={OFFER_STATUS_TONES[data.offer.status as OfferStatus] ?? 'neutral'} />
          {data.offer.responded_at && <span className="text-xs text-muted-foreground">answered {shortDate(data.offer.responded_at)}</span>}
          <Link to="/offers" className="text-xs text-brand underline">Offers</Link>
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Orientation</h4>
        <OrientationChecklist items={data.orientation} canTick={() => true}
          onToggle={async (item, done) => {
            await setChecklistItemDone(item.id, done);
            load();
          }} />
        {templates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <select className={`${inputClass} max-w-xs`} value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Checklist to assign">
              <option value="">{data.orientation.length ? 'Replace with another checklist…' : 'Choose a checklist…'}</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Button variant="secondary" disabled={!templateId}
              onClick={() => void run(() => assignChecklist(employeeId, templateId), 'Checklist assigned').then(() => setTemplateId(''))}>
              Assign
            </Button>
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Required training</h4>
        {data.training.length === 0 ? (
          <p className="text-sm text-muted-foreground">No training required for this job.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.training.map((t) => (
              <li key={`${t.kind}-${t.item_id}`} className="flex flex-wrap items-center gap-2">
                <span className="flex-1 min-w-[160px] text-ink">{t.title}{t.due_date ? <span className="text-xs text-muted-foreground"> · due {shortDate(t.due_date)}</span> : null}</span>
                {t.completed ? <StatusPill label={`Completed ${shortDate(t.completed_at)}`} tone="success" />
                  : isOverdue(t.due_date, false) ? <StatusPill label="Overdue" tone="danger" /> : <StatusPill label="Not yet" tone="neutral" />}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Tests</h4>
        {data.tests.length === 0 && <p className="text-sm text-muted-foreground">No tests assigned.</p>}
        <ul className="space-y-1 text-sm">
          {data.tests.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[160px] text-ink">
                {t.title}
                <span className="text-xs text-muted-foreground"> · pass mark {t.pass_mark}%{t.due_date ? ` · due ${shortDate(t.due_date)}` : ''}{t.attempts > 1 ? ` · ${t.attempts} attempts` : ''}</span>
              </span>
              {t.submitted_at ? (
                <>
                  <StatusPill label={`${t.score}% (${t.correct_count}/${t.question_count}) · ${t.passed ? 'Passed' : 'Not passed'}`} tone={t.passed ? 'success' : 'danger'} />
                  <Button variant="ghost" onClick={() => void run(() => allowAnotherAttempt(t.id), 'They can take it again')}>Allow another attempt</Button>
                </>
              ) : (
                <StatusPill label={isOverdue(t.due_date, false) ? 'Overdue' : 'Not taken'} tone={isOverdue(t.due_date, false) ? 'danger' : 'neutral'} />
              )}
            </li>
          ))}
        </ul>
        {quizzes.some((q) => !assignedQuizzes.has(q.id)) && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <select className={`${inputClass} max-w-xs`} value={quizId} onChange={(e) => setQuizId(e.target.value)} aria-label="Test to assign">
              <option value="">Assign a test…</option>
              {quizzes.filter((q) => !assignedQuizzes.has(q.id)).map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
            </select>
            <Button variant="secondary" disabled={!quizId}
              onClick={() => void run(() => assignQuiz(quizId, employeeId), 'Test assigned').then(() => setQuizId(''))}>
              Assign
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
