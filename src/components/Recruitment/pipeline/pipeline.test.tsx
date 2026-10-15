import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PipelineBoard from './PipelineBoard';
import CandidateView, { CandidateActions, isInterviewStage } from './CandidateView';
import ScorecardForm from './ScorecardForm';
import { Candidate, Interview, Stage, summariseScores } from './types';

afterEach(cleanup);

const stages: Stage[] = [
  { id: 's-hired', job_posting_id: 'p1', name: 'Hired', position: 6, kind: 'hired' },
  { id: 's-applied', job_posting_id: 'p1', name: 'Applied', position: 1, kind: 'open' },
  { id: 's-screen', job_posting_id: 'p1', name: 'Screening', position: 2, kind: 'open' },
  { id: 's-interview', job_posting_id: 'p1', name: 'Interview', position: 3, kind: 'open' },
  { id: 's-rejected', job_posting_id: 'p1', name: 'Rejected', position: 7, kind: 'rejected' },
];

const candidate = (over: Partial<Candidate>): Candidate => ({
  id: 'a1',
  job_posting_id: 'p1',
  first_name: 'Amina',
  last_name: 'Otieno',
  email: 'amina@example.com',
  phone: '0700000000',
  position: 'Sales Rep',
  status: 'pending',
  current_stage_id: 's-applied',
  stage_changed_at: '2026-10-01T09:00:00Z',
  hired_at: null,
  applied_at: '2026-10-01T09:00:00Z',
  ...over,
});

describe('PipelineBoard', () => {
  const candidates = [
    candidate({}),
    candidate({ id: 'a2', first_name: 'Brian', last_name: 'Kip', current_stage_id: 's-interview' }),
    candidate({ id: 'a3', first_name: 'Chebet', last_name: 'Mo', current_stage_id: 's-hired', hired_at: '2026-10-10T09:00:00Z', status: 'hired' }),
    candidate({ id: 'a4', first_name: 'Dan', last_name: 'Withdrew', status: 'withdrawn' }),
  ];

  it('shows a column per stage, in order, with its candidates', () => {
    render(<PipelineBoard stages={stages} candidates={candidates} onOpen={vi.fn()} onMove={vi.fn()} />);
    const columns = screen.getAllByRole('listitem');
    expect(columns.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Applied (2)',
      'Screening (0)',
      'Interview (1)',
      'Hired (1)',
      'Rejected (0)',
    ]);
    expect(within(columns[0]).getByText('Amina Otieno')).toBeTruthy();
    expect(within(columns[2]).getByText('Brian Kip')).toBeTruthy();
    expect(within(columns[3]).getAllByText('Hired')).toHaveLength(2); // the column and the card's badge
    expect(within(columns[0]).getByText('Withdrawn by the candidate')).toBeTruthy();
  });

  it('moves a candidate with the "Move to" picker, offering every other stage', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<PipelineBoard stages={stages} candidates={candidates} onOpen={vi.fn()} onMove={onMove} />);
    const picker = screen.getByLabelText('Move Brian Kip to') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.text)).toEqual(['Move to...', 'Applied', 'Screening', 'Hired', 'Rejected']);
    fireEvent.change(picker, { target: { value: 's-hired' } });
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }), 's-hired'));
    expect(screen.queryByLabelText('Move Dan Withdrew to')).toBeNull();
  });

  it('opens a candidate', () => {
    const onOpen = vi.fn();
    render(<PipelineBoard stages={stages} candidates={candidates} onOpen={onOpen} onMove={vi.fn()} />);
    fireEvent.click(screen.getByText('Brian Kip'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }));
  });
});

describe('ScorecardForm', () => {
  it('needs a score and a recommendation, then sends the scored criteria', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ScorecardForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Submit scorecard'));
    expect((await screen.findByRole('alert')).textContent).toBe('Score at least one criterion');

    fireEvent.click(screen.getByLabelText('Communication: 4'));
    fireEvent.click(screen.getByText('Submit scorecard'));
    expect((await screen.findByRole('alert')).textContent).toBe('Choose a recommendation');

    fireEvent.change(screen.getByLabelText('New criterion'), { target: { value: 'Sales sense' } });
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByLabelText('Sales sense: 5'));
    fireEvent.click(screen.getByLabelText('Strong yes'));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Great energy' } });
    fireEvent.click(screen.getByText('Submit scorecard'));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        ratings: [
          { criterion: 'Communication', score: 4 },
          { criterion: 'Sales sense', score: 5 },
        ],
        recommendation: 'strong_yes',
        notes: 'Great energy',
      })
    );
  });

  it("edits the panelist's earlier scorecard", () => {
    render(
      <ScorecardForm
        onSubmit={vi.fn()}
        existing={{
          id: 'sc1',
          interview_id: 'i1',
          panelist_id: 'u1',
          recommendation: 'no',
          notes: 'Hmm',
          submitted_at: '2026-10-02T09:00:00Z',
          scorecard_ratings: [{ criterion: 'Experience', score: 2 }],
        }}
      />
    );
    expect(screen.getByLabelText('Experience: 2').getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('No') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Update scorecard')).toBeTruthy();
  });
});

describe('CandidateView', () => {
  const interviews: Interview[] = [
    {
      id: 'i1',
      application_id: 'a1',
      stage_id: 's-interview',
      scheduled_at: '2026-10-05T09:00:00Z',
      duration_minutes: 45,
      mode: 'video',
      location: null,
      meeting_link: 'https://meet.example/abc',
      meeting_code: null,
      status: 'done',
      notes: null,
      interview_panelists: [{ user_id: 'u-me' }, { user_id: 'u-other' }],
      interview_scorecards: [
        {
          id: 'sc1',
          interview_id: 'i1',
          panelist_id: 'u-other',
          recommendation: 'yes',
          notes: 'Solid',
          submitted_at: '2026-10-05T10:00:00Z',
          scorecard_ratings: [
            { criterion: 'Communication', score: 4 },
            { criterion: 'Experience', score: 3 },
          ],
        },
      ],
      interview_transcripts: [
        { id: 't1', kind: 'text', title: 'Interview notes', body: 'Asked about targets', file_path: null, file_name: null, created_at: '2026-10-05T10:00:00Z' },
        { id: 't2', kind: 'file', title: 'call.pdf', body: null, file_path: 'x/i1/f.pdf', file_name: 'call.pdf', created_at: '2026-10-05T10:00:00Z' },
      ],
    },
  ];
  const users = [
    { user_id: 'u-me', full_name: 'Rita Recruiter', email: 'rita@a.co' },
    { user_id: 'u-other', full_name: 'Paul Panel', email: 'paul@a.co' },
  ];
  const actions = (): CandidateActions => ({
    onMove: vi.fn().mockResolvedValue(undefined),
    onSchedule: vi.fn().mockResolvedValue(undefined),
    onInterviewStatus: vi.fn().mockResolvedValue(undefined),
    onScorecard: vi.fn().mockResolvedValue(undefined),
    onAddText: vi.fn().mockResolvedValue(undefined),
    onUpload: vi.fn().mockResolvedValue(undefined),
    onLinkMeeting: vi.fn().mockResolvedValue(undefined),
    onOpenFile: vi.fn(),
    onOpenCv: vi.fn(),
  });
  const view = (a: CandidateActions, over: Partial<Candidate> = {}) =>
    render(
      <CandidateView
        candidate={candidate({ current_stage_id: 's-interview', resume_file_url: 'public/cv.pdf', skills: 'Negotiation', ...over })}
        stages={stages}
        history={[
          { id: 'h2', from_stage_name: 'Applied', to_stage_name: 'Interview', note: 'Good CV', moved_by: 'u-me', moved_at: '2026-10-03T09:00:00Z' },
          { id: 'h1', from_stage_name: null, to_stage_name: 'Applied', note: null, moved_by: null, moved_at: '2026-10-01T09:00:00Z' },
        ]}
        interviews={interviews}
        users={users}
        currentUserId="u-me"
        {...a}
      />
    );

  it('shows details, CV, the stage history, interviews, scores and transcripts together', () => {
    const a = actions();
    view(a);
    expect(screen.getByText('Amina Otieno')).toBeTruthy();
    expect(screen.getByText('Negotiation')).toBeTruthy();
    fireEvent.click(screen.getByText('View CV'));
    expect(a.onOpenCv).toHaveBeenCalled();

    const timeline = screen.getByRole('list', { name: 'Stage history' });
    expect(within(timeline).getByText('Applied → Interview')).toBeTruthy();
    expect(within(timeline).getByText('Good CV')).toBeTruthy();
    expect(within(timeline).getByText(/Rita Recruiter/)).toBeTruthy();

    expect(screen.getByText('Panel: Rita Recruiter, Paul Panel')).toBeTruthy();
    expect(screen.getByText('Paul Panel: Yes')).toBeTruthy();
    expect(screen.getAllByText('3.5 / 5 average from 1 scorecard')).toHaveLength(2); // the candidate and the interview
    expect(screen.getByText('Asked about targets')).toBeTruthy();
    fireEvent.click(screen.getByText('Open call.pdf'));
    expect(a.onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }));
  });

  it('moves the candidate with a note', async () => {
    const a = actions();
    view(a);
    fireEvent.change(screen.getByLabelText('Move to stage'), { target: { value: 's-hired' } });
    fireEvent.change(screen.getByLabelText('Note for this move'), { target: { value: 'Offer accepted' } });
    fireEvent.click(screen.getByText('Move'));
    await waitFor(() => expect(a.onMove).toHaveBeenCalledWith('s-hired', 'Offer accepted'));
  });

  it('shows Hired once the candidate is hired', () => {
    view(actions(), { current_stage_id: 's-hired', hired_at: '2026-10-10T09:00:00Z', status: 'hired' });
    expect(screen.getByText(/Hired on/)).toBeTruthy();
  });

  it('lets a panelist score the interview', async () => {
    const a = actions();
    view(a);
    fireEvent.click(screen.getByText('Score this interview'));
    fireEvent.click(screen.getByLabelText('Experience: 5'));
    fireEvent.click(screen.getByLabelText('Strong yes'));
    fireEvent.click(screen.getByText('Submit scorecard'));
    await waitFor(() =>
      expect(a.onScorecard).toHaveBeenCalledWith('i1', { ratings: [{ criterion: 'Experience', score: 5 }], recommendation: 'strong_yes', notes: '' })
    );
  });

  it('pastes a transcript and links a VideoConf meeting', async () => {
    const a = actions();
    view(a);
    fireEvent.click(screen.getByText('Paste transcript or notes'));
    fireEvent.change(screen.getByLabelText('Transcript text'), { target: { value: 'Q and A' } });
    fireEvent.click(screen.getByText('Save transcript'));
    await waitFor(() => expect(a.onAddText).toHaveBeenCalledWith('i1', '', 'Q and A'));

    fireEvent.click(screen.getByText('Link VideoConf meeting'));
    fireEvent.change(screen.getByLabelText('Meeting code'), { target: { value: 'abc-123' } });
    fireEvent.click(screen.getByText('Link transcript'));
    await waitFor(() => expect(a.onLinkMeeting).toHaveBeenCalledWith('i1', 'abc-123'));
  });

  it('opens the Schedule interview form once a candidate is moved to the interview stage', async () => {
    const a = actions();
    view(a, { current_stage_id: 's-applied' });
    expect(screen.queryByText('Cancel')).toBeNull();
    fireEvent.change(screen.getByLabelText('Move to stage'), { target: { value: 's-interview' } });
    fireEvent.click(screen.getByText('Move'));
    await waitFor(() => expect(a.onMove).toHaveBeenCalledWith('s-interview', ''));
    expect(await screen.findByLabelText('Meeting link')).toBeTruthy();
  });

  it('can open with the Schedule interview form showing', () => {
    render(
      <CandidateView candidate={candidate({ current_stage_id: 's-interview' })} stages={stages} history={[]} interviews={[]} users={users}
        currentUserId="u-me" startScheduling {...actions()} />
    );
    expect(screen.getByLabelText('Meeting link')).toBeTruthy();
  });

  it('knows which stages lead to an interview', () => {
    expect(isInterviewStage({ name: 'Shortlisted', kind: 'open' })).toBe(true);
    expect(isInterviewStage({ name: 'Interview', kind: 'open' })).toBe(true);
    expect(isInterviewStage({ name: 'Screening', kind: 'open' })).toBe(false);
    expect(isInterviewStage(undefined)).toBe(false);
  });

  it('schedules an interview with a panel', async () => {
    const a = actions();
    const { container } = view(a);
    fireEvent.click(screen.getByText('Schedule interview'));
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-11-02' } });
    fireEvent.change(container.querySelector('input[type="time"]')!, { target: { value: '10:30' } });
    fireEvent.change(screen.getByLabelText('Meeting link'), { target: { value: 'https://meet.example/x' } });
    fireEvent.click(screen.getByLabelText('Paul Panel'));
    fireEvent.click(screen.getByText('Schedule'));
    await waitFor(() =>
      expect(a.onSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ applicationId: 'a1', mode: 'video', meetingLink: 'https://meet.example/x', panel: ['u-other'], durationMinutes: 30 }),
        true
      )
    );
  });
});

describe('summariseScores', () => {
  it('averages every score and counts recommendations, leaving out cancelled interviews', () => {
    const card = (recommendation: 'yes' | 'no', scores: number[]) => ({
      id: 'x',
      interview_id: 'i',
      panelist_id: 'p',
      recommendation,
      notes: null,
      submitted_at: '',
      scorecard_ratings: scores.map((score) => ({ criterion: 'c', score })),
    });
    expect(
      summariseScores([
        { status: 'done', interview_scorecards: [card('yes', [5, 4]), card('no', [2])] },
        { status: 'cancelled', interview_scorecards: [card('no', [1])] },
      ])
    ).toEqual({ count: 2, average: 3.7, recommendations: { strong_yes: 0, yes: 1, no: 1, strong_no: 0 } });
    expect(summariseScores([]).average).toBeNull();
  });
});
