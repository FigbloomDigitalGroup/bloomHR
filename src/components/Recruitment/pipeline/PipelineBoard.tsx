import { useState } from 'react';
import { CheckCircle2, UserRound } from 'lucide-react';
import { StatusPill } from '../../UI';
import { Candidate, Stage, candidateName, formatDate, sortStages, stageTone } from './types';

interface PipelineBoardProps {
  stages: Stage[];
  candidates: Candidate[];
  onOpen: (candidate: Candidate) => void;
  onMove: (candidate: Candidate, stageId: string) => Promise<void> | void;
}

/**
 * One job's pipeline: a column per stage with its candidates. On a phone the columns stack into a list; each card has
 * a "Move to" picker (more reliable than dragging, and it works by touch).
 */
export default function PipelineBoard({ stages, candidates, onOpen, onMove }: PipelineBoardProps) {
  const [moving, setMoving] = useState<string | null>(null);
  const ordered = sortStages(stages);
  const firstStage = ordered.find((s) => s.kind === 'open') ?? ordered[0];
  const stageOf = (c: Candidate) => (ordered.some((s) => s.id === c.current_stage_id) ? c.current_stage_id : firstStage?.id);

  const move = async (c: Candidate, stageId: string) => {
    if (!stageId || stageId === c.current_stage_id) return;
    setMoving(c.id);
    try {
      await onMove(c, stageId);
    } finally {
      setMoving(null);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-3 md:overflow-x-auto md:pb-2" role="list" aria-label="Pipeline">
      {ordered.map((stage) => {
        const inStage = candidates.filter((c) => stageOf(c) === stage.id);
        return (
          <section
            key={stage.id}
            role="listitem"
            aria-label={`${stage.name} (${inStage.length})`}
            className="md:w-64 md:shrink-0 bg-secondary rounded-card p-2.5 flex flex-col gap-2"
          >
            <header className="flex items-center justify-between px-1">
              <h3 className="text-[12.5px] font-bold text-ink">{stage.name}</h3>
              <StatusPill label={String(inStage.length)} tone={stage.kind === 'open' ? 'neutral' : stageTone(stage.kind)} />
            </header>
            {inStage.length === 0 && <p className="text-[11.5px] text-subtle px-1 pb-1">No candidates</p>}
            {inStage.map((c) => (
              <article key={c.id} className="bg-white border border-border rounded-tile p-2.5 space-y-2">
                <button type="button" onClick={() => onOpen(c)} className="w-full text-left flex items-start gap-2">
                  <span className="w-7 h-7 shrink-0 rounded-full bg-green-tint text-brand flex items-center justify-center">
                    <UserRound className="w-3.5 h-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-ink truncate hover:text-brand">{candidateName(c)}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {[c.position, c.applied_at && `Applied ${formatDate(c.applied_at)}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
                {c.hired_at && (
                  <p className="flex items-center gap-1 text-[11.5px] font-semibold text-status-success">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Hired
                  </p>
                )}
                {c.status === 'withdrawn' ? (
                  <p className="text-[11.5px] text-subtle">Withdrawn by the candidate</p>
                ) : (
                  <label className="block">
                    <span className="sr-only">Move {candidateName(c)} to</span>
                    <select
                      value=""
                      disabled={moving === c.id}
                      onChange={(e) => move(c, e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-tile text-[12px] bg-white"
                    >
                      <option value="">{moving === c.id ? 'Moving...' : 'Move to...'}</option>
                      {ordered
                        .filter((s) => s.id !== stage.id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
