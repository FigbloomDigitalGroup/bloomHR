import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '../UI';
import { type QuizResult, type QuizToTake, loadQuizToTake, submitQuiz } from '../../lib/afterHiring';

import { confirmDialog } from '../../lib/confirmDialog';
// Taking a test in the staff portal: one choice per question, then the answers are sent and marked by the database
// (the right answers never reach the browser). One attempt; the result shows straight away.

export default function QuizTaker({ assignmentId, onFinished, onClose }: {
  assignmentId: string;
  onFinished: (result: QuizResult) => void;
  onClose: () => void;
}) {
  const [quiz, setQuiz] = useState<QuizToTake | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    loadQuizToTake(assignmentId).then(
      (q) => {
        setQuiz(q);
        setAnswers(q.questions.map(() => null));
      },
      (err) => setProblem((err as Error).message)
    );
  }, [assignmentId]);

  const unanswered = answers.filter((a) => a === null).length;

  const submit = async () => {
    if (unanswered > 0) {
      setProblem(`Answer every question (${unanswered} left).`);
      return;
    }
    if (!(await confirmDialog({ title: 'Send your answers?', message: 'You can take this test once.', confirmLabel: 'Send answers' }))) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await submitQuiz(assignmentId, answers as number[]);
      setResult(r);
      onFinished(r);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="space-y-3 text-center py-4" role="status">
        {result.passed ? <CheckCircle2 className="h-10 w-10 mx-auto text-status-success" /> : <XCircle className="h-10 w-10 mx-auto text-status-danger" />}
        <p className="text-lg font-semibold text-ink">{result.passed ? 'You passed' : 'Not passed this time'}</p>
        <p className="text-sm text-muted-foreground">
          You scored {result.score}% ({result.correct} of {result.total} right). The pass mark is {result.pass_mark}%.
        </p>
        {!result.passed && <p className="text-sm text-muted-foreground">HR can let you take it again.</p>}
        <Button onClick={onClose}>Done</Button>
      </div>
    );
  }

  if (!quiz) {
    return problem ? <p role="alert" className="text-sm text-status-danger">{problem}</p> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading the test" />;
  }

  return (
    <div className="space-y-4">
      {quiz.description && <p className="text-sm text-muted-foreground">{quiz.description}</p>}
      <p className="text-xs text-muted-foreground">{quiz.questions.length} questions · pass mark {quiz.pass_mark}%</p>
      <ol className="space-y-4">
        {quiz.questions.map((q, qi) => (
          <li key={q.id}>
            <fieldset>
              <legend className="text-sm font-medium text-ink mb-2">{qi + 1}. {q.question}</legend>
              <div className="space-y-1.5">
                {q.options.map((option, oi) => (
                  <label key={oi} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${answers[qi] === oi ? 'border-brand bg-secondary' : 'border-border'}`}>
                    <input type="radio" name={`q-${q.id}`} checked={answers[qi] === oi}
                      onChange={() => setAnswers((a) => a.map((x, i) => (i === qi ? oi : x)))} />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {problem && <p role="alert" className="text-sm text-status-danger">{problem}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void submit()} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Send answers</Button>
      </div>
    </div>
  );
}
