import type { StatusTone } from '../../UI';

// The recruitment pipeline (FIG-830): see supabase/migrations/20261015900000_recruitment_pipeline.sql.

export type StageKind = 'open' | 'hired' | 'rejected';

export interface Stage {
  id: string;
  job_posting_id: string | null;
  name: string;
  position: number;
  kind: StageKind;
}

export interface Candidate {
  id: string;
  job_posting_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  position: string | null;
  department?: string | null;
  preferred_location?: string | null;
  status: string | null;
  current_stage_id: string | null;
  stage_changed_at: string | null;
  hired_at: string | null;
  applied_at: string | null;
  resume_file_url?: string | null;
  resume_file_name?: string | null;
  [key: string]: unknown;
}

export interface StageMove {
  id: string;
  from_stage_name: string | null;
  to_stage_name: string;
  note: string | null;
  moved_by: string | null;
  moved_at: string;
}

export type InterviewMode = 'in_person' | 'video';
export type InterviewStatus = 'scheduled' | 'done' | 'cancelled' | 'no_show';
export type Recommendation = 'strong_yes' | 'yes' | 'no' | 'strong_no';

export interface Rating {
  criterion: string;
  score: number;
}

export interface Scorecard {
  id: string;
  interview_id: string;
  panelist_id: string;
  recommendation: Recommendation;
  notes: string | null;
  submitted_at: string;
  scorecard_ratings: Rating[];
}

export interface Transcript {
  id: string;
  kind: 'text' | 'file' | 'meeting';
  title: string | null;
  body: string | null;
  file_path: string | null;
  file_name: string | null;
  created_at: string;
}

export interface Interview {
  id: string;
  application_id: string;
  stage_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  mode: InterviewMode;
  location: string | null;
  meeting_link: string | null;
  meeting_code: string | null;
  status: InterviewStatus;
  notes: string | null;
  interview_panelists: { user_id: string }[];
  interview_scorecards: Scorecard[];
  interview_transcripts: Transcript[];
}

export interface CompanyUser {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export interface ScorecardInput {
  ratings: Rating[];
  recommendation: Recommendation;
  notes: string;
}

export const DEFAULT_CRITERIA = ['Communication', 'Experience', 'Skills for the role', 'Culture fit'];

export const RECOMMENDATIONS: { value: Recommendation; label: string; tone: StatusTone }[] = [
  { value: 'strong_yes', label: 'Strong yes', tone: 'success' },
  { value: 'yes', label: 'Yes', tone: 'info' },
  { value: 'no', label: 'No', tone: 'warning' },
  { value: 'strong_no', label: 'Strong no', tone: 'danger' },
];

export const INTERVIEW_STATUSES: { value: InterviewStatus; label: string; tone: StatusTone }[] = [
  { value: 'scheduled', label: 'Scheduled', tone: 'info' },
  { value: 'done', label: 'Done', tone: 'success' },
  { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
  { value: 'no_show', label: 'No-show', tone: 'danger' },
];

export const recommendationLabel = (r: Recommendation) => RECOMMENDATIONS.find((x) => x.value === r)?.label ?? r;

export const candidateName = (c: Pick<Candidate, 'first_name' | 'last_name' | 'email'>) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email || 'Unnamed candidate';

export const userName = (users: CompanyUser[], id: string | null) => {
  if (!id) return 'System';
  const u = users.find((x) => x.user_id === id);
  return u?.full_name || u?.email || 'Someone';
};

export const sortStages = (stages: Stage[]) => [...stages].sort((a, b) => a.position - b.position);

export const stageTone = (kind: StageKind): StatusTone => (kind === 'hired' ? 'success' : kind === 'rejected' ? 'danger' : 'info');

export interface ScoreSummary {
  /** scorecards counted */
  count: number;
  /** the average of every criterion score, to one decimal place; null when nothing is scored */
  average: number | null;
  /** how many panelists gave each recommendation */
  recommendations: Record<Recommendation, number>;
}

/** Summarises scorecards: for one interview, or every interview of a candidate. Cancelled interviews don't count. */
export function summariseScores(interviews: Pick<Interview, 'status' | 'interview_scorecards'>[]): ScoreSummary {
  const cards = interviews.filter((i) => i.status !== 'cancelled').flatMap((i) => i.interview_scorecards);
  const scores = cards.flatMap((c) => c.scorecard_ratings.map((r) => r.score));
  const recommendations: Record<Recommendation, number> = { strong_yes: 0, yes: 0, no: 0, strong_no: 0 };
  for (const c of cards) recommendations[c.recommendation] += 1;
  return {
    count: cards.length,
    average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    recommendations,
  };
}

export const formatDateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

export const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');
