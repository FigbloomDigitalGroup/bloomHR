import { useCallback, useEffect, useState } from 'react';
import { BookOpen, ClipboardList, GraduationCap } from 'lucide-react';
import { Button, Card, Modal, StatusPill } from '../UI';
import OrientationChecklist from './OrientationChecklist';
import QuizTaker from './QuizTaker';
import { type AfterHiring, isOverdue, loadAfterHiring, setChecklistItemDone, shortDate } from '../../lib/afterHiring';

// The staff portal's "My first weeks": the employee's orientation checklist (they tick their own items), the
// training they must complete and the tests they must take.

export default function MyFirstWeeks({ onOpenTraining }: { onOpenTraining?: () => void }) {
  const [data, setData] = useState<AfterHiring | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [taking, setTaking] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(() => {
    loadAfterHiring().then(setData, (err) => setProblem((err as Error).message));
  }, []);
  useEffect(load, [load]);

  if (problem) return <p className="text-sm text-muted-foreground p-4">{problem}</p>;
  if (!data) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;

  const nothing = data.orientation.length === 0 && data.training.length === 0 && data.tests.length === 0;
  return (
    <div className="space-y-4 p-0 sm:p-2">
      <div>
        <h2 className="text-lg font-semibold text-ink">My first weeks</h2>
        <p className="text-sm text-muted-foreground">What to do as you settle in: your orientation, required training and tests.</p>
      </div>
      {nothing && <Card><p className="text-sm text-muted-foreground">Nothing set for you yet.</p></Card>}

      {data.orientation.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Orientation checklist</h3>
          <OrientationChecklist items={data.orientation} canTick={(i) => i.owner_role === 'employee'}
            onToggle={async (item, done) => {
              await setChecklistItemDone(item.id, done);
              load();
            }} />
        </Card>
      )}

      {data.training.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2"><BookOpen className="h-4 w-4" /> Required training</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.training.map((t) => (
              <li key={`${t.kind}-${t.item_id}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm text-ink">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground">{t.kind === 'video' ? 'Video' : 'Document'}{t.due_date ? ` · due ${shortDate(t.due_date)}` : ''}</p>
                </div>
                {t.completed ? <StatusPill label="Completed" tone="success" />
                  : isOverdue(t.due_date, false) ? <StatusPill label="Overdue" tone="danger" /> : <StatusPill label="To do" tone="info" />}
              </li>
            ))}
          </ul>
          {onOpenTraining && <div className="mt-3 flex justify-end"><Button variant="secondary" onClick={onOpenTraining}>Open Training</Button></div>}
        </Card>
      )}

      {data.tests.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Tests</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.tests.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm text-ink">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t.question_count} questions · pass mark {t.pass_mark}%{t.due_date ? ` · due ${shortDate(t.due_date)}` : ''}
                  </p>
                </div>
                {t.submitted_at ? (
                  <StatusPill label={`${t.score}% · ${t.passed ? 'Passed' : 'Not passed'}`} tone={t.passed ? 'success' : 'danger'} />
                ) : (
                  <Button onClick={() => setTaking({ id: t.id, title: t.title })} disabled={t.question_count === 0}>Take test</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {taking && (
        <Modal open onClose={() => setTaking(null)} title={taking.title} size="2xl" closeOnBackdrop={false}>
          <div className="mt-3">
            <QuizTaker assignmentId={taking.id} onFinished={load} onClose={() => setTaking(null)} />
          </div>
        </Modal>
      )}
    </div>
  );
}
