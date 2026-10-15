import { ReactNode, useState } from 'react';
import { CalendarClock, CheckCircle2, FileText, Link2, MapPin, Paperclip, Upload, Video } from 'lucide-react';
import { Button, Card, EmptyState, StatusPill } from '../../UI';
import ScorecardForm from './ScorecardForm';
import ScheduleInterviewForm from './ScheduleInterviewForm';
import type { InterviewInput } from './api';
import {
  Candidate,
  CompanyUser,
  INTERVIEW_STATUSES,
  Interview,
  InterviewStatus,
  RECOMMENDATIONS,
  ScoreSummary,
  ScorecardInput,
  Stage,
  StageMove,
  Transcript,
  candidateName,
  formatDate,
  formatDateTime,
  recommendationLabel,
  sortStages,
  stageTone,
  summariseScores,
  userName,
} from './types';

export interface CandidateActions {
  onMove: (stageId: string, note: string) => Promise<void>;
  onSchedule: (input: InterviewInput, emailCandidate: boolean) => Promise<void>;
  onInterviewStatus: (interviewId: string, status: InterviewStatus) => Promise<void>;
  onScorecard: (interviewId: string, input: ScorecardInput) => Promise<void>;
  onAddText: (interviewId: string, title: string, body: string) => Promise<void>;
  onUpload: (interviewId: string, file: File) => Promise<void>;
  onLinkMeeting: (interviewId: string, meetingCode: string) => Promise<void>;
  onOpenFile: (transcript: Transcript) => void;
  onOpenCv: () => void;
}

interface CandidateViewProps extends CandidateActions {
  candidate: Candidate;
  stages: Stage[];
  history: StageMove[];
  interviews: Interview[];
  users: CompanyUser[];
  currentUserId: string | null;
  /** open with the Schedule interview form showing (the candidate was just shortlisted) */
  startScheduling?: boolean;
}

/** A stage after which the next step is an interview: shortlisted or interview stages, by name. */
export const isInterviewStage = (stage: { name: string; kind?: string } | undefined) =>
  !!stage && stage.kind !== 'hired' && stage.kind !== 'rejected' && /shortlist|interview/i.test(stage.name);

const DETAILS: [string, string][] = [
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['position', 'Position'],
  ['department', 'Department'],
  ['preferred_location', 'Preferred location'],
  ['available_start_date', 'Available from'],
  ['education', 'Education'],
  ['university', 'University'],
  ['work_experience', 'Experience'],
  ['previous_company', 'Previous company'],
  ['previous_role', 'Previous role'],
  ['expected_salary', 'Expected salary'],
  ['skills', 'Skills'],
  ['languages', 'Languages'],
];

const Section = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <Card padding="md" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[14px] font-bold text-ink">{title}</h3>
      {action}
    </div>
    {children}
  </Card>
);

function SummaryLine({ summary }: { summary: ScoreSummary }) {
  if (!summary.count) return <p className="text-[12px] text-subtle">No scorecards yet</p>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
      <span className="font-semibold text-ink">
        {summary.average ?? '-'} / 5 average from {summary.count} scorecard{summary.count === 1 ? '' : 's'}
      </span>
      {RECOMMENDATIONS.filter((r) => summary.recommendations[r.value]).map((r) => (
        <StatusPill key={r.value} tone={r.tone} label={`${r.label}: ${summary.recommendations[r.value]}`} />
      ))}
    </div>
  );
}

function TranscriptAdder({ interview, actions }: { interview: Interview; actions: CandidateActions }) {
  const [mode, setMode] = useState<'' | 'text' | 'file' | 'meeting'>('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [code, setCode] = useState(interview.meeting_code ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      setMode('');
      setTitle('');
      setBody('');
      setFile(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full px-3 py-2 border border-border rounded-tile text-[13px] bg-white';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setMode('text')} icon={<FileText className="w-3.5 h-3.5" />}>
          Paste transcript or notes
        </Button>
        <Button variant="secondary" onClick={() => setMode('file')} icon={<Upload className="w-3.5 h-3.5" />}>
          Upload file
        </Button>
        <Button variant="secondary" onClick={() => setMode('meeting')} icon={<Link2 className="w-3.5 h-3.5" />}>
          Link VideoConf meeting
        </Button>
      </div>
      {mode === 'text' && (
        <div className="space-y-2">
          <input aria-label="Transcript title" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
          <textarea aria-label="Transcript text" rows={5} value={body} onChange={(e) => setBody(e.target.value)} className={input} />
          <Button disabled={busy || !body.trim()} onClick={() => run(() => actions.onAddText(interview.id, title, body))}>
            Save transcript
          </Button>
        </div>
      )}
      {mode === 'file' && (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            aria-label="Transcript file"
            type="file"
            accept=".pdf,.doc,.docx,.txt,.vtt,.srt,audio/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-[12.5px]"
          />
          <Button disabled={busy || !file} onClick={() => file && run(() => actions.onUpload(interview.id, file))}>
            {busy ? 'Uploading...' : 'Upload'}
          </Button>
        </div>
      )}
      {mode === 'meeting' && (
        <div className="flex flex-col sm:flex-row gap-2">
          <input aria-label="Meeting code" placeholder="Meeting code" value={code} onChange={(e) => setCode(e.target.value)} className={input} />
          <Button disabled={busy || !code.trim()} onClick={() => run(() => actions.onLinkMeeting(interview.id, code))}>
            Link transcript
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] text-status-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function InterviewCard({
  interview,
  stages,
  users,
  currentUserId,
  actions,
}: {
  interview: Interview;
  stages: Stage[];
  users: CompanyUser[];
  currentUserId: string | null;
  actions: CandidateActions;
}) {
  const [scoring, setScoring] = useState(false);
  const status = INTERVIEW_STATUSES.find((s) => s.value === interview.status);
  const onPanel = !!currentUserId && interview.interview_panelists.some((p) => p.user_id === currentUserId);
  const mine = interview.interview_scorecards.find((s) => s.panelist_id === currentUserId) ?? null;
  const stage = stages.find((s) => s.id === interview.stage_id);

  return (
    <article className="border border-border rounded-tile p-3 space-y-3" aria-label={`Interview ${formatDateTime(interview.scheduled_at)}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <CalendarClock className="w-3.5 h-3.5" /> {formatDateTime(interview.scheduled_at)} · {interview.duration_minutes} min
          </p>
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {interview.mode === 'video' ? <Video className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
            {interview.mode === 'video' ? interview.meeting_link || 'Video' : interview.location || 'In person'}
            {stage && <> · {stage.name}</>}
          </p>
          <p className="text-[12px] text-muted-foreground">
            Panel: {interview.interview_panelists.map((p) => userName(users, p.user_id)).join(', ') || 'none'}
          </p>
        </div>
        <label className="flex items-center gap-2">
          {status && <StatusPill tone={status.tone} label={status.label} />}
          <span className="sr-only">Interview status</span>
          <select
            value={interview.status}
            onChange={(e) => actions.onInterviewStatus(interview.id, e.target.value as InterviewStatus)}
            className="px-2 py-1 border border-border rounded-tile text-[12px] bg-white"
          >
            {INTERVIEW_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {interview.notes && <p className="text-[12.5px] text-ink whitespace-pre-wrap">{interview.notes}</p>}

      <div className="space-y-2">
        <h4 className="text-[12.5px] font-bold text-ink">Scores</h4>
        <SummaryLine summary={summariseScores([interview])} />
        {interview.interview_scorecards.map((card) => (
          <div key={card.id} className="bg-secondary rounded-tile p-2.5 text-[12.5px] space-y-1">
            <p className="font-semibold text-ink">
              {userName(users, card.panelist_id)}: {recommendationLabel(card.recommendation)}
            </p>
            <p className="text-muted-foreground">{card.scorecard_ratings.map((r) => `${r.criterion} ${r.score}/5`).join(' · ')}</p>
            {card.notes && <p className="text-ink whitespace-pre-wrap">{card.notes}</p>}
          </div>
        ))}
        {onPanel && interview.status !== 'cancelled' && !scoring && (
          <Button variant="secondary" onClick={() => setScoring(true)}>
            {mine ? 'Edit my scorecard' : 'Score this interview'}
          </Button>
        )}
        {scoring && (
          <ScorecardForm
            existing={mine}
            onCancel={() => setScoring(false)}
            onSubmit={async (input) => {
              await actions.onScorecard(interview.id, input);
              setScoring(false);
            }}
          />
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-[12.5px] font-bold text-ink">Transcripts and notes</h4>
        {interview.interview_transcripts.length === 0 && <p className="text-[12px] text-subtle">None yet</p>}
        {interview.interview_transcripts.map((t) => (
          <details key={t.id} className="bg-secondary rounded-tile p-2.5 text-[12.5px]">
            <summary className="cursor-pointer font-semibold text-ink">
              {t.title || (t.kind === 'meeting' ? 'Meeting transcript' : 'Notes')}{' '}
              <span className="font-normal text-muted-foreground">· {formatDateTime(t.created_at)}</span>
            </summary>
            {t.kind === 'file' ? (
              <button type="button" onClick={() => actions.onOpenFile(t)} className="mt-2 flex items-center gap-1 text-brand font-semibold">
                <Paperclip className="w-3.5 h-3.5" /> Open {t.file_name || 'file'}
              </button>
            ) : (
              <p className="mt-2 whitespace-pre-wrap text-ink">{t.body}</p>
            )}
          </details>
        ))}
        <TranscriptAdder interview={interview} actions={actions} />
      </div>
    </article>
  );
}

/** Everything about one candidate: details and CV, where they are, how they got there, interviews, scores, decision. */
export default function CandidateView(props: CandidateViewProps) {
  const { candidate, stages, history, interviews, users, currentUserId, startScheduling = false, ...actions } = props;
  const [stageId, setStageId] = useState('');
  const [note, setNote] = useState('');
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState('');
  const [scheduling, setScheduling] = useState(startScheduling);

  const ordered = sortStages(stages);
  const current = ordered.find((s) => s.id === candidate.current_stage_id);
  const withdrawn = candidate.status === 'withdrawn';

  const move = async () => {
    if (!stageId) return;
    setMoving(true);
    setMoveError('');
    try {
      await actions.onMove(stageId, note);
      // shortlisted: the next step is booking the interview
      if (isInterviewStage(stages.find((s) => s.id === stageId))) setScheduling(true);
      setStageId('');
      setNote('');
    } catch (err) {
      setMoveError((err as Error).message);
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-ink mr-1">{candidateName(candidate)}</h2>
        {current && <StatusPill tone={stageTone(current.kind)} label={current.name} />}
        {withdrawn && <StatusPill tone="neutral" label="Withdrawn" />}
      </div>

      <Section title="Decision">
        {candidate.hired_at ? (
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-status-success">
            <CheckCircle2 className="w-4 h-4" /> Hired on {formatDate(candidate.hired_at)}
          </p>
        ) : current?.kind === 'rejected' ? (
          <p className="text-[13px] font-semibold text-status-danger">Not taken forward</p>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            In {current?.name ?? 'the pipeline'}
            {candidate.stage_changed_at ? ` since ${formatDate(candidate.stage_changed_at)}` : ''}
          </p>
        )}
        <SummaryLine summary={summariseScores(interviews)} />
        {!withdrawn && (
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="sm:w-48">
              <span className="sr-only">Move to stage</span>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-tile text-[13px] bg-white"
              >
                <option value="">Move to...</option>
                {ordered
                  .filter((s) => s.id !== candidate.current_stage_id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <input
              aria-label="Note for this move"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 border border-border rounded-tile text-[13px]"
            />
            <Button onClick={move} disabled={!stageId || moving}>
              {moving ? 'Moving...' : 'Move'}
            </Button>
          </div>
        )}
        {moveError && (
          <p role="alert" className="text-[12.5px] text-status-danger">
            {moveError}
          </p>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section
          title="Details"
          action={
            (candidate.resume_file_url || candidate.resume_file_name) && (
              <Button variant="secondary" onClick={actions.onOpenCv} icon={<FileText className="w-3.5 h-3.5" />}>
                View CV
              </Button>
            )
          }
        >
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
            {DETAILS.filter(([key]) => candidate[key]).map(([key, label]) => (
              <div key={key} className="min-w-0">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-ink break-words">{String(candidate[key])}</dd>
              </div>
            ))}
            {candidate.applied_at && (
              <div>
                <dt className="text-muted-foreground">Applied</dt>
                <dd className="text-ink">{formatDate(candidate.applied_at)}</dd>
              </div>
            )}
          </dl>
          {typeof candidate.cover_letter === 'string' && candidate.cover_letter && (
            <details className="text-[12.5px]">
              <summary className="cursor-pointer font-semibold text-ink">Cover letter</summary>
              <p className="mt-1 whitespace-pre-wrap text-ink">{candidate.cover_letter}</p>
            </details>
          )}
        </Section>

        <Section title="Stage history">
          <ol className="relative border-l border-border ml-1.5 space-y-3" aria-label="Stage history">
            {history.map((h) => (
              <li key={h.id} className="pl-4 relative">
                <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-brand" />
                <p className="text-[12.5px] font-semibold text-ink">
                  {h.from_stage_name ? `${h.from_stage_name} → ${h.to_stage_name}` : h.to_stage_name}
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  {formatDateTime(h.moved_at)} · {userName(users, h.moved_by)}
                </p>
                {h.note && <p className="text-[12px] text-ink whitespace-pre-wrap">{h.note}</p>}
              </li>
            ))}
          </ol>
          {history.length === 0 && <p className="text-[12px] text-subtle">No moves yet</p>}
        </Section>
      </div>

      <Section
        title={`Interviews (${interviews.length})`}
        action={
          !scheduling && (
            <Button onClick={() => setScheduling(true)} icon={<CalendarClock className="w-3.5 h-3.5" />}>
              Schedule interview
            </Button>
          )
        }
      >
        {scheduling && (
          <ScheduleInterviewForm
            applicationId={candidate.id}
            users={users}
            onCancel={() => setScheduling(false)}
            onSubmit={async (input, email) => {
              await actions.onSchedule(input, email);
              setScheduling(false);
            }}
          />
        )}
        {interviews.length === 0 && !scheduling && (
          <EmptyState icon={<CalendarClock className="w-5 h-5" />} title="No interviews yet" />
        )}
        {interviews.map((i) => (
          <InterviewCard key={i.id} interview={i} stages={stages} users={users} currentUserId={currentUserId} actions={actions} />
        ))}
      </Section>
    </div>
  );
}
