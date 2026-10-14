import { FormEvent, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '../../UI';
import { DEFAULT_CRITERIA, RECOMMENDATIONS, Recommendation, Scorecard, ScorecardInput } from './types';

interface ScorecardFormProps {
  /** the panelist's earlier scorecard, to edit */
  existing?: Scorecard | null;
  onSubmit: (input: ScorecardInput) => Promise<void> | void;
  onCancel?: () => void;
}

interface Row {
  criterion: string;
  score: number | null;
}

/** A panelist's scorecard: each criterion 1-5, a recommendation and notes. */
export default function ScorecardForm({ existing, onSubmit, onCancel }: ScorecardFormProps) {
  const [rows, setRows] = useState<Row[]>(() =>
    existing?.scorecard_ratings.length
      ? existing.scorecard_ratings.map((r) => ({ criterion: r.criterion, score: r.score }))
      : DEFAULT_CRITERIA.map((criterion) => ({ criterion, score: null }))
  );
  const [recommendation, setRecommendation] = useState<Recommendation | ''>(existing?.recommendation ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [newCriterion, setNewCriterion] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const setScore = (i: number, score: number) => setRows((r) => r.map((row, j) => (j === i ? { ...row, score } : row)));

  const addCriterion = () => {
    const name = newCriterion.trim();
    if (!name) return;
    if (rows.some((r) => r.criterion.toLowerCase() === name.toLowerCase())) {
      setError(`${name} is already on the scorecard`);
      return;
    }
    setRows((r) => [...r, { criterion: name, score: null }]);
    setNewCriterion('');
    setError('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const scored = rows.filter((r) => r.score !== null);
    if (!scored.length) return setError('Score at least one criterion');
    if (!recommendation) return setError('Choose a recommendation');
    setError('');
    setSaving(true);
    try {
      await onSubmit({ ratings: scored.map((r) => ({ criterion: r.criterion, score: r.score as number })), recommendation, notes });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Scorecard">
      <div className="space-y-2">
        {rows.map((row, i) => (
          <fieldset key={row.criterion} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <legend className="sr-only">{row.criterion}</legend>
            <div className="flex items-center gap-1 sm:w-48 text-[13px] font-medium text-ink">
              <span className="truncate">{row.criterion}</span>
              <button
                type="button"
                aria-label={`Remove ${row.criterion}`}
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                className="text-subtle hover:text-status-danger"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex gap-1.5" role="radiogroup" aria-label={`${row.criterion} score`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={row.score === n}
                  aria-label={`${row.criterion}: ${n}`}
                  onClick={() => setScore(i, n)}
                  className={`w-9 h-9 rounded-tile border text-[13px] font-semibold transition-colors ${
                    row.score === n ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-border hover:bg-secondary'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={newCriterion}
          onChange={(e) => setNewCriterion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCriterion();
            }
          }}
          placeholder="Add a criterion"
          aria-label="New criterion"
          className="flex-1 min-w-0 px-3 py-2 border border-border rounded-tile text-[13px]"
        />
        <Button variant="secondary" onClick={addCriterion} icon={<Plus className="w-3.5 h-3.5" />}>
          Add
        </Button>
      </div>

      <fieldset>
        <legend className="text-[12px] font-semibold text-muted-foreground mb-1.5">Recommendation</legend>
        <div className="flex flex-wrap gap-2">
          {RECOMMENDATIONS.map((r) => (
            <label
              key={r.value}
              className={`px-3 py-1.5 rounded-pill border text-[12.5px] font-semibold cursor-pointer ${
                recommendation === r.value ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-border'
              }`}
            >
              <input
                type="radio"
                name="recommendation"
                value={r.value}
                checked={recommendation === r.value}
                onChange={() => setRecommendation(r.value)}
                className="sr-only"
              />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="text-[12px] font-semibold text-muted-foreground">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full px-3 py-2 border border-border rounded-tile text-[13px]"
        />
      </label>

      {error && (
        <p role="alert" className="text-[12.5px] text-status-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : existing ? 'Update scorecard' : 'Submit scorecard'}
        </Button>
      </div>
    </form>
  );
}
