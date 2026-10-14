import { supabase } from '../../../lib/supabase';
import { currentUserAndTenant, randomFileName } from '../../../lib/privateFiles';
import { sendEmail } from '../../../services/email';
import type { Candidate, CompanyUser, Interview, InterviewMode, InterviewStatus, ScorecardInput, Stage, StageMove } from './types';

// Reads and writes for the recruitment pipeline. The database decides who may do what (the 'recruitment' module,
// one scorecard per panelist) and records every stage move itself; these only pass the errors on.

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export interface JobPostingOption {
  id: string;
  job_title: string;
  department: string | null;
  status: string | null;
  is_public?: boolean; // shown on the careers page (FIG-838)
}

export async function loadPostings(): Promise<JobPostingOption[]> {
  const { data, error } = await supabase
    .from('job_postings')
    .select('id, job_title, department, status, is_public')
    .order('posted_at', { ascending: false });
  fail(error);
  return (data || []) as JobPostingOption[];
}

/** A posting's stages, or the company's default stages (used by applications with no posting) when postingId is null. */
export async function loadStages(postingId: string | null): Promise<Stage[]> {
  const base = supabase.from('recruitment_stages').select('id, job_posting_id, name, position, kind');
  const { data, error } = await (postingId ? base.eq('job_posting_id', postingId) : base.is('job_posting_id', null))
    .order('position')
    .order('created_at');
  fail(error);
  return (data || []) as Stage[];
}

export async function loadCandidates(postingId: string | null): Promise<Candidate[]> {
  const base = supabase.from('job_applications').select('*');
  const { data, error } = await (postingId ? base.eq('job_posting_id', postingId) : base.is('job_posting_id', null)).order(
    'applied_at',
    { ascending: false }
  );
  fail(error);
  return (data || []) as Candidate[];
}

export async function loadCompanyUsers(): Promise<CompanyUser[]> {
  const { data, error } = await supabase.from('user_profiles').select('user_id, full_name, email').order('full_name');
  fail(error);
  return (data || []) as CompanyUser[];
}

export async function moveCandidate(applicationId: string, stageId: string, note?: string) {
  const { error } = await supabase.rpc('move_application_stage', {
    p_application: applicationId,
    p_stage: stageId,
    p_note: note?.trim() || null,
  });
  fail(error);
}

// --- stages ---------------------------------------------------------------------------------------------------

export async function renameStage(stageId: string, name: string) {
  const { error } = await supabase.from('recruitment_stages').update({ name: name.trim() }).eq('id', stageId);
  fail(error);
}

export async function addStage(postingId: string | null, name: string, position: number) {
  const { error } = await supabase.from('recruitment_stages').insert({ job_posting_id: postingId, name: name.trim(), position });
  fail(error);
}

export async function removeStage(stageId: string) {
  const { error } = await supabase.from('recruitment_stages').delete().eq('id', stageId);
  fail(error);
}

/** Saves the stages' order: positions 1, 2, 3... in the order given. */
export async function reorderStages(ordered: Stage[]) {
  for (const [i, stage] of ordered.entries()) {
    if (stage.position === i + 1) continue;
    const { error } = await supabase.from('recruitment_stages').update({ position: i + 1 }).eq('id', stage.id);
    fail(error);
  }
}

// --- one candidate ----------------------------------------------------------------------------------------------

export async function loadCandidate(
  applicationId: string
): Promise<{ candidate: Candidate; history: StageMove[]; interviews: Interview[] }> {
  const [app, history, interviews] = await Promise.all([
    supabase.from('job_applications').select('*').eq('id', applicationId).single(),
    supabase
      .from('application_stage_history')
      .select('id, from_stage_name, to_stage_name, note, moved_by, moved_at')
      .eq('application_id', applicationId)
      .order('moved_at', { ascending: false }),
    supabase
      .from('recruitment_interviews')
      .select('*, interview_panelists(user_id), interview_scorecards(*, scorecard_ratings(criterion, score)), interview_transcripts(*)')
      .eq('application_id', applicationId)
      .order('scheduled_at', { ascending: false }),
  ]);
  fail(app.error);
  fail(history.error);
  fail(interviews.error);
  return {
    candidate: app.data as Candidate,
    history: (history.data || []) as StageMove[],
    interviews: (interviews.data || []) as Interview[],
  };
}

export interface InterviewInput {
  applicationId: string;
  scheduledAt: Date;
  durationMinutes: number;
  mode: InterviewMode;
  location?: string;
  meetingLink?: string;
  notes?: string;
  panel?: string[];
}

/** Saves an interview and its panel. */
export async function saveInterview(input: InterviewInput): Promise<string> {
  const { data, error } = await supabase
    .from('recruitment_interviews')
    .insert({
      application_id: input.applicationId,
      scheduled_at: input.scheduledAt.toISOString(),
      duration_minutes: input.durationMinutes,
      mode: input.mode,
      location: input.mode === 'in_person' ? input.location?.trim() || null : null,
      meeting_link: input.mode === 'video' ? input.meetingLink?.trim() || null : null,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single();
  fail(error);
  const id = (data as { id: string }).id;
  if (input.panel?.length) {
    const { error: panelError } = await supabase
      .from('interview_panelists')
      .insert(input.panel.map((user_id) => ({ interview_id: id, user_id })));
    fail(panelError);
  }
  return id;
}

export async function setInterviewStatus(interviewId: string, status: InterviewStatus) {
  const { error } = await supabase.from('recruitment_interviews').update({ status }).eq('id', interviewId);
  fail(error);
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Tells the candidate when and where their interview is. */
export async function sendInterviewEmail(
  candidate: Pick<Candidate, 'email' | 'first_name' | 'position'>,
  interview: Pick<InterviewInput, 'scheduledAt' | 'mode' | 'location' | 'meetingLink' | 'notes'>
) {
  if (!candidate.email) throw new Error('This candidate has no email address');
  const role = escapeHtml(candidate.position || 'the role');
  const where =
    interview.mode === 'video'
      ? `<p><strong>Meeting Link:</strong> ${escapeHtml(interview.meetingLink || '')}</p>`
      : `<p><strong>Location:</strong> ${escapeHtml(interview.location || '')}</p>`;
  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #2563eb;">Interview Scheduled</h2>
      <p>Hello ${escapeHtml(candidate.first_name || '')},</p>
      <p>Your interview for <strong>${role}</strong> has been scheduled.</p>
      <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Date:</strong> ${interview.scheduledAt.toLocaleDateString()}</p>
        <p><strong>Time:</strong> ${interview.scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        ${where}
        ${interview.notes ? `<p><strong>Notes:</strong> ${escapeHtml(interview.notes)}</p>` : ''}
      </div>
    </div>
  `;
  await sendEmail({ to: candidate.email, subject: `Interview Scheduled for ${candidate.position || 'your application'}`, html }, 'recruitment');
}

/** Saves the signed-in panelist's scorecard for an interview (replacing their earlier one). */
export async function saveScorecard(interviewId: string, input: ScorecardInput) {
  const { userId } = await currentUserAndTenant();
  const { data, error } = await supabase
    .from('interview_scorecards')
    .upsert(
      { interview_id: interviewId, panelist_id: userId, recommendation: input.recommendation, notes: input.notes.trim() || null },
      { onConflict: 'interview_id,panelist_id' }
    )
    .select('id')
    .single();
  fail(error);
  const id = (data as { id: string }).id;
  const { error: clearError } = await supabase.from('scorecard_ratings').delete().eq('scorecard_id', id);
  fail(clearError);
  if (input.ratings.length) {
    const { error: ratingError } = await supabase
      .from('scorecard_ratings')
      .insert(input.ratings.map((r) => ({ scorecard_id: id, criterion: r.criterion.trim(), score: r.score })));
    fail(ratingError);
  }
}

// --- transcripts ------------------------------------------------------------------------------------------------

export async function addTextTranscript(interviewId: string, title: string, body: string) {
  const { error } = await supabase
    .from('interview_transcripts')
    .insert({ interview_id: interviewId, kind: 'text', title: title.trim() || null, body });
  fail(error);
}

/** Uploads a transcript file to the private bucket (<company>/<interview>/<random>.<ext>) and records it. */
export async function uploadTranscriptFile(interviewId: string, file: File) {
  const { tenantId } = await currentUserAndTenant();
  const path = `${tenantId}/${interviewId}/${randomFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from('interview-transcripts')
    .upload(path, file, { contentType: file.type || undefined });
  fail(uploadError);
  const { error } = await supabase
    .from('interview_transcripts')
    .insert({ interview_id: interviewId, kind: 'file', title: file.name, file_path: path, file_name: file.name });
  if (error) {
    await supabase.storage.from('interview-transcripts').remove([path]);
    throw new Error(error.message);
  }
}

/** Copies a VideoConf meeting's transcripts onto the interview; returns how many were added. */
export async function linkMeetingTranscript(interviewId: string, meetingCode: string): Promise<number> {
  const { data, error } = await supabase.rpc('link_meeting_transcript', { p_interview: interviewId, p_meeting_code: meetingCode.trim() });
  fail(error);
  return Number(data) || 0;
}
